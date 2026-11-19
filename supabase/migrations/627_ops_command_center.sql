-- 627_ops_command_center.sql
-- Operations Portal — Command Center module.
-- Backs the /erp/operations/command-center tab (OperationsCommandCenter.tsx).
-- Previously the module rendered hardcoded mock data in useState. This migration
-- persists the live alert feed to the DB so the module can fetch/acknowledge via
-- /api/ops-portal/command-center.
--
-- Alert model (mirrors hk_dashboard_alerts / sec_dashboard_alerts):
--   severity: critical | warning | info
--   status:   Active → Acknowledged → Resolved
--   source:   'seed'      — rows below, previously hardcoded in the component.
--             'generated' — rows written by the GET endpoint's alert generator,
--                           which scans live data across the other department
--                           portals (HK tasks, engineering work orders, security
--                           incidents, transport, spa, F&B orders, guest
--                           requests, inventory stock levels). Generated rows
--                           carry deterministic ids (ops-gen-*) and are
--                           auto-resolved when their trigger condition clears;
--                           seed rows are never auto-resolved.

-- ── Table ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ops_command_alerts (
  id               TEXT PRIMARY KEY,
  property_id      UUID,
  severity         TEXT NOT NULL DEFAULT 'info' CHECK (severity IN (
                     'critical', 'warning', 'info'
                   )),
  category         TEXT NOT NULL,
  message          TEXT NOT NULL,
  department       TEXT NOT NULL,
  status           TEXT NOT NULL DEFAULT 'Active' CHECK (status IN (
                     'Active', 'Acknowledged', 'Resolved'
                   )),
  acknowledged_by  TEXT,
  acknowledged_at  TIMESTAMPTZ,
  source           TEXT NOT NULL DEFAULT 'generated' CHECK (source IN (
                     'seed', 'generated'
                   )),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ops_command_alerts_property
  ON public.ops_command_alerts(property_id);
CREATE INDEX IF NOT EXISTS idx_ops_command_alerts_status
  ON public.ops_command_alerts(status);
CREATE INDEX IF NOT EXISTS idx_ops_command_alerts_severity
  ON public.ops_command_alerts(severity);
CREATE INDEX IF NOT EXISTS idx_ops_command_alerts_created
  ON public.ops_command_alerts(created_at DESC);

-- ── updated_at trigger ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.update_ops_command_alerts_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_ops_command_alerts_updated_at
  ON public.ops_command_alerts;
CREATE TRIGGER trg_ops_command_alerts_updated_at
  BEFORE UPDATE ON public.ops_command_alerts
  FOR EACH ROW
  EXECUTE FUNCTION public.update_ops_command_alerts_timestamp();

ALTER TABLE public.ops_command_alerts ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ops_command_alerts TO authenticated;

-- ── Seed mock data ───────────────────────────────────────────────────────
-- The 5 alerts previously hardcoded in OperationsCommandCenter.tsx
-- (mockAlerts). Uses the single demo property
-- (18762279-a389-41c9-9169-7ebc682e9703). 'Acknowledged' mirrors the
-- acknowledged flag the mock rows carried.
INSERT INTO public.ops_command_alerts
  (id, property_id, severity, category, message, department, status, source)
VALUES
  ('ops-seed-001', '18762279-a389-41c9-9169-7ebc682e9703', 'critical',
   'Equipment Failure',
   'HVAC system failure on Floor 3 affecting 12 rooms',
   'Engineering', 'Active', 'seed'),
  ('ops-seed-002', '18762279-a389-41c9-9169-7ebc682e9703', 'warning',
   'Staff Shortage',
   '3 housekeepers called in sick for afternoon shift',
   'Housekeeping', 'Active', 'seed'),
  ('ops-seed-003', '18762279-a389-41c9-9169-7ebc682e9703', 'critical',
   'Guest Escalation',
   'Guest in Room 305 reporting water leak, immediate attention required',
   'Front Office', 'Acknowledged', 'seed'),
  ('ops-seed-004', '18762279-a389-41c9-9169-7ebc682e9703', 'warning',
   'Equipment Failure',
   'Airport shuttle van requires maintenance - 1 vehicle out of service',
   'Transportation', 'Active', 'seed'),
  ('ops-seed-005', '18762279-a389-41c9-9169-7ebc682e9703', 'info',
   'VIP Arrival',
   'VVIP guest Mr. Smith arriving at 3:00 PM, suite preparation in progress',
   'Front Office', 'Acknowledged', 'seed')
ON CONFLICT (id) DO NOTHING;
