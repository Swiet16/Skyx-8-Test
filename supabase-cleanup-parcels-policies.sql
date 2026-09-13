-- ─────────────────────────────────────────────────────────────────────────────
-- supabase-cleanup-parcels-policies.sql
--
-- NUCLEAR FIX: Drops ALL existing policies on parcels and recreates
-- a clean, minimal set that actually works.
--
-- PROBLEM
-- There were 6+ conflicting UPDATE/ALL policies on parcels:
--   - 'Admins and staff can manage all parcels' (ALL) — uses is_user_blocked()
--   - 'admin_partner_own_parcels' (ALL) — checks role='admin_partner' (doesn't exist)
--   - 'admin_staff_full_access_parcels' (ALL) — OK
--   - 'super_admin_all_parcels' (ALL) — checks role='super_admin' (doesn't exist)
--   - 'user_own_parcels' (ALL) — WITH CHECK created_by = auth.uid() BLOCKS admins
--   - 'parcels_update_unified' (UPDATE) — OK but overridden by the ALL policies
--
-- Postgres ANDs all matching policies together. The 'user_own_parcels'
-- policy (cmd=ALL) requires created_by = auth.uid() for EVERY update,
-- which blocks admins from editing parcels they didn't create.
--
-- FIX: Drop EVERYTHING and recreate a clean minimal set.
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

-- ════════════════════════════════════════════════════════════════════════════
-- STEP 1: Drop ALL existing policies on parcels (every command type)
-- ════════════════════════════════════════════════════════════════════════════

DO $$
DECLARE pol_name TEXT;
BEGIN
  FOR pol_name IN
    SELECT DISTINCT policyname FROM pg_policies
     WHERE tablename = 'parcels' AND schemaname = 'public'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.parcels', pol_name);
    RAISE NOTICE 'Dropped policy: %', pol_name;
  END LOOP;
END $$;

-- ════════════════════════════════════════════════════════════════════════════
-- STEP 2: Create a CLEAN minimal policy set
-- ════════════════════════════════════════════════════════════════════════════

-- SELECT: anyone can read (public tracking + authenticated users)
CREATE POLICY parcels_select_all
  ON public.parcels FOR SELECT
  USING (true);

-- INSERT: authenticated users can create parcels (RLS on created_by is
-- enforced by the app, not by RLS here — partners can only insert their own)
CREATE POLICY parcels_insert_authenticated
  ON public.parcels FOR INSERT TO authenticated
  WITH CHECK (true);

-- UPDATE: admins/staff/developer can update ANY parcel;
-- partners can update parcels where created_by = their UID
CREATE POLICY parcels_update_unified
  ON public.parcels FOR UPDATE TO authenticated
  USING (
    public.get_user_role(auth.uid()) IN ('admin', 'staff', 'developer')
    OR created_by = auth.uid()
  )
  WITH CHECK (
    public.get_user_role(auth.uid()) IN ('admin', 'staff', 'developer')
    OR created_by = auth.uid()
  );

-- DELETE: only admins can delete
CREATE POLICY parcels_delete_admin
  ON public.parcels FOR DELETE TO authenticated
  USING (
    public.get_user_role(auth.uid()) IN ('admin', 'staff')
  );

-- ════════════════════════════════════════════════════════════════════════════
-- STEP 3: Ensure get_user_role() exists (safety check)
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
-- STEP 4: Ensure table-level grants are correct
-- ════════════════════════════════════════════════════════════════════════════

GRANT SELECT ON public.parcels TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.parcels TO authenticated;

COMMIT;

-- ════════════════════════════════════════════════════════════════════════════
-- VERIFICATION — run this AFTER to confirm clean state:
--
-- SELECT policyname, cmd FROM pg_policies
-- WHERE tablename = 'parcels' AND schemaname = 'public'
-- ORDER BY cmd, policyname;
--
-- Expected: EXACTLY 4 policies:
--   parcels_select_all          | SELECT
--   parcels_insert_authenticated | INSERT
--   parcels_update_unified      | UPDATE
--   parcels_delete_admin        | DELETE
-- ════════════════════════════════════════════════════════════════════════════
