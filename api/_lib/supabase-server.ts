/// <reference lib="dom" />
/// <reference types="node" />

/**
 * Lightweight server-side Supabase helper that uses raw fetch calls instead of
 * @supabase/supabase-js. The JS SDK initialises a WebSocket realtime client in
 * its constructor, which throws on Node.js < 22 (no native globalThis.WebSocket).
 * For auth + REST queries we only need HTTP — no SDK required.
 */

function cfg(): { url: string; key: string } {
  const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || "";
  const key = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || "";
  return { url, key };
}

function authHeaders(token: string): Record<string, string> {
  const { key } = cfg();
  return {
    Authorization: `Bearer ${token}`,
    apikey: key,
    "Content-Type": "application/json",
  };
}

/** Verify a user JWT and return the user object, or null if invalid. */
export async function getUser(token: string): Promise<{ id: string; email?: string } | null> {
  const { url } = cfg();
  try {
    const res = await fetch(`${url}/auth/v1/user`, {
      headers: authHeaders(token),
    });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

/** Call the get_user_role() Postgres RPC and return the role string, or null on error. */
export async function getUserRole(token: string): Promise<string | null> {
  const { url } = cfg();
  try {
    const res = await fetch(`${url}/rest/v1/rpc/get_user_role`, {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify({}),
    });
    if (!res.ok) return null;
    return res.json(); // returns bare string
  } catch {
    return null;
  }
}

const PARCEL_COLS = [
  "id", "tracking_id", "reference_id", "sender_name", "sender_email",
  "sender_phone", "sender_address", "sender_city", "sender_country",
  "receiver_name", "receiver_email", "receiver_address", "receiver_city", "receiver_state",
  "receiver_country", "receiver_postal_code", "receiver_phone",
  "from_country", "to_country", "weight", "chargeable_weight",
  "length", "width", "height", "parcel_type", "service_type",
  "declared_value", "total_price", "currency", "special_instructions",
  "pieces", "items", "xray_email_sent_at",
].join(",");

/** Fetch a single parcel by ID. RLS on the Supabase side enforces access. */
export async function fetchParcel(token: string, parcelId: string): Promise<any | null> {
  const { url } = cfg();
  try {
    const res = await fetch(
      `${url}/rest/v1/parcels?id=eq.${encodeURIComponent(parcelId)}&select=${PARCEL_COLS}&limit=1`,
      { headers: { ...authHeaders(token), Accept: "application/json" } },
    );
    if (!res.ok) return null;
    const rows: any[] = await res.json();
    return rows[0] ?? null;
  } catch {
    return null;
  }
}
