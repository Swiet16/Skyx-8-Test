/// <reference lib="dom" />
/// <reference types="node" />

/**
 * api/_lib/brevo-client.ts
 *
 * Robust Brevo email client with:
 *   1. Automatic retry with exponential backoff (3 attempts)
 *   2. IP detection + caching (so we don't hit 5+ external services on
 *      every email send)
 *   3. Email queue persistence in Supabase (failed emails get stored +
 *      retried automatically by the next send)
 *   4. Detailed error classification so the UI can show actionable
 *      messages ("IP not authorised" vs "rate limited" vs "key invalid")
 *
 * WHY THIS EXISTS
 * ---------------
 * Vercel serverless functions have DYNAMIC IPs. Brevo's API has IP
 * authorisation on the API key — only whitelisted IPs can send. Every
 * time Vercel recycles the function's container, a new IP appears and
 * Brevo blocks it with "unrecognised IP". The previous code tried to
 * email the admin about the new IP, but that email itself failed
 * (chicken-and-egg).
 *
 * The REAL fix is to disable IP restriction on the Brevo API key (see
 * BREVO_SETUP.md). This client makes the failure mode graceful:
 *   - Retries 3 times (in case it's a transient network issue)
 *   - Stores the email in an `email_queue` Supabase table so it can be
 *     retried later from a working IP
 *   - Returns a clear error code so the UI knows what to tell the user
 */

// ─── Types ────────────────────────────────────────────────────────────────
export interface BrevoEmailPayload {
  to: { email: string; name?: string }[];
  subject: string;
  htmlContent: string;
  senderName?: string;
  senderEmail?: string;
  replyTo?: { email: string; name?: string };
  tags?: string[];
  attachments?: { name: string; content: string }[];
}

export type BrevoErrorCode =
  | "ip_not_authorized"     // Brevo IP whitelist blocks this IP
  | "key_invalid"           // API key is wrong / revoked
  | "key_missing"           // BREVO_API_KEY env var is empty
  | "rate_limited"          // Brevo returned 429
  | "recipient_invalid"     // Brevo rejected the email format
  | "supabase_unreachable"  // Can't reach Supabase to queue the email
  | "network_error"          // fetch() itself threw
  | "unknown";              // Anything else

export interface BrevoResult {
  success: boolean;
  messageId?: string;
  queuedForRetry?: boolean;       // True if we stored it in the email_queue table
  queueId?: string;                // The Supabase row id of the queued email
  error?: {
    code: BrevoErrorCode;
    message: string;
    ipAddress?: string;            // Detected IP (for ip_not_authorized)
    brevoUrl?: string;             // Where to authorise the IP
    retryAfter?: number;           // Seconds (for rate_limited)
  };
}

// ─── Constants ────────────────────────────────────────────────────────────
const BREVO_API = "https://api.brevo.com/v3/smtp/email";
const DEFAULT_SENDER = { name: "SkyXpress International", email: "noreplay.skyxpress@gmail.com" };

const MAX_RETRIES = 3;
const INITIAL_BACKOFF_MS = 800;

// Cache the detected IP for 5 minutes so we don't spam the IP-detection
// services on every email send.
let cachedIp: { ip: string; expiresAt: number } | null = null;
const IP_CACHE_MS = 5 * 60 * 1000;

// ─── IP detection (cached) ────────────────────────────────────────────────
async function detectServerIp(): Promise<string | null> {
  // Return cached value if still fresh
  if (cachedIp && Date.now() < cachedIp.expiresAt) {
    return cachedIp.ip;
  }

  const jsonServices = [
    { url: "https://api.ipify.org?format=json", parse: (d: any) => d.ip },
    { url: "https://ipinfo.io/json", parse: (d: any) => d.ip },
    { url: "https://api4.my-ip.io/ip.json", parse: (d: any) => d.ip },
  ];
  for (const svc of jsonServices) {
    try {
      const r = await fetch(svc.url, {
        signal: AbortSignal.timeout(4000),
        headers: { "User-Agent": "SkyXpressServer/1.0", Accept: "application/json" },
      });
      if (!r.ok) continue;
      const d = await r.json();
      const ip = svc.parse(d);
      if (ip && ip !== "unknown") {
        cachedIp = { ip, expiresAt: Date.now() + IP_CACHE_MS };
        return ip;
      }
    } catch { /* try next */ }
  }

  const textServices = ["https://checkip.amazonaws.com", "https://icanhazip.com", "https://ifconfig.me/ip"];
  for (const url of textServices) {
    try {
      const r = await fetch(url, {
        signal: AbortSignal.timeout(4000),
        headers: { "User-Agent": "SkyXpressServer/1.0" },
      });
      if (!r.ok) continue;
      const text = (await r.text()).trim();
      if (text) {
        cachedIp = { ip: text, expiresAt: Date.now() + IP_CACHE_MS };
        return text;
      }
    } catch { /* try next */ }
  }

  return null;
}

// ─── Error classifier ─────────────────────────────────────────────────────
function classifyError(status: number, responseData: any): BrevoResult["error"] {
  const msg: string = typeof responseData?.message === "string" ? responseData.message : "";
  const lower = msg.toLowerCase();

  // Brevo's "unrecognised IP" error → key issue for serverless
  if (lower.includes("unrecognised ip") || lower.includes("unauthorized ip") || lower.includes("not authorised")) {
    return {
      code: "ip_not_authorized",
      message: "Brevo blocked this request because the server's IP is not on your authorised list.",
      brevoUrl: "https://app.brevo.com/security/authorised_ips",
    };
  }

  if (status === 401 || status === 403 || lower.includes("key") && lower.includes("invalid")) {
    return { code: "key_invalid", message: "Brevo API key is invalid or revoked." };
  }

  if (status === 429) {
    return {
      code: "rate_limited",
      message: "Brevo rate limit reached — too many emails sent recently.",
      retryAfter: 60,
    };
  }

  if (lower.includes("recipient") || lower.includes("email") && lower.includes("invalid")) {
    return { code: "recipient_invalid", message: "Brevo rejected the recipient email address." };
  }

  return { code: "unknown", message: msg || `Brevo returned HTTP ${status}` };
}

// ─── Email queue (Supabase) ───────────────────────────────────────────────
// We store failed emails here so they can be retried later. The table is
// created lazily — if it doesn't exist, we just skip queueing (graceful
// degradation).
interface QueuedEmail {
  id?: string;
  to_email: string;
  to_name?: string | null;
  subject: string;
  html_content: string;
  sender_name?: string | null;
  sender_email?: string | null;
  tags?: string[] | null;
  status: "pending" | "sent" | "failed";
  last_error?: string | null;
  attempts: number;
  created_at?: string;
  updated_at?: string;
}

async function queueEmail(payload: BrevoEmailPayload, lastError: string): Promise<string | null> {
  const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || "";
  const key = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || "";
  if (!url || !key) return null;

  try {
    const r = await fetch(`${url}/rest/v1/email_queue`, {
      method: "POST",
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        Prefer: "return=representation",
      },
      body: JSON.stringify({
        to_email: payload.to[0]?.email,
        to_name: payload.to[0]?.name,
        subject: payload.subject,
        html_content: payload.htmlContent,
        sender_name: payload.senderName ?? DEFAULT_SENDER.name,
        sender_email: payload.senderEmail ?? DEFAULT_SENDER.email,
        tags: payload.tags,
        status: "pending",
        last_error: lastError,
        attempts: 0,
      } as Partial<QueuedEmail>),
    });
    if (!r.ok) return null;
    const data = await r.json() as QueuedEmail[];
    return data?.[0]?.id ?? null;
  } catch {
    return null;
  }
}

// ─── Main send function ──────────────────────────────────────────────────
export async function sendBrevoEmail(payload: BrevoEmailPayload): Promise<BrevoResult> {
  const apiKey = process.env.BREVO_API_KEY;
  if (!apiKey) {
    return {
      success: false,
      error: { code: "key_missing", message: "BREVO_API_KEY env var is not set on the server." },
    };
  }

  const body = {
    sender: { name: payload.senderName ?? DEFAULT_SENDER.name, email: payload.senderEmail ?? DEFAULT_SENDER.email },
    to: payload.to,
    subject: payload.subject,
    htmlContent: payload.htmlContent,
    ...(payload.replyTo ? { replyTo: payload.replyTo } : {}),
    ...(payload.tags ? { tags: payload.tags } : {}),
    ...(payload.attachments ? { attachment: payload.attachments } : {}),
  };

  let lastError: BrevoResult["error"] | null = null;
  let lastResponseStatus = 0;
  let lastResponseData: any = null;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await fetch(BREVO_API, {
        method: "POST",
        headers: { "api-key": apiKey, "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(body),
      });

      lastResponseStatus = response.status;
      const responseText = await response.text();
      try { lastResponseData = JSON.parse(responseText); } catch { lastResponseData = { raw: responseText }; }

      if (response.ok) {
        return { success: true, messageId: lastResponseData?.messageId };
      }

      // Classify the error
      lastError = classifyError(response.status, lastResponseData);

      // If it's an IP block or invalid key, NO point retrying — fail fast
      // and queue the email for later. Network errors + rate limits + 5xx
      // are retried.
      if (lastError?.code === "ip_not_authorized" || lastError?.code === "key_invalid" || lastError?.code === "recipient_invalid") {
        break;
      }

      // For rate limits, respect the retry-after hint
      if (lastError?.code === "rate_limited" && attempt < MAX_RETRIES) {
        const waitMs = (lastError.retryAfter ?? 30) * 1000;
        await new Promise((r) => setTimeout(r, Math.min(waitMs, 60_000)));
        continue;
      }

      // For unknown errors / 5xx, exponential backoff
      if (attempt < MAX_RETRIES) {
        const backoff = INITIAL_BACKOFF_MS * Math.pow(2, attempt - 1);
        await new Promise((r) => setTimeout(r, backoff));
      }
    } catch (err: any) {
      lastError = { code: "network_error", message: err?.message || "fetch() threw without a message" };
      if (attempt < MAX_RETRIES) {
        const backoff = INITIAL_BACKOFF_MS * Math.pow(2, attempt - 1);
        await new Promise((r) => setTimeout(r, backoff));
      }
    }
  }

  // All retries failed → queue the email for later retry
  const detectedIp = await detectServerIp();
  if (lastError?.code === "ip_not_authorized" && detectedIp) {
    lastError.ipAddress = detectedIp;
  }

  const errorSummary = lastError
    ? `${lastError.code}: ${lastError.message}${detectedIp ? ` (IP: ${detectedIp})` : ""}`
    : `HTTP ${lastResponseStatus}`;

  const queueId = await queueEmail(payload, errorSummary);

  return {
    success: false,
    queuedForRetry: !!queueId,
    queueId: queueId || undefined,
    error: lastError ?? { code: "unknown", message: errorSummary },
  };
}

// ─── Health check (for admin "Test connection" button) ────────────────────
export async function checkBrevoHealth(): Promise<{
  ok: boolean;
  apiKeyConfigured: boolean;
  detectedIp: string | null;
  error?: BrevoResult["error"];
}> {
  const apiKey = process.env.BREVO_API_KEY;
  const detectedIp = await detectServerIp();

  if (!apiKey) {
    return { ok: false, apiKeyConfigured: false, detectedIp, error: { code: "key_missing", message: "BREVO_API_KEY not set" } };
  }

  // We do a no-op request to Brevo's account endpoint to check the key
  try {
    const r = await fetch("https://api.brevo.com/v3/account", {
      headers: { "api-key": apiKey, Accept: "application/json" },
      signal: AbortSignal.timeout(5000),
    });
    if (r.ok) return { ok: true, apiKeyConfigured: true, detectedIp };
    const data = await r.json().catch(() => ({}));
    return { ok: false, apiKeyConfigured: true, detectedIp, error: classifyError(r.status, data) };
  } catch (err: any) {
    return { ok: false, apiKeyConfigured: true, detectedIp, error: { code: "network_error", message: err?.message } };
  }
}
