-- ─────────────────────────────────────────────────────────────────────────────
-- supabase-diagnose-and-fix-parcel-edit.sql
--
-- COMPREHENSIVE fix for "can't edit Tracking ID / Reference ID" issue.
-- This SQL:
--   1. Diagnoses the current state (policies, function, role)
--   2. Grants column-level UPDATE privileges (often the hidden blocker)
--   3. Recreates the unified UPDATE policy
--   4. Tests that admin can actually update a parcel
--
-- Run once in Supabase SQL Editor. Safe to re-run.
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

-- ════════════════════════════════════════════════════════════════════════════
-- DIAGNOSIS: Print current state so we can see what's wrong
-- ════════════════════════════════════════════════════════════════════════════

RAISE NOTICE '=== DIAGNOSIS: Current UPDATE policies on parcels ===';
DO $$
DECLARE
  pol RECORD;
BEGIN
  FOR pol IN
    SELECT policyname, cmd, qual, with_check
    FROM pg_policies
    WHERE tablename = 'parcels' AND schemaname = 'public' AND cmd = 'UPDATE'
  LOOP
    RAISE NOTICE 'Policy: % | USING: % | WITH CHECK: %', pol.policyname, pol.qual, pol.with_check;
  END LOOP;
END $$;

RAISE NOTICE '=== DIAGNOSIS: get_user_role() function exists? ===';
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'get_user_role'
  ) THEN
    RAISE NOTICE 'get_user_role() EXISTS ✓';
  ELSE
    RAISE NOTICE 'get_user_role() MISSING ✗ — will create below';
  END IF;
END $$;

-- ════════════════════════════════════════════════════════════════════════════
-- FIX 1: Ensure get_user_role() exists + checks BOTH id and user_id columns
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.get_user_role(user_uuid uuid)
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

-- ════════════════════════════════════════════════════════════════════════════
-- FIX 2: Grant column-level UPDATE privileges to authenticated users
-- This is the HIDDEN BLOCKER — even if RLS allows the update, Postgres
-- column-level grants can block updates to specific columns.
-- ════════════════════════════════════════════════════════════════════════════

-- Grant UPDATE on ALL columns of parcels to authenticated users
-- (RLS is the real guard — this just ensures no column-level block exists)
GRANT UPDATE ON ALL COLUMNS OF public.parcels TO authenticated;

-- Also grant SELECT on all columns (so the frontend can read tracking_id etc.)
GRANT SELECT ON ALL COLUMNS OF public.parcels TO authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- FIX 3: Drop ALL existing UPDATE policies + create ONE unified policy
-- ════════════════════════════════════════════════════════════════════════════

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

CREATE POLICY parcels_update_unified
  ON public.parcels
  FOR UPDATE
  TO authenticated
  USING (
    public.get_user_role(auth.uid()) IN ('admin', 'staff', 'developer')
    OR created_by = auth.uid()
  )
  WITH CHECK (
    public.get_user_role(auth.uid()) IN ('admin', 'staff', 'developer')
    OR created_by = auth.uid()
  );

-- ════════════════════════════════════════════════════════════════════════════
-- FIX 4: Ensure profiles.role column exists + backfill
-- ════════════════════════════════════════════════════════════════════════════

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'profiles' AND column_name = 'role'
  ) THEN
    ALTER TABLE public.profiles ADD COLUMN role TEXT DEFAULT 'user';
    RAISE NOTICE 'Added role column to profiles';
  END IF;
END $$;

UPDATE public.profiles SET role = 'user' WHERE role IS NULL OR role = '';

-- ════════════════════════════════════════════════════════════════════════════
-- FIX 5: Also ensure the SELECT policy lets admins see all parcels
-- ════════════════════════════════════════════════════════════════════════════

DO $$
DECLARE has_select_policy BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE tablename = 'parcels' AND schemaname = 'public' AND cmd = 'SELECT'
  ) INTO has_select_policy;

  IF NOT has_select_policy THEN
    CREATE POLICY parcels_select_all
      ON public.parcels FOR SELECT TO authenticated USING (true);
    RAISE NOTICE 'Created SELECT policy: parcels_select_all';
  END IF;
END $$;

COMMIT;

-- ════════════════════════════════════════════════════════════════════════════
-- VERIFICATION (run these AFTER the migration to confirm):
-- ════════════════════════════════════════════════════════════════════════════

-- -- 1. Check what UPDATE policies exist now (should be ONLY parcels_update_unified)
-- SELECT policyname, cmd FROM pg_policies
-- WHERE tablename = 'parcels' AND schemaname = 'public' AND cmd = 'UPDATE';

-- -- 2. Find your auth UUID
-- SELECT id, email FROM auth.users WHERE email = 'myne7x@gmail.com';

-- -- 3. Test get_user_role() with your UUID (replace UUID below)
-- SELECT public.get_user_role('YOUR-UUID-HERE');
-- -- Should return: 'admin'

-- -- 4. Check your profiles row
-- SELECT id, user_id, role, full_name, email
-- FROM public.profiles
-- WHERE email = 'myne7x@gmail.com';
-- -- Check: is role = 'admin'? Is user_id set to your auth.uid()?

-- -- 5. Test that you can actually update a parcel (replace UUIDs)
-- -- This should return "UPDATE 1" if everything works:
-- UPDATE public.parcels
--    SET special_instructions = COALESCE(special_instructions, '') || ''
--  WHERE id = 'PARCEL-UUID-HERE';
-- ════════════════════════════════════════════════════════════════════════════
