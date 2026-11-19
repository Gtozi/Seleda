-- 527_guest_corporate_trips_bridge.sql
-- Extend the transport_requests bridge to the two remaining trip silos:
--   transport_guest_transports  (source_ref 'gt:<id>')
--   transport_corporate_trips   (source_ref 'ct:<id>')
-- Same pattern as 523/525/526: INSERT bridge, bidirectional status /
-- vehicle / driver sync with IS DISTINCT guards, DELETE cascade, backfill.

-- ── Type + status mapping helpers ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.guest_transport_type_to_transport(p_type text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p_type
    WHEN 'Tour Transportation' THEN 'Sightseeing Tour'
    WHEN 'Special Assistance' THEN 'VIP Transport'
    ELSE 'City Transfer'  -- Local Transfer, Restaurant Transfer, Medical Transportation
  END;
$$;

CREATE OR REPLACE FUNCTION public.corporate_trip_type_to_transport(p_type text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN p_type ILIKE '%drop%' OR p_type ILIKE '%departure%' THEN 'Airport Drop-off'
    WHEN p_type ILIKE '%airport%' OR p_type ILIKE '%arrival%' THEN 'Airport Pickup'
    WHEN p_type ILIKE '%vip%' OR p_type ILIKE '%executive%' THEN 'VIP Transport'
    WHEN p_type ILIKE '%tour%' OR p_type ILIKE '%sightsee%' THEN 'Sightseeing Tour'
    ELSE 'City Transfer'
  END;
$$;

-- Narrower source vocabularies -> transport status (forward).
CREATE OR REPLACE FUNCTION public.silo_status_to_transport(p_status text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p_status
    WHEN 'Confirmed' THEN 'Confirmed'
    WHEN 'Assigned' THEN 'Assigned'
    WHEN 'In Progress' THEN 'In Progress'
    WHEN 'Completed' THEN 'Completed'
    WHEN 'Cancelled' THEN 'Cancelled'
    ELSE 'Requested'  -- 'Pending', 'Requested', anything else
  END;
$$;

-- transport status -> narrow silo vocabulary (reverse). Both silos allow
-- ('Requested','Confirmed','In Progress','Completed','Cancelled'); guest
-- transports also allow 'Pending' (unused here).
CREATE OR REPLACE FUNCTION public.transport_status_to_silo(p_status text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p_status
    WHEN 'Confirmed' THEN 'Confirmed'
    WHEN 'Assigned' THEN 'Confirmed'
    WHEN 'Driver En Route' THEN 'Confirmed'
    WHEN 'Guest Picked Up' THEN 'In Progress'
    WHEN 'In Progress' THEN 'In Progress'
    WHEN 'Completed' THEN 'Completed'
    WHEN 'Cancelled' THEN 'Cancelled'
    WHEN 'No Show' THEN 'Cancelled'
    ELSE 'Requested'
  END;
$$;

-- ── INSERT bridges ───────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.trg_bridge_guest_transport_to_request()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO transport_requests
    (property_id, request_number, guest_id, guest_name, room, type, source,
     pickup_location, destination, scheduled_time, passenger_count, status,
     special_instructions, assigned_vehicle, driver_id, amount,
     payment_method, estimated_duration, source_ref)
  VALUES
    (NEW.property_id, 'TR-' || NEW.transport_number, NEW.guest_id, NEW.guest_name,
     NEW.room, public.guest_transport_type_to_transport(NEW.type), 'Front Office',
     NEW.pickup, NEW.destination, NEW.scheduled_time,
     GREATEST(1, COALESCE(NEW.passenger_count, 1)),
     public.silo_status_to_transport(NEW.status),
     NEW.special_requests, NEW.assigned_vehicle, NEW.driver_id,
     COALESCE(NEW.amount, 0), 'Guest Folio', NEW.estimated_duration,
     'gt:' || NEW.id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guest_transport_bridge ON transport_guest_transports;
CREATE TRIGGER trg_guest_transport_bridge
  AFTER INSERT ON transport_guest_transports
  FOR EACH ROW EXECUTE FUNCTION public.trg_bridge_guest_transport_to_request();

CREATE OR REPLACE FUNCTION public.trg_bridge_corporate_trip_to_request()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO transport_requests
    (property_id, request_number, guest_name, type, source,
     pickup_location, destination, scheduled_time, passenger_count, status,
     special_instructions, assigned_vehicle, driver_id, amount,
     payment_method, source_ref)
  VALUES
    (NEW.property_id, 'TR-' || NEW.trip_number, NEW.guest_name,
     public.corporate_trip_type_to_transport(NEW.type), 'Corporate Account',
     NEW.pickup, NEW.destination, NEW.scheduled_time,
     GREATEST(1, COALESCE(NEW.passenger_count, 1)),
     public.silo_status_to_transport(NEW.status),
       NULLIF('Company: ' || COALESCE(NEW.company, ''), 'Company: '),
     NEW.assigned_vehicle, NEW.driver_id,
     COALESCE(NEW.amount, 0),
     CASE WHEN COALESCE(NEW.billed_to, '') ILIKE '%guest%'
             OR COALESCE(NEW.billed_to, '') ILIKE '%folio%'
          THEN 'Guest Folio' ELSE 'Corporate Billing' END,
     'ct:' || NEW.id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_corporate_trip_bridge ON transport_corporate_trips;
CREATE TRIGGER trg_corporate_trip_bridge
  AFTER INSERT ON transport_corporate_trips
  FOR EACH ROW EXECUTE FUNCTION public.trg_bridge_corporate_trip_to_request();

-- ── transport_requests -> sources: extend sync-back for gt:/ct: refs ─────────
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
  ELSIF NEW.source_ref LIKE 'gt:%' THEN
    IF NEW.status IS DISTINCT FROM OLD.status
       OR NEW.assigned_vehicle IS DISTINCT FROM OLD.assigned_vehicle
       OR NEW.driver_id IS DISTINCT FROM OLD.driver_id THEN
      UPDATE transport_guest_transports
         SET status = public.transport_status_to_silo(NEW.status),
             assigned_vehicle = NEW.assigned_vehicle,
             driver_id = NEW.driver_id
       WHERE id = substring(NEW.source_ref from 4)::uuid;
    END IF;
  ELSIF NEW.source_ref LIKE 'ct:%' THEN
    IF NEW.status IS DISTINCT FROM OLD.status
       OR NEW.assigned_vehicle IS DISTINCT FROM OLD.assigned_vehicle
       OR NEW.driver_id IS DISTINCT FROM OLD.driver_id THEN
      UPDATE transport_corporate_trips
         SET status = public.transport_status_to_silo(NEW.status),
             assigned_vehicle = NEW.assigned_vehicle,
             driver_id = NEW.driver_id
       WHERE id = substring(NEW.source_ref from 4)::uuid;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_transport_request_sync_source ON transport_requests;
CREATE TRIGGER trg_transport_request_sync_source
  AFTER UPDATE OF status, assigned_vehicle, driver_id ON transport_requests
  FOR EACH ROW EXECUTE FUNCTION public.trg_transport_request_sync_source();

-- ── Silos -> transport_requests: UPDATE/DELETE reverse sync ──────────────────
CREATE OR REPLACE FUNCTION public.trg_guest_transport_sync_request()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ref text := 'gt:' || COALESCE(NEW.id, OLD.id);
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM transport_requests WHERE source_ref = v_ref;
    RETURN OLD;
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status
     OR NEW.assigned_vehicle IS DISTINCT FROM OLD.assigned_vehicle
     OR NEW.driver_id IS DISTINCT FROM OLD.driver_id THEN
    UPDATE transport_requests
       SET status = public.silo_status_to_transport(NEW.status),
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

DROP TRIGGER IF EXISTS trg_guest_transport_sync_request ON transport_guest_transports;
CREATE TRIGGER trg_guest_transport_sync_request
  AFTER UPDATE OR DELETE ON transport_guest_transports
  FOR EACH ROW EXECUTE FUNCTION public.trg_guest_transport_sync_request();

CREATE OR REPLACE FUNCTION public.trg_corporate_trip_sync_request()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ref text := 'ct:' || COALESCE(NEW.id, OLD.id);
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM transport_requests WHERE source_ref = v_ref;
    RETURN OLD;
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status
     OR NEW.assigned_vehicle IS DISTINCT FROM OLD.assigned_vehicle
     OR NEW.driver_id IS DISTINCT FROM OLD.driver_id THEN
    UPDATE transport_requests
       SET status = public.silo_status_to_transport(NEW.status),
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

DROP TRIGGER IF EXISTS trg_corporate_trip_sync_request ON transport_corporate_trips;
CREATE TRIGGER trg_corporate_trip_sync_request
  AFTER UPDATE OR DELETE ON transport_corporate_trips
  FOR EACH ROW EXECUTE FUNCTION public.trg_corporate_trip_sync_request();

-- ── Backfill existing rows that lack a bridged request ───────────────────────
INSERT INTO transport_requests
  (property_id, request_number, guest_id, guest_name, room, type, source,
   pickup_location, destination, scheduled_time, passenger_count, status,
   special_instructions, assigned_vehicle, driver_id, amount,
   payment_method, estimated_duration, source_ref)
SELECT t.property_id, 'TR-' || t.transport_number, t.guest_id, t.guest_name,
       t.room, public.guest_transport_type_to_transport(t.type), 'Front Office',
       t.pickup, t.destination, t.scheduled_time,
       GREATEST(1, COALESCE(t.passenger_count, 1)),
       public.silo_status_to_transport(t.status),
       t.special_requests, t.assigned_vehicle, t.driver_id,
       COALESCE(t.amount, 0), 'Guest Folio', t.estimated_duration,
       'gt:' || t.id
  FROM transport_guest_transports t
 WHERE NOT EXISTS (
   SELECT 1 FROM transport_requests r WHERE r.source_ref = 'gt:' || t.id::text);

INSERT INTO transport_requests
  (property_id, request_number, guest_name, type, source,
   pickup_location, destination, scheduled_time, passenger_count, status,
   special_instructions, assigned_vehicle, driver_id, amount,
   payment_method, source_ref)
SELECT t.property_id, 'TR-' || t.trip_number, t.guest_name,
       public.corporate_trip_type_to_transport(t.type), 'Corporate Account',
       t.pickup, t.destination, t.scheduled_time,
       GREATEST(1, COALESCE(t.passenger_count, 1)),
       public.silo_status_to_transport(t.status),
       NULLIF('Company: ' || COALESCE(t.company, ''), 'Company: '),
       t.assigned_vehicle, t.driver_id,
       COALESCE(t.amount, 0),
       CASE WHEN COALESCE(t.billed_to, '') ILIKE '%guest%'
               OR COALESCE(t.billed_to, '') ILIKE '%folio%'
            THEN 'Guest Folio' ELSE 'Corporate Billing' END,
       'ct:' || t.id
  FROM transport_corporate_trips t
 WHERE NOT EXISTS (
   SELECT 1 FROM transport_requests r WHERE r.source_ref = 'ct:' || t.id::text);
