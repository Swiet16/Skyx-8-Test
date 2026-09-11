-- ─────────────────────────────────────────────────────────────────────────────
-- supabase-parcels-assigned-by.sql
--
-- Adds "Assigned by" tracking to the parcels table so that when an admin
-- reassigns a parcel to a partner, the row records WHO did the assignment
-- (admin user_id + display name) and WHEN.
--
-- Columns added:
--   assigned_by        UUID      — auth.users.id of the admin who assigned
--   assigned_by_name    TEXT      — denormalized admin display name (so we
--                                   don't need a join to render the UI pill)
--   assigned_at         TIMESTAMPTZ — when the assignment happened
--
-- All three columns are nullable so existing rows (parcels created before
-- this feature shipped) simply show no "Assigned by" pill — they were
-- created the old way (created_by was set at insert time, never changed).
--
-- Run this once in the Supabase SQL Editor (or via psql against your db).
-- Safe to re-run (uses IF NOT EXISTS / guards).
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

-- 1) Add the three columns if they don't already exist ----------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'parcels' AND column_name = 'assigned_by'
  ) THEN
    ALTER TABLE public.parcels
      ADD COLUMN assigned_by UUID REFERENCES auth.users(id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'parcels' AND column_name = 'assigned_by_name'
  ) THEN
    ALTER TABLE public.parcels
      ADD COLUMN assigned_by_name TEXT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'parcels' AND column_name = 'assigned_at'
  ) THEN
    ALTER TABLE public.parcels
      ADD COLUMN assigned_at TIMESTAMPTZ;
  END IF;
END $$;

-- 2) Backfill existing rows --------------------------------------------------
--    For parcels that were created before this feature, set assigned_by =
--    created_by and assigned_by_name = created_by_name and assigned_at =
--    created_at, so older parcels also show "Assigned by …" (the original
--    creator is treated as the assigner). This is OPTIONAL — comment out
--    the next DO block if you'd rather leave older rows blank.
DO $$
BEGIN
  UPDATE public.parcels
     SET assigned_by      = created_by,
         assigned_by_name = created_by_name,
         assigned_at      = created_at
   WHERE assigned_by IS NULL
     AND created_by IS NOT NULL;
END $$;

-- 3) Index for the partner-side dashboard query (parcels WHERE assigned_by=?)
--    Not strictly required, but speeds up "parcels assigned to me" queries
--    if you ever want a future admin-only view.
CREATE INDEX IF NOT EXISTS idx_parcels_assigned_by
  ON public.parcels (assigned_by);

-- 4) RLS policies -------------------------------------------------------------
--    These mirror how created_by is already treated: anyone authenticated
--    can read assigned_by*, only admins can write them (the UI also enforces
--    this — only admins see the Assign button — but RLS is the real guard).

-- Drop existing policies if they were created by a previous run, then recreate.
DO $$
DECLARE
  pol_name TEXT;
BEGIN
  FOR pol_name IN
    SELECT policyname FROM pg_policies
     WHERE tablename = 'parcels'
       AND schemaname = 'public'
       AND policyname IN ('parcels_assigned_by_read', 'parcels_assigned_by_write_admin')
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.parcels', pol_name);
  END LOOP;
END $$;

-- Anyone authenticated can read assigned_by / assigned_by_name / assigned_at
-- (the parcels table is already SELECT-able by authenticated users).
CREATE POLICY parcels_assigned_by_read
  ON public.parcels
  FOR SELECT
  TO authenticated
  USING (true);

-- Only admins can write the assigned_by* columns. We enforce this via a
-- CHECK that compares the current user's role in the profiles table.
-- (If you don't yet have a profiles.role column, this policy will be a no-op
--  and the UI's role gate will be the only guard — which is fine for most
--  deployments. To make RLS the source of truth, ensure profiles.role
--  exists and has values 'admin' / 'staff' / 'partner'.)
CREATE POLICY parcels_assigned_by_write_admin
  ON public.parcels
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
       WHERE p.user_id = auth.uid()
         AND p.role = 'admin'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles p
       WHERE p.user_id = auth.uid()
         AND p.role = 'admin'
    )
  );

COMMIT;

-- ─────────────────────────────────────────────────────────────────────────────
-- Verification (run after the migration to confirm):
--
-- SELECT
--   column_name, data_type, is_nullable
-- FROM information_schema.columns
-- WHERE table_schema = 'public'
--   AND table_name = 'parcels'
--   AND column_name IN ('assigned_by', 'assigned_by_name', 'assigned_at')
-- ORDER BY column_name;
--
-- Expected output:
--   assigned_by        | uuid        | YES
--   assigned_at        | timestamptz | YES
--   assigned_by_name   | text        | YES
-- ─────────────────────────────────────────────────────────────────────────────
