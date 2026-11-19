-- Migration 643: Operations Configuration
-- Backs /erp/operations/configuration (Configuration.tsx).
--
-- ops_config mirrors hk_config/eng_config/sec_config: section-keyed JSONB
-- config rows. Seeded with the former mock settings (shift types, alert
-- thresholds, notification rules) plus expanded ops sections (escalation,
-- reports, duty manager).

CREATE TABLE IF NOT EXISTS public.ops_config (
  id          TEXT PRIMARY KEY,
  property_id UUID,
  section     TEXT NOT NULL,
  data        JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_by  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (property_id, section)
);

ALTER TABLE public.ops_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ops_config_auth ON public.ops_config;
CREATE POLICY ops_config_auth ON public.ops_config
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.ops_config TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ops_config TO service_role;

-- Seed sections (property_id NULL = global defaults).
INSERT INTO public.ops_config (id, property_id, section, data) VALUES
  ('ops-cfg-shift-types', NULL, 'shift-types',
   '{"morningStart":"07:00","afternoonStart":"15:00","nightStart":"23:00","handoverMinutes":30}'::jsonb),
  ('ops-cfg-alert-thresholds', NULL, 'alert-thresholds',
   '{"criticalResponseMinutes":15,"highResponseMinutes":30,"mediumResponseMinutes":60,"escalateAfterMinutes":120}'::jsonb),
  ('ops-cfg-notifications', NULL, 'notification-rules',
   '{"smsEnabled":true,"emailEnabled":true,"pushEnabled":true,"notifyOnEscalation":true,"notifyOnEmergency":true}'::jsonb),
  ('ops-cfg-escalation', NULL, 'escalation',
   '{"defaultSlaHours":2,"criticalSlaHours":1,"autoEscalate":true,"escalateToDutyManager":true}'::jsonb),
  ('ops-cfg-reports', NULL, 'reports',
   '{"defaultFormat":"PDF","defaultPeriod":"Today","autoRunDaily":false,"archiveRetentionDays":90}'::jsonb),
  ('ops-cfg-duty-manager', NULL, 'duty-manager',
   '{"walkthroughRequired":true,"handoverChecklistRequired":true,"maxShiftHours":12,"briefingLeadMinutes":15}'::jsonb)
ON CONFLICT (id) DO NOTHING;
