-- ============================================================================
-- 623_security_dashboard.sql — Security Dashboard Alerts
-- Backs the /erp/security/dashboard tab (SecurityDashboard.tsx). Mimics the
-- HK Smart Alert Engine (migration 317 / hk_dashboard_alerts): the
-- GET /api/sec-portal/dashboard/overview endpoint scans the live sec_*
-- tables, upserts alert rows here, and resolves alerts whose trigger
-- condition has cleared. Acknowledge/Snooze persist status back here.
--
-- Alert types:
--   Active Alarm, Critical Incident, Emergency Active, Fire Equipment
--   Overdue, Fire Equipment Down, CCTV Offline, Risk Review Overdue,
--   Training Expired, Access Violation, Key Lost, Blacklisted Visitor,
--   Patrol Missed
--
-- Priority: Critical | High | Medium | Low
-- Status:   Active | Acknowledged | Snoozed | Resolved
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.sec_dashboard_alerts (
  id            TEXT PRIMARY KEY,
  property_id   UUID,
  type          TEXT NOT NULL CHECK (type IN (
                  'Active Alarm', 'Critical Incident', 'Emergency Active',
                  'Fire Equipment Overdue', 'Fire Equipment Down',
                  'CCTV Offline', 'Risk Review Overdue', 'Training Expired',
                  'Access Violation', 'Key Lost', 'Blacklisted Visitor',
                  'Patrol Missed'
                )),
  message       TEXT NOT NULL,
  priority      TEXT NOT NULL DEFAULT 'Medium' CHECK (priority IN ('Critical','High','Medium','Low')),
  status        TEXT NOT NULL DEFAULT 'Active' CHECK (status IN ('Active','Acknowledged','Snoozed','Resolved')),
  ref_id        TEXT,          -- source row id (incident/alarm/equipment/…)
  location      TEXT,
  snoozed_until TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sec_dash_alerts_property ON public.sec_dashboard_alerts(property_id);
CREATE INDEX IF NOT EXISTS idx_sec_dash_alerts_status   ON public.sec_dashboard_alerts(status);
CREATE INDEX IF NOT EXISTS idx_sec_dash_alerts_priority ON public.sec_dashboard_alerts(priority);

CREATE OR REPLACE FUNCTION sec_dash_alerts_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sec_dash_alerts_updated_at ON public.sec_dashboard_alerts;
CREATE TRIGGER trg_sec_dash_alerts_updated_at
  BEFORE UPDATE ON public.sec_dashboard_alerts
  FOR EACH ROW EXECUTE FUNCTION sec_dash_alerts_set_updated_at();

ALTER TABLE public.sec_dashboard_alerts ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sec_dashboard_alerts TO authenticated;
