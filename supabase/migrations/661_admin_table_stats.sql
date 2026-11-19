-- 661: Admin health — live row-count stats across all public tables
-- Used by GET /api/admin/health/db-stats for the Monitoring & Health dashboard.
-- Returns estimated live row counts from pg_stat_user_tables (fast, no table scans).

CREATE OR REPLACE FUNCTION public.get_table_stats()
RETURNS TABLE(table_name text, row_count bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT c.relname::text AS table_name,
         s.n_live_tup::bigint AS row_count
  FROM pg_stat_user_tables s
  JOIN pg_class c ON c.relname = s.relname
  JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = s.schemaname
  WHERE s.schemaname = 'public'
    AND c.relkind IN ('r', 'p')
  ORDER BY s.n_live_tup DESC;
$$;

GRANT EXECUTE ON FUNCTION public.get_table_stats() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_table_stats() TO service_role;

COMMENT ON FUNCTION public.get_table_stats() IS
  'Returns estimated live row counts for all public-schema tables, ordered by size desc. Used by the admin health dashboard.';
