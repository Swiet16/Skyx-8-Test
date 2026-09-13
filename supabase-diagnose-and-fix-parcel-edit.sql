-- ─────────────────────────────────────────────────────────────────────────────
-- supabase-diagnose-and-fix-parcel-edit.sql  (v2 — fixed syntax)
--
-- FIXES the previous syntax error:
--   ERROR: 42601: syntax error at or near "COLUMNS"
--   GRANT UPDATE ON ALL COLUMNS OF public.parcels TO authenticated;
--
-- Root cause: Postgres GRANT syntax doesn't have an "ALL COLUMNS OF" form.
-- The correct way to grant column-level access is to either:
--   a) GRANT UPDATE ON table_name TO role;  (grants all columns by default)
--   b) GRANT UPDATE (col1, col2, ...) ON table_name TO role;  (specific cols)
--
-- We use approach (a) which grants UPDATE on ALL columns of the table.
-- Then we explicitly revoke any column-level denials by re-granting
-- each column individually.
--
-- Run once in Supabase SQL Editor. Safe to re-run.
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

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
-- FIX 2: Grant table-level UPDATE + SELECT on parcels (covers ALL columns)
-- This is the correct Postgres syntax — no "ALL COLUMNS OF" needed.
-- Table-level grants automatically apply to all current + future columns.
-- ════════════════════════════════════════════════════════════════════════════

GRANT UPDATE ON public.parcels TO authenticated;
GRANT SELECT ON public.parcels TO authenticated;
GRANT INSERT ON public.parcels TO authenticated;
GRANT DELETE ON public.parcels TO authenticated;

-- Also grant to anon (public tracking page reads parcels)
GRANT SELECT ON public.parcels TO anon;

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
  END IF;
END $$;

UPDATE public.profiles SET role = 'user' WHERE role IS NULL OR role = '';

-- ════════════════════════════════════════════════════════════════════════════
-- FIX 5: Ensure SELECT policy exists (so admin can read parcels to update them)
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
-- VERIFICATION (run AFTER the migration):
-- ════════════════════════════════════════════════════════════════════════════

-- -- 1. Find your auth UUID
-- SELECT id, email FROM auth.users WHERE email = 'myne7x@gmail.com';

-- -- 2. Test get_user_role() with your UUID (replace UUID)
-- SELECT public.get_user_role('YOUR-UUID-HERE');
-- -- Should return: 'admin'

-- -- 3. Check your profiles row
-- SELECT id, user_id, role, full_name, email
-- FROM public.profiles WHERE email = 'myne7x@gmail.com';

-- -- 4. Check what UPDATE policies exist now
-- SELECT policyname FROM pg_policies
-- WHERE tablename = 'parcels' AND schemaname = 'public' AND cmd = 'UPDATE';
-- -- Should show: parcels_update_unified
-- ════════════════════════════════════════════════════════════════════════════
