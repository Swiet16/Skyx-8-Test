/// <reference lib="dom" />
/// <reference types="node" />

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireRole } from "./_lib/auth";
import { fetchParcel } from "./_lib/supabase-server";
import { createXrayEmailHtml } from "./_lib/emailTemplate";
import { sendResendEmail } from "./_lib/resend-client";

/**
 * api/send-parcel-email.ts
 *
 * Sends the X-Ray cleared email to the parcel's receiver_email.
 *
 * NOW USES RESEND instead of Brevo — Resend has no IP restriction,
 * so it works from any Vercel serverless IP without whitelisting.
 *
 * The email template (createXrayEmailHtml) is UNCHANGED — same design.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const auth = await requireRole(req.headers.authorization, ["admin", "staff", "developer"]);
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

  const result = await sendResendEmail({
    to: recipientEmail,
    subject: `✈ X-Ray Cleared — Ref: ${ref} | SkyXpress`,
    htmlContent: html,
    fromName: "SkyXpress International",
    fromEmail: "noreply@skyxpress.site", // Verified domain — can send to anyone
    tags: ["x-ray", "parcel"],
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
    }).catch(() => {});

    res.json({
      success: true,
      messageId: result.messageId,
      sentTo: recipientEmail,
      provider: "resend",
    });
    return;
  }

  // Failed — translate the error into an HTTP status + clear message
  const code = result.error?.code;
  const status =
    code === "key_missing" || code === "key_invalid" ? 503 :
    code === "rate_limited" ? 429 :
    code === "sender_not_verified" ? 400 :
    code === "recipient_invalid" ? 400 :
    502;

  res.status(status).json({
    error: code || "unknown",
    message: result.error?.message,
    retryAfter: result.error?.retryAfter,
    queuedForRetry: result.queuedForRetry,
    queueId: result.queueId,
    provider: "resend",
    hint:
      code === "key_missing"
        ? "Set the RESEND_API_KEY environment variable on Vercel."
        : code === "sender_not_verified"
        ? "Verify your domain at https://resend.com/domains, or use onboarding@resend.dev for testing."
        : code === "rate_limited"
        ? "Too many emails sent recently — wait a minute and try again."
        : undefined,
  });
}
