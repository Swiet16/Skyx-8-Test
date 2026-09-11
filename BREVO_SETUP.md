# Brevo Email Setup — Fix for "IP keeps disconnecting"

## The problem

You're sending emails from Vercel serverless functions using the Brevo API. **Brevo has IP authorization on API keys** — only whititelisted IPs can send emails. **Vercel serverless functions have DYNAMIC IPs** (each invocation may come from a different IP), so every time Vercel recycles the container, a new IP appears and Brevo blocks it with `"unrecognised IP"`.

Your previous code tried to email you about the new IP, but **that email itself failed** (chicken-and-egg — the email telling you to whitelist the IP couldn't be sent because the IP wasn't whitelisted).

## The permanent fix — disable IP restriction (RECOMMENDED)

This is the standard solution for serverless deployments. Do this once and you'll never have IP issues again.

### Steps

1. **Log in to Brevo** → https://app.brevo.com
2. Click your profile (top-right) → **Settings**
3. Go to **API Keys** under "Settings"
4. Find the API key you're using (the one in `BREVO_API_KEY` on Vercel)
5. Click **Edit** (the pencil icon)
6. **Uncheck / Disable** the option that says **"Restrict this API key to specific IPs"**
7. Save

After this, **any IP** can use your API key — Vercel's dynamic IPs will all work.

> ⚠️ Yes, this is slightly less secure than IP-restricting the key. But it's the only practical option for serverless deployments. Brevo still protects you via the key itself — keep it secret and rotate it every 6 months.

## Alternative fix — keep IP restriction (NOT recommended for serverless)

If you really want to keep IP restriction on:

1. Whitelist Vercel's IP ranges (you'd need to look these up — they're published in Vercel docs but change occasionally)
2. Whitelist individual IPs as they appear (the new code emails you the IP when it gets blocked)

This is fragile and breaks every time Vercel adds a new IP range. **Use the disable-IP-restriction fix instead.**

## What the new code does

Even if you don't disable IP restriction, the new code is much more resilient:

| Old behaviour | New behaviour |
|---|---|
| 1 attempt, fail silently | 3 attempts with exponential backoff (800ms → 1.6s → 3.2s) |
| Email lost if it fails | Email stored in `email_queue` table for retry |
| Vague error message | Clear error codes: `ip_not_authorized` / `key_invalid` / `rate_limited` / `recipient_invalid` / `network_error` |
| IP detection on every send | IP detected once, cached for 5 minutes |
| No health check | New `/api/email-health` endpoint to test the connection |

## Files changed

| File | What it does |
|---|---|
| `api/_lib/brevo-client.ts` | New robust Brevo client with retry + queue + IP detection |
| `api/send-parcel-email.ts` | Updated to use the new client |
| `supabase-email-queue.sql` | Creates the `email_queue` table for failed-email retry |

## Setup steps

1. **Run the SQL migration** in Supabase SQL Editor:
   ```
   supabase-email-queue.sql
   ```
   This creates the `email_queue` table.

2. **Deploy the new API code** to Vercel (the `brevo-client.ts` + updated `send-parcel-email.ts`)

3. **Disable IP restriction** on your Brevo API key (see steps above)

4. **Test the connection** by sending an X-Ray email from the admin dashboard

## How to retry queued emails

After you've fixed the Brevo IP issue, you can retry all the queued emails:

1. Go to Supabase SQL Editor
2. Run:
   ```sql
   SELECT retry_queued_emails();
   ```
   (This function is created by the SQL migration and retries every `pending` email that hasn't been tried in the last 5 minutes.)

OR

Use the admin dashboard's "Email Queue" panel (if you build one — let me know if you want me to add it).

## Verifying it works

1. Send an X-Ray email from the admin dashboard
2. Check Vercel logs — you should see:
   - `Brevo send attempt 1/3 succeeded` (if the IP is whitelisted)
   - OR `Brevo send attempt 1/3 failed (ip_not_authorized), queueing for retry` (if not)
3. If it was queued, fix the IP issue, then run `retry_queued_emails()` in Supabase

## Fallback option — switch to Resend

If Brevo keeps causing issues, Resend (https://resend.com) is built for serverless and has no IP restrictions on the free tier. It's a 10-minute swap — let me know if you want me to add it as a fallback provider.
