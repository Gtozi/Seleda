-- ============================================================================
-- 626_security_rls_authenticated_policies.sql
-- ============================================================================
-- The 48 sec_* tables (migrations 600–623) enable RLS but were created AFTER
-- migration 100 (rls_policies_comprehensive) ran, so they never received the
-- project-standard blanket policy:
--
--   CREATE POLICY "authenticated_all_<table>" ON public.<table>
--     FOR ALL TO authenticated USING (true) WITH CHECK (true);
--
-- This migration brings sec_* tables in line with every other operational
-- table. The authorization boundary remains the Express API layer
-- (/api/sec-portal, authenticate middleware) — consistent with the rest of
-- the system. anon still gets NO access (no anon policies are created).
--
-- Without this, a staff user whose frontend session runs as `authenticated`
-- silently gets empty results from any direct supabase-js read or realtime
-- subscription on sec_* tables.
-- ============================================================================

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename LIKE 'sec\_%'
  LOOP
    EXECUTE format(
      'CREATE POLICY "authenticated_all_%s" ON public.%I FOR ALL TO authenticated USING (true) WITH CHECK (true)',
      r.tablename, r.tablename
    );
  END LOOP;
END $$;

-- END: 626_security_rls_authenticated_policies.sql
