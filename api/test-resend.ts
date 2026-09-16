/// <reference lib="dom" />
/// <reference types="node" />

import type { VercelRequest, VercelResponse } from "@vercel/node";

/**
 * api/test-resend.ts
 *
 * Server-side test endpoint for the Resend API.
 * Run it by visiting:
 *   https://YOUR-DEPLOYMENT-URL/api/test-resend
 *
 * It tests whether RESEND_API_KEY is set + valid by sending a real
 * test email. No CORS issues because it runs server-side.
 *
 * Query params:
 *   ?to=myne7x@gmail.com   (optional — defaults to myne7x@gmail.com)
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Always return HTML so it's viewable in the browser
  const toEmail = (req.query.to as string) || "myne7x@gmail.com";

  const apiKey = process.env.RESEND_API_KEY || "";

  // ── Step 1: Check if env var is set ────────────────────────────────────
  if (!apiKey) {
    return res.status(200).send(renderHtml({
      success: false,
      step: "env-check",
      title: "❌ RESEND_API_KEY is not set",
      details: `The RESEND_API_KEY environment variable is not set on Vercel.

To fix:
1. Go to https://vercel.com → your project → Settings → Environment Variables
2. Add a new variable:
   - Key:   RESEND_API_KEY
   - Value: re_xxxxxxxxxxxxxxxxxxxxxxxx
   - Environments: select ALL (Production, Preview, Development)
3. Click Save
4. Redeploy the project (Deployments → ⋯ → Redeploy)
5. Visit this URL again`,
    }));
  }

  // ── Step 2: Check key format ───────────────────────────────────────────
  if (!apiKey.startsWith("re_")) {
    return res.status(200).send(renderHtml({
      success: false,
      step: "key-format",
      title: "❌ API key format is wrong",
      details: `The RESEND_API_KEY env var is set but doesn't start with "re_".

Current value starts with: "${apiKey.substring(0, 8)}..."

A valid Resend API key looks like: re_xxxxxxxxxxxxxxxxxxxxxxxx

Get your key from https://resend.com/api-keys`,
    }));
  }

  // ── Step 3: Try sending a test email ───────────────────────────────────
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "SkyXpress International <noreply@skyxpress.site>",
        to: [toEmail],
        subject: "✈ SkyXpress Resend Test — API Key Works!",
        html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#f8fafc;padding:32px;border-radius:12px;">
  <h1 style="color:#f59e0b;margin-bottom:16px;">✈ Resend API Test Successful</h1>
  <p style="font-size:16px;color:#1e293b;line-height:1.6;">
    If you can see this email, your Resend API key is working correctly!
    You can now send X-Ray emails from the SkyXpress dashboard.
  </p>
  <p style="font-size:14px;color:#64748b;margin-top:24px;">
    Sent from: <code>noreply@skyxpress.site</code><br>
    Sent to: <code>${toEmail}</code><br>
    Time: ${new Date().toISOString()}
  </p>
</div>`,
      }),
    });

    const data = await response.json();

    if (response.ok && data.id) {
      return res.status(200).send(renderHtml({
        success: true,
        step: "send",
        title: "✅ Resend API is working!",
        details: `Email sent successfully!

Email ID: ${data.id}
Sent from: noreply@skyxpress.site
Sent to: ${toEmail}

Check your inbox (and spam folder). The email should arrive within 30 seconds.

You can now send X-Ray emails from the SkyXpress dashboard.`,
      }));
    }

    // ── Error responses ────────────────────────────────────────────────
    let hint = "";
    const msg = (data.message || data.error || JSON.stringify(data)).toLowerCase();

    if (msg.includes("api key") || response.status === 401 || response.status === 403) {
      hint = `The API key is invalid or revoked.

Fix:
1. Go to https://resend.com/api-keys
2. Click "Create API Key"
3. Name it: SkyXpress Production
4. Permission: Full access (NOT "Sending access" only)
5. Copy the new key (starts with re_)
6. Update the RESEND_API_KEY env var on Vercel
7. Redeploy`;
    } else if (msg.includes("sender") || msg.includes("verify")) {
      hint = `The sender email is not verified.

Fix:
- Use "onboarding@resend.dev" as the sender (already set)
- OR verify your own domain at https://resend.com/domains`;
    } else if (msg.includes("rate") || response.status === 429) {
      hint = `Rate limit reached. Wait 1 minute and try again.`;
    }

    return res.status(200).send(renderHtml({
      success: false,
      step: "send",
      title: `❌ Resend API returned HTTP ${response.status}`,
      details: `Error: ${data.message || data.error || JSON.stringify(data)}

${hint}`,
    }));
  } catch (err: any) {
    return res.status(200).send(renderHtml({
      success: false,
      step: "network",
      title: "❌ Network error",
      details: `Could not reach api.resend.com.

Error: ${err.message}

This usually means:
- Vercel's serverless function couldn't reach the internet
- OR there's a DNS issue

Try again in a few seconds.`,
    }));
  }
}

// ─── HTML renderer ────────────────────────────────────────────────────────
function renderHtml({ success, step, title, details }: {
  success: boolean;
  step: string;
  title: string;
  details: string;
}): string {
  const color = success ? "#22c55e" : "#ef4444";
  const bg = success ? "rgba(34,197,94,0.1)" : "rgba(239,68,68,0.1)";
  const border = success ? "rgba(34,197,94,0.3)" : "rgba(239,68,68,0.3)";
  const textColor = success ? "#4ade80" : "#f87171";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Resend API Test — SkyXpress</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%);
      min-height: 100vh; color: #e2e8f0; padding: 20px;
    }
    .container { max-width: 700px; margin: 0 auto; }
    h1 {
      font-size: 28px; font-weight: 800; margin-bottom: 8px;
      background: linear-gradient(135deg, #f59e0b 0%, #f97316 100%);
      -webkit-background-clip: text; -webkit-text-fill-color: transparent;
      background-clip: text;
    }
    .subtitle { color: #94a3b8; margin-bottom: 24px; font-size: 14px; }
    .card {
      background: rgba(30, 41, 59, 0.6);
      border: 1px solid rgba(148, 163, 184, 0.1);
      border-radius: 16px; padding: 24px; margin-bottom: 20px;
      backdrop-filter: blur(8px);
    }
    .status {
      padding: 20px; border-radius: 12px; margin-bottom: 16px;
      background: ${bg}; border: 1px solid ${border};
      color: ${textColor}; font-size: 18px; font-weight: 700;
    }
    .details {
      background: rgba(15, 23, 42, 0.8);
      border: 1px solid rgba(148, 163, 184, 0.2);
      border-radius: 10px; padding: 16px;
      font-family: monospace; font-size: 13px;
      white-space: pre-wrap; word-break: break-word;
      color: #e2e8f0; line-height: 1.6;
    }
    .step {
      display: inline-block;
      font-size: 11px; font-weight: 700;
      text-transform: uppercase; letter-spacing: 1px;
      padding: 3px 10px; border-radius: 20px;
      background: rgba(245, 158, 11, 0.15);
      color: #fbbf24; margin-bottom: 12px;
    }
    .retry {
      display: inline-block; margin-top: 16px;
      padding: 10px 20px;
      background: linear-gradient(135deg, #f59e0b 0%, #f97316 100%);
      color: white; border: none; border-radius: 8px;
      font-size: 14px; font-weight: 700; cursor: pointer;
      text-decoration: none;
    }
    .retry:hover { transform: translateY(-1px); }
  </style>
</head>
<body>
  <div class="container">
    <h1>✈ Resend API Test</h1>
    <p class="subtitle">Server-side test — runs on Vercel, no CORS issues</p>

    <div class="card">
      <span class="step">Step: ${step}</span>
      <div class="status">${title}</div>
      <div class="details">${escapeHtml(details)}</div>
      <a class="retry" href="javascript:location.reload()">↻ Run test again</a>
    </div>

    <div class="card">
      <h2 style="font-size:14px;text-transform:uppercase;letter-spacing:1.5px;color:#f59e0b;margin-bottom:12px;">📋 Setup Checklist</h2>
      <div style="font-size:13px;color:#94a3b8;line-height:2;">
        ${success ? "✅" : "⬜"} 1. RESEND_API_KEY env var is set on Vercel<br>
        ${success ? "✅" : "⬜"} 2. API key starts with "re_"<br>
        ${success ? "✅" : "⬜"} 3. API key is valid (Resend accepts it)<br>
        ${success ? "✅" : "⬜"} 4. Test email was sent successfully<br>
        ${success ? "✅" : "⬜"} 5. Check your inbox for the test email<br>
      </div>
    </div>
  </div>
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
