-- 528_request_delete_cascades_to_silos.sql
-- When a bridged transport_requests row is deleted, mark the source silo row
-- Cancelled instead of leaving it orphaned at its last status. The silo row
-- is kept (not deleted) so flight details, contract links and history survive.
--
-- Loop safety: the silo status update fires the silo->request reverse
-- trigger, which updates transport_requests WHERE source_ref = ... — that row
-- is already gone, so it's a no-op.

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

  -- Deleting a bridged request cancels the source record.
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
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_transport_request_sync_source ON transport_requests;
CREATE TRIGGER trg_transport_request_sync_source
  AFTER UPDATE OF status, assigned_vehicle, driver_id OR DELETE
  ON transport_requests
  FOR EACH ROW EXECUTE FUNCTION public.trg_transport_request_sync_source();
