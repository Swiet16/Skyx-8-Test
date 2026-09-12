-- ─────────────────────────────────────────────────────────────────────────────
-- supabase-parcels-id-edit-count.sql
--
-- Adds an `id_edit_count` JSONB column to the parcels table to track how
-- many times the Tracking ID and Reference ID have been changed.
--
-- The UI uses this to enforce a 2-edit limit per ID per parcel — after
-- 2 changes, the field is permanently locked (only a super-admin with
-- direct DB access can reset it).
--
-- Column shape:
--   id_edit_count = { "tracking_id": 2, "reference_id": 1 }
--
-- Run once in Supabase SQL Editor. Safe to re-run (IF NOT EXISTS).
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

-- 1) Add the id_edit_count JSONB column if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'parcels' AND column_name = 'id_edit_count'
  ) THEN
    ALTER TABLE public.parcels
      ADD COLUMN id_edit_count JSONB DEFAULT '{}'::jsonb;
  END IF;
END $$;

-- 2) Backfill existing rows with empty objects
UPDATE public.parcels
   SET id_edit_count = '{}'::jsonb
 WHERE id_edit_count IS NULL;

-- 3) Index (for potential future "show me over-edited parcels" queries)
CREATE INDEX IF NOT EXISTS idx_parcels_id_edit_count
  ON public.parcels USING gin (id_edit_count);

-- 4) RLS: anyone authenticated can READ (so the UI can check the count);
--    only admins can WRITE (so partners/staff can't bypass the limit
--    by calling the API directly).
DO $$
DECLARE pol_name TEXT;
BEGIN
  FOR pol_name IN
    SELECT policyname FROM pg_policies
     WHERE tablename = 'parcels' AND schemaname = 'public'
       AND policyname IN ('parcels_id_edit_count_read', 'parcels_id_edit_count_write_admin')
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.parcels', pol_name);
  END LOOP;
END $$;

CREATE POLICY parcels_id_edit_count_read
  ON public.parcels FOR SELECT TO authenticated
  USING (true);

CREATE POLICY parcels_id_edit_count_write_admin
  ON public.parcels FOR UPDATE TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.profiles p WHERE p.user_id = auth.uid() AND p.role = 'admin')
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.profiles p WHERE p.user_id = auth.uid() AND p.role = 'admin')
  );

COMMIT;

-- ─────────────────────────────────────────────────────────────────────────────
-- Verification:
--
-- SELECT column_name, data_type, column_default
-- FROM information_schema.columns
-- WHERE table_schema = 'public' AND table_name = 'parcels'
--   AND column_name = 'id_edit_count';
--
-- Expected:
--   id_edit_count | jsonb | '{}'::jsonb
--
-- To RESET the edit count for a specific parcel (super-admin override):
--
-- UPDATE public.parcels
--    SET id_edit_count = '{}'::jsonb
--  WHERE tracking_id = 'TRK123456789';
-- ─────────────────────────────────────────────────────────────────────────────
