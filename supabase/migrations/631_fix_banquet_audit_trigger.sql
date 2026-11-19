-- 631_fix_banquet_audit_trigger.sql
-- Fix the shared banquet audit trigger function.
--
-- trg_banquet_audit() is attached to every banquet_* table, but it reads
-- NEW.event_id / OLD.event_id unconditionally for any table other than
-- event_bookings. Tables without an event_id column (banquet_events,
-- banquet_venues, banquet_schedules, banquet_checklists, banquet_beos,
-- banquet_event_type_items, banquet_menu_items, banquet_beverages,
-- banquet_resources, …) therefore fail on EVERY insert/update/delete with:
--   ERROR: record "new" has no field "event_id"
--
-- Fix: derive the row once via to_jsonb() and read event_id defensively
-- (missing key → NULL instead of an error). For the event tables
-- themselves (event_bookings, banquet_events) the record id *is* the
-- event id.

CREATE OR REPLACE FUNCTION public.trg_banquet_audit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_event   text;
  v_prop    uuid;
  v_record  text;
  v_row     jsonb;
BEGIN
  v_row    := CASE WHEN TG_OP = 'DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
  v_record := v_row ->> 'id';
  v_prop   := NULLIF(v_row ->> 'property_id', '')::uuid;
  v_event  := CASE
                WHEN TG_TABLE_NAME IN ('event_bookings', 'banquet_events')
                  THEN v_record
                ELSE v_row ->> 'event_id'
              END;

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
$function$;
