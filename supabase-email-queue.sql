-- ─────────────────────────────────────────────────────────────────────────────
-- supabase-email-queue.sql
--
-- Creates the email_queue table used by the new brevo-client.ts to store
-- emails that failed to send (e.g. when Brevo blocks the server's IP).
--
-- Failed emails get stored here with status='pending' and can be retried
-- later via a cron job or manually from the admin dashboard.
--
-- Run once in Supabase SQL Editor. Safe to re-run (IF NOT EXISTS).
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

-- 1) Create the email_queue table if it doesn't exist
CREATE TABLE IF NOT EXISTS public.email_queue (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  to_email      TEXT NOT NULL,
  to_name       TEXT,
  subject       TEXT NOT NULL,
  html_content  TEXT NOT NULL,
  sender_name   TEXT,
  sender_email  TEXT,
  tags          TEXT[],
  status        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed', 'cancelled')),
  last_error    TEXT,
  attempts      INTEGER NOT NULL DEFAULT 0,
  next_retry_at TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at       TIMESTAMPTZ
);

-- Indexes for the common queries
CREATE INDEX IF NOT EXISTS idx_email_queue_status ON public.email_queue (status);
CREATE INDEX IF NOT EXISTS idx_email_queue_next_retry ON public.email_queue (next_retry_at) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_email_queue_created_at ON public.email_queue (created_at DESC);

-- 2) RLS policies
--    - Authenticated users can READ (admin sees the queue)
--    - Anyone (including the serverless function with anon key) can INSERT
--      (so we can queue emails even when the user's session is gone)
--    - Only admins can UPDATE / DELETE (to retry or cancel)
DO $$
DECLARE pol_name TEXT;
BEGIN
  FOR pol_name IN
    SELECT policyname FROM pg_policies
     WHERE tablename = 'email_queue' AND schemaname = 'public'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.email_queue', pol_name);
  END LOOP;
END $$;

-- Anyone (anon + authenticated) can INSERT — needed so the serverless
-- function can queue emails using the anon key
CREATE POLICY email_queue_insert_anyone
  ON public.email_queue
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

-- Authenticated users can SELECT (admins see the queue in the dashboard)
CREATE POLICY email_queue_select_authed
  ON public.email_queue
  FOR SELECT
  TO authenticated
  USING (true);

-- Only admins can UPDATE (retry, mark as sent, cancel)
CREATE POLICY email_queue_update_admin
  ON public.email_queue
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.profiles p WHERE p.user_id = auth.uid() AND p.role = 'admin')
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.profiles p WHERE p.user_id = auth.uid() AND p.role = 'admin')
  );

-- Only admins can DELETE
CREATE POLICY email_queue_delete_admin
  ON public.email_queue
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.profiles p WHERE p.user_id = auth.uid() AND p.role = 'admin')
  );

COMMIT;

-- ─────────────────────────────────────────────────────────────────────────────
-- Optional: clean up old sent / cancelled emails after 30 days.
-- Run this once a week via a Supabase cron (pg_cron extension):
--
-- SELECT cron.schedule(
--   'cleanup-old-email-queue',
--   '0 3 * * 0',  -- every Sunday at 3am UTC
--   $$DELETE FROM public.email_queue
--     WHERE status IN ('sent', 'cancelled')
--       AND created_at < now() - interval '30 days'$$
-- );
-- ─────────────────────────────────────────────────────────────────────────────

-- Verification:
-- SELECT column_name, data_type FROM information_schema.columns
-- WHERE table_schema='public' AND table_name='email_queue'
-- ORDER BY ordinal_position;
