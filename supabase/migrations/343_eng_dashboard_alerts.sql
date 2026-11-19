-- ============================================================
-- Engineering Portal — Dashboard Alerts (Migration 343)
-- ============================================================
-- Backs the Engineering Dashboard Smart Alert Engine.
-- The GET /api/eng-portal/dashboard/alerts endpoint runs an alert
-- generator that scans work orders, PM schedules, compliance items,
-- generators, utility readings, and room issues, then upserts alerts
-- into this table. Acknowledge/Snooze actions persist status changes
-- back here.
--
-- Alert types (Engineering-specific):
--   Critical Equipment Failure, Safety Incident, Fire System Fault,
--   Generator Alarm, HVAC Alarm, Water Leak, Low Spare Parts Stock,
--   Compliance Inspection Due, PM Overdue, Room Out of Order
--
-- Priority: Critical | High | Medium | Low
-- Status:   Active | Acknowledged | Snoozed | Resolved
-- ============================================================

CREATE TABLE IF NOT EXISTS public.eng_dashboard_alerts (
  id            TEXT PRIMARY KEY,
  property_id   UUID,
  type          TEXT NOT NULL CHECK (type IN (
                  'Critical Equipment Failure', 'Safety Incident', 'Fire System Fault',
                  'Generator Alarm', 'HVAC Alarm', 'Water Leak',
                  'Low Spare Parts Stock', 'Compliance Inspection Due',
                  'PM Overdue', 'Room Out of Order'
                )),
  message       TEXT NOT NULL,
  priority      TEXT NOT NULL DEFAULT 'Medium' CHECK (priority IN ('Critical','High','Medium','Low')),
  status        TEXT NOT NULL DEFAULT 'Active' CHECK (status IN ('Active','Acknowledged','Snoozed','Resolved')),
  source        TEXT,
  snoozed_until TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_eng_dash_alerts_property ON public.eng_dashboard_alerts(property_id);
CREATE INDEX IF NOT EXISTS idx_eng_dash_alerts_status ON public.eng_dashboard_alerts(status);
CREATE INDEX IF NOT EXISTS idx_eng_dash_alerts_priority ON public.eng_dashboard_alerts(priority);

-- updated_at trigger
CREATE OR REPLACE FUNCTION public.eng_dash_alerts_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_eng_dash_alerts_updated_at ON public.eng_dashboard_alerts;
CREATE TRIGGER trg_eng_dash_alerts_updated_at
  BEFORE UPDATE ON public.eng_dashboard_alerts
  FOR EACH ROW EXECUTE FUNCTION public.eng_dash_alerts_set_updated_at();

ALTER TABLE public.eng_dashboard_alerts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated can CRUD eng_dashboard_alerts"
  ON public.eng_dashboard_alerts FOR ALL TO authenticated
  USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.eng_dashboard_alerts TO authenticated;
