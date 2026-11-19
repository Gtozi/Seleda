-- RMS Configuration module.
-- Replaces hardcoded settings panels in RevenueManagement/Configuration.tsx.

CREATE TABLE IF NOT EXISTS rms_config_settings (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id   UUID REFERENCES properties(id) ON DELETE CASCADE,
  setting_key   TEXT NOT NULL UNIQUE,
  section       TEXT NOT NULL, -- 'general','pricing','forecast','competitor','alerts','preferences'
  name          TEXT NOT NULL,
  description   TEXT,
  value         JSONB NOT NULL,
  value_type    TEXT NOT NULL DEFAULT 'boolean', -- 'boolean','number','select'
  options       JSONB, -- for select type
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS rms_system_status (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id   UUID REFERENCES properties(id) ON DELETE CASCADE,
  component     TEXT NOT NULL UNIQUE,
  status        TEXT NOT NULL DEFAULT 'operational', -- 'operational','warning','error'
  last_update   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rms_config_section ON rms_config_settings(section);

CREATE OR REPLACE FUNCTION public.trg_rms_config_set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_rms_config_updated ON rms_config_settings;
CREATE TRIGGER trg_rms_config_updated BEFORE UPDATE ON rms_config_settings FOR EACH ROW EXECUTE FUNCTION public.trg_rms_config_set_updated_at();

ALTER TABLE rms_config_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE rms_system_status ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS rms_config_read ON rms_config_settings;
CREATE POLICY rms_config_read ON rms_config_settings FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS rms_config_write ON rms_config_settings;
CREATE POLICY rms_config_write ON rms_config_settings FOR ALL TO authenticated
  USING ((SELECT auth.jwt()) -> 'app_metadata' ->> 'role' IN ('revenue_manager','revenue','admin','system_admin','superuser','owner','executive','general_manager','gm'))
  WITH CHECK ((SELECT auth.jwt()) -> 'app_metadata' ->> 'role' IN ('revenue_manager','revenue','admin','system_admin','superuser','owner','executive','general_manager','gm'));

DROP POLICY IF EXISTS rms_status_read ON rms_system_status;
CREATE POLICY rms_status_read ON rms_system_status FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS rms_status_write ON rms_system_status;
CREATE POLICY rms_status_write ON rms_system_status FOR ALL TO authenticated
  USING ((SELECT auth.jwt()) -> 'app_metadata' ->> 'role' IN ('revenue_manager','revenue','admin','system_admin','superuser','owner','executive','general_manager','gm'))
  WITH CHECK ((SELECT auth.jwt()) -> 'app_metadata' ->> 'role' IN ('revenue_manager','revenue','admin','system_admin','superuser','owner','executive','general_manager','gm'));

INSERT INTO rms_config_settings (setting_key, section, name, description, value, value_type, options, display_order) VALUES
  ('auto_update', 'general', 'Auto-update Rates', 'Automatically update rates based on demand', 'true'::jsonb, 'boolean', NULL, 1),
  ('sync_channels', 'general', 'Sync Channels', 'Automatically sync rates to all channels', 'true'::jsonb, 'boolean', NULL, 2),
  ('update_frequency', 'general', 'Update Frequency', 'How often to check for rate updates', '"hourly"'::jsonb, 'select', '["real-time","hourly","daily"]'::jsonb, 3),
  ('default_currency', 'general', 'Default Currency', 'Currency for rate display', '"USD"'::jsonb, 'select', '["USD","EUR","GBP","ETB"]'::jsonb, 4),
  ('timezone', 'general', 'Timezone', 'Timezone for rate calculations', '"UTC+3"'::jsonb, 'select', '["UTC+3","UTC+0","UTC-5","UTC-8"]'::jsonb, 5),
  ('min_rate', 'pricing', 'Minimum Rate', 'Minimum allowed rate for any room type', '80'::jsonb, 'number', NULL, 1),
  ('max_rate', 'pricing', 'Maximum Rate', 'Maximum allowed rate for any room type', '500'::jsonb, 'number', NULL, 2),
  ('rate_change_limit', 'pricing', 'Rate Change Limit', 'Maximum percentage change per update', '20'::jsonb, 'number', NULL, 3),
  ('competitor_parity', 'pricing', 'Competitor Parity', 'Stay within X% of competitor rates', '10'::jsonb, 'number', NULL, 4),
  ('loyalty_discount', 'pricing', 'Loyalty Discount', 'Default discount for loyalty members', '10'::jsonb, 'number', NULL, 5),
  ('forecast_horizon', 'forecast', 'Forecast Horizon', 'Days to forecast ahead', '90'::jsonb, 'number', NULL, 1),
  ('model_type', 'forecast', 'Forecast Model', 'AI model for demand forecasting', '"advanced"'::jsonb, 'select', '["basic","standard","advanced"]'::jsonb, 2),
  ('include_events', 'forecast', 'Include Events', 'Factor in local events in forecasts', 'true'::jsonb, 'boolean', NULL, 3),
  ('include_seasonality', 'forecast', 'Include Seasonality', 'Factor in seasonal patterns', 'true'::jsonb, 'boolean', NULL, 4),
  ('forecast_update', 'forecast', 'Forecast Update', 'How often to regenerate forecasts', '"daily"'::jsonb, 'select', '["hourly","daily","weekly"]'::jsonb, 5),
  ('auto_monitor', 'competitor', 'Auto Monitor', 'Automatically monitor competitor rates', 'true'::jsonb, 'boolean', NULL, 1),
  ('check_frequency', 'competitor', 'Check Frequency', 'How often to check competitor rates', '"daily"'::jsonb, 'select', '["hourly","daily","weekly"]'::jsonb, 2),
  ('competitor_count', 'competitor', 'Competitor Count', 'Number of competitors to track', '5'::jsonb, 'number', NULL, 3),
  ('comp_alert_threshold', 'competitor', 'Alert Threshold', 'Rate difference percentage for alerts', '15'::jsonb, 'number', NULL, 4),
  ('include_ota', 'competitor', 'Include OTA Rates', 'Track OTA displayed rates', 'true'::jsonb, 'boolean', NULL, 5),
  ('low_occupancy', 'alerts', 'Low Occupancy Alert', 'Alert when occupancy falls below', '60'::jsonb, 'number', NULL, 1),
  ('high_occupancy', 'alerts', 'High Occupancy Alert', 'Alert when occupancy exceeds', '90'::jsonb, 'number', NULL, 2),
  ('rate_parity_alert', 'alerts', 'Rate Parity Alert', 'Alert on rate parity violation', 'true'::jsonb, 'boolean', NULL, 3),
  ('forecast_variance', 'alerts', 'Forecast Variance', 'Alert when actual varies from forecast by', '15'::jsonb, 'number', NULL, 4),
  ('competitor_change', 'alerts', 'Competitor Change Alert', 'Alert on significant competitor rate changes', 'true'::jsonb, 'boolean', NULL, 5),
  ('email_notifications', 'preferences', 'Email Notifications', 'Receive email alerts', 'true'::jsonb, 'boolean', NULL, 1),
  ('push_notifications', 'preferences', 'Push Notifications', 'Receive push notifications', 'true'::jsonb, 'boolean', NULL, 2),
  ('daily_summary', 'preferences', 'Daily Summary', 'Receive daily revenue summary', 'true'::jsonb, 'boolean', NULL, 3),
  ('report_format', 'preferences', 'Default Report Format', 'Preferred format for reports', '"PDF"'::jsonb, 'select', '["PDF","Excel","CSV"]'::jsonb, 4),
  ('dashboard_view', 'preferences', 'Default Dashboard View', 'Initial dashboard view', '"revenue"'::jsonb, 'select', '["revenue","occupancy","adr","revpar"]'::jsonb, 5)
ON CONFLICT (setting_key) DO NOTHING;

INSERT INTO rms_system_status (component, status, last_update, display_order) VALUES
  ('Rate Engine', 'operational', NOW() - INTERVAL '2 minutes', 1),
  ('Forecast Engine', 'operational', NOW() - INTERVAL '15 minutes', 2),
  ('Channel Sync', 'operational', NOW() - INTERVAL '5 minutes', 3)
ON CONFLICT (component) DO NOTHING;
