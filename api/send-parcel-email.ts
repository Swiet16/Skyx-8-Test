/// <reference lib="dom" />
/// <reference types="node" />

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireRole } from "./_lib/auth";
import { fetchParcel } from "./_lib/supabase-server";
import { createXrayEmailHtml } from "./_lib/emailTemplate";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  // 1. Authenticate & authorise
  const auth = await requireRole(req.headers.authorization, ["admin", "staff", "developer"]);
  if (!auth.ok) {
    res.status(auth.status).json({ error: auth.error });
    return;
  }

  // 2. Validate request body
  const { parcelId } = req.body ?? {};
  if (!parcelId || typeof parcelId !== "string") {
    res.status(400).json({ error: "Missing or invalid parcelId" });
    return;
  }

  // 3. Fetch parcel server-side (RLS enforces access)
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

  // 4. Rate-limit: 5-minute cooldown per parcel
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

  // 5. Check Brevo key
  const apiKey = process.env.BREVO_API_KEY;
  if (!apiKey) {
    res.status(503).json({ error: "Email service is not configured (BREVO_API_KEY missing)" });
    return;
  }

  // 6. Build & send email
  const html = createXrayEmailHtml(parcel);
  const ref = parcel.reference_id || parcel.tracking_id || "your parcel";

  try {
    const response = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: { "api-key": apiKey, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        sender: { name: "SkyXpress International", email: "noreplay.skyxpress@gmail.com" },
        to: [{ email: recipientEmail, name: parcel.sender_name || recipientEmail }],
        subject: `✈ X-Ray Cleared — Ref: ${ref} | SkyXpress`,
        htmlContent: html,
      }),
    });

    const responseText = await response.text();
    let responseData: any = {};
    try { responseData = JSON.parse(responseText); } catch { responseData = { raw: responseText }; }

    if (!response.ok) {
      const isIpBlock =
        typeof responseData?.message === "string" &&
        responseData.message.toLowerCase().includes("unrecognised ip");
      res.status(502).json({
        error: isIpBlock ? "ip_not_authorized" : "Failed to send email via Brevo",
        ...(isIpBlock && {
          ipAddress: (responseData.message as string).match(/\d+\.\d+\.\d+\.\d+/)?.[0],
          brevoUrl: "https://app.brevo.com/security/authorised_ips",
        }),
        details: responseData,
      });
      return;
    }

    res.json({ success: true, messageId: responseData.messageId, sentTo: recipientEmail });
  } catch (err: any) {
    res.status(500).json({ error: "Internal error sending email", message: err.message });
  }
}
