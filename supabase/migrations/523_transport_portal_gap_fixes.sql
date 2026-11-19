-- 523_transport_portal_gap_fixes.sql
-- Transportation portal gap fixes:
--   1. Register transport:read / transport:write permissions + a
--      'transportation' role and grant both (writes were previously
--      admin-only because the permission code was never seeded).
--   2. notifications.property_id column (hrNotifications already inserts it).
--   3. Bridge legacy airport_shuttle_requests rows into transport_requests so
--      concierge / public-booking / front-office requests reach dispatch, and
--      sync trip status back to the legacy row.
--   4. transport_vehicle_positions — GPS position history for trip replay.
--   5. Tighten transport_* RLS read policies from USING (TRUE) to
--      staff-scoped access and switch write policies to permission-based.

-- ============================================================================
-- 1. Permissions & role
-- ============================================================================
INSERT INTO permissions (id, code, module, description)
VALUES
  ('perm_transport_read',  'transport:read',  'transportation',
   'View transportation portal data (requests, fleet, drivers, reports)'),
  ('perm_transport_write', 'transport:write', 'transportation',
   'Create/update transport requests, dispatch, fleet, drivers, fuel, billing')
ON CONFLICT (id) DO NOTHING;

INSERT INTO permissions (id, code, module, description)
SELECT 'perm_transport_read', 'transport:read', 'transportation',
       'View transportation portal data'
WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE code = 'transport:read');

INSERT INTO permissions (id, code, module, description)
SELECT 'perm_transport_write', 'transport:write', 'transportation',
       'Create/update transport requests, dispatch, fleet, drivers, fuel, billing'
WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE code = 'transport:write');

INSERT INTO roles (id, name, description, is_system, is_superuser)
VALUES ('role_transportation', 'transportation', 'Transportation department role', true, false)
ON CONFLICT (id) DO UPDATE SET
  name = excluded.name,
  description = excluded.description,
  is_system = excluded.is_system;

INSERT INTO role_permissions (role_id, permission_id)
SELECT 'role_transportation', p.id FROM permissions p
WHERE p.code IN ('transport:read', 'transport:write', 'reports:view')
ON CONFLICT DO NOTHING;

-- admin role keeps implicit access
INSERT INTO role_permissions (role_id, permission_id)
SELECT 'role_admin', p.id FROM permissions p
WHERE p.code IN ('transport:read', 'transport:write')
  AND EXISTS (SELECT 1 FROM roles WHERE id = 'role_admin')
ON CONFLICT DO NOTHING;

-- Link transportation department system users to the role
INSERT INTO user_roles (user_id, role_id)
SELECT su.id, 'role_transportation'
FROM system_users su
WHERE (su.role = 'transportation' OR su.department = 'Transportation')
  AND NOT EXISTS (
    SELECT 1 FROM user_roles ur
    WHERE ur.user_id = su.id AND ur.role_id = 'role_transportation'
  );

-- ============================================================================
-- 2. notifications.property_id (used by hr/transport notification helpers)
-- ============================================================================
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'notifications') THEN
    ALTER TABLE notifications ADD COLUMN IF NOT EXISTS property_id UUID REFERENCES properties(id) ON DELETE SET NULL;
    CREATE INDEX IF NOT EXISTS idx_notifications_property ON notifications(property_id);
  END IF;
END $$;

-- ============================================================================
-- 3. Legacy shuttle bridge
-- ============================================================================
-- The concierge shuttle form posts fields the legacy table never had.
ALTER TABLE airport_shuttle_requests ADD COLUMN IF NOT EXISTS guest_name TEXT;
ALTER TABLE airport_shuttle_requests ADD COLUMN IF NOT EXISTS pickup_location TEXT;
ALTER TABLE airport_shuttle_requests ADD COLUMN IF NOT EXISTS dropoff_location TEXT;
ALTER TABLE airport_shuttle_requests ADD COLUMN IF NOT EXISTS scheduled_at TIMESTAMPTZ;

-- transport_requests.source_ref marks rows bridged from another channel so the
-- sync-back trigger can find (and only touch) them.
ALTER TABLE transport_requests ADD COLUMN IF NOT EXISTS source_ref TEXT;
CREATE INDEX IF NOT EXISTS idx_transport_requests_source_ref
  ON transport_requests(source_ref) WHERE source_ref IS NOT NULL;

-- airport_shuttle_requests.status is narrower than transport_requests.status.
CREATE OR REPLACE FUNCTION public.transport_status_to_shuttle(p_status text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p_status
    WHEN 'Confirmed' THEN 'Confirmed'
    WHEN 'Assigned' THEN 'Confirmed'
    WHEN 'Driver En Route' THEN 'Confirmed'
    WHEN 'Guest Picked Up' THEN 'Confirmed'
    WHEN 'In Progress' THEN 'Confirmed'
    WHEN 'Completed' THEN 'Completed'
    WHEN 'Cancelled' THEN 'Cancelled'
    WHEN 'No Show' THEN 'Cancelled'
    ELSE 'Pending'
  END;
$$;

CREATE OR REPLACE FUNCTION public.trg_bridge_airport_shuttle_to_transport()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_property   uuid;
  v_guest_name text;
  v_room       text;
  v_type       text;
  v_source     text;
  v_status     text;
  v_when       timestamptz;
  v_num        text;
  v_notes      text;
BEGIN
  -- Resolve property: the reservation's property, else the first property.
  IF NEW.reservation_id IS NOT NULL THEN
    SELECT r.property_id INTO v_property FROM reservations r WHERE r.id = NEW.reservation_id;
  END IF;
  IF v_property IS NULL THEN
    SELECT p.id INTO v_property FROM properties p ORDER BY p.created_at LIMIT 1;
  END IF;
  IF v_property IS NULL THEN
    RETURN NEW; -- nowhere to bridge to
  END IF;

  v_guest_name := NEW.guest_name;
  v_room := NEW.room_number;
  IF v_guest_name IS NULL AND NEW.guest_id IS NOT NULL THEN
    SELECT g.name INTO v_guest_name FROM guests g WHERE g.id = NEW.guest_id;
  END IF;
  IF (v_guest_name IS NULL OR v_room IS NULL) AND NEW.reservation_id IS NOT NULL THEN
    SELECT COALESCE(v_guest_name, r.guest_name), COALESCE(v_room, r.room_number)
      INTO v_guest_name, v_room
      FROM reservations r WHERE r.id = NEW.reservation_id;
  END IF;
  v_guest_name := COALESCE(v_guest_name, 'Guest');

  v_type := CASE WHEN COALESCE(NEW.shuttle_type, '') ILIKE '%drop%'
                 THEN 'Airport Drop-off' ELSE 'Airport Pickup' END;
  v_source := CASE WHEN NEW.reservation_id IS NOT NULL
                   THEN 'Reservation System' ELSE 'Concierge' END;
  v_status := CASE NEW.status
    WHEN 'Confirmed' THEN 'Confirmed'
    WHEN 'Completed' THEN 'Completed'
    WHEN 'Cancelled' THEN 'Cancelled'
    ELSE 'Requested'
  END;
  v_when := COALESCE(
    NEW.scheduled_at,
    (NEW.scheduled_date + COALESCE(NEW.scheduled_time, '00:00'::time))::timestamptz,
    NOW()
  );
  v_notes := concat_ws(' | ',
    NULLIF('Flight ' || COALESCE(NEW.flight_number, ''), 'Flight '),
    NULLIF(NEW.notes, ''));

  v_num := 'TR-' || to_char(now(), 'YYYYMMDD') || '-' || lpad(floor(random() * 10000)::text, 4, '0');

  INSERT INTO transport_requests
    (property_id, request_number, guest_id, guest_name, room, type, source,
     pickup_location, destination, scheduled_time, passenger_count, status,
     special_instructions, source_ref)
  VALUES
    (v_property, v_num, NEW.guest_id, v_guest_name, v_room, v_type, v_source,
     COALESCE(NEW.pickup_location,
              CASE WHEN v_type = 'Airport Pickup' THEN 'Airport' ELSE 'Hotel' END),
     COALESCE(NEW.dropoff_location,
              CASE WHEN v_type = 'Airport Pickup' THEN 'Hotel' ELSE 'Airport' END),
     v_when,
     GREATEST(1, COALESCE(NEW.quantity, 1)),
     v_status, v_notes, 'asr:' || NEW.id);

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_airport_shuttle_bridge ON airport_shuttle_requests;
CREATE TRIGGER trg_airport_shuttle_bridge
  AFTER INSERT ON airport_shuttle_requests
  FOR EACH ROW EXECUTE FUNCTION public.trg_bridge_airport_shuttle_to_transport();

-- Propagate transport-side status changes back to the legacy row so the
-- front-office/concierge views stay in sync.
CREATE OR REPLACE FUNCTION public.trg_transport_request_sync_source()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.source_ref IS NOT NULL
     AND NEW.source_ref LIKE 'asr:%'
     AND NEW.status IS DISTINCT FROM OLD.status THEN
    UPDATE airport_shuttle_requests
       SET status = public.transport_status_to_shuttle(NEW.status)
     WHERE id = substring(NEW.source_ref from 5);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_transport_request_sync_source ON transport_requests;
CREATE TRIGGER trg_transport_request_sync_source
  AFTER UPDATE OF status ON transport_requests
  FOR EACH ROW EXECUTE FUNCTION public.trg_transport_request_sync_source();

-- ============================================================================
-- 4. GPS position history (trip replay)
-- ============================================================================
CREATE TABLE IF NOT EXISTS transport_vehicle_telemetry_history (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id    UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  vehicle_id     UUID NOT NULL REFERENCES transport_vehicles(id) ON DELETE CASCADE,
  trip_id        UUID REFERENCES transport_requests(id) ON DELETE SET NULL,
  latitude       NUMERIC(10,7),
  longitude      NUMERIC(10,7),
  speed_kmh      NUMERIC(8,2),
  heading        NUMERIC(5,1),
  status         TEXT,
  location_label TEXT,
  recorded_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_transport_telemetry_history_vehicle  ON transport_vehicle_telemetry_history(vehicle_id, recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_transport_telemetry_history_trip     ON transport_vehicle_telemetry_history(trip_id, recorded_at);
CREATE INDEX IF NOT EXISTS idx_transport_telemetry_history_property ON transport_vehicle_telemetry_history(property_id, recorded_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON transport_vehicle_telemetry_history TO authenticated;
ALTER TABLE transport_vehicle_telemetry_history ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- 5. RLS tightening — property-scoped, mirroring migration 458 (banquet)
-- ============================================================================
-- Progressive-hardening semantics: if the caller has NO property assignment
-- (the current state of this deployment), access is unchanged so nothing
-- breaks. Once operations assigns users to properties, isolation engages
-- automatically. Rows with NULL property_id remain global.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.transport_user_property_ids()
RETURNS uuid[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(array_agg(DISTINCT p), '{}'::uuid[]) FROM (
    SELECT su.property_id AS p
      FROM public.system_users su
     WHERE su.auth_user_id::text = auth.uid()::text
       AND su.property_id IS NOT NULL
    UNION
    SELECT upa.property_id AS p
      FROM public.user_property_access upa
     WHERE upa.user_id::text = auth.uid()::text
       AND upa.is_active
       AND upa.property_id IS NOT NULL
  ) t;
$$;

CREATE OR REPLACE FUNCTION public.transport_can_access_property(p uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p IS NULL
      OR cardinality(public.transport_user_property_ids()) = 0
      OR p = ANY(public.transport_user_property_ids());
$$;

GRANT EXECUTE ON FUNCTION public.transport_user_property_ids() TO authenticated;
GRANT EXECUTE ON FUNCTION public.transport_can_access_property(uuid) TO authenticated;

DO $$
DECLARE
  t text;
  transport_tables text[] := ARRAY[
    'transport_requests', 'transport_vehicles', 'transport_drivers',
    'transport_shuttles', 'transport_shuttle_boarding', 'transport_trips',
    'transport_airport_transfers', 'transport_guest_transports',
    'transport_corporate_contracts', 'transport_corporate_trips',
    'transport_routes', 'transport_schedule_items',
    'transport_vehicle_telemetry', 'transport_vehicle_telemetry_history',
    'transport_fuel_purchases', 'transport_fuel_cards',
    'transport_maintenance_requests', 'transport_contractors',
    'transport_contractor_trips', 'transport_billing_charges',
    'transport_messages', 'transport_reports', 'transport_config_items'
  ];
  pol record;
BEGIN
  FOREACH t IN ARRAY transport_tables LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = t) THEN
      CONTINUE;
    END IF;
    -- Replace blanket read and admin-name write policies with one
    -- property-scoped policy covering all commands (mirrors 458).
    FOR pol IN
      SELECT policyname FROM pg_policies
      WHERE schemaname = 'public' AND tablename = t
    LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', pol.policyname, t);
    END LOOP;
    EXECUTE format(
      'CREATE POLICY %I_property_scoped ON public.%I FOR ALL TO authenticated
         USING (public.transport_can_access_property(property_id))
         WITH CHECK (public.transport_can_access_property(property_id))',
      t, t);
  END LOOP;
END $$;
