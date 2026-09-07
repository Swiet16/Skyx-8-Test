-- ================================================================
-- SkyXpress — Manifest → Parcel Status Sync — COMPLETE ONE-SHOT FIX
-- Run this ENTIRE script in: Supabase Dashboard → SQL Editor → Run.
-- Safe to re-run (every statement is idempotent / existence-guarded).
--
-- SYMPTOM IT FIXES
-- ----------------
-- Updating a manifest's status (single or bulk) left the parcels stuck on
-- "processing" and/or showed an error toast.
--
-- ROOT CAUSES
-- -----------
-- 1) SCHEMA: the manifest editor syncs the new status down to `parcels`
--    writing optional columns (admin_note, status_notes, current_location,
--    last_location, detailed_status) that do NOT exist in the live database.
--    PostgREST rejects the WHOLE update with PGRST204 ("Could not find the
--    'x' column of 'parcels' in the schema cache") → current_status never
--    lands → parcels keep showing "processing".
--    → Fixed by SECTION 2.
--
-- 2) RLS: when Row Level Security is enabled on `parcels` /
--    `manifests_detail` / `manifest_history` / `manifest_sequence`,
--    missing or too-strict policies either silently block the update
--    (0 rows affected, NO error shown) or throw RLS violations.
--    Partners also write manifest_history on every status change, which a
--    SELECT-only policy blocks. → Fixed by SECTION 4 + 5.
--
-- AFTER RUNNING: hard-refresh the app and retry the manifest status update.
-- Staff comments + location mirroring now persist as well.
-- ================================================================


-- ================================================================
-- SECTION 1 — get_user_role() helper (created ONLY if missing)
-- Your live database already has this RPC; this block leaves it untouched
-- and only provides a fallback for fresh databases so the policies below
-- can never fail on a missing function.
-- ================================================================
DO $do$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM   pg_proc p
    JOIN   pg_namespace n ON n.oid = p.pronamespace
    WHERE  n.nspname = 'public'
      AND  p.proname  = 'get_user_role'
  ) THEN
    BEGIN
      CREATE FUNCTION public.get_user_role(user_uuid uuid)
      RETURNS text
      LANGUAGE sql
      STABLE
      SECURITY DEFINER
      SET search_path = public
      AS $fn$
        SELECT COALESCE(
          (SELECT role::text FROM public.profiles WHERE id = user_uuid),
          'user'
        )
      $fn$;
      EXECUTE 'GRANT EXECUTE ON FUNCTION public.get_user_role(uuid) TO authenticated';
      RAISE NOTICE 'get_user_role() created.';
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'Skipped get_user_role() creation: %', SQLERRM;
    END;
  ELSE
    RAISE NOTICE 'get_user_role() already exists — left untouched.';
  END IF;
END
$do$;


-- ================================================================
-- SECTION 2 — Add every `parcels` column the app expects
-- (THIS is the direct fix for "status stays processing": PostgREST no
--  longer rejects the manifest → parcel sync with PGRST204.)
-- All statements are no-ops if the column already exists.
-- ================================================================

-- Status-sync columns used by the manifest editor + public tracking page
ALTER TABLE public.parcels ADD COLUMN IF NOT EXISTS admin_note       text;
ALTER TABLE public.parcels ADD COLUMN IF NOT EXISTS status_notes     text;
ALTER TABLE public.parcels ADD COLUMN IF NOT EXISTS current_location text;
ALTER TABLE public.parcels ADD COLUMN IF NOT EXISTS last_location    text;
ALTER TABLE public.parcels ADD COLUMN IF NOT EXISTS detailed_status  jsonb;

-- Columns used by parcel management / email features (no-ops if present)
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

-- Helpful index for tracking / manifest-cascade lookups
CREATE INDEX IF NOT EXISTS parcels_tracking_id_idx ON public.parcels (tracking_id);


-- ================================================================
-- SECTION 3 — RLS on `parcels`
-- Only applied if RLS is ALREADY enabled on the table (we never change
-- your security posture implicitly — if RLS is off, updates already work).
--
-- Role model (matches supabase-rls-manifests.sql):
--   • admin / staff / developer → full access
--   • owner (created_by)        → manage own parcels
--   • partner                   → update parcels contained in OWN manifests
--                                 (this is what the manifest status
--                                  cascade writes to — cross-owner safe)
--   • anon                      → SELECT only (public tracking page)
-- ================================================================
DO $do$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM   pg_class c
    JOIN   pg_namespace n ON n.oid = c.relnamespace
    WHERE  n.nspname = 'public'
      AND  c.relname = 'parcels'
      AND  c.relrowsecurity = true
  ) THEN
    -- Remove old / conflicting policies so the script is safe to re-run
    DROP POLICY IF EXISTS "admin_staff_full_access_parcels"   ON public.parcels;
    DROP POLICY IF EXISTS "own_parcels_select"                ON public.parcels;
    DROP POLICY IF EXISTS "own_parcels_insert"                ON public.parcels;
    DROP POLICY IF EXISTS "own_parcels_update"                ON public.parcels;
    DROP POLICY IF EXISTS "own_parcels_delete"                ON public.parcels;
    DROP POLICY IF EXISTS "public_track_parcels_select"       ON public.parcels;
    DROP POLICY IF EXISTS "partners_manifest_parcels_update"  ON public.parcels;

    -- Admin / staff / developer — full access
    CREATE POLICY "admin_staff_full_access_parcels"
      ON public.parcels
      FOR ALL
      TO authenticated
      USING (get_user_role(auth.uid()) IN ('admin', 'staff', 'developer'))
      WITH CHECK (get_user_role(auth.uid()) IN ('admin', 'staff', 'developer'));

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

    RAISE NOTICE 'parcels RLS policies created (RLS was enabled).';
  ELSE
    RAISE NOTICE 'parcels RLS is NOT enabled — skipping policy creation (nothing changed).';
  END IF;
END
$do$;

-- Partner bonus policy: a partner may update parcels that are listed inside
-- one of THEIR OWN manifests (manifests_detail.parcels jsonb array) even if
-- those parcel rows were created by someone else — this is exactly what the
-- manifest status cascade touches. Guarded: only created when the
-- manifests_detail table + partner_user_id + parcels columns all exist.
DO $do$
DECLARE
  v_table   text;
  v_policy  text;
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'parcels' AND c.relrowsecurity = true
  )
  AND to_regclass('public.manifests_detail') IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'manifests_detail'
      AND column_name IN ('partner_user_id', 'parcels')
    HAVING COUNT(*) = 2
  ) THEN
    BEGIN
      EXECUTE 'DROP POLICY IF EXISTS "partners_manifest_parcels_update" ON public.parcels';
      EXECUTE $pol$
        CREATE POLICY "partners_manifest_parcels_update"
          ON public.parcels
          FOR UPDATE
          TO authenticated
          USING (
            EXISTS (
              SELECT 1
              FROM   public.manifests_detail md,
                     LATERAL jsonb_array_elements(
                       CASE WHEN jsonb_typeof(md.parcels::jsonb) = 'array'
                            THEN md.parcels::jsonb
                            ELSE '[]'::jsonb END
                     ) el
              WHERE  md.partner_user_id = auth.uid()
                AND  el->>'tracking_id' = parcels.tracking_id
            )
          )
      $pol$;
      RAISE NOTICE 'partners_manifest_parcels_update policy created.';
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'Skipped partners_manifest_parcels_update: %', SQLERRM;
    END;
  END IF;
END
$do$;


-- ================================================================
-- SECTION 4 — RLS on the manifest tables
-- Each block only runs when its table actually exists, so the script also
-- works on databases where the manifest feature is not yet installed.
-- ================================================================

-- ----------------------------------------------------------------
-- 4a. manifests_detail — admin/staff/developer full, partner own rows
-- ----------------------------------------------------------------
DO $do$
BEGIN
  IF to_regclass('public.manifests_detail') IS NOT NULL THEN
    ALTER TABLE public.manifests_detail ENABLE ROW LEVEL SECURITY;

    DROP POLICY IF EXISTS "admin_staff_full_access_manifests" ON public.manifests_detail;
    DROP POLICY IF EXISTS "partners_own_manifests_select"     ON public.manifests_detail;
    DROP POLICY IF EXISTS "partners_own_manifests_insert"     ON public.manifests_detail;
    DROP POLICY IF EXISTS "partners_own_manifests_update"     ON public.manifests_detail;
    DROP POLICY IF EXISTS "partners_own_manifests_delete"     ON public.manifests_detail;

    CREATE POLICY "admin_staff_full_access_manifests"
      ON public.manifests_detail
      FOR ALL
      TO authenticated
      USING (get_user_role(auth.uid()) IN ('admin', 'staff', 'developer'))
      WITH CHECK (get_user_role(auth.uid()) IN ('admin', 'staff', 'developer'));

    -- Partner policies need the partner_user_id column — guard them
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name   = 'manifests_detail'
        AND column_name  = 'partner_user_id'
    ) THEN
      CREATE POLICY "partners_own_manifests_select"
        ON public.manifests_detail FOR SELECT TO authenticated
        USING (get_user_role(auth.uid()) = 'partner' AND partner_user_id = auth.uid());

      CREATE POLICY "partners_own_manifests_insert"
        ON public.manifests_detail FOR INSERT TO authenticated
        WITH CHECK (get_user_role(auth.uid()) = 'partner' AND partner_user_id = auth.uid());

      CREATE POLICY "partners_own_manifests_update"
        ON public.manifests_detail FOR UPDATE TO authenticated
        USING (get_user_role(auth.uid()) = 'partner' AND partner_user_id = auth.uid())
        WITH CHECK (get_user_role(auth.uid()) = 'partner' AND partner_user_id = auth.uid());

      CREATE POLICY "partners_own_manifests_delete"
        ON public.manifests_detail FOR DELETE TO authenticated
        USING (get_user_role(auth.uid()) = 'partner' AND partner_user_id = auth.uid());
    END IF;

    RAISE NOTICE 'manifests_detail RLS configured.';
  ELSE
    RAISE NOTICE 'manifests_detail does not exist — skipped.';
  END IF;
END
$do$;

-- ----------------------------------------------------------------
-- 4b. manifest_history — admin/staff/developer full;
--     partner SELECT + INSERT for history of THEIR OWN manifests
--     (the app inserts a history row on EVERY manifest status change,
--      so SELECT-only partners previously got an RLS violation here).
-- ----------------------------------------------------------------
DO $do$
BEGIN
  IF to_regclass('public.manifest_history') IS NOT NULL THEN
    ALTER TABLE public.manifest_history ENABLE ROW LEVEL SECURITY;

    DROP POLICY IF EXISTS "admin_staff_full_access_manifest_history" ON public.manifest_history;
    DROP POLICY IF EXISTS "partners_own_manifest_history_select"     ON public.manifest_history;
    DROP POLICY IF EXISTS "partners_own_manifest_history_insert"     ON public.manifest_history;

    CREATE POLICY "admin_staff_full_access_manifest_history"
      ON public.manifest_history
      FOR ALL
      TO authenticated
      USING (get_user_role(auth.uid()) IN ('admin', 'staff', 'developer'))
      WITH CHECK (get_user_role(auth.uid()) IN ('admin', 'staff', 'developer'));

    -- Partner policies need manifests_detail.partner_user_id to exist
    IF to_regclass('public.manifests_detail') IS NOT NULL
       AND EXISTS (
         SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name   = 'manifests_detail'
           AND column_name  = 'partner_user_id'
       ) THEN
      CREATE POLICY "partners_own_manifest_history_select"
        ON public.manifest_history FOR SELECT TO authenticated
        USING (
          get_user_role(auth.uid()) = 'partner'
          AND EXISTS (
            SELECT 1
            FROM   public.manifests_detail md
            WHERE  md.manifest_id     = manifest_history.manifest_id
              AND  md.partner_user_id = auth.uid()
          )
        );

      CREATE POLICY "partners_own_manifest_history_insert"
        ON public.manifest_history FOR INSERT TO authenticated
        WITH CHECK (
          get_user_role(auth.uid()) = 'partner'
          AND EXISTS (
            SELECT 1
            FROM   public.manifests_detail md
            WHERE  md.manifest_id     = manifest_history.manifest_id
              AND  md.partner_user_id = auth.uid()
          )
        );
    END IF;

    RAISE NOTICE 'manifest_history RLS configured.';
  ELSE
    RAISE NOTICE 'manifest_history does not exist — skipped.';
  END IF;
END
$do$;

-- ----------------------------------------------------------------
-- 4c. manifest_sequence — all authenticated users read + update
--     (partners create manifests and must advance the counter)
-- ----------------------------------------------------------------
DO $do$
BEGIN
  IF to_regclass('public.manifest_sequence') IS NOT NULL THEN
    ALTER TABLE public.manifest_sequence ENABLE ROW LEVEL SECURITY;

    DROP POLICY IF EXISTS "authenticated_read_manifest_sequence"   ON public.manifest_sequence;
    DROP POLICY IF EXISTS "authenticated_update_manifest_sequence" ON public.manifest_sequence;

    CREATE POLICY "authenticated_read_manifest_sequence"
      ON public.manifest_sequence
      FOR SELECT
      TO authenticated
      USING (true);

    CREATE POLICY "authenticated_update_manifest_sequence"
      ON public.manifest_sequence
      FOR UPDATE
      TO authenticated
      USING (true)
      WITH CHECK (true);

    RAISE NOTICE 'manifest_sequence RLS configured.';
  ELSE
    RAISE NOTICE 'manifest_sequence does not exist — skipped.';
  END IF;
END
$do$;


-- ================================================================
-- SECTION 5 — increment_manifest_sequence() RPC
-- Created ONLY if missing. SECURITY DEFINER so partners can always get
-- the next manifest number even before the RLS policies above apply.
-- ================================================================
DO $do$
BEGIN
  IF to_regclass('public.manifest_sequence') IS NOT NULL
     AND NOT EXISTS (
       SELECT 1
       FROM   pg_proc p
       JOIN   pg_namespace n ON n.oid = p.pronamespace
       WHERE  n.nspname = 'public'
         AND  p.proname  = 'increment_manifest_sequence'
     ) THEN
    BEGIN
      CREATE FUNCTION public.increment_manifest_sequence()
      RETURNS bigint
      LANGUAGE plpgsql
      SECURITY DEFINER
      SET search_path = public
      AS $fn$
      DECLARE
        next_val bigint;
      BEGIN
        UPDATE public.manifest_sequence
           SET last_number = COALESCE(last_number, 0) + 1
         WHERE id = 1
        RETURNING last_number INTO next_val;
        RETURN next_val;
      END;
      $fn$;
      EXECUTE 'GRANT EXECUTE ON FUNCTION public.increment_manifest_sequence() TO authenticated';
      RAISE NOTICE 'increment_manifest_sequence() created.';
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'Skipped increment_manifest_sequence() creation: %', SQLERRM;
    END;
  ELSE
    RAISE NOTICE 'increment_manifest_sequence() already exists (or table missing) — left untouched.';
  END IF;
END
$do$;


-- ================================================================
-- SECTION 6 — Reload the PostgREST schema cache immediately
-- (Supabase normally auto-reloads on DDL; this makes the new columns
--  usable by the app the second the script finishes.)
-- ================================================================
NOTIFY pgrst, 'reload schema';


-- ================================================================
-- VERIFICATION — run the results panel and confirm:
--   1) all new parcels columns exist
--   2) the expected policies are active
--   3) the helper functions exist
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

SELECT tablename, policyname, cmd, roles
FROM   pg_policies
WHERE  schemaname = 'public'
  AND  tablename IN ('parcels', 'manifests_detail', 'manifest_history', 'manifest_sequence')
ORDER  BY tablename, policyname;

SELECT p.proname AS function_name, pg_get_function_identity_arguments(p.oid) AS arguments
FROM   pg_proc p
JOIN   pg_namespace n ON n.oid = p.pronamespace
WHERE  n.nspname = 'public'
  AND  p.proname IN ('get_user_role', 'increment_manifest_sequence')
ORDER  BY p.proname;
