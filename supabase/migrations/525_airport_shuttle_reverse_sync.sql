-- 525_airport_shuttle_reverse_sync.sql
-- Complete the airport_shuttle_requests <-> transport_requests bridge.
-- Migration 523 bridges legacy INSERT -> transport and transport status ->
-- legacy. This adds the missing directions:
--   * legacy UPDATE (status / schedule / quantity / flight / notes) -> transport
--   * legacy DELETE -> delete the bridged transport row
-- Per-field guards prevent status regressions and trigger loops:
--   legacy 'Confirmed' -> transport 'Confirmed' -> sync-back writes legacy
--   'Confirmed' (no change) -> this trigger does not refire.

-- Narrower legacy vocabulary -> wider transport vocabulary.
CREATE OR REPLACE FUNCTION public.shuttle_status_to_transport(p_status text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p_status
    WHEN 'Confirmed' THEN 'Confirmed'
    WHEN 'Completed' THEN 'Completed'
    WHEN 'Cancelled' THEN 'Cancelled'
    ELSE 'Requested'  -- 'Pending' and anything else
  END;
$$;

CREATE OR REPLACE FUNCTION public.trg_airport_shuttle_sync_transport()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ref text := 'asr:' || COALESCE(NEW.id, OLD.id);
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM transport_requests WHERE source_ref = v_ref;
    RETURN OLD;
  END IF;

  -- Status: only propagate when the legacy status actually changed, so an
  -- unrelated legacy edit cannot roll back a more advanced transport status.
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    UPDATE transport_requests
       SET status = public.shuttle_status_to_transport(NEW.status)
     WHERE source_ref = v_ref;
  END IF;

  IF NEW.scheduled_date IS DISTINCT FROM OLD.scheduled_date
     OR NEW.scheduled_time IS DISTINCT FROM OLD.scheduled_time THEN
    UPDATE transport_requests
       SET scheduled_time =
             COALESCE(NEW.scheduled_at,
               (NEW.scheduled_date + COALESCE(NEW.scheduled_time, '00:00'::time))::timestamptz)
     WHERE source_ref = v_ref;
  END IF;

  IF NEW.quantity IS DISTINCT FROM OLD.quantity THEN
    UPDATE transport_requests
       SET passenger_count = GREATEST(1, COALESCE(NEW.quantity, 1))
     WHERE source_ref = v_ref;
  END IF;

  IF NEW.flight_number IS DISTINCT FROM OLD.flight_number
     OR NEW.notes IS DISTINCT FROM OLD.notes THEN
    UPDATE transport_requests
       SET special_instructions = concat_ws(' | ',
             NULLIF('Flight ' || COALESCE(NEW.flight_number, ''), 'Flight '),
             NULLIF(NEW.notes, ''))
     WHERE source_ref = v_ref;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_airport_shuttle_sync_transport ON airport_shuttle_requests;
CREATE TRIGGER trg_airport_shuttle_sync_transport
  AFTER UPDATE OR DELETE ON airport_shuttle_requests
  FOR EACH ROW EXECUTE FUNCTION public.trg_airport_shuttle_sync_transport();
