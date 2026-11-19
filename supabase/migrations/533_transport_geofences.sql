-- Transportation Geofences
-- Radius-based geofences around key locations (airport, hotel, depots) plus a
-- geofence_events log populated by the GPS ingest path (spec §18 "Geofencing").

-- ============================================================================
-- transport_geofences
-- ============================================================================
CREATE TABLE IF NOT EXISTS transport_geofences (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id      UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  name             TEXT NOT NULL,
  center_latitude  NUMERIC(10,6) NOT NULL,
  center_longitude NUMERIC(10,6) NOT NULL,
  radius_km        NUMERIC(8,3) NOT NULL DEFAULT 1 CHECK (radius_km > 0),
  alert_on_enter   BOOLEAN NOT NULL DEFAULT TRUE,
  alert_on_exit    BOOLEAN NOT NULL DEFAULT FALSE,
  active           BOOLEAN NOT NULL DEFAULT TRUE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (property_id, name)
);

CREATE INDEX IF NOT EXISTS idx_transport_geofences_property ON transport_geofences(property_id);

-- ============================================================================
-- transport_geofence_events — append-only enter/exit log
-- ============================================================================
CREATE TABLE IF NOT EXISTS transport_geofence_events (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  geofence_id UUID REFERENCES transport_geofences(id) ON DELETE SET NULL,
  geofence_name TEXT,
  vehicle_id  UUID REFERENCES transport_vehicles(id) ON DELETE CASCADE,
  trip_id     UUID REFERENCES transport_requests(id) ON DELETE SET NULL,
  event_type  TEXT NOT NULL CHECK (event_type IN ('enter', 'exit')),
  latitude    NUMERIC(10,6),
  longitude   NUMERIC(10,6),
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_geofence_events_property ON transport_geofence_events(property_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_geofence_events_vehicle  ON transport_geofence_events(vehicle_id, occurred_at DESC);

-- Per-vehicle "currently inside" state so ingest can detect transitions.
CREATE TABLE IF NOT EXISTS transport_geofence_state (
  vehicle_id  UUID PRIMARY KEY REFERENCES transport_vehicles(id) ON DELETE CASCADE,
  inside      UUID[] NOT NULL DEFAULT '{}',   -- geofence ids the vehicle is inside
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS transport_geofences_updated_at ON transport_geofences;
CREATE TRIGGER transport_geofences_updated_at
  BEFORE UPDATE ON transport_geofences
  FOR EACH ROW EXECUTE FUNCTION hr_recruit_set_updated_at();

-- ============================================================================
-- Grants & RLS
-- ============================================================================
GRANT SELECT, INSERT, UPDATE, DELETE ON transport_geofences TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON transport_geofence_events TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON transport_geofence_state TO authenticated;

ALTER TABLE transport_geofences ENABLE ROW LEVEL SECURITY;
ALTER TABLE transport_geofence_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE transport_geofence_state ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS transport_geofences_read ON transport_geofences;
CREATE POLICY transport_geofences_read ON transport_geofences
  FOR SELECT TO authenticated USING (TRUE);

DROP POLICY IF EXISTS transport_geofences_write ON transport_geofences;
CREATE POLICY transport_geofences_write ON transport_geofences
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON ur.role_id = r.id WHERE ur.user_id = auth.uid()::text AND r.name = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON ur.role_id = r.id WHERE ur.user_id = auth.uid()::text AND r.name = 'admin'));

DROP POLICY IF EXISTS transport_geofence_events_read ON transport_geofence_events;
CREATE POLICY transport_geofence_events_read ON transport_geofence_events
  FOR SELECT TO authenticated USING (TRUE);

DROP POLICY IF EXISTS transport_geofence_events_write ON transport_geofence_events;
CREATE POLICY transport_geofence_events_write ON transport_geofence_events
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON ur.role_id = r.id WHERE ur.user_id = auth.uid()::text AND r.name = 'admin'));

DROP POLICY IF EXISTS transport_geofence_state_all ON transport_geofence_state;
CREATE POLICY transport_geofence_state_all ON transport_geofence_state
  FOR ALL TO authenticated USING (TRUE) WITH CHECK (TRUE);
