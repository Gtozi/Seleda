-- 530_schedule_items_bridge.sql
-- Bridge transport_schedule_items (Scheduling & Dispatch) <-> transport_requests.
-- Schedule items are dispatchable trips (driver, vehicle, passengers,
-- scheduled_time) that were invisible to the main dispatch queue.
--   source_ref = 'si:<id>'

-- Type map: free-text schedule types -> transport_requests.type
CREATE OR REPLACE FUNCTION public.schedule_type_to_transport(p_type text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p_type
    WHEN 'Airport Pickup' THEN 'Airport Pickup'
    WHEN 'City Transfer' THEN 'City Transfer'
    WHEN 'Staff Shuttle' THEN 'Staff Shuttle'
    WHEN 'VIP Transfer' THEN 'VIP Transport'
    WHEN 'Tour Transportation' THEN 'Sightseeing Tour'
    WHEN 'Conference Shuttle' THEN 'Hotel Shuttle'
    ELSE 'City Transfer'  -- Corporate Transfer, Shopping Trip, Other, etc.
  END;
$$;

-- Forward: schedule status -> transport status.
CREATE OR REPLACE FUNCTION public.schedule_status_to_transport(p_status text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p_status
    WHEN 'In Progress' THEN 'In Progress'
    WHEN 'Completed' THEN 'Completed'
    WHEN 'Cancelled' THEN 'Cancelled'
    WHEN 'Unassigned' THEN 'Requested'
    ELSE 'Confirmed'  -- 'Scheduled'
  END;
$$;

-- Reverse: transport status -> schedule status.
CREATE OR REPLACE FUNCTION public.transport_status_to_schedule(p_status text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p_status
    WHEN 'Requested' THEN 'Unassigned'
    WHEN 'Guest Picked Up' THEN 'In Progress'
    WHEN 'In Progress' THEN 'In Progress'
    WHEN 'Completed' THEN 'Completed'
    WHEN 'Cancelled' THEN 'Cancelled'
    WHEN 'No Show' THEN 'Cancelled'
    ELSE 'Scheduled'  -- Confirmed, Assigned, Driver En Route
  END;
$$;

-- Split a free-text route like "Hotel to JFK Airport" / "A → B" into
-- pickup + destination for the request row.
CREATE OR REPLACE FUNCTION public.schedule_route_pickup(p_route text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT COALESCE(
           CASE
             WHEN position('→' in p_route) > 0 THEN NULLIF(btrim(split_part(p_route, '→', 1)), '')
             WHEN position('↔' in p_route) > 0 THEN NULLIF(btrim(split_part(p_route, '↔', 1)), '')
             WHEN position(' to ' in p_route) > 0 THEN NULLIF(btrim(split_part(p_route, ' to ', 1)), '')
             ELSE NULLIF(btrim(p_route), '')
           END,
           'Scheduled Route');
$$;

CREATE OR REPLACE FUNCTION public.schedule_route_destination(p_route text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT COALESCE(
           CASE
             WHEN position('→' in p_route) > 0 THEN NULLIF(btrim(split_part(p_route, '→', 2)), '')
             WHEN position('↔' in p_route) > 0 THEN NULLIF(btrim(split_part(p_route, '↔', 2)), '')
             WHEN position(' to ' in p_route) > 0 THEN NULLIF(btrim(split_part(p_route, ' to ', 2)), '')
             ELSE NULLIF(btrim(p_route), '')
           END,
           'Destination TBD');
$$;

-- ── INSERT bridge ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.trg_bridge_schedule_item_to_request()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO transport_requests
    (property_id, request_number, guest_name, type, source,
     pickup_location, destination, scheduled_time, passenger_count, status,
     assigned_vehicle, driver_id, estimated_duration, source_ref)
  VALUES
    (NEW.property_id, 'TR-' || NEW.schedule_number,
     'Scheduled Trip', public.schedule_type_to_transport(NEW.type),
     'Front Office',
     public.schedule_route_pickup(NEW.route),
     public.schedule_route_destination(NEW.route),
     NEW.scheduled_time,
     GREATEST(1, COALESCE(NEW.passenger_count, 1)),
     public.schedule_status_to_transport(NEW.status),
     NEW.assigned_vehicle, NEW.driver_id,
     COALESCE(NEW.duration_minutes::text || ' min', NULL),
     'si:' || NEW.id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_schedule_item_bridge ON transport_schedule_items;
CREATE TRIGGER trg_schedule_item_bridge
  AFTER INSERT ON transport_schedule_items
  FOR EACH ROW EXECUTE FUNCTION public.trg_bridge_schedule_item_to_request();

-- ── transport_requests -> sources: extend sync-back for 'si:' refs ───────────
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
    ELSIF v_ref LIKE 'si:%' THEN
      UPDATE transport_schedule_items SET status = 'Cancelled'
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
  ELSIF v_ref LIKE 'si:%' THEN
    IF NEW.status IS DISTINCT FROM OLD.status
       OR NEW.assigned_vehicle IS DISTINCT FROM OLD.assigned_vehicle
       OR NEW.driver_id IS DISTINCT FROM OLD.driver_id THEN
      UPDATE transport_schedule_items
         SET status = public.transport_status_to_schedule(NEW.status),
             assigned_vehicle = NEW.assigned_vehicle,
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

-- ── schedule_items -> transport_requests: UPDATE/DELETE reverse sync ─────────
CREATE OR REPLACE FUNCTION public.trg_schedule_item_sync_request()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ref text := 'si:' || COALESCE(NEW.id, OLD.id);
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM transport_requests WHERE source_ref = v_ref;
    RETURN OLD;
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status
     OR NEW.assigned_vehicle IS DISTINCT FROM OLD.assigned_vehicle
     OR NEW.driver_id IS DISTINCT FROM OLD.driver_id THEN
    UPDATE transport_requests
       SET status = public.schedule_status_to_transport(NEW.status),
           assigned_vehicle = NEW.assigned_vehicle,
           driver_id = NEW.driver_id
     WHERE source_ref = v_ref;
  END IF;

  IF NEW.scheduled_time IS DISTINCT FROM OLD.scheduled_time THEN
    UPDATE transport_requests SET scheduled_time = NEW.scheduled_time
     WHERE source_ref = v_ref;
  END IF;

  IF NEW.passenger_count IS DISTINCT FROM OLD.passenger_count THEN
    UPDATE transport_requests
       SET passenger_count = GREATEST(1, COALESCE(NEW.passenger_count, 1))
     WHERE source_ref = v_ref;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_schedule_item_sync_request ON transport_schedule_items;
CREATE TRIGGER trg_schedule_item_sync_request
  AFTER UPDATE OR DELETE ON transport_schedule_items
  FOR EACH ROW EXECUTE FUNCTION public.trg_schedule_item_sync_request();

-- ── Backfill ─────────────────────────────────────────────────────────────────
INSERT INTO transport_requests
  (property_id, request_number, guest_name, type, source,
   pickup_location, destination, scheduled_time, passenger_count, status,
   assigned_vehicle, driver_id, estimated_duration, source_ref)
SELECT t.property_id, 'TR-' || t.schedule_number,
       'Scheduled Trip', public.schedule_type_to_transport(t.type),
       'Front Office',
       public.schedule_route_pickup(t.route),
       public.schedule_route_destination(t.route),
       t.scheduled_time,
       GREATEST(1, COALESCE(t.passenger_count, 1)),
       public.schedule_status_to_transport(t.status),
       t.assigned_vehicle, t.driver_id,
       t.duration_minutes::text || ' min',
       'si:' || t.id
  FROM transport_schedule_items t
 WHERE NOT EXISTS (
   SELECT 1 FROM transport_requests r WHERE r.source_ref = 'si:' || t.id::text);
