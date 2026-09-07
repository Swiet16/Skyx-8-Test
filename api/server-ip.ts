/// <reference lib="dom" />
/// <reference types="node" />

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireRole } from "./_lib/auth";

async function detectIp(): Promise<string> {
  for (const svc of [
    { url: "https://api.ipify.org?format=json", parse: (d: any) => d.ip },
    { url: "https://api4.my-ip.io/ip.json", parse: (d: any) => d.ip },
    { url: "https://ipinfo.io/json", parse: (d: any) => d.ip },
  ]) {
    try {
      const r = await fetch(svc.url, { signal: AbortSignal.timeout(5000), headers: { Accept: "application/json" } });
      if (!r.ok) continue;
      const ip = svc.parse(await r.json());
      if (ip && ip !== "unknown") return ip;
    } catch { /* try next */ }
  }
  for (const url of ["https://checkip.amazonaws.com", "https://icanhazip.com", "https://ifconfig.me/ip"]) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(5000) });
      if (!r.ok) continue;
      const text = (await r.text()).trim();
      if (text) return text;
    } catch { /* try next */ }
  }
  return "unavailable";
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const auth = await requireRole(req.headers.authorization, ["admin", "staff", "developer"]);
  if (!auth.ok) { res.status(auth.status).json({ error: auth.error }); return; }
  res.json({ ip: await detectIp() });
}
