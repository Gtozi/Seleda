-- Migration: Security Asset Protection
-- Backs the /erp/security/asset-protection tab (AssetProtection.tsx).
--
-- Two tables:
--   1. sec_assets      — high-value asset register (type, value, custodian,
--                        security level, protection measures, check schedule,
--                        lifecycle)
--   2. sec_asset_logs  — per-asset movement/review trail (Registered,
--                        Check Performed, Moved, Status Change, Security
--                        Review, Alarm Test, Note), CASCADE on asset delete.

-- ── 1. Asset register ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.sec_assets (
  id                  TEXT PRIMARY KEY,
  property_id         UUID,
  name                TEXT NOT NULL,
  asset_type          TEXT NOT NULL DEFAULT 'Other' CHECK (asset_type IN (
                        'Artwork', 'Cash & Valuables', 'Electronics', 'Vehicle',
                        'Equipment', 'Documents', 'Furniture', 'Other'
                      )),
  location            TEXT,
  estimated_value     NUMERIC(14,2),
  serial_no           TEXT,
  custodian           TEXT,
  security_level      TEXT NOT NULL DEFAULT 'Standard' CHECK (security_level IN (
                        'Maximum', 'High', 'Standard'
                      )),
  status              TEXT NOT NULL DEFAULT 'Secured' CHECK (status IN (
                        'Secured', 'In Transit', 'Under Review', 'Missing', 'Compromised'
                      )),
  protection_measures TEXT,
  last_check          TIMESTAMP WITH TIME ZONE,
  next_check_due      DATE,
  notes               TEXT,
  created_by          TEXT,
  created_at          TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sec_assets_prop ON public.sec_assets(property_id);
CREATE INDEX IF NOT EXISTS idx_sec_assets_status ON public.sec_assets(status);
CREATE INDEX IF NOT EXISTS idx_sec_assets_due ON public.sec_assets(next_check_due);

CREATE OR REPLACE FUNCTION public.update_sec_assets_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_sec_assets_updated_at ON public.sec_assets;
CREATE TRIGGER trigger_sec_assets_updated_at
  BEFORE UPDATE ON public.sec_assets
  FOR EACH ROW
  EXECUTE FUNCTION public.update_sec_assets_timestamp();

ALTER TABLE public.sec_assets ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sec_assets TO authenticated;

-- ── 2. Asset log — movement + review trail ───────────────────────────────
CREATE TABLE IF NOT EXISTS public.sec_asset_logs (
  id         TEXT PRIMARY KEY,
  asset_id   TEXT NOT NULL REFERENCES public.sec_assets(id) ON DELETE CASCADE,
  action     TEXT NOT NULL CHECK (action IN (
               'Registered', 'Check Performed', 'Moved', 'Status Change',
               'Security Review', 'Alarm Test', 'Note'
             )),
  detail     TEXT,
  location   TEXT,
  actor      TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sec_asset_logs_asset ON public.sec_asset_logs(asset_id);

ALTER TABLE public.sec_asset_logs ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sec_asset_logs TO authenticated;

-- ── Seed data ────────────────────────────────────────────────────────────
-- Uses the demo property (18762279-a389-41c9-9169-7ebc682e9703).

INSERT INTO public.sec_assets
  (id, property_id, name, asset_type, location, estimated_value, serial_no,
   custodian, security_level, status, protection_measures,
   last_check, next_check_due, notes)
VALUES
  ('AST-001', '18762279-a389-41c9-9169-7ebc682e9703', 'Lobby Sculpture — "Meridian" Bronze',
   'Artwork', 'Main Lobby', 85000, NULL,
   'Security Manager', 'High', 'Secured',
   '24/7 CCTV CAM-002, vibration sensor, rope barrier, nightly check.',
   NOW() - INTERVAL '1 day', CURRENT_DATE + INTERVAL '6 days', 'On loan from city gallery — insurance rider active.'),
  ('AST-002', '18762279-a389-41c9-9169-7ebc682e9703', 'Front Office Safe — Float Cash',
   'Cash & Valuables', 'Front Office Back Room', 25000, 'SAFE-FO-01',
   'Front Office Manager', 'Maximum', 'Secured',
   'Dual-control access, drop-safe, camera CAM-007 coverage, daily two-person count.',
   NOW() - INTERVAL '8 hours', CURRENT_DATE, 'Daily float verification logged.'),
  ('AST-003', '18762279-a389-41c9-9169-7ebc682e9703', 'Guest Safe Deposit Boxes (Vault)',
   'Cash & Valuables', 'Vault — B1', NULL, NULL,
   'Security Manager', 'Maximum', 'Secured',
   'Vault door time-lock, dual-key protocol, biometric entry, CCTV CAM-001.',
   NOW() - INTERVAL '12 hours', CURRENT_DATE + INTERVAL '2 days', '42 boxes — 28 occupied.'),
  ('AST-004', '18762279-a389-41c9-9169-7ebc682e9703', 'Banquet Silver Service Set',
   'Equipment', 'F&B Storage Room', 18500, 'SIL-SET-12',
   'F&B Director', 'High', 'Under Review',
   'Locked cabinet, access log; count discrepancy under review.',
   NOW() - INTERVAL '2 days', CURRENT_DATE + INTERVAL '1 day', 'Last count short 2 pieces — reconciliation in progress.'),
  ('AST-005', '18762279-a389-41c9-9169-7ebc682e9703', 'Hotel Shuttle Van #2',
   'Vehicle', 'Parking B2 — Bay 14', 42000, 'VAN-02',
   'Transport Supervisor', 'Standard', 'Secured',
   'GPS tracker, key in key register (KEY-004), nightly fuel/odometer check.',
   NOW() - INTERVAL '14 hours', CURRENT_DATE + INTERVAL '3 days', NULL),
  ('AST-006', '18762279-a389-41c9-9169-7ebc682e9703', 'Wine Cellar Reserve Collection',
   'Other', 'Wine Cellar — B1', 67000, NULL,
   'F&B Director', 'High', 'Secured',
   'Climate-controlled room, access-grant restricted (AGR-004), inventory monthly.',
   NOW() - INTERVAL '5 days', CURRENT_DATE - INTERVAL '2 days', 'Monthly inventory overdue — schedule count.'),
  ('AST-007', '18762279-a389-41c9-9169-7ebc682e9703', 'IT Server Room — Core Equipment',
   'Electronics', 'Server Room B1', 120000, NULL,
   'IT Manager', 'Maximum', 'Secured',
   'Biometric + badge dual auth, fire suppression, UPS, environmental alarms.',
   NOW() - INTERVAL '1 day', CURRENT_DATE + INTERVAL '5 days', NULL),
  ('AST-008', '18762279-a389-41c9-9169-7ebc682e9703', 'Event A/V Kit — Projectors & Mixers',
   'Electronics', 'AV Storage — Events Floor', 31000, 'AVKIT-07',
   'Events Manager', 'Standard', 'In Transit',
   'Check-in/out via storage log; currently deployed for ballroom conference.',
   NOW() - INTERVAL '3 hours', CURRENT_DATE + INTERVAL '1 day', 'Deployed for 3-day conference — due back Friday.')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.sec_asset_logs
  (id, asset_id, action, detail, location, actor, created_at)
VALUES
  ('ASL-001', 'AST-001', 'Registered', 'Asset registered on arrival — condition documented with photos.', 'Main Lobby', 'Security Manager', NOW() - INTERVAL '90 days'),
  ('ASL-002', 'AST-001', 'Alarm Test', 'Vibration sensor tested — alert received in SOC within 4s.', 'Main Lobby', 'Security Officer', NOW() - INTERVAL '7 days'),
  ('ASL-003', 'AST-001', 'Check Performed', 'Nightly visual check — barrier intact, no tampering.', 'Main Lobby', 'Night Officer', NOW() - INTERVAL '1 day'),
  ('ASL-004', 'AST-002', 'Check Performed', 'Two-person float count verified — balanced.', 'Front Office', 'Duty Manager', NOW() - INTERVAL '8 hours'),
  ('ASL-005', 'AST-003', 'Security Review', 'Vault access log reviewed — no anomalies. 28/42 boxes occupied.', 'Vault B1', 'Security Manager', NOW() - INTERVAL '12 hours'),
  ('ASL-006', 'AST-004', 'Status Change', 'Status → Under Review: count short 2 pieces at monthly inventory.', 'F&B Storage', 'F&B Director', NOW() - INTERVAL '2 days'),
  ('ASL-007', 'AST-004', 'Security Review', 'Reconciliation in progress — reviewing event manifests + access log.', 'F&B Storage', 'Security Officer', NOW() - INTERVAL '1 day'),
  ('ASL-008', 'AST-005', 'Check Performed', 'Fuel/odometer check — GPS tracker responsive.', 'Parking B2', 'Transport Supervisor', NOW() - INTERVAL '14 hours'),
  ('ASL-009', 'AST-006', 'Check Performed', 'Monthly inventory count — pending completion, 2 days overdue.', 'Wine Cellar', 'F&B Director', NOW() - INTERVAL '5 days'),
  ('ASL-010', 'AST-007', 'Alarm Test', 'Environmental alarms + UPS failover tested — all nominal.', 'Server Room', 'IT Manager', NOW() - INTERVAL '1 day'),
  ('ASL-011', 'AST-008', 'Moved', 'Kit deployed to Ballroom for 3-day conference.', 'Ballroom', 'Events Manager', NOW() - INTERVAL '3 hours'),
  ('ASL-012', 'AST-008', 'Status Change', 'Status → In Transit for event duration.', 'Events Floor', 'Events Manager', NOW() - INTERVAL '3 hours')
ON CONFLICT (id) DO NOTHING;
