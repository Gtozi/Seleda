-- Migration 705: tenant_id on remaining parent-keyed tables
--
-- The app-layer tenant filter (ALS scope) covers tables with tenant_id.
-- These tables were skipped because they lacked the column; they all have
-- property_id, so tenant_id is derived from the parent property and the
-- 704 backstop trigger keeps it correct for future writes.

DO $$
DECLARE
  t text;
  candidate_tables text[] := ARRAY[
    'allotments', 'allotment_pickup_log', 'pre_registrations', 'vouchers',
    'work_requests', 'guest_communications', 'guest_feedback'
  ];
BEGIN
  FOREACH t IN ARRAY candidate_tables LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = t
    ) THEN
      EXECUTE format(
        'ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS tenant_id uuid', t);
      EXECUTE format(
        'UPDATE public.%I c SET tenant_id = p.tenant_id
           FROM public.properties p
           WHERE c.property_id = p.id AND c.tenant_id IS NULL', t);
      EXECUTE format(
        'CREATE INDEX IF NOT EXISTS %I ON public.%I (tenant_id)',
        'idx_' || t || '_tenant', t);
      EXECUTE format('DROP TRIGGER IF EXISTS trg_set_tenant_id ON public.%I', t);
      EXECUTE format(
        'CREATE TRIGGER trg_set_tenant_id
           BEFORE INSERT OR UPDATE ON public.%I
           FOR EACH ROW EXECUTE FUNCTION set_tenant_id_from_property()', t);
    END IF;
  END LOOP;
END $$;
