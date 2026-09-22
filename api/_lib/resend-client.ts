/// <reference lib="dom" />
/// <reference types="node" />

/**
 * api/_lib/resend-client.ts
 *
 * Resend email client — replaces the Brevo client.
 *
 * WHY RESEND INSTEAD OF BREVO?
 * Brevo has IP authorisation on API keys — every time Vercel recycles
 * its serverless container, a new IP appears and Brevo blocks it with
 * "unrecognised IP". Resend has NO IP restriction — it works from any
 * IP out of the box, which is perfect for serverless deployments.
 *
 * Free tier: 3,000 emails/month (vs Brevo's 300/day).
 *
 * API: https://resend.com/api-docs
 *   POST https://api.resend.com/emails
 *   Authorization: Bearer re_xxx
 *   Body: { from, to, subject, html }
 *
 * The sender email must be from a verified domain. For testing, Resend
 * provides a default sender: onboarding@resend.dev
 */

// ─── Types ────────────────────────────────────────────────────────────────
export interface ResendEmailPayload {
  to: string | string[];
  subject: string;
  htmlContent: string;
  fromName?: string;
  fromEmail?: string;
  replyTo?: string;
  tags?: string[];
}

export type ResendErrorCode =
  | "key_missing"
  | "key_invalid"
  | "rate_limited"
  | "recipient_invalid"
  | "sender_not_verified"
  | "network_error"
  | "supabase_unreachable"
  | "unknown";

export interface ResendResult {
  success: boolean;
  messageId?: string;
  queuedForRetry?: boolean;
  queueId?: string;
  error?: {
    code: ResendErrorCode;
    message: string;
    retryAfter?: number;
  };
}

// ─── Constants ────────────────────────────────────────────────────────────
const RESEND_API = "https://api.resend.com/emails";

// Default sender — myskyxpress.com is verified in Resend, so this can
// deliver to any inbox (not just the account owner).
const DEFAULT_FROM = {
  name: "SkyXpress International",
  email: "noreply@myskyxpress.com",
};

const MAX_RETRIES = 3;
const INITIAL_BACKOFF_MS = 800;

// ─── Error classifier ─────────────────────────────────────────────────────
function classifyError(status: number, responseData: any): ResendResult["error"] {
  const msg: string =
    typeof responseData?.message === "string"
      ? responseData.message
      : typeof responseData?.error === "string"
        ? responseData.error
        : JSON.stringify(responseData || {});

  const lower = msg.toLowerCase();

  if (status === 401 || status === 403 || lower.includes("api key")) {
    return { code: "key_invalid", message: "Resend API key is invalid or missing." };
  }

  if (status === 429) {
    return {
      code: "rate_limited",
      message: "Resend rate limit reached — too many emails sent recently.",
      retryAfter: 60,
    };
  }

  if (lower.includes("sender") && (lower.includes("verify") || lower.includes("not verified"))) {
    return {
      code: "sender_not_verified",
      message: "The sender email domain is not verified in Resend. Use onboarding@resend.dev for testing, or verify your domain at https://resend.com/domains",
    };
  }

  if (lower.includes("recipient") || lower.includes("email") && lower.includes("invalid")) {
    return { code: "recipient_invalid", message: "Resend rejected the recipient email address." };
  }

  return { code: "unknown", message: msg || `Resend returned HTTP ${status}` };
}

// ─── Email queue (Supabase) — same as the Brevo client ────────────────────
async function queueEmail(payload: ResendEmailPayload, lastError: string): Promise<string | null> {
  const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || "";
  const key = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || "";
  if (!url || !key) return null;

  try {
    const toStr = Array.isArray(payload.to) ? payload.to[0] : payload.to;
    const r = await fetch(`${url}/rest/v1/email_queue`, {
      method: "POST",
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        Prefer: "return=representation",
      },
      body: JSON.stringify({
        to_email: toStr,
        subject: payload.subject,
        html_content: payload.htmlContent,
        sender_name: payload.fromName ?? DEFAULT_FROM.name,
        sender_email: payload.fromEmail ?? DEFAULT_FROM.email,
        tags: payload.tags,
        status: "pending",
        last_error: lastError,
        attempts: 0,
      }),
    });
    if (!r.ok) return null;
    const data = await r.json();
    return data?.[0]?.id ?? null;
  } catch {
    return null;
  }
}

// ─── Main send function ──────────────────────────────────────────────────
export async function sendResendEmail(payload: ResendEmailPayload): Promise<ResendResult> {
  const apiKey =
    process.env.RESEND_API_KEY ||
    process.env.BREVO_API_KEY || // fallback to old env var name
    "";

  // API key must be set via the RESEND_API_KEY env var on Vercel.
  // Do NOT hardcode the key here — GitHub push protection will block it.
  const finalApiKey = apiKey;

  if (!finalApiKey) {
    return {
      success: false,
      error: { code: "key_missing", message: "RESEND_API_KEY env var is not set." },
    };
  }

  const fromEmail = payload.fromEmail || DEFAULT_FROM.email;
  const fromName = payload.fromName || DEFAULT_FROM.name;
  const toArray = Array.isArray(payload.to) ? payload.to : [payload.to];

  const body = {
    from: `${fromName} <${fromEmail}>`,
    to: toArray,
    subject: payload.subject,
    html: payload.htmlContent,
    ...(payload.replyTo ? { reply_to: payload.replyTo } : {}),
    ...(payload.tags ? { tags: payload.tags.map((name) => ({ name })) } : {}),
  };

  let lastError: ResendResult["error"] | null = null;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await fetch(RESEND_API, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${finalApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });

      const responseText = await response.text();
      let responseData: any = {};
      try { responseData = JSON.parse(responseText); } catch { responseData = { raw: responseText }; }

      if (response.ok) {
        return { success: true, messageId: responseData.id };
      }

      lastError = classifyError(response.status, responseData);

      // Don't retry on key_invalid or sender_not_verified — they won't fix themselves
      if (lastError?.code === "key_invalid" || lastError?.code === "sender_not_verified") {
        break;
      }

      // Rate limit: respect retry-after
      if (lastError?.code === "rate_limited" && attempt < MAX_RETRIES) {
        const waitMs = (lastError.retryAfter ?? 30) * 1000;
        await new Promise((r) => setTimeout(r, Math.min(waitMs, 60_000)));
        continue;
      }

      // Unknown / network: exponential backoff
      if (attempt < MAX_RETRIES) {
        const backoff = INITIAL_BACKOFF_MS * Math.pow(2, attempt - 1);
        await new Promise((r) => setTimeout(r, backoff));
      }
    } catch (err: any) {
      lastError = { code: "network_error", message: err?.message || "fetch() threw" };
      if (attempt < MAX_RETRIES) {
        const backoff = INITIAL_BACKOFF_MS * Math.pow(2, attempt - 1);
        await new Promise((r) => setTimeout(r, backoff));
      }
    }
  }

  // All retries failed → queue the email
  const errorSummary = lastError
    ? `${lastError.code}: ${lastError.message}`
    : "All retries failed";

  const queueId = await queueEmail(payload, errorSummary);

  return {
    success: false,
    queuedForRetry: !!queueId,
    queueId: queueId || undefined,
    error: lastError ?? { code: "unknown", message: errorSummary },
  };
}

// ─── Health check ─────────────────────────────────────────────────────────
export async function checkResendHealth(): Promise<{
  ok: boolean;
  apiKeyConfigured: boolean;
  error?: ResendResult["error"];
}> {
  const apiKey = process.env.RESEND_API_KEY || "";
  if (!apiKey) {
    return { ok: false, apiKeyConfigured: false, error: { code: "key_missing", message: "RESEND_API_KEY not set" } };
  }

  try {
    // Resend doesn't have a dedicated "account" endpoint like Brevo,
    // so we do a minimal API call to check if the key is valid.
    // Sending to a known-bad email returns 422, which still proves the key works.
    const r = await fetch(RESEND_API, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: DEFAULT_FROM.email,
        to: "test@resend.dev",
        subject: "Health check",
        html: "<p>Test</p>",
      }),
      signal: AbortSignal.timeout(5000),
    });

    // 200 = sent successfully
    // 422 = key works but email rejected (fine for health check)
    // 401/403 = key invalid
    if (r.ok || r.status === 422) {
      return { ok: true, apiKeyConfigured: true };
    }
    const data = await r.json().catch(() => ({}));
    return { ok: false, apiKeyConfigured: true, error: classifyError(r.status, data) };
  } catch (err: any) {
    return { ok: false, apiKeyConfigured: true, error: { code: "network_error", message: err?.message } };
  }
}
