-- 529_staff_trips_bridge.sql
-- Bridge transport_trips (staff pickup/drop-off trips) <-> transport_requests
-- so staff transportation is visible to dispatch like every other channel.
--   source_ref = 'tp:<id>'
-- transport_trips status vocabulary is ('Scheduled','In Progress',
-- 'Completed','Cancelled') — narrower than transport_requests, so it gets
-- its own mapping (no 'Confirmed'/'Assigned' equivalents).

-- Forward: trip status -> transport status. A scheduled staff trip is an
-- already-arranged pickup, so 'Scheduled' maps to 'Confirmed'.
CREATE OR REPLACE FUNCTION public.trip_status_to_transport(p_status text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p_status
    WHEN 'In Progress' THEN 'In Progress'
    WHEN 'Completed' THEN 'Completed'
    WHEN 'Cancelled' THEN 'Cancelled'
    ELSE 'Confirmed'  -- 'Scheduled'
  END;
$$;

-- Reverse: transport status -> transport_trips status.
CREATE OR REPLACE FUNCTION public.transport_status_to_trip(p_status text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p_status
    WHEN 'Guest Picked Up' THEN 'In Progress'
    WHEN 'In Progress' THEN 'In Progress'
    WHEN 'Completed' THEN 'Completed'
    WHEN 'Cancelled' THEN 'Cancelled'
    WHEN 'No Show' THEN 'Cancelled'
    ELSE 'Scheduled'  -- Requested, Confirmed, Assigned, Driver En Route
  END;
$$;

-- ── INSERT bridge ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.trg_bridge_staff_trip_to_request()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_name text;
BEGIN
  SELECT e.name INTO v_name FROM employees e WHERE e.id = NEW.employee_id;

  INSERT INTO transport_requests
    (property_id, request_number, guest_name, type, source,
     pickup_location, destination, scheduled_time, status,
     special_instructions, assigned_vehicle, driver_id, source_ref)
  VALUES
    (NEW.property_id,
     'TR-TP-' || to_char(now(), 'YYYYMMDD') || '-' ||
       lpad(floor(random() * 10000)::text, 4, '0'),
     COALESCE(v_name, 'Staff Member'), 'Staff Shuttle', 'Staff Portal',
     NEW.pickup, NEW.destination, NEW.scheduled_at,
     public.trip_status_to_transport(NEW.status),
     concat_ws(' | ',
       NULLIF('Trip type: ' || COALESCE(NEW.type, ''), 'Trip type: '),
       NULLIF('Shift: ' || COALESCE(NEW.shift, ''), 'Shift: ')),
     NEW.vehicle, NEW.driver_id,
     'tp:' || NEW.id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_staff_trip_bridge ON transport_trips;
CREATE TRIGGER trg_staff_trip_bridge
  AFTER INSERT ON transport_trips
  FOR EACH ROW EXECUTE FUNCTION public.trg_bridge_staff_trip_to_request();

-- ── transport_requests -> sources: extend sync-back for 'tp:' refs ───────────
CREATE OR REPLACE FUNCTION public.trg_transport_request_sync_source()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ref text := COALESCE(NEW.source_ref, OLD.source_ref);
BEGIN
  IF v_ref IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF TG_OP = 'DELETE' THEN
    IF v_ref LIKE 'asr:%' THEN
      UPDATE airport_shuttle_requests SET status = 'Cancelled'
       WHERE id = substring(v_ref from 5) AND status <> 'Cancelled';
    ELSIF v_ref LIKE 'at:%' THEN
      UPDATE transport_airport_transfers SET status = 'Cancelled'
       WHERE id = substring(v_ref from 4)::uuid AND status <> 'Cancelled';
    ELSIF v_ref LIKE 'gt:%' THEN
      UPDATE transport_guest_transports SET status = 'Cancelled'
       WHERE id = substring(v_ref from 4)::uuid AND status <> 'Cancelled';
    ELSIF v_ref LIKE 'ct:%' THEN
      UPDATE transport_corporate_trips SET status = 'Cancelled'
       WHERE id = substring(v_ref from 4)::uuid AND status <> 'Cancelled';
    ELSIF v_ref LIKE 'tp:%' THEN
      UPDATE transport_trips SET status = 'Cancelled'
       WHERE id = substring(v_ref from 4)::uuid AND status <> 'Cancelled';
    END IF;
    RETURN OLD;
  END IF;

  IF v_ref LIKE 'asr:%' THEN
    IF NEW.status IS DISTINCT FROM OLD.status THEN
      UPDATE airport_shuttle_requests
         SET status = public.transport_status_to_shuttle(NEW.status)
       WHERE id = substring(v_ref from 5);
    END IF;
  ELSIF v_ref LIKE 'at:%' THEN
    IF NEW.status IS DISTINCT FROM OLD.status
       OR NEW.assigned_vehicle IS DISTINCT FROM OLD.assigned_vehicle
       OR NEW.driver_id IS DISTINCT FROM OLD.driver_id THEN
      UPDATE transport_airport_transfers
         SET status = NEW.status,
             assigned_vehicle = NEW.assigned_vehicle,
             driver_id = NEW.driver_id
       WHERE id = substring(v_ref from 4)::uuid;
    END IF;
  ELSIF v_ref LIKE 'gt:%' THEN
    IF NEW.status IS DISTINCT FROM OLD.status
       OR NEW.assigned_vehicle IS DISTINCT FROM OLD.assigned_vehicle
       OR NEW.driver_id IS DISTINCT FROM OLD.driver_id THEN
      UPDATE transport_guest_transports
         SET status = public.transport_status_to_silo(NEW.status),
             assigned_vehicle = NEW.assigned_vehicle,
             driver_id = NEW.driver_id
       WHERE id = substring(v_ref from 4)::uuid;
    END IF;
  ELSIF v_ref LIKE 'ct:%' THEN
    IF NEW.status IS DISTINCT FROM OLD.status
       OR NEW.assigned_vehicle IS DISTINCT FROM OLD.assigned_vehicle
       OR NEW.driver_id IS DISTINCT FROM OLD.driver_id THEN
      UPDATE transport_corporate_trips
         SET status = public.transport_status_to_silo(NEW.status),
             assigned_vehicle = NEW.assigned_vehicle,
             driver_id = NEW.driver_id
       WHERE id = substring(v_ref from 4)::uuid;
    END IF;
  ELSIF v_ref LIKE 'tp:%' THEN
    IF NEW.status IS DISTINCT FROM OLD.status
       OR NEW.assigned_vehicle IS DISTINCT FROM OLD.assigned_vehicle
       OR NEW.driver_id IS DISTINCT FROM OLD.driver_id THEN
      UPDATE transport_trips
         SET status = public.transport_status_to_trip(NEW.status),
             vehicle = NEW.assigned_vehicle,
             driver_id = NEW.driver_id
       WHERE id = substring(v_ref from 4)::uuid;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_transport_request_sync_source ON transport_requests;
CREATE TRIGGER trg_transport_request_sync_source
  AFTER UPDATE OF status, assigned_vehicle, driver_id OR DELETE
  ON transport_requests
  FOR EACH ROW EXECUTE FUNCTION public.trg_transport_request_sync_source();

-- ── transport_trips -> transport_requests: UPDATE/DELETE reverse sync ────────
CREATE OR REPLACE FUNCTION public.trg_staff_trip_sync_request()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ref text := 'tp:' || COALESCE(NEW.id, OLD.id);
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM transport_requests WHERE source_ref = v_ref;
    RETURN OLD;
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status
     OR NEW.vehicle IS DISTINCT FROM OLD.vehicle
     OR NEW.driver_id IS DISTINCT FROM OLD.driver_id THEN
    UPDATE transport_requests
       SET status = public.trip_status_to_transport(NEW.status),
           assigned_vehicle = NEW.vehicle,
           driver_id = NEW.driver_id
     WHERE source_ref = v_ref;
  END IF;

  IF NEW.scheduled_at IS DISTINCT FROM OLD.scheduled_at THEN
    UPDATE transport_requests SET scheduled_time = NEW.scheduled_at
     WHERE source_ref = v_ref;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_staff_trip_sync_request ON transport_trips;
CREATE TRIGGER trg_staff_trip_sync_request
  AFTER UPDATE OR DELETE ON transport_trips
  FOR EACH ROW EXECUTE FUNCTION public.trg_staff_trip_sync_request();

-- ── Backfill existing staff trips without a bridged request ──────────────────
INSERT INTO transport_requests
  (property_id, request_number, guest_name, type, source,
   pickup_location, destination, scheduled_time, status,
   special_instructions, assigned_vehicle, driver_id, source_ref)
SELECT t.property_id,
       'TR-TP-' || substring(t.id::text from 1 for 8),
       COALESCE(e.name, 'Staff Member'), 'Staff Shuttle', 'Staff Portal',
       t.pickup, t.destination, t.scheduled_at,
       public.trip_status_to_transport(t.status),
       concat_ws(' | ',
         NULLIF('Trip type: ' || COALESCE(t.type, ''), 'Trip type: '),
         NULLIF('Shift: ' || COALESCE(t.shift, ''), 'Shift: ')),
       t.vehicle, t.driver_id,
       'tp:' || t.id
  FROM transport_trips t
  LEFT JOIN employees e ON e.id = t.employee_id
 WHERE NOT EXISTS (
   SELECT 1 FROM transport_requests r WHERE r.source_ref = 'tp:' || t.id::text);
