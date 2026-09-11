/// <reference lib="dom" />
/// <reference types="node" />

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireRole } from "./_lib/auth";
import { fetchParcel } from "./_lib/supabase-server";
import { createXrayEmailHtml } from "./_lib/emailTemplate";
import { sendBrevoEmail } from "./_lib/brevo-client";

/**
 * api/send-parcel-email.ts
 *
 * Sends the X-Ray cleared email to the parcel's receiver_email.
 *
 * REFACTORED to use the new brevo-client.ts which:
 *   - Retries transient failures 3 times with exponential backoff
 *   - Detects the server's IP once + caches it for 5 minutes
 *   - Classifies errors (IP block / invalid key / rate limit / network)
 *   - Queues failed emails in a Supabase `email_queue` table for later retry
 *
 * The previous version would fail silently when Vercel's IP rotated out
 * of Brevo's whitelist. Now the UI gets a clear error code AND the email
 * is stored in the queue so it can be retried once the IP is fixed.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const auth = await requireRole(req.headers.authorization, ["admin", "staff", "developer", "partner"]);
  if (!auth.ok) {
    res.status(auth.status).json({ error: auth.error });
    return;
  }

  const { parcelId } = req.body ?? {};
  if (!parcelId || typeof parcelId !== "string") {
    res.status(400).json({ error: "Missing or invalid parcelId" });
    return;
  }

  const parcel = await fetchParcel(auth.token, parcelId);
  if (!parcel) {
    res.status(404).json({ error: "Parcel not found or access denied" });
    return;
  }

  const recipientEmail = typeof parcel.receiver_email === "string" ? parcel.receiver_email.trim() : "";
  if (!recipientEmail) {
    res.status(400).json({ error: "Parcel has no receiver_email — cannot send notification" });
    return;
  }

  // Rate-limit: 5-minute cooldown per parcel
  if (parcel.xray_email_sent_at) {
    const lastSent = new Date(parcel.xray_email_sent_at).getTime();
    const cooldownMs = 5 * 60 * 1000;
    if (Date.now() - lastSent < cooldownMs) {
      res.status(429).json({
        error: "Email was already sent recently. Please wait before resending.",
        retryAfter: Math.ceil((cooldownMs - (Date.now() - lastSent)) / 1000),
      });
      return;
    }
  }

  const html = createXrayEmailHtml(parcel);
  const ref = parcel.reference_id || parcel.tracking_id || "your parcel";

  const result = await sendBrevoEmail({
    to: [{ email: recipientEmail, name: parcel.sender_name || recipientEmail }],
    subject: `✈ X-Ray Cleared — Ref: ${ref} | SkyXpress`,
    htmlContent: html,
    tags: ["x-ray", "parcel", parcel.tracking_id || ""].filter(Boolean),
  });

  if (result.success) {
    // Stamp the parcel row so the UI shows "Email sent ✓"
    await fetch(`${process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL}/rest/v1/parcels?id=eq.${parcelId}`, {
      method: "PATCH",
      headers: {
        apikey: process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || "",
        Authorization: `Bearer ${auth.token}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify({ xray_email_sent_at: new Date().toISOString() }),
    }).catch(() => {}); // best-effort — the email was already sent

    res.json({
      success: true,
      messageId: result.messageId,
      sentTo: recipientEmail,
    });
    return;
  }

  // Failed — translate the error into an HTTP status + clear message
  const code = result.error?.code;
  const status =
    code === "key_missing" || code === "key_invalid" ? 503 :
    code === "rate_limited" ? 429 :
    code === "ip_not_authorized" ? 502 :
    code === "recipient_invalid" ? 400 :
    502;

  res.status(status).json({
    error: code || "unknown",
    message: result.error?.message,
    ipAddress: result.error?.ipAddress,
    brevoUrl: result.error?.brevoUrl,
    retryAfter: result.error?.retryAfter,
    queuedForRetry: result.queuedForRetry,
    queueId: result.queueId,
    // Friendly hint shown in the UI
    hint:
      code === "ip_not_authorized"
        ? "Brevo is blocking this server's IP. Go to https://app.brevo.com/security/authorised_ips and add the IP shown, OR disable IP restriction entirely (recommended for serverless)."
        : code === "key_missing"
        ? "Set the BREVO_API_KEY environment variable on Vercel."
        : code === "rate_limited"
        ? "Too many emails sent recently — wait a minute and try again."
        : undefined,
  });
}
