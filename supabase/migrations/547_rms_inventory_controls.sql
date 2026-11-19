-- RMS Inventory Controls module.
-- Replaces hardcoded mock room inventory, sell limits, allotments, and stop sell blocks in InventoryControls.tsx.

CREATE TABLE IF NOT EXISTS rms_inventory_room_types (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id     UUID REFERENCES properties(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  total_rooms     INTEGER NOT NULL DEFAULT 0,
  available       INTEGER NOT NULL DEFAULT 0,
  sold            INTEGER NOT NULL DEFAULT 0,
  stop_sell       BOOLEAN NOT NULL DEFAULT false,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(property_id, name)
);

CREATE TABLE IF NOT EXISTS rms_inventory_sell_limits (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id     UUID REFERENCES properties(id) ON DELETE CASCADE,
  room_type       TEXT NOT NULL,
  channel         TEXT NOT NULL,
  limit_amount    INTEGER NOT NULL DEFAULT 0,
  used            INTEGER NOT NULL DEFAULT 0,
  active          BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS rms_inventory_allotments (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id     UUID REFERENCES properties(id) ON DELETE CASCADE,
  operator        TEXT NOT NULL,
  room_type       TEXT NOT NULL,
  total           INTEGER NOT NULL DEFAULT 0,
  released        INTEGER NOT NULL DEFAULT 0,
  expiry          DATE NOT NULL,
  active          BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS rms_inventory_stop_sell (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id     UUID REFERENCES properties(id) ON DELETE CASCADE,
  room_type       TEXT NOT NULL,
  start_date      DATE NOT NULL,
  end_date        DATE NOT NULL,
  reason          TEXT NOT NULL,
  active          BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rms_inv_room_prop ON rms_inventory_room_types(property_id);
CREATE INDEX IF NOT EXISTS idx_rms_sell_limit_prop ON rms_inventory_sell_limits(property_id);
CREATE INDEX IF NOT EXISTS idx_rms_allotment_prop ON rms_inventory_allotments(property_id);
CREATE INDEX IF NOT EXISTS idx_rms_stop_sell_prop ON rms_inventory_stop_sell(property_id);

CREATE OR REPLACE FUNCTION public.trg_rms_inv_set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_rms_inv_room_updated ON rms_inventory_room_types;
CREATE TRIGGER trg_rms_inv_room_updated
  BEFORE UPDATE ON rms_inventory_room_types
  FOR EACH ROW EXECUTE FUNCTION public.trg_rms_inv_set_updated_at();

DROP TRIGGER IF EXISTS trg_rms_sell_limit_updated ON rms_inventory_sell_limits;
CREATE TRIGGER trg_rms_sell_limit_updated
  BEFORE UPDATE ON rms_inventory_sell_limits
  FOR EACH ROW EXECUTE FUNCTION public.trg_rms_inv_set_updated_at();

DROP TRIGGER IF EXISTS trg_rms_allotment_updated ON rms_inventory_allotments;
CREATE TRIGGER trg_rms_allotment_updated
  BEFORE UPDATE ON rms_inventory_allotments
  FOR EACH ROW EXECUTE FUNCTION public.trg_rms_inv_set_updated_at();

DROP TRIGGER IF EXISTS trg_rms_stop_sell_updated ON rms_inventory_stop_sell;
CREATE TRIGGER trg_rms_stop_sell_updated
  BEFORE UPDATE ON rms_inventory_stop_sell
  FOR EACH ROW EXECUTE FUNCTION public.trg_rms_inv_set_updated_at();

ALTER TABLE rms_inventory_room_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE rms_inventory_sell_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE rms_inventory_allotments ENABLE ROW LEVEL SECURITY;
ALTER TABLE rms_inventory_stop_sell ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS rms_inv_room_read ON rms_inventory_room_types;
CREATE POLICY rms_inv_room_read ON rms_inventory_room_types FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS rms_inv_room_write ON rms_inventory_room_types;
CREATE POLICY rms_inv_room_write ON rms_inventory_room_types FOR ALL TO authenticated
  USING ((SELECT auth.jwt()) -> 'app_metadata' ->> 'role' IN ('revenue_manager','revenue','admin','system_admin','superuser','owner','executive','general_manager','gm'))
  WITH CHECK ((SELECT auth.jwt()) -> 'app_metadata' ->> 'role' IN ('revenue_manager','revenue','admin','system_admin','superuser','owner','executive','general_manager','gm'));

DROP POLICY IF EXISTS rms_sell_limit_read ON rms_inventory_sell_limits;
CREATE POLICY rms_sell_limit_read ON rms_inventory_sell_limits FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS rms_sell_limit_write ON rms_inventory_sell_limits;
CREATE POLICY rms_sell_limit_write ON rms_inventory_sell_limits FOR ALL TO authenticated
  USING ((SELECT auth.jwt()) -> 'app_metadata' ->> 'role' IN ('revenue_manager','revenue','admin','system_admin','superuser','owner','executive','general_manager','gm'))
  WITH CHECK ((SELECT auth.jwt()) -> 'app_metadata' ->> 'role' IN ('revenue_manager','revenue','admin','system_admin','superuser','owner','executive','general_manager','gm'));

DROP POLICY IF EXISTS rms_allotment_read ON rms_inventory_allotments;
CREATE POLICY rms_allotment_read ON rms_inventory_allotments FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS rms_allotment_write ON rms_inventory_allotments;
CREATE POLICY rms_allotment_write ON rms_inventory_allotments FOR ALL TO authenticated
  USING ((SELECT auth.jwt()) -> 'app_metadata' ->> 'role' IN ('revenue_manager','revenue','admin','system_admin','superuser','owner','executive','general_manager','gm'))
  WITH CHECK ((SELECT auth.jwt()) -> 'app_metadata' ->> 'role' IN ('revenue_manager','revenue','admin','system_admin','superuser','owner','executive','general_manager','gm'));

DROP POLICY IF EXISTS rms_stop_sell_read ON rms_inventory_stop_sell;
CREATE POLICY rms_stop_sell_read ON rms_inventory_stop_sell FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS rms_stop_sell_write ON rms_inventory_stop_sell;
CREATE POLICY rms_stop_sell_write ON rms_inventory_stop_sell FOR ALL TO authenticated
  USING ((SELECT auth.jwt()) -> 'app_metadata' ->> 'role' IN ('revenue_manager','revenue','admin','system_admin','superuser','owner','executive','general_manager','gm'))
  WITH CHECK ((SELECT auth.jwt()) -> 'app_metadata' ->> 'role' IN ('revenue_manager','revenue','admin','system_admin','superuser','owner','executive','general_manager','gm'));

INSERT INTO rms_inventory_room_types (name, total_rooms, available, sold, stop_sell) VALUES
  ('Deluxe Suite', 50, 35, 15, false),
  ('Standard Room', 100, 60, 40, false),
  ('Ocean View', 30, 20, 10, true),
  ('Family Suite', 25, 18, 7, false)
ON CONFLICT (property_id, name) DO UPDATE SET
  total_rooms = EXCLUDED.total_rooms,
  available = EXCLUDED.available,
  sold = EXCLUDED.sold,
  stop_sell = EXCLUDED.stop_sell;

INSERT INTO rms_inventory_sell_limits (room_type, channel, limit_amount, used, active) VALUES
  ('Deluxe Suite', 'All Channels', 40, 35, true),
  ('Standard Room', 'OTA', 50, 45, true),
  ('Ocean View', 'Direct', 15, 12, true)
ON CONFLICT DO NOTHING;

INSERT INTO rms_inventory_allotments (operator, room_type, total, released, expiry, active) VALUES
  ('Travel Corp X', 'Deluxe Suite', 20, 15, DATE '2024-12-31', true),
  ('Agency Y', 'Standard Room', 30, 25, DATE '2024-11-30', true),
  ('Tour Operator Z', 'Family Suite', 10, 8, DATE '2024-12-15', true)
ON CONFLICT DO NOTHING;

INSERT INTO rms_inventory_stop_sell (room_type, start_date, end_date, reason, active) VALUES
  ('Ocean View', DATE '2024-12-20', DATE '2024-12-31', 'Holiday period', true),
  ('Deluxe Suite', DATE '2024-12-24', DATE '2024-12-26', 'Christmas', true)
ON CONFLICT DO NOTHING;
