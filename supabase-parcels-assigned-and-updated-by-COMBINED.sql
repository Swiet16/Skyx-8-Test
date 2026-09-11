-- ─────────────────────────────────────────────────────────────────────────────
-- supabase-parcels-assigned-and-updated-by-COMBINED.sql
--
-- COMBINED migration that ensures BOTH "Assigned by" AND "Updated by"
-- columns exist on public.parcels. Run this if either of the individual
-- migrations failed or wasn't run.
--
-- Columns added:
--   assigned_by         UUID   — auth uid of admin who assigned the parcel
--   assigned_by_name    TEXT   — admin display name (denormalized)
--   assigned_at         TIMESTAMPTZ — when the assignment happened
--   updated_by          UUID   — auth uid of last person who changed status
--   updated_by_name     TEXT   — last updater display name (denormalized)
--   updated_by_role     TEXT   — 'admin' | 'staff' | 'partner'
--
-- Run once in Supabase SQL Editor. Safe to re-run (IF NOT EXISTS).
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

-- ════════════════════════════════════════════════════════════════════════════
-- PART A: ASSIGNED BY columns (assigned_by, assigned_by_name, assigned_at)
-- ════════════════════════════════════════════════════════════════════════════

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'parcels' AND column_name = 'assigned_by') THEN
    ALTER TABLE public.parcels ADD COLUMN assigned_by UUID REFERENCES auth.users(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'parcels' AND column_name = 'assigned_by_name') THEN
    ALTER TABLE public.parcels ADD COLUMN assigned_by_name TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'parcels' AND column_name = 'assigned_at') THEN
    ALTER TABLE public.parcels ADD COLUMN assigned_at TIMESTAMPTZ;
  END IF;
END $$;

-- Backfill assigned_by from created_by for existing parcels
DO $$
BEGIN
  UPDATE public.parcels
     SET assigned_by      = created_by,
         assigned_by_name = created_by_name,
         assigned_at      = created_at
   WHERE assigned_by IS NULL
     AND created_by IS NOT NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_parcels_assigned_by ON public.parcels (assigned_by);

-- ════════════════════════════════════════════════════════════════════════════
-- PART B: UPDATED BY columns (updated_by, updated_by_name, updated_by_role)
-- ════════════════════════════════════════════════════════════════════════════

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'parcels' AND column_name = 'updated_by') THEN
    ALTER TABLE public.parcels ADD COLUMN updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'parcels' AND column_name = 'updated_by_name') THEN
    ALTER TABLE public.parcels ADD COLUMN updated_by_name TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'parcels' AND column_name = 'updated_by_role') THEN
    ALTER TABLE public.parcels ADD COLUMN updated_by_role TEXT;
  END IF;
END $$;

-- Backfill updated_by from created_by
DO $$
BEGIN
  UPDATE public.parcels p
     SET updated_by      = p.created_by,
         updated_by_name = p.created_by_name,
         updated_by_role = COALESCE(
           (SELECT pr.role FROM public.profiles pr WHERE pr.user_id = p.created_by LIMIT 1),
           'admin'
         )
   WHERE p.updated_by IS NULL
     AND p.created_by IS NOT NULL;
END $$;

-- Backfill status_timeline JSONB: add updated_by* keys to each event
-- FIX: uses direct column references (p.created_by) not correlated subqueries
DO $$
BEGIN
  UPDATE public.parcels p
     SET status_timeline = (
       SELECT jsonb_agg(
         CASE
           WHEN elem ? 'updated_by_name'
           THEN elem
           ELSE elem || jsonb_build_object(
             'updated_by',       COALESCE(elem->>'updated_by',       p.created_by::text),
             'updated_by_name',  COALESCE(elem->>'updated_by_name',  p.created_by_name),
             'updated_by_role',  COALESCE(elem->>'updated_by_role',  COALESCE(
               (SELECT pr.role FROM public.profiles pr WHERE pr.user_id = p.created_by LIMIT 1),
               'admin'
             ))
           )
         END
       )
       FROM jsonb_array_elements(
         CASE WHEN jsonb_typeof(p.status_timeline) = 'array'
               THEN p.status_timeline
               ELSE '[]'::jsonb END
       ) AS elem
     )
   WHERE jsonb_typeof(p.status_timeline) = 'array'
     AND jsonb_array_length(p.status_timeline) > 0;
END $$;

CREATE INDEX IF NOT EXISTS idx_parcels_updated_by ON public.parcels (updated_by);

-- ════════════════════════════════════════════════════════════════════════════
-- PART C: RLS policies (drop + recreate to be safe)
-- ════════════════════════════════════════════════════════════════════════════

DO $$
DECLARE pol_name TEXT;
BEGIN
  FOR pol_name IN
    SELECT policyname FROM pg_policies
     WHERE tablename = 'parcels' AND schemaname = 'public'
       AND policyname IN (
         'parcels_assigned_by_read', 'parcels_assigned_by_write_admin',
         'parcels_updated_by_read', 'parcels_updated_by_write'
       )
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.parcels', pol_name);
  END LOOP;
END $$;

-- Anyone authenticated can read
CREATE POLICY parcels_assigned_by_read ON public.parcels FOR SELECT TO authenticated USING (true);
CREATE POLICY parcels_updated_by_read ON public.parcels FOR SELECT TO authenticated USING (true);

-- Only admins can write assigned_by*
CREATE POLICY parcels_assigned_by_write_admin
  ON public.parcels FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.user_id = auth.uid() AND p.role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM public.profiles p WHERE p.user_id = auth.uid() AND p.role = 'admin'));

-- Admins, staff, or the parcel's own partner can write updated_by*
CREATE POLICY parcels_updated_by_write
  ON public.parcels FOR UPDATE TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.profiles p WHERE p.user_id = auth.uid() AND p.role = 'admin')
    OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.user_id = auth.uid() AND p.role = 'staff')
    OR created_by = auth.uid()
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.profiles p WHERE p.user_id = auth.uid() AND p.role = 'admin')
    OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.user_id = auth.uid() AND p.role = 'staff')
    OR created_by = auth.uid()
  );

COMMIT;

-- ════════════════════════════════════════════════════════════════════════════
-- VERIFICATION — run this after to confirm all 6 columns exist:
-- ════════════════════════════════════════════════════════════════════════════
-- SELECT column_name, data_type
-- FROM information_schema.columns
-- WHERE table_schema = 'public' AND table_name = 'parcels'
--   AND column_name IN (
--     'assigned_by', 'assigned_by_name', 'assigned_at',
--     'updated_by', 'updated_by_name', 'updated_by_role'
--   )
-- ORDER BY column_name;
--
-- Expected: 6 rows
--   assigned_at         | timestamptz
--   assigned_by          | uuid
--   assigned_by_name     | text
--   updated_by           | uuid
--   updated_by_name      | text
--   updated_by_role      | text
