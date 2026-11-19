-- ============================================================
-- Engineering Portal — Configuration (Migration 336)
-- ============================================================
-- Backs the /erp/maintenance/configuration tab
-- (Configuration.tsx). Previously the module rendered hardcoded
-- mock settings in useState with a non-functional "Save Changes"
-- button. This migration persists that contract to the DB so the
-- module can fetch/persist via /api/eng-portal/config.
--
-- Scope: MAINTENANCE-ONLY config. General/department/staff/
-- locations/utilities settings are admin-managed elsewhere and are
-- NOT included here. The 4 maintenance sections are:
--   work_orders, preventive_maintenance, alerts, safety
--
-- Each section's JSONB data contains both:
--   - flat key-value settings (booleans, numbers, selects)
--   - row-based config entities (arrays of objects) that are
--     edited via add/edit/delete rows in the UI, mirroring the HK
--     ConfigurationModule pattern (migration 320 / hk_config).
--
-- Pattern mirrors hk_config (migration 320):
--   JSON-blob config per property per section.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.eng_config (
  id          TEXT PRIMARY KEY,
  property_id UUID,
  section     TEXT NOT NULL CHECK (section IN (
                'work_orders', 'preventive_maintenance',
                'alerts', 'safety'
              )),
  data        JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_eng_config_property_section
  ON public.eng_config(property_id, section);

CREATE INDEX IF NOT EXISTS idx_eng_config_section
  ON public.eng_config(section);

-- ── updated_at trigger ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.eng_config_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_eng_config_updated_at ON public.eng_config;
CREATE TRIGGER trg_eng_config_updated_at
  BEFORE UPDATE ON public.eng_config
  FOR EACH ROW
  EXECUTE FUNCTION public.eng_config_set_updated_at();

-- ── RLS ──────────────────────────────────────────────────────────────────
ALTER TABLE public.eng_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated can CRUD eng_config"
  ON public.eng_config FOR ALL TO authenticated
  USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.eng_config TO authenticated;

-- ── Seed default config for the demo property ────────────────────────────
-- Only the 4 maintenance-specific sections. Each section's JSONB
-- contains flat settings + row-based entity arrays.
INSERT INTO public.eng_config (id, property_id, section, data)
VALUES
  ('eng-cfg-18762279-work_orders',
   '18762279-a389-41c9-9169-7ebc682e9703',
   'work_orders',
   '{
     "auto-assign": false,
     "default-priority": "Normal",
     "sla-hours": 4,
     "require-photos": true,
     "allow-guest-requests": true,
     "priorities": [
       { "id": "WO-P-1", "label": "Emergency", "slaHours": 1, "color": "bg-rose-500" },
       { "id": "WO-P-2", "label": "High", "slaHours": 4, "color": "bg-amber-500" },
       { "id": "WO-P-3", "label": "Normal", "slaHours": 24, "color": "bg-blue-500" },
       { "id": "WO-P-4", "label": "Low", "slaHours": 72, "color": "bg-slate-500" }
     ],
     "categories": [
       { "id": "WO-C-1", "label": "Electrical", "defaultAssignee": "Electrician" },
       { "id": "WO-C-2", "label": "Plumbing", "defaultAssignee": "Plumber" },
       { "id": "WO-C-3", "label": "HVAC", "defaultAssignee": "HVAC Technician" },
       { "id": "WO-C-4", "label": "General", "defaultAssignee": "Maintenance Team" }
     ]
   }'::jsonb),
  ('eng-cfg-18762279-preventive_maintenance',
   '18762279-a389-41c9-9169-7ebc682e9703',
   'preventive_maintenance',
   '{
     "auto-schedule": true,
     "pm-advance-days": 7,
     "pm-frequency": "Monthly",
     "require-checklist": true,
     "pm-reminder": true,
     "frequencies": [
       { "id": "PM-F-1", "label": "Daily", "intervalDays": 1 },
       { "id": "PM-F-2", "label": "Weekly", "intervalDays": 7 },
       { "id": "PM-F-3", "label": "Monthly", "intervalDays": 30 },
       { "id": "PM-F-4", "label": "Quarterly", "intervalDays": 90 },
       { "id": "PM-F-5", "label": "Semi-Annual", "intervalDays": 180 },
       { "id": "PM-F-6", "label": "Annual", "intervalDays": 365 }
     ],
     "checklistTemplates": [
       { "id": "PM-CT-1", "label": "HVAC Filter Check", "items": 5 },
       { "id": "PM-CT-2", "label": "Generator Test", "items": 8 },
       { "id": "PM-CT-3", "label": "Elevator Inspection", "items": 12 },
       { "id": "PM-CT-4", "label": "Boiler Maintenance", "items": 6 }
     ]
   }'::jsonb),
  ('eng-cfg-18762279-alerts',
   '18762279-a389-41c9-9169-7ebc682e9703',
   'alerts',
   '{
     "email-alerts": true,
     "sms-alerts": false,
     "critical-threshold": 1,
     "alert-recipients": "engineering@seleda.et",
     "downtime-alert": true,
     "alertTypes": [
       { "id": "AL-1", "label": "Equipment Down", "priority": "Critical", "channel": "Email + SMS" },
       { "id": "AL-2", "label": "Temperature Threshold", "priority": "High", "channel": "Email" },
       { "id": "AL-3", "label": "PM Overdue", "priority": "High", "channel": "Email" },
       { "id": "AL-4", "label": "Inspection Due", "priority": "Normal", "channel": "Email" },
       { "id": "AL-5", "label": "Inventory Low", "priority": "Normal", "channel": "Email" }
     ]
   }'::jsonb),
  ('eng-cfg-18762279-safety',
   '18762279-a389-41c9-9169-7ebc682e9703',
   'safety',
   '{
     "safety-checklist": true,
     "ppe-req": true,
     "incident-reporting": true,
     "compliance-alerts": true,
     "inspection-frequency": "Monthly",
     "inspectionTypes": [
       { "id": "SI-1", "label": "Fire Safety", "frequency": "Monthly", "authority": "Safety Officer" },
       { "id": "SI-2", "label": "Electrical Safety", "frequency": "Quarterly", "authority": "Senior Electrician" },
       { "id": "SI-3", "label": "Elevator Certification", "frequency": "Annual", "authority": "External Inspector" },
       { "id": "SI-4", "label": "Boiler Inspection", "frequency": "Annual", "authority": "External Inspector" },
       { "id": "SI-5", "label": "Emergency Exit Check", "frequency": "Monthly", "authority": "Safety Officer" }
     ],
     "ppeItems": [
       { "id": "PPE-1", "label": "Hard Hat", "required": true },
       { "id": "PPE-2", "label": "Safety Gloves", "required": true },
       { "id": "PPE-3", "label": "Safety Goggles", "required": true },
       { "id": "PPE-4", "label": "Steel-toe Boots", "required": true },
       { "id": "PPE-5", "label": "High-visibility Vest", "required": false }
     ]
   }'::jsonb)
ON CONFLICT (id) DO NOTHING;
