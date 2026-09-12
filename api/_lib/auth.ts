/// <reference lib="dom" />
/// <reference types="node" />

import { getUser, getUserRole } from "./supabase-server";

export type AllowedRole = "admin" | "staff" | "developer" | "partner";

/** Extract Bearer token from Authorization header */
export function extractToken(authHeader: string | string[] | undefined): string | null {
  const raw = Array.isArray(authHeader) ? authHeader[0] : authHeader;
  if (!raw) return null;
  const match = raw.match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : null;
}

export type AuthResult =
  | { ok: true; userId: string; role: string; token: string }
  | { ok: false; error: string; status: number };

/**
 * Verify the Bearer token and check the user has one of the required roles.
 * Uses direct Supabase REST calls — no WebSocket / SDK initialisation.
 */
export async function requireRole(
  authHeader: string | string[] | undefined,
  requiredRoles: AllowedRole[]
): Promise<AuthResult> {
  const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const key = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
  if (!url || !key) {
    return { ok: false, error: "Server misconfiguration: Supabase credentials missing", status: 503 };
  }

  const token = extractToken(authHeader);
  if (!token) {
    return { ok: false, error: "Missing authorization token", status: 401 };
  }

  const user = await getUser(token);
  if (!user) {
    return { ok: false, error: "Invalid or expired token", status: 401 };
  }

  const role = await getUserRole(token);
  if (!role) {
    return { ok: false, error: "Could not verify user role", status: 403 };
  }

  if (!requiredRoles.includes(role as AllowedRole)) {
    return { ok: false, error: "Insufficient permissions — admin/staff access required", status: 403 };
  }

  return { ok: true, userId: user.id, role, token };
}
