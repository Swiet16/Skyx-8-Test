-- ─────────────────────────────────────────────────────────────────────────────
-- supabase-fix-get-user-role.sql
--
-- FIXES: the get_user_role() function was querying `profiles WHERE id = user_uuid`
-- but the standard Supabase profiles table uses `user_id` (not `id`) as the
-- column that stores the auth.users.id reference.
--
-- This caused get_user_role() to return NULL for every user → falling back
-- to 'user' → admins were getting "only admin can edit" errors even though
-- their profiles.role was correctly set to 'admin'.
--
-- This migration replaces get_user_role() with a version that checks BOTH
-- `id` and `user_id` columns (so it works regardless of which schema you
-- have) and is case-insensitive.
--
-- Run once in Supabase SQL Editor. Safe to re-run.
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

-- Drop the existing function (if any) so we can recreate it
DROP FUNCTION IF EXISTS public.get_user_role(uuid);

-- Recreate with the fix: check both `id` AND `user_id` columns,
-- case-insensitive comparison, returns 'user' as fallback.
CREATE FUNCTION public.get_user_role(user_uuid uuid)
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

-- Grant execute to authenticated users
GRANT EXECUTE ON FUNCTION public.get_user_role(uuid) TO authenticated;

-- Also ensure the profiles table has the role column (in case it's missing)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'profiles' AND column_name = 'role'
  ) THEN
    ALTER TABLE public.profiles ADD COLUMN role TEXT DEFAULT 'user';
  END IF;
END $$;

-- Backfill: ensure every profile has a role (default to 'user')
UPDATE public.profiles SET role = 'user' WHERE role IS NULL OR role = '';

COMMIT;

-- ─────────────────────────────────────────────────────────────────────────────
-- Verification:
--
-- -- Check your own role (replace with your auth uid):
-- SELECT public.get_user_role('YOUR-AUTH-UUID-HERE');
--
-- -- Should return: 'admin' (if you're an admin)
--
-- -- Check what column your profiles table uses:
-- SELECT column_name FROM information_schema.columns
-- WHERE table_name = 'profiles' AND column_name IN ('id', 'user_id');
--
-- -- Check your profile row directly:
-- SELECT id, user_id, role, full_name FROM public.profiles
-- WHERE user_id = 'YOUR-AUTH-UUID-HERE' OR id = 'YOUR-AUTH-UUID-HERE';
-- ─────────────────────────────────────────────────────────────────────────────
