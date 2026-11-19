-- Migration: Housekeeping Dashboard Alerts
-- Backs the Smart Alert Engine (docs/Housekeeping Portal new.md §4).
-- The GET /api/hk-portal/dashboard/alerts endpoint runs an alert generator
-- that scans rooms, tasks, inspections, linen, minibar, and maintenance
-- data, then upserts alerts into this table. Acknowledge/Snooze actions
-- persist status changes back here.
--
-- Alert types (§4 Alerts):
--   VIP Arrival, Early Arrival, Late Check-out, Failed Inspection,
--   Linen Shortage, Minibar Pending, Deep Cleaning Due, Maintenance Awaiting
--
-- Priority: Critical | High | Medium | Low
-- Status:   Active | Acknowledged | Snoozed | Resolved

CREATE TABLE IF NOT EXISTS hk_dashboard_alerts (
  id            TEXT PRIMARY KEY,
  property_id   UUID,
  type          TEXT NOT NULL CHECK (type IN (
                  'VIP Arrival', 'Early Arrival', 'Late Check-out',
                  'Failed Inspection', 'Linen Shortage', 'Minibar Pending',
                  'Deep Cleaning Due', 'Maintenance Awaiting'
                )),
  message       TEXT NOT NULL,
  priority      TEXT NOT NULL DEFAULT 'Medium' CHECK (priority IN ('Critical','High','Medium','Low')),
  status        TEXT NOT NULL DEFAULT 'Active' CHECK (status IN ('Active','Acknowledged','Snoozed','Resolved')),
  room          TEXT,
  snoozed_until TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_hk_dash_alerts_property ON hk_dashboard_alerts(property_id);
CREATE INDEX IF NOT EXISTS idx_hk_dash_alerts_status ON hk_dashboard_alerts(status);
CREATE INDEX IF NOT EXISTS idx_hk_dash_alerts_priority ON hk_dashboard_alerts(priority);

-- updated_at trigger
CREATE OR REPLACE FUNCTION hk_dash_alerts_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_hk_dash_alerts_updated_at ON hk_dashboard_alerts;
CREATE TRIGGER trg_hk_dash_alerts_updated_at
  BEFORE UPDATE ON hk_dashboard_alerts
  FOR EACH ROW EXECUTE FUNCTION hk_dash_alerts_set_updated_at();

GRANT SELECT, INSERT, UPDATE, DELETE ON hk_dashboard_alerts TO authenticated;
