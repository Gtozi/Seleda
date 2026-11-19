-- 531: Driver assignment notifications
-- When a transport_requests row gains (or changes) a driver, insert an in-app
-- notification for the property's Transportation feed. A trigger covers every
-- assignment path uniformly: requests API POST/PUT, bridged silo syncs
-- (asr:/at:/gt:/ct:/tp:/si:), driver self-service, and direct table writes.

CREATE OR REPLACE FUNCTION public.trg_transport_request_notify_driver()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_driver_name TEXT;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.driver_id IS NOT DISTINCT FROM OLD.driver_id THEN
    RETURN NEW;
  END IF;
  IF NEW.driver_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT e.name INTO v_driver_name
  FROM transport_drivers d
  JOIN employees e ON e.id = d.employee_id
  WHERE d.id = NEW.driver_id;

  INSERT INTO notifications (id, property_id, message, type, department, read, created_at)
  VALUES (
    gen_random_uuid()::text,
    NEW.property_id,
    format(
      'Trip %s assigned to %s — %s → %s at %s',
      NEW.request_number,
      coalesce(v_driver_name, 'a driver'),
      coalesce(NEW.pickup_location, '?'),
      coalesce(NEW.destination, '?'),
      to_char(NEW.scheduled_time, 'YYYY-MM-DD HH24:MI')
    ),
    'info',
    'Transportation',
    false,
    now()
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS transport_requests_notify_driver ON transport_requests;
CREATE TRIGGER transport_requests_notify_driver
  AFTER INSERT OR UPDATE OF driver_id ON transport_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_transport_request_notify_driver();
