-- ─────────────────────────────────────────────────────────────────────────────
-- supabase-fix-get-user-role.sql  (v2 — uses CREATE OR REPLACE)
--
-- FIXES: the get_user_role() function was querying `profiles WHERE id = user_uuid`
-- but the standard Supabase profiles table uses `user_id` (not `id`) as the
-- column that stores the auth.users.id reference.
--
-- This caused get_user_role() to return NULL for every user → falling back
-- to 'user' → admins were getting "only admin can edit" errors even though
-- their profiles.role was correctly set to 'admin'.
--
-- IMPORTANT: This version uses CREATE OR REPLACE FUNCTION (not DROP + CREATE)
-- because many RLS policies depend on get_user_role() and DROP FUNCTION
-- fails with "cannot drop function because other objects depend on it".
--
-- CREATE OR REPLACE updates the function body in place WITHOUT touching
-- the dependent policies — they continue to work seamlessly.
--
-- Run once in Supabase SQL Editor. Safe to re-run.
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

-- 1) Replace the function body in place (preserves all dependent RLS policies)
CREATE OR REPLACE FUNCTION public.get_user_role(user_uuid uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
  SELECT COALESCE(
    -- Try profiles.user_id first (standard Supabase schema)
    (SELECT LOWER(role::text) FROM public.profiles WHERE user_id = user_uuid LIMIT 1),
    -- Fall back to profiles.id (older schema)
    (SELECT LOWER(role::text) FROM public.profiles WHERE id = user_uuid LIMIT 1),
    -- Final fallback
    'user'
  )
$fn$;

-- 2) Ensure the profiles table has the role column (in case it's missing)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'profiles' AND column_name = 'role'
  ) THEN
    ALTER TABLE public.profiles ADD COLUMN role TEXT DEFAULT 'user';
  END IF;
END $$;

-- 3) Backfill: ensure every profile has a role (default to 'user')
UPDATE public.profiles SET role = 'user' WHERE role IS NULL OR role = '';

-- 4) Grant execute to authenticated users (no-op if already granted)
GRANT EXECUTE ON FUNCTION public.get_user_role(uuid) TO authenticated;

COMMIT;

-- ─────────────────────────────────────────────────────────────────────────────
-- Verification (run AFTER the migration):
--
-- -- Check your own role (replace with your auth uid):
-- SELECT public.get_user_role('YOUR-AUTH-UUID-HERE');
-- -- Should return: 'admin' (if you're an admin)
--
-- -- Check what columns your profiles table uses:
-- SELECT column_name FROM information_schema.columns
-- WHERE table_name = 'profiles' AND column_name IN ('id', 'user_id', 'role');
--
-- -- Check your profile row directly:
-- SELECT id, user_id, role, full_name FROM public.profiles
-- WHERE user_id = 'YOUR-AUTH-UUID-HERE' OR id = 'YOUR-AUTH-UUID-HERE';
--
-- -- Check the function definition:
-- SELECT pg_get_functiondef('public.get_user_role(uuid)'::regprocedure);
-- ─────────────────────────────────────────────────────────────────────────────
