-- 526_airport_transfers_bridge.sql
-- Bridge transport_airport_transfers <-> transport_requests so flight-tracked
-- transfers are visible to dispatch (and vice versa), matching the
-- airport_shuttle_requests bridge from 523/525.
--
--   * INSERT on transport_airport_transfers -> bridged transport_requests row
--     (source_ref = 'at:<id>')
--   * transport_requests UPDATE (status / assigned_vehicle / driver_id) ->
--     airport_transfers (same status vocabulary, 1:1)
--   * airport_transfers UPDATE/DELETE -> bridged transport_requests row
--   * Backfill: existing airport_transfers + legacy shuttle rows that lack a
--     bridged transport_requests row get one.

-- ── Type mapping: airport transfer type -> transport_requests.type ───────────
CREATE OR REPLACE FUNCTION public.airport_transfer_type_to_transport(p_type text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p_type
    WHEN 'Departure Drop-off' THEN 'Airport Drop-off'
    WHEN 'VIP Pickup' THEN 'VIP Transport'
    WHEN 'Executive Transfer' THEN 'VIP Transport'
    ELSE 'Airport Pickup'  -- Arrival Pickup, Meet & Greet, Group Transfer
  END;
$$;

-- ── INSERT bridge: airport_transfers -> transport_requests ──────────────────
CREATE OR REPLACE FUNCTION public.trg_bridge_airport_transfer_to_transport()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO transport_requests
    (property_id, request_number, guest_id, guest_name, room, type, source,
     pickup_location, destination, scheduled_time, passenger_count,
     luggage_count, status, special_instructions, assigned_vehicle, driver_id,
     source_ref)
  VALUES
    (NEW.property_id, 'TR-' || NEW.transfer_number, NEW.guest_id, NEW.guest_name,
     NEW.room, public.airport_transfer_type_to_transport(NEW.type),
     'Front Office', NEW.pickup_location, NEW.destination, NEW.scheduled_time,
     GREATEST(1, COALESCE(NEW.passenger_count, 1)),
     GREATEST(0, COALESCE(NEW.luggage_count, 0)),
     NEW.status,
     concat_ws(' | ',
       NULLIF('Flight ' || COALESCE(NEW.flight_number, ''), 'Flight '),
       NULLIF(NEW.airline, ''),
       NULLIF(NEW.terminal, ''),
       CASE WHEN NEW.meet_greet THEN 'Meet & Greet' END),
     NEW.assigned_vehicle, NEW.driver_id,
     'at:' || NEW.id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_airport_transfer_bridge ON transport_airport_transfers;
CREATE TRIGGER trg_airport_transfer_bridge
  AFTER INSERT ON transport_airport_transfers
  FOR EACH ROW EXECUTE FUNCTION public.trg_bridge_airport_transfer_to_transport();

-- ── transport_requests -> sources: extend the 523 sync-back to 'at:%' refs ───
-- Both directions guard on IS DISTINCT FROM OLD so the pair cannot loop.
CREATE OR REPLACE FUNCTION public.trg_transport_request_sync_source()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.source_ref IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.source_ref LIKE 'asr:%' THEN
    IF NEW.status IS DISTINCT FROM OLD.status THEN
      UPDATE airport_shuttle_requests
         SET status = public.transport_status_to_shuttle(NEW.status)
       WHERE id = substring(NEW.source_ref from 5);
    END IF;
  ELSIF NEW.source_ref LIKE 'at:%' THEN
    IF NEW.status IS DISTINCT FROM OLD.status
       OR NEW.assigned_vehicle IS DISTINCT FROM OLD.assigned_vehicle
       OR NEW.driver_id IS DISTINCT FROM OLD.driver_id THEN
      UPDATE transport_airport_transfers
         SET status = NEW.status,
             assigned_vehicle = NEW.assigned_vehicle,
             driver_id = NEW.driver_id
       WHERE id = substring(NEW.source_ref from 4)::uuid;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- Recreate with the wider column list so vehicle/driver assignment syncs too.
DROP TRIGGER IF EXISTS trg_transport_request_sync_source ON transport_requests;
CREATE TRIGGER trg_transport_request_sync_source
  AFTER UPDATE OF status, assigned_vehicle, driver_id ON transport_requests
  FOR EACH ROW EXECUTE FUNCTION public.trg_transport_request_sync_source();

-- ── airport_transfers -> transport_requests: UPDATE/DELETE reverse sync ─────
CREATE OR REPLACE FUNCTION public.trg_airport_transfer_sync_transport()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ref text := 'at:' || COALESCE(NEW.id, OLD.id);
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM transport_requests WHERE source_ref = v_ref;
    RETURN OLD;
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status
     OR NEW.assigned_vehicle IS DISTINCT FROM OLD.assigned_vehicle
     OR NEW.driver_id IS DISTINCT FROM OLD.driver_id THEN
    UPDATE transport_requests
       SET status = NEW.status,
           assigned_vehicle = NEW.assigned_vehicle,
           driver_id = NEW.driver_id
     WHERE source_ref = v_ref;
  END IF;

  IF NEW.scheduled_time IS DISTINCT FROM OLD.scheduled_time THEN
    UPDATE transport_requests SET scheduled_time = NEW.scheduled_time
     WHERE source_ref = v_ref;
  END IF;

  IF NEW.passenger_count IS DISTINCT FROM OLD.passenger_count
     OR NEW.luggage_count IS DISTINCT FROM OLD.luggage_count THEN
    UPDATE transport_requests
       SET passenger_count = GREATEST(1, COALESCE(NEW.passenger_count, 1)),
           luggage_count = GREATEST(0, COALESCE(NEW.luggage_count, 0))
     WHERE source_ref = v_ref;
  END IF;

  IF NEW.flight_number IS DISTINCT FROM OLD.flight_number
     OR NEW.airline IS DISTINCT FROM OLD.airline
     OR NEW.terminal IS DISTINCT FROM OLD.terminal THEN
    UPDATE transport_requests
       SET special_instructions = concat_ws(' | ',
             NULLIF('Flight ' || COALESCE(NEW.flight_number, ''), 'Flight '),
             NULLIF(NEW.airline, ''),
             NULLIF(NEW.terminal, ''),
             CASE WHEN NEW.meet_greet THEN 'Meet & Greet' END)
     WHERE source_ref = v_ref;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_airport_transfer_sync_transport ON transport_airport_transfers;
CREATE TRIGGER trg_airport_transfer_sync_transport
  AFTER UPDATE OR DELETE ON transport_airport_transfers
  FOR EACH ROW EXECUTE FUNCTION public.trg_airport_transfer_sync_transport();

-- ── Backfill: existing airport transfers without a bridged request ───────────
INSERT INTO transport_requests
  (property_id, request_number, guest_id, guest_name, room, type, source,
   pickup_location, destination, scheduled_time, passenger_count,
   luggage_count, status, special_instructions, assigned_vehicle, driver_id,
   source_ref)
SELECT t.property_id, 'TR-' || t.transfer_number, t.guest_id, t.guest_name,
       t.room, public.airport_transfer_type_to_transport(t.type),
       'Front Office', t.pickup_location, t.destination, t.scheduled_time,
       GREATEST(1, COALESCE(t.passenger_count, 1)),
       GREATEST(0, COALESCE(t.luggage_count, 0)),
       t.status,
       concat_ws(' | ',
         NULLIF('Flight ' || COALESCE(t.flight_number, ''), 'Flight '),
         NULLIF(t.airline, ''),
         NULLIF(t.terminal, ''),
         CASE WHEN t.meet_greet THEN 'Meet & Greet' END),
       t.assigned_vehicle, t.driver_id, 'at:' || t.id
  FROM transport_airport_transfers t
 WHERE NOT EXISTS (
   SELECT 1 FROM transport_requests r WHERE r.source_ref = 'at:' || t.id::text);

-- ── Backfill: legacy shuttle rows created before the 523 bridge ──────────────
INSERT INTO transport_requests
  (property_id, request_number, guest_id, guest_name, room, type, source,
   pickup_location, destination, scheduled_time, passenger_count, status,
   special_instructions, source_ref)
SELECT COALESCE(
         (SELECT r.property_id FROM reservations r WHERE r.id = s.reservation_id),
         (SELECT p.id FROM properties p ORDER BY p.created_at LIMIT 1)),
       'TR-' || to_char(now(), 'YYYYMMDD') || '-S' || substring(s.id from 1 for 8),
       s.guest_id,
       COALESCE(s.guest_name,
         (SELECT g.name FROM guests g WHERE g.id = s.guest_id),
         (SELECT r.guest_name FROM reservations r WHERE r.id = s.reservation_id),
         'Guest'),
       COALESCE(s.room_number,
         (SELECT r.room_number FROM reservations r WHERE r.id = s.reservation_id)),
       CASE WHEN COALESCE(s.shuttle_type, '') ILIKE '%drop%'
            THEN 'Airport Drop-off' ELSE 'Airport Pickup' END,
       CASE WHEN s.reservation_id IS NOT NULL
            THEN 'Reservation System' ELSE 'Concierge' END,
       COALESCE(s.pickup_location,
         CASE WHEN COALESCE(s.shuttle_type, '') ILIKE '%drop%'
              THEN 'Hotel' ELSE 'Airport' END),
       COALESCE(s.dropoff_location,
         CASE WHEN COALESCE(s.shuttle_type, '') ILIKE '%drop%'
              THEN 'Airport' ELSE 'Hotel' END),
       COALESCE(s.scheduled_at,
         (s.scheduled_date + COALESCE(s.scheduled_time, '00:00'::time))::timestamptz),
       GREATEST(1, COALESCE(s.quantity, 1)),
       CASE s.status
         WHEN 'Confirmed' THEN 'Confirmed'
         WHEN 'Completed' THEN 'Completed'
         WHEN 'Cancelled' THEN 'Cancelled'
         ELSE 'Requested' END,
       concat_ws(' | ',
         NULLIF('Flight ' || COALESCE(s.flight_number, ''), 'Flight '),
         NULLIF(s.notes, '')),
       'asr:' || s.id
  FROM airport_shuttle_requests s
 WHERE NOT EXISTS (
   SELECT 1 FROM transport_requests r WHERE r.source_ref = 'asr:' || s.id)
   AND COALESCE(
         (SELECT r.property_id FROM reservations r WHERE r.id = s.reservation_id),
         (SELECT p.id FROM properties p ORDER BY p.created_at LIMIT 1)) IS NOT NULL;
