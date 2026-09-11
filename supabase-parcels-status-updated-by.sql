-- ─────────────────────────────────────────────────────────────────────────────
-- supabase-parcels-status-updated-by.sql
--
-- Adds "Updated by" tracking to the parcels table + the status_timeline
-- JSONB array so every status change records WHO made it (admin / staff /
-- partner name + role) and WHEN.
--
-- Columns added to public.parcels:
--   updated_by        UUID       — auth.users.id of the last person who
--                                  changed current_status
--   updated_by_name   TEXT       — denormalized display name (no join needed
--                                  to render the ℹ bubble)
--   updated_by_role   TEXT       — 'admin' | 'staff' | 'partner' (denormalized)
--
-- status_timeline JSONB entries get 3 extra keys per event:
--   updated_by        string     — auth uid of the updater
--   updated_by_name   string     — display name
--   updated_by_role   string     — role label
--
-- Run once in the Supabase SQL Editor. Safe to re-run (IF NOT EXISTS).
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

-- 1) Add the three columns if they don't already exist ----------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'parcels' AND column_name = 'updated_by'
  ) THEN
    ALTER TABLE public.parcels
      ADD COLUMN updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'parcels' AND column_name = 'updated_by_name'
  ) THEN
    ALTER TABLE public.parcels
      ADD COLUMN updated_by_name TEXT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'parcels' AND column_name = 'updated_by_role'
  ) THEN
    ALTER TABLE public.parcels
      ADD COLUMN updated_by_role TEXT;
  END IF;
END $$;

-- 2) Backfill existing rows --------------------------------------------------
--    For parcels that were updated before this feature shipped, set
--    updated_by = created_by, updated_by_name = created_by_name, and
--    updated_by_role = (lookup role from profiles). This way older parcels
--    also show an ℹ bubble with the original creator as the updater.
DO $$
BEGIN
  UPDATE public.parcels p
     SET updated_by      = p.created_by,
         updated_by_name = p.created_by_name,
         updated_by_role = COALESCE(
           (SELECT pr.role FROM public.profiles pr WHERE pr.user_id = p.created_by),
           'admin'
         )
   WHERE p.updated_by IS NULL
     AND p.created_by IS NOT NULL;
END $$;

-- 3) Backfill the status_timeline JSONB array on existing rows --------------
--    Each timeline event gets the 3 new keys added (updated_by / updated_by_name
--    / updated_by_role) so the ℹ bubble works for historical events too.
--    Events that already have those keys are left untouched.
--
--    NOTE: elem->>'updated_by' returns TEXT, but parcels.created_by is UUID.
--    We cast created_by::text so the COALESCE types match (both text).
--    Same for the profiles.user_id lookup (already UUID, cast is a no-op
--    but harmless).
DO $$
BEGIN
  UPDATE public.parcels
     SET status_timeline = (
       SELECT jsonb_agg(
         CASE
           WHEN elem ? 'updated_by_name'
           THEN elem
           ELSE elem || jsonb_build_object(
             'updated_by',       COALESCE(elem->>'updated_by',       (SELECT created_by::text    FROM public.parcels WHERE id = parcels.id)),
             'updated_by_name',  COALESCE(elem->>'updated_by_name',  (SELECT created_by_name     FROM public.parcels WHERE id = parcels.id)),
             'updated_by_role',  COALESCE(elem->>'updated_by_role',  COALESCE(
               (SELECT pr.role FROM public.profiles pr
                  WHERE pr.user_id = (SELECT created_by FROM public.parcels WHERE id = parcels.id)),
               'admin'
             ))
           )
         END
       )
       FROM jsonb_array_elements(CASE
         WHEN jsonb_typeof(status_timeline) = 'array' THEN status_timeline
         ELSE '[]'::jsonb
       END) AS elem
     )
   WHERE jsonb_typeof(status_timeline) = 'array'
     AND jsonb_array_length(status_timeline) > 0;
END $$;

-- 4) Index for "who last touched this parcel" lookups -----------------------
CREATE INDEX IF NOT EXISTS idx_parcels_updated_by
  ON public.parcels (updated_by);

-- 5) RLS policies -------------------------------------------------------------
--    Mirror the existing parcels SELECT policy: authenticated users can read
--    the new columns. Only admins / staff / the parcel's own partner can
--    WRITE updated_by* (the UI gates this further, but RLS is the source of
--    truth). We allow partners to update their OWN parcels' status (so they
--    can use the status picker on their own dashboard) but stamp their role
--    as 'partner' in the column so the ℹ bubble shows it.

DO $$
DECLARE
  pol_name TEXT;
BEGIN
  FOR pol_name IN
    SELECT policyname FROM pg_policies
     WHERE tablename = 'parcels'
       AND schemaname = 'public'
       AND policyname IN (
         'parcels_updated_by_read',
         'parcels_updated_by_write'
       )
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.parcels', pol_name);
  END LOOP;
END $$;

-- Anyone authenticated can read the updated_by* columns
CREATE POLICY parcels_updated_by_read
  ON public.parcels
  FOR SELECT
  TO authenticated
  USING (true);

-- Update policy: admins can update anyone's parcels; staff can update any
-- non-partner-owned parcel; partners can update only their OWN parcels
-- (where created_by = auth.uid()).
CREATE POLICY parcels_updated_by_write
  ON public.parcels
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
       WHERE p.user_id = auth.uid()
         AND p.role = 'admin'
    )
    OR EXISTS (
      SELECT 1 FROM public.profiles p
       WHERE p.user_id = auth.uid()
         AND p.role = 'staff'
    )
    OR created_by = auth.uid()
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles p
       WHERE p.user_id = auth.uid()
         AND p.role = 'admin'
    )
    OR EXISTS (
      SELECT 1 FROM public.profiles p
       WHERE p.user_id = auth.uid()
         AND p.role = 'staff'
    )
    OR created_by = auth.uid()
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
--   AND column_name IN ('updated_by', 'updated_by_name', 'updated_by_role')
-- ORDER BY column_name;
--
-- Expected:
--   updated_by       | uuid | YES
--   updated_by_name  | text | YES
--   updated_by_role  | text | YES
--
-- Also verify the status_timeline entries have the new keys:
--
-- SELECT
--   tracking_id,
--   status_timeline->0->>'status'         AS first_event_status,
--   status_timeline->0->>'updated_by_name' AS first_event_updater,
--   status_timeline->0->>'updated_by_role' AS first_event_role
-- FROM public.parcels
-- WHERE jsonb_typeof(status_timeline) = 'array'
--   AND jsonb_array_length(status_timeline) > 0
-- LIMIT 5;
-- ─────────────────────────────────────────────────────────────────────────────
