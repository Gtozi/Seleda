-- Transportation Incidents
-- Real incident log for driver/vehicle safety events (spec §15 "Incident
-- History", §26 Security integration, §30 "Vehicle Incident Rate").
-- Keeps transport_drivers.incidents (a counter column) in sync via trigger.

-- ============================================================================
-- transport_incidents
-- ============================================================================
CREATE TABLE IF NOT EXISTS transport_incidents (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id      UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  incident_number  TEXT NOT NULL,
  driver_id        UUID REFERENCES transport_drivers(id) ON DELETE SET NULL,
  vehicle_id       UUID REFERENCES transport_vehicles(id) ON DELETE SET NULL,
  trip_id          UUID REFERENCES transport_requests(id) ON DELETE SET NULL,
  occurred_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  type             TEXT NOT NULL DEFAULT 'Other'
                     CHECK (type IN ('Accident', 'Traffic Violation', 'Speeding', 'Breakdown', 'Passenger Complaint', 'Vehicle Damage', 'Other')),
  severity         TEXT NOT NULL DEFAULT 'Minor'
                     CHECK (severity IN ('Minor', 'Moderate', 'Major', 'Critical')),
  location         TEXT,
  description      TEXT,
  status           TEXT NOT NULL DEFAULT 'Reported'
                     CHECK (status IN ('Reported', 'Under Review', 'Resolved', 'Closed')),
  reported_by      TEXT,
  resolution_notes TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (property_id, incident_number)
);

CREATE INDEX IF NOT EXISTS idx_transport_incidents_property ON transport_incidents(property_id);
CREATE INDEX IF NOT EXISTS idx_transport_incidents_driver   ON transport_incidents(driver_id);
CREATE INDEX IF NOT EXISTS idx_transport_incidents_vehicle  ON transport_incidents(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_transport_incidents_status   ON transport_incidents(property_id, status);
CREATE INDEX IF NOT EXISTS idx_transport_incidents_occurred ON transport_incidents(property_id, occurred_at DESC);

-- ============================================================================
-- Keep transport_drivers.incidents = count of non-closed-out incident rows.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.trg_transport_incidents_sync_count()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.driver_id IS NOT NULL THEN
      UPDATE transport_drivers
      SET incidents = (SELECT COUNT(*) FROM transport_incidents WHERE driver_id = OLD.driver_id),
          updated_at = NOW()
      WHERE id = OLD.driver_id;
    END IF;
    RETURN OLD;
  END IF;

  IF NEW.driver_id IS NOT NULL THEN
    UPDATE transport_drivers
    SET incidents = (SELECT COUNT(*) FROM transport_incidents WHERE driver_id = NEW.driver_id),
        updated_at = NOW()
    WHERE id = NEW.driver_id;
  END IF;
  -- Reassignment: also refresh the previous driver's count.
  IF TG_OP = 'UPDATE' AND OLD.driver_id IS DISTINCT FROM NEW.driver_id AND OLD.driver_id IS NOT NULL THEN
    UPDATE transport_drivers
    SET incidents = (SELECT COUNT(*) FROM transport_incidents WHERE driver_id = OLD.driver_id),
        updated_at = NOW()
    WHERE id = OLD.driver_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS transport_incidents_sync_count ON transport_incidents;
CREATE TRIGGER transport_incidents_sync_count
  AFTER INSERT OR UPDATE OR DELETE ON transport_incidents
  FOR EACH ROW EXECUTE FUNCTION public.trg_transport_incidents_sync_count();

DROP TRIGGER IF EXISTS transport_incidents_updated_at ON transport_incidents;
CREATE TRIGGER transport_incidents_updated_at
  BEFORE UPDATE ON transport_incidents
  FOR EACH ROW EXECUTE FUNCTION hr_recruit_set_updated_at();

-- ============================================================================
-- Grants & RLS (same pattern as other transport tables)
-- ============================================================================
GRANT SELECT, INSERT, UPDATE, DELETE ON transport_incidents TO authenticated;

ALTER TABLE transport_incidents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS transport_incidents_read ON transport_incidents;
CREATE POLICY transport_incidents_read ON transport_incidents
  FOR SELECT TO authenticated USING (TRUE);

DROP POLICY IF EXISTS transport_incidents_write ON transport_incidents;
CREATE POLICY transport_incidents_write ON transport_incidents
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON ur.role_id = r.id WHERE ur.user_id = auth.uid()::text AND r.name = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON ur.role_id = r.id WHERE ur.user_id = auth.uid()::text AND r.name = 'admin'));
