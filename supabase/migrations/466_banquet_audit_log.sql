-- =============================================================================
-- Migration 466: Banquet & Events — audit trail
-- =============================================================================
-- GAP: the spec's System Administration integration (§Department Matrix /
-- "Complete audit trail") requires every banquet operation to be auditable.
-- No audit table existed for the portal.
--
-- Adds:
--   banquet_audit_log — append-only log of INSERT/UPDATE/DELETE on every
--     banquet table (and event_bookings). Records old/new row snapshots,
--     the event the row belongs to, and the acting user when the write came
--     through PostgREST (auth.uid()); service-role writes record NULL.
--   trg_banquet_audit() — generic trigger function attached to all banquet
--     tables.
--
-- Read access is property-scoped like every other banquet table.
-- Depends on: all banquet tables, 458 (banquet_can_access_property)
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.banquet_audit_log (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  property_id uuid,
  table_name  text NOT NULL,
  record_id   text,
  event_id    text,
  action      text NOT NULL,            -- INSERT | UPDATE | DELETE
  old_data    jsonb,
  new_data    jsonb,
  changed_by  text,
  changed_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_banquet_audit_table_record
  ON public.banquet_audit_log (table_name, record_id);
CREATE INDEX IF NOT EXISTS idx_banquet_audit_event
  ON public.banquet_audit_log (event_id) WHERE event_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_banquet_audit_changed_at
  ON public.banquet_audit_log (changed_at DESC);

ALTER TABLE public.banquet_audit_log ENABLE ROW LEVEL SECURITY;

-- Read-only to the property's users; writes only ever come from the trigger.
DROP POLICY IF EXISTS banquet_audit_log_property_scoped ON public.banquet_audit_log;
CREATE POLICY banquet_audit_log_property_scoped ON public.banquet_audit_log
  FOR SELECT TO authenticated
  USING (public.banquet_can_access_property(property_id));

CREATE OR REPLACE FUNCTION public.trg_banquet_audit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_event   text;
  v_prop    uuid;
  v_record  text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_record := OLD.id::text;
    v_prop   := OLD.property_id;
    v_event  := CASE WHEN TG_TABLE_NAME = 'event_bookings' THEN OLD.id ELSE OLD.event_id END;
  ELSE
    v_record := NEW.id::text;
    v_prop   := NEW.property_id;
    v_event  := CASE WHEN TG_TABLE_NAME = 'event_bookings' THEN NEW.id ELSE NEW.event_id END;
  END IF;

  INSERT INTO public.banquet_audit_log
    (property_id, table_name, record_id, event_id, action, old_data, new_data, changed_by)
  VALUES (
    v_prop,
    TG_TABLE_NAME,
    v_record,
    v_event,
    TG_OP,
    CASE WHEN TG_OP <> 'INSERT' THEN to_jsonb(OLD) END,
    CASE WHEN TG_OP <> 'DELETE' THEN to_jsonb(NEW) END,
    auth.uid()::text
  );

  RETURN COALESCE(NEW, OLD);
END;
$$;

-- Attach to every banquet write path, plus event_bookings so lifecycle and
-- financial changes are captured too.
DO $$
DECLARE
  t text;
  audit_tables text[] := ARRAY[
    'event_bookings',
    'banquet_venues',
    'banquet_schedules',
    'banquet_checklists',
    'banquet_beos',
    'banquet_event_type_items',
    'banquet_menu_items',
    'banquet_beverages',
    'banquet_resources',
    'banquet_equipment',
    'banquet_equipment_catalog',
    'banquet_vendors',
    'banquet_transportation',
    'banquet_event_issues',
    'banquet_dept_coordination',
    'banquet_communications',
    'banquet_event_guests',
    'banquet_event_registrations',
    'banquet_event_seating',
    'banquet_event_config',
    'event_deposit_schedule'
  ];
BEGIN
  FOREACH t IN ARRAY audit_tables LOOP
    IF to_regclass('public.' || t) IS NULL THEN CONTINUE; END IF;
    EXECUTE format('DROP TRIGGER IF EXISTS trg_audit_%I ON public.%I', t, t);
    EXECUTE format(
      'CREATE TRIGGER trg_audit_%I AFTER INSERT OR UPDATE OR DELETE ON public.%I
         FOR EACH ROW EXECUTE FUNCTION public.trg_banquet_audit()', t, t);
  END LOOP;
END $$;

COMMENT ON TABLE public.banquet_audit_log IS
  'Append-only audit trail for every banquet write. Backs GET /api/banquet-events/audit-log. '
  'changed_by is populated for PostgREST (RLS) writes; service-role route writes record NULL.';
