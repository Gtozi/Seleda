-- Migration 704: Tenant-id backstop trigger
--
-- The application layer now enforces tenant isolation (ALS-scoped queries +
-- insert stamping), but rows created inside Postgres functions/RPCs
-- (create_booking_atomic, check-in/out helpers, etc.) bypass the app layer
-- and would land with tenant_id NULL — invisible on tenant subdomains.
--
-- This trigger derives tenant_id from property_id on INSERT/UPDATE for every
-- table that has both columns, so RPC-created rows are scoped correctly
-- regardless of the code path that wrote them.

CREATE OR REPLACE FUNCTION set_tenant_id_from_property()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Only fill when tenant_id is missing; never overwrite an explicit value.
  IF NEW.tenant_id IS NULL AND NEW.property_id IS NOT NULL THEN
    SELECT p.tenant_id INTO NEW.tenant_id
    FROM public.properties p
    WHERE p.id = NEW.property_id;
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION set_tenant_id_from_property() IS
  'Backfills tenant_id from property_id for RPC-created rows (migration 704).';

-- Attach to every table that has both tenant_id and property_id columns.
-- The DO block checks column existence so it is safe on schemas where a
-- table lacks one of the columns.
DO $$
DECLARE
  t text;
  candidate_tables text[] := ARRAY[
    'reservations', 'guests', 'folios', 'guest_requests', 'guest_services',
    'rooms', 'room_types', 'spa_appointments', 'spa_treatments',
    'transport_requests', 'transport_config_items', 'airport_shuttle_requests',
    'banquet_events', 'banquet_venues', 'sales_leads', 'sales_proposals',
    'sales_contracts', 'work_orders', 'housekeeping_task_mgmt',
    'housekeeping_maintenance_issues', 'housekeeping_communication_messages',
    'hk_linen_stock', 'hk_amenity_stock', 'mobile_check_ins', 'digital_keys',
    'guest_notifications', 'guest_feedbacks', 'lost_found',
    'security_incidents', 'group_bookings', 'group_profiles', 'group_blocks',
    'inventory_items', 'inventory_stores', 'inventory_suppliers',
    'inventory_stock_movements', 'inventory_requisitions', 'inventory_grns',
    'uinv_items', 'uinv_stores', 'uinv_stock_balances', 'uinv_stock_ledger',
    'outlets', 'menu_items', 'ingredients', 'recipes', 'orders',
    'stock_locations', 'stock_transactions', 'requisitions', 'wastage_logs',
    'stock_counts', 'spare_parts', 'pm_schedules', 'vendors', 'employees',
    'rate_plans', 'seasons', 'packages', 'yield_policies', 'chart_of_accounts',
    'journal_entries', 'journal_lines', 'ap_bills', 'ap_payments',
    'bank_accounts', 'fixed_assets', 'depreciation_schedules',
    'accounting_periods', 'reconciliation_batches', 'reporting_snapshots',
    'metric_history', 'forecast_entries', 'alert_instances', 'alert_rules',
    'dashboard_views', 'report_schedules', 'drill_down_links',
    'corporate_accounts', 'guest_group_relationships', 'action_item',
    'daily_briefing', 'escalation', 'staffing_status', 'folio_lines',
    'folio_payments', 'public_testimonials', 'rms_promotions',
    'rms_daily_rate_overrides'
  ];
BEGIN
  FOREACH t IN ARRAY candidate_tables LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = t AND column_name = 'tenant_id'
    ) AND EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = t AND column_name = 'property_id'
    ) THEN
      EXECUTE format('DROP TRIGGER IF EXISTS trg_set_tenant_id ON public.%I', t);
      EXECUTE format(
        'CREATE TRIGGER trg_set_tenant_id
           BEFORE INSERT OR UPDATE ON public.%I
           FOR EACH ROW EXECUTE FUNCTION set_tenant_id_from_property()', t);
    END IF;
  END LOOP;
END $$;
