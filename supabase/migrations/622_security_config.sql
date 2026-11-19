-- ============================================================================
-- 622_security_config.sql — Security Configuration
-- Backs the /erp/security/configuration tab (SecurityConfiguration.tsx).
-- Mimics the HK hk_config / Engineering eng_config pattern: a JSON-blob
-- config row per (property_id, section). The component merges these with
-- client-side defaults; Save upserts the whole section blob.
--
-- Sections: zones | patrols | incidents | access
--   zones     — security zones/posts (label, area, riskLevel)
--   patrols   — patrol route templates (label, zone, checkpoints, duration)
--   incidents — incident categories (label, defaultPriority, slaMinutes)
--   access    — access roles/badge levels (label, level, zones)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.sec_config (
  id          TEXT PRIMARY KEY,
  property_id UUID NOT NULL,
  section     TEXT NOT NULL CHECK (section IN ('zones','patrols','incidents','access')),
  data        JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_sec_config_property_section
  ON public.sec_config(property_id, section);

CREATE OR REPLACE FUNCTION sec_config_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sec_config_updated_at ON public.sec_config;
CREATE TRIGGER trg_sec_config_updated_at
  BEFORE UPDATE ON public.sec_config
  FOR EACH ROW EXECUTE FUNCTION sec_config_set_updated_at();

ALTER TABLE public.sec_config ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sec_config TO authenticated;

-- ── Seed defaults for the demo property ─────────────────────────────────
INSERT INTO public.sec_config (id, property_id, section, data) VALUES
(
  'sec-cfg-18762279-zones',
  '18762279-a389-41c9-9169-7ebc682e9703',
  'zones',
  '{
    "patrol-required": true,
    "default-check-frequency": "60 min",
    "zone-alert-enabled": true,
    "visitor-escort-required": true,
    "zones": [
      {"id":"ZN-01","label":"Front Gate","area":"Exterior","riskLevel":"High","notes":"ID checks + vehicle screening"},
      {"id":"ZN-02","label":"Lobby","area":"Ground Floor","riskLevel":"Medium","notes":"Public access, VIP escort point"},
      {"id":"ZN-03","label":"Guest Floors","area":"Floors 2–12","riskLevel":"Medium","notes":"Hourly sweeps"},
      {"id":"ZN-04","label":"Perimeter","area":"Exterior","riskLevel":"High","notes":"Fence line + parking"},
      {"id":"ZN-05","label":"Control Room","area":"Basement B1","riskLevel":"Critical","notes":"CCTV + access control hub"},
      {"id":"ZN-06","label":"Pool Deck","area":"Level 3","riskLevel":"Medium","notes":"Lifeguard overlap zone"},
      {"id":"ZN-07","label":"Parking Garage","area":"Basement B1–B2","riskLevel":"High","notes":"Vehicle patrol circuit"}
    ]
  }'::jsonb
),
(
  'sec-cfg-18762279-patrols',
  '18762279-a389-41c9-9169-7ebc682e9703',
  'patrols',
  '{
    "auto-generate": true,
    "default-interval": 60,
    "require-checkpoints": true,
    "missed-patrol-alert": true,
    "routes": [
      {"id":"RT-01","label":"Perimeter Sweep","zone":"Perimeter","checkpoints":8,"duration":45},
      {"id":"RT-02","label":"Lobby & Public Areas","zone":"Lobby","checkpoints":6,"duration":30},
      {"id":"RT-03","label":"Guest Floor Patrol","zone":"Guest Floors","checkpoints":12,"duration":50},
      {"id":"RT-04","label":"Parking Circuit","zone":"Parking Garage","checkpoints":6,"duration":35}
    ]
  }'::jsonb
),
(
  'sec-cfg-18762279-incidents',
  '18762279-a389-41c9-9169-7ebc682e9703',
  'incidents',
  '{
    "auto-escalate-critical": true,
    "default-priority": "Medium",
    "response-sla-minutes": 15,
    "require-photos": true,
    "notify-manager": true,
    "categories": [
      {"id":"IC-01","label":"Theft","defaultPriority":"High","slaMinutes":10},
      {"id":"IC-02","label":"Assault","defaultPriority":"Critical","slaMinutes":5},
      {"id":"IC-03","label":"Trespassing","defaultPriority":"Medium","slaMinutes":15},
      {"id":"IC-04","label":"Vandalism","defaultPriority":"Medium","slaMinutes":20},
      {"id":"IC-05","label":"Medical Emergency","defaultPriority":"Critical","slaMinutes":3},
      {"id":"IC-06","label":"Fire","defaultPriority":"Critical","slaMinutes":2},
      {"id":"IC-07","label":"Suspicious Activity","defaultPriority":"Medium","slaMinutes":15},
      {"id":"IC-08","label":"Guest Disturbance","defaultPriority":"Low","slaMinutes":30}
    ]
  }'::jsonb
),
(
  'sec-cfg-18762279-access',
  '18762279-a389-41c9-9169-7ebc682e9703',
  'access',
  '{
    "badge-expiry-days": 365,
    "tailgating-alerts": true,
    "auto-lockdown": false,
    "visitor-pre-approval": true,
    "roles": [
      {"id":"AR-01","label":"Guest Access","level":"Level 1 — Public","zones":"Lobby, Restaurants, Pool"},
      {"id":"AR-02","label":"Staff Access","level":"Level 2 — Staff","zones":"Back of House, Staff Areas"},
      {"id":"AR-03","label":"Contractor","level":"Level 2 — Staff","zones":"Assigned work areas only"},
      {"id":"AR-04","label":"Security Personnel","level":"Level 3 — Restricted","zones":"All zones except vaults"},
      {"id":"AR-05","label":"Management","level":"Level 3 — Restricted","zones":"All zones"},
      {"id":"AR-06","label":"Vault & Server Rooms","level":"Level 4 — Secure","zones":"Control Room, Vault, Server Room"}
    ]
  }'::jsonb
)
ON CONFLICT (id) DO NOTHING;
