/// <reference lib="dom" />
/// <reference types="node" />

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireRole } from "./_lib/auth";

async function detectIp(): Promise<string> {
  const jsonServices = [
    { url: "https://api.ipify.org?format=json", parse: (d: any) => d.ip },
    { url: "https://api4.my-ip.io/ip.json", parse: (d: any) => d.ip },
    { url: "https://ipinfo.io/json", parse: (d: any) => d.ip },
  ];
  for (const svc of jsonServices) {
    try {
      const r = await fetch(svc.url, {
        signal: AbortSignal.timeout(5000),
        headers: { "User-Agent": "Mozilla/5.0 (compatible; SkyXpressServer/1.0)", Accept: "application/json" },
      });
      if (!r.ok) continue;
      const d = await r.json();
      const ip = svc.parse(d);
      if (ip && ip !== "unknown") return ip;
    } catch { /* try next */ }
  }
  for (const url of ["https://checkip.amazonaws.com", "https://icanhazip.com", "https://ifconfig.me/ip"]) {
    try {
      const r = await fetch(url, {
        signal: AbortSignal.timeout(5000),
        headers: { "User-Agent": "Mozilla/5.0 (compatible; SkyXpressServer/1.0)" },
      });
      if (!r.ok) continue;
      const text = (await r.text()).trim();
      if (text) return text;
    } catch { /* try next */ }
  }
  return "unavailable";
}

const buildEmailHtml = (ip: string, ts: string) => `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Brevo IP Authorization Required</title>
</head>
<body style="margin:0;padding:0;background:#0f1117;font-family:'Segoe UI',Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#0f1117;padding:40px 0;">
  <tr><td align="center">
    <table width="560" cellpadding="0" cellspacing="0" style="background:#1a1d2e;border-radius:16px;overflow:hidden;border:1px solid #2a2d3e;">
      <tr>
        <td style="background:linear-gradient(135deg,#1e3a8a 0%,#1e40af 50%,#c2410c 100%);padding:32px 40px;text-align:center;">
          <p style="margin:0 0 6px;font-size:11px;letter-spacing:3px;text-transform:uppercase;color:rgba(255,255,255,0.6);">SkyXpress International</p>
          <h1 style="margin:0;font-size:26px;font-weight:800;color:#ffffff;">✈ IP Authorization Required</h1>
          <p style="margin:10px 0 0;font-size:13px;color:rgba(255,255,255,0.7);">Action needed to restore email delivery</p>
        </td>
      </tr>
      <tr>
        <td style="padding:36px 40px;">
          <table width="100%" cellpadding="0" cellspacing="0" style="background:#0f1117;border:1px solid #2a2d3e;border-radius:12px;margin-bottom:28px;">
            <tr>
              <td style="padding:20px 24px;">
                <p style="margin:0 0 8px;font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#64748b;">Server IP Address</p>
                <p style="margin:0;font-size:28px;font-weight:700;color:#60a5fa;letter-spacing:2px;font-family:'Courier New',monospace;">${ip}</p>
                <p style="margin:6px 0 0;font-size:11px;color:#475569;">Detected at ${ts} UTC</p>
              </td>
            </tr>
          </table>
          <table width="100%" cellpadding="0" cellspacing="0">
            ${[
              ["1", "Log in to your Brevo account", "Go to <strong>app.brevo.com</strong> and sign in"],
              ["2", "Open Security Settings", "Navigate to <strong>Settings → Security → Authorised IPs</strong>"],
              ["3", "Add the IP address", "Click <strong>Add an IP address</strong> and enter the IP shown above"],
              ["4", "Save &amp; test", "Click Save — your next email send will go through immediately"],
            ].map(([num, title, desc]) => `
            <tr><td style="padding:0 0 14px;">
              <table width="100%" cellpadding="0" cellspacing="0" style="background:#1e2235;border-radius:10px;border-left:3px solid #3b82f6;">
                <tr><td style="padding:14px 16px;">
                  <table cellpadding="0" cellspacing="0"><tr>
                    <td style="width:28px;height:28px;background:#3b82f6;border-radius:50%;text-align:center;vertical-align:middle;">
                      <span style="font-size:13px;font-weight:700;color:#fff;">${num}</span>
                    </td>
                    <td style="padding-left:12px;">
                      <p style="margin:0 0 3px;font-size:14px;font-weight:600;color:#e2e8f0;">${title}</p>
                      <p style="margin:0;font-size:12px;color:#94a3b8;">${desc}</p>
                    </td>
                  </tr></table>
                </td></tr>
              </table>
            </td></tr>`).join("")}
          </table>
          <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:8px;">
            <tr><td align="center">
              <a href="https://app.brevo.com/security/authorised_ips"
                 style="display:inline-block;background:linear-gradient(135deg,#2563eb,#1d4ed8);color:#ffffff;font-size:14px;font-weight:700;text-decoration:none;padding:14px 36px;border-radius:10px;">
                Open Brevo Authorised IPs →
              </a>
            </td></tr>
          </table>
        </td>
      </tr>
      <tr>
        <td style="background:#0f1117;padding:20px 40px;border-top:1px solid #2a2d3e;text-align:center;">
          <p style="margin:0;font-size:11px;color:#475569;">SkyXpress International Courier &amp; Cargo · Automated system notification</p>
        </td>
      </tr>
    </table>
  </td></tr>
</table>
</body>
</html>`;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  // Admin-only endpoint
  const auth = await requireRole(req.headers.authorization, ["admin"]);
  if (!auth.ok) {
    res.status(auth.status).json({ error: auth.error });
    return;
  }

  const apiKey = process.env.BREVO_API_KEY;
  if (!apiKey) {
    res.status(503).json({ error: "Email service not configured (BREVO_API_KEY missing)" });
    return;
  }

  const ip = await detectIp();
  const ts = new Date().toUTCString();
  const html = buildEmailHtml(ip, ts);

  const payload = {
    sender: { name: "SkyXpress System", email: "noreplay.skyxpress@gmail.com" },
    to: [{ email: "myne7x@gmail.com", name: "SkyXpress Admin" }],
    subject: `🔐 Brevo IP Authorization Needed — ${ip}`,
    htmlContent: html,
  };

  try {
    const response = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: { "api-key": apiKey, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(payload),
    });

    const text = await response.text();
    let data: any = {};
    try { data = JSON.parse(text); } catch { data = { raw: text }; }

    if (!response.ok) {
      res.status(502).json({ error: "Failed to send authorization email", details: data });
      return;
    }

    res.json({ success: true, ip, messageId: data.messageId });
  } catch (err: any) {
    res.status(500).json({ error: "Internal error", message: err.message });
  }
}
