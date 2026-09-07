-- ================================================================
-- SkyXpress — Parcels Status-Sync Fix
-- Run this entire script in the Supabase SQL Editor (one shot).
-- Safe to re-run (everything is IF NOT EXISTS / idempotent).
--
-- WHAT THIS FIXES
-- ---------------
-- Updating a manifest's status (single or bulk) syncs the new status down to
-- every parcel so the public tracking page stops showing "processing".
-- The sync writes these optional columns on `parcels`:
--     admin_note, status_notes, current_location, last_location, detailed_status
-- On databases where those columns don't exist, PostgREST rejected the WHOLE
-- update (PGRST204 "Could not find the 'x' column of 'parcels' in the schema
-- cache") — so the parcel status itself never changed and kept showing the
-- old value (e.g. "processing").
--
-- This script adds every column the app expects, so manifest → parcel status
-- sync (including staff comments + location mirroring) works fully.
--
-- NOTE: the app also works WITHOUT this script (core status sync only) since
-- the ManifestStock fallback retries with core columns — but comments and
-- location mirroring need these columns.
-- ================================================================

-- ----------------------------------------------------------------
-- 1. Add missing columns to `parcels` (all safe / idempotent)
-- ----------------------------------------------------------------

-- Status-sync columns used by the manifest editor + public tracking page
ALTER TABLE public.parcels ADD COLUMN IF NOT EXISTS admin_note       text;
ALTER TABLE public.parcels ADD COLUMN IF NOT EXISTS status_notes     text;
ALTER TABLE public.parcels ADD COLUMN IF NOT EXISTS current_location text;
ALTER TABLE public.parcels ADD COLUMN IF NOT EXISTS last_location    text;
ALTER TABLE public.parcels ADD COLUMN IF NOT EXISTS detailed_status  jsonb;

-- Columns used by parcel management / email features (some DBs already have
-- these — IF NOT EXISTS makes this a no-op for them)
ALTER TABLE public.parcels ADD COLUMN IF NOT EXISTS reference_id          text;
ALTER TABLE public.parcels ADD COLUMN IF NOT EXISTS receiver_email        text;
ALTER TABLE public.parcels ADD COLUMN IF NOT EXISTS sender_city           text;
ALTER TABLE public.parcels ADD COLUMN IF NOT EXISTS sender_country        text;
ALTER TABLE public.parcels ADD COLUMN IF NOT EXISTS receiver_city         text;
ALTER TABLE public.parcels ADD COLUMN IF NOT EXISTS receiver_state        text;
ALTER TABLE public.parcels ADD COLUMN IF NOT EXISTS receiver_country      text;
ALTER TABLE public.parcels ADD COLUMN IF NOT EXISTS receiver_postal_code  text;
ALTER TABLE public.parcels ADD COLUMN IF NOT EXISTS pieces                integer;
ALTER TABLE public.parcels ADD COLUMN IF NOT EXISTS items                 jsonb;
ALTER TABLE public.parcels ADD COLUMN IF NOT EXISTS xray_email_sent_at    timestamptz;

-- Helpful index for the tracking lookups (no-op if it already exists)
CREATE INDEX IF NOT EXISTS parcels_tracking_id_idx ON public.parcels (tracking_id);

-- ----------------------------------------------------------------
-- 2. Row Level Security for `parcels`
--    Only applied if RLS is ALREADY enabled on the table — we never change
--    your security posture implicitly. Role model matches
--    supabase-rls-manifests.sql:
--      • admin / staff / developer → full access
--      • partner / user            → rows they created (created_by = their UID)
--      • anon                      → SELECT only (public tracking page)
-- ----------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM   pg_class c
    JOIN   pg_namespace n ON n.oid = c.relnamespace
    WHERE  n.nspname = 'public'
      AND  c.relname = 'parcels'
      AND  c.relrowsecurity = true
  ) THEN
    -- Clean up any conflicting policies so this is safe to re-run
    DROP POLICY IF EXISTS "admin_staff_full_access_parcels" ON public.parcels;
    DROP POLICY IF EXISTS "own_parcels_select"              ON public.parcels;
    DROP POLICY IF EXISTS "own_parcels_update"              ON public.parcels;
    DROP POLICY IF EXISTS "own_parcels_insert"              ON public.parcels;
    DROP POLICY IF EXISTS "own_parcels_delete"              ON public.parcels;
    DROP POLICY IF EXISTS "public_track_parcels_select"     ON public.parcels;

    -- Admin / staff / developer — full access
    CREATE POLICY "admin_staff_full_access_parcels"
      ON public.parcels
      FOR ALL
      TO authenticated
      USING (
        get_user_role(auth.uid()) IN ('admin', 'staff', 'developer')
      )
      WITH CHECK (
        get_user_role(auth.uid()) IN ('admin', 'staff', 'developer')
      );

    -- Partner / user — manage the parcels they created
    CREATE POLICY "own_parcels_select"
      ON public.parcels FOR SELECT TO authenticated
      USING (created_by = auth.uid());

    CREATE POLICY "own_parcels_insert"
      ON public.parcels FOR INSERT TO authenticated
      WITH CHECK (created_by = auth.uid());

    CREATE POLICY "own_parcels_update"
      ON public.parcels FOR UPDATE TO authenticated
      USING (created_by = auth.uid())
      WITH CHECK (created_by = auth.uid());

    CREATE POLICY "own_parcels_delete"
      ON public.parcels FOR DELETE TO authenticated
      USING (created_by = auth.uid());

    -- Anonymous visitors — read-only so the public tracking page works
    CREATE POLICY "public_track_parcels_select"
      ON public.parcels FOR SELECT TO anon
      USING (true);

    RAISE NOTICE 'parcels RLS policies created (RLS was already enabled).';
  ELSE
    RAISE NOTICE 'parcels RLS is NOT enabled — skipping policy creation (nothing changed).';
  END IF;
END $$;


-- ================================================================
-- Quick verification — run after applying:
--   • the new columns exist
--   • which policies are active
-- ================================================================
SELECT column_name, data_type
FROM   information_schema.columns
WHERE  table_schema = 'public'
  AND  table_name   = 'parcels'
  AND  column_name IN (
         'admin_note', 'status_notes', 'current_location',
         'last_location', 'detailed_status', 'reference_id',
         'receiver_email', 'xray_email_sent_at'
       )
ORDER BY column_name;

SELECT schemaname, tablename, policyname, cmd, roles
FROM   pg_policies
WHERE  tablename = 'parcels'
ORDER  BY policyname;
