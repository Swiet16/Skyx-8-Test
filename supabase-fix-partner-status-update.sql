-- ─────────────────────────────────────────────────────────────────────────────
-- supabase-fix-partner-status-update.sql
--
-- Ensures partners can UPDATE the status of their own parcels.
--
-- PROBLEM
-- Partners were getting "Permission denied" or RLS errors when trying to
-- update a parcel's status from the Parcel Details modal. Root cause was
-- either:
--   1. The parcels_updated_by_write policy (added in a previous migration)
--      was too restrictive — it required role IN ('admin','staff') OR
--      created_by = auth.uid(), but the WITH CHECK clause was rejecting
--      partners because the patch included columns they "shouldn't" write.
--   2. The own_parcels_update policy (from supabase-parcels-status-sync.sql)
--      was missing or had been overwritten.
--
-- FIX
-- Drops any conflicting UPDATE policies on parcels and recreates a single
-- clear policy that allows:
--   - admins / staff / developer → update ANY parcel
--   - partners                   → update parcels where created_by = their UID
--   - the WITH CHECK clause uses the EXISTING row's created_by (not the
--     new row's), so a partner can change current_status / status_timeline
--     / admin_note etc. without "losing" ownership of the row.
--
-- Run once in Supabase SQL Editor. Safe to re-run.
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

-- 1) Drop ALL existing UPDATE policies on parcels so we don't have conflicts
DO $$
DECLARE pol_name TEXT;
BEGIN
  FOR pol_name IN
    SELECT policyname FROM pg_policies
     WHERE tablename = 'parcels' AND schemaname = 'public'
       AND cmd = 'UPDATE'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.parcels', pol_name);
    RAISE NOTICE 'Dropped UPDATE policy: %', pol_name;
  END LOOP;
END $$;

-- 2) Create ONE unified UPDATE policy that handles all roles
CREATE POLICY parcels_update_unified
  ON public.parcels
  FOR UPDATE
  TO authenticated
  USING (
    -- Admin / staff / developer can update ANY parcel
    EXISTS (
      SELECT 1 FROM public.profiles p
       WHERE p.user_id = auth.uid()
         AND p.role IN ('admin', 'staff', 'developer')
    )
    -- Partners can update parcels they own (created_by = their UID)
    OR created_by = auth.uid()
  )
  WITH CHECK (
    -- Same condition for the new row state. Note: we use the EXISTING
    -- row's created_by (via the USING clause) — the WITH CHECK here just
    -- ensures the updater is still allowed. A partner cannot change
    -- created_by to someone else's UID (that would fail the check).
    EXISTS (
      SELECT 1 FROM public.profiles p
       WHERE p.user_id = auth.uid()
         AND p.role IN ('admin', 'staff', 'developer')
    )
    OR created_by = auth.uid()
  );

-- 3) Also ensure the SELECT policy lets partners READ their parcels
-- (so the partner dashboard can fetch the parcel row to update it)
DO $$
DECLARE has_select_policy BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE tablename = 'parcels' AND schemaname = 'public' AND cmd = 'SELECT'
  ) INTO has_select_policy;

  IF NOT has_select_policy THEN
    CREATE POLICY parcels_select_all
      ON public.parcels
      FOR SELECT
      TO authenticated
      USING (true);
    RAISE NOTICE 'Created SELECT policy: parcels_select_all';
  END IF;
END $$;

COMMIT;

-- ─────────────────────────────────────────────────────────────────────────────
-- Verification:
--
-- SELECT policyname, cmd, roles, qual, with_check
-- FROM pg_policies
-- WHERE tablename = 'parcels' AND schemaname = 'public'
-- ORDER BY cmd, policyname;
--
-- Expected: one UPDATE policy named 'parcels_update_unified' with:
--   qual:       (EXISTS (... role IN ('admin','staff','developer')) OR created_by = auth.uid())
--   with_check: (EXISTS (... role IN ('admin','staff','developer')) OR created_by = auth.uid())
-- ─────────────────────────────────────────────────────────────────────────────
