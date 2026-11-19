-- RMS Package Pricing module.
-- Replaces hardcoded mock packages in PackagePricing.tsx.

CREATE TABLE IF NOT EXISTS rms_packages (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id   UUID REFERENCES properties(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  package_type  TEXT NOT NULL, -- 'room','dining','spa','conference','wedding','seasonal'
  room_type     TEXT NOT NULL DEFAULT 'All Room Types',
  base_rate     NUMERIC(12,2) NOT NULL DEFAULT 0,
  package_rate  NUMERIC(12,2) NOT NULL DEFAULT 0,
  includes      JSONB NOT NULL DEFAULT '[]'::jsonb,
  validity      TEXT NOT NULL DEFAULT 'All year',
  active        BOOLEAN NOT NULL DEFAULT true,
  bookings      INTEGER NOT NULL DEFAULT 0,
  revenue       NUMERIC(14,2) NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rms_package_type ON rms_packages(package_type);
CREATE INDEX IF NOT EXISTS idx_rms_package_active ON rms_packages(active);

CREATE OR REPLACE FUNCTION public.trg_rms_packages_set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_rms_package_updated ON rms_packages;
CREATE TRIGGER trg_rms_package_updated BEFORE UPDATE ON rms_packages FOR EACH ROW EXECUTE FUNCTION public.trg_rms_packages_set_updated_at();

ALTER TABLE rms_packages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS rms_package_read ON rms_packages;
CREATE POLICY rms_package_read ON rms_packages FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS rms_package_write ON rms_packages;
CREATE POLICY rms_package_write ON rms_packages FOR ALL TO authenticated
  USING ((SELECT auth.jwt()) -> 'app_metadata' ->> 'role' IN ('revenue_manager','revenue','admin','system_admin','superuser','owner','executive','general_manager','gm'))
  WITH CHECK ((SELECT auth.jwt()) -> 'app_metadata' ->> 'role' IN ('revenue_manager','revenue','admin','system_admin','superuser','owner','executive','general_manager','gm'));

INSERT INTO rms_packages (name, package_type, room_type, base_rate, package_rate, includes, validity, active, bookings, revenue) VALUES
  ('Romantic Getaway', 'room', 'Deluxe Suite', 200, 280, '["Champagne on arrival","Rose petals","Late checkout","Breakfast for two"]'::jsonb, '2024-12-01 to 2024-12-31', true, 45, 12600),
  ('Business Executive', 'room', 'Standard Room', 100, 150, '["High-speed WiFi","Workspace","Daily newspaper","Airport transfer"]'::jsonb, 'All year', true, 120, 18000),
  ('Fine Dining Experience', 'dining', 'All Room Types', 0, 75, '["3-course dinner","Wine pairing","Chef''s special"]'::jsonb, 'Fri-Sun', true, 85, 6375),
  ('Spa Retreat', 'spa', 'Deluxe Suite', 200, 350, '["Daily spa treatment","Massage","Facial","Access to thermal pool"]'::jsonb, '2024-11-01 to 2025-03-31', true, 30, 10500),
  ('Conference Package', 'conference', 'All Room Types', 0, 120, '["Meeting room","Projector","Coffee breaks","Lunch"]'::jsonb, 'Mon-Fri', true, 25, 3000),
  ('Dream Wedding', 'wedding', 'Ballroom', 0, 5000, '["Venue decoration","Catering for 100","Wedding cake","Photography package"]'::jsonb, 'All year', true, 8, 40000),
  ('Summer Special', 'seasonal', 'All Room Types', 100, 85, '["Pool access","Daily breakfast","Kids club access"]'::jsonb, '2024-06-01 to 2024-08-31', false, 200, 17000)
ON CONFLICT DO NOTHING;
