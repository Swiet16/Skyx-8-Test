-- ─────────────────────────────────────────────────────────────────────────────
-- supabase-unified-parcels-update-policy.sql
--
-- FIXES: Multiple conflicting UPDATE policies on the parcels table were
-- causing admins to get "permission denied" / RLS rejection errors when
-- trying to edit Tracking ID or Reference ID.
--
-- Root cause: 3 separate UPDATE policies existed:
--   1. parcels_updated_by_write  (queries profiles.user_id)
--   2. parcels_update_unified    (queries profiles.user_id)
--   3. own_parcels_update         (uses created_by = auth.uid())
--
-- Postgres requires ALL UPDATE policies to pass (AND logic). If any one
-- fails, the entire update is rejected. Policies 1 and 2 were failing
-- because they queried `profiles WHERE user_id = auth.uid()` — but if the
-- profiles table uses `id` (not `user_id`) as the auth reference column,
-- the query returns nothing → policy fails → update blocked.
--
-- FIX: Drop ALL existing UPDATE policies on parcels and create ONE unified
-- policy that uses get_user_role() (which checks BOTH id and user_id columns
-- and is case-insensitive). This is the ONLY UPDATE policy that matters.
--
-- Run once in Supabase SQL Editor. Safe to re-run.
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

-- 1) Drop ALL existing UPDATE policies on parcels
--    (We recreate ONE unified policy below)
DO $$
DECLARE pol_name TEXT;
BEGIN
  FOR pol_name IN
    SELECT policyname FROM pg_policies
     WHERE tablename = 'parcels' AND schemaname = 'public' AND cmd = 'UPDATE'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.parcels', pol_name);
    RAISE NOTICE 'Dropped UPDATE policy: %', pol_name;
  END LOOP;
END $$;

-- 2) Create ONE unified UPDATE policy using get_user_role()
--    This function is SECURITY DEFINER + checks BOTH id and user_id columns
--    + is case-insensitive, so it works regardless of schema.
CREATE POLICY parcels_update_unified
  ON public.parcels
  FOR UPDATE
  TO authenticated
  USING (
    -- Admin / staff / developer can update ANY parcel
    public.get_user_role(auth.uid()) IN ('admin', 'staff', 'developer')
    -- Partners can update parcels they own (created_by = their UID)
    OR created_by = auth.uid()
  )
  WITH CHECK (
    -- Same condition for the new row state
    public.get_user_role(auth.uid()) IN ('admin', 'staff', 'developer')
    OR created_by = auth.uid()
  );

-- 3) Ensure get_user_role() exists (in case it was dropped)
--    This is a safety check — if the function doesn't exist, create it.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'get_user_role'
  ) THEN
    CREATE FUNCTION public.get_user_role(user_uuid uuid)
    RETURNS text
    LANGUAGE sql
    STABLE
    SECURITY DEFINER
    SET search_path = public
    AS $fn$
      SELECT COALESCE(
        (SELECT LOWER(role::text) FROM public.profiles WHERE user_id = user_uuid LIMIT 1),
        (SELECT LOWER(role::text) FROM public.profiles WHERE id = user_uuid LIMIT 1),
        'user'
      )
    $fn$;
    GRANT EXECUTE ON FUNCTION public.get_user_role(uuid) TO authenticated;
    RAISE NOTICE 'Created get_user_role() function';
  END IF;
END $$;

COMMIT;

-- ─────────────────────────────────────────────────────────────────────────────
-- Verification (run AFTER the migration):
--
-- -- Check what UPDATE policies exist now (should be ONLY parcels_update_unified)
-- SELECT policyname, cmd, qual, with_check
-- FROM pg_policies
-- WHERE tablename = 'parcels' AND schemaname = 'public' AND cmd = 'UPDATE';
--
-- -- Test: check your own role via the function
-- SELECT public.get_user_role('YOUR-AUTH-UUID-HERE');
-- -- Should return: 'admin' (if you're an admin)
--
-- -- Test: can you update a parcel? (replace with your actual parcel id + UUID)
-- -- This should return UPDATE 1 if RLS is working correctly:
-- UPDATE public.parcels
--    SET special_instructions = special_instructions
--  WHERE id = 'PARCEL-UUID-HERE';
-- ─────────────────────────────────────────────────────────────────────────────
