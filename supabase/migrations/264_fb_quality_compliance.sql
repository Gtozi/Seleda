-- Migration: F&B Quality & Compliance
-- Backs the /erp/fb/quality-compliance screen. Owns temperature logs, HACCP checks,
-- allergen controls, expiry tracking, service standards, cleaning checklists, and
-- compliance audits. References outlets(id) and employees(id).

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ── fb_temperature_logs ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS fb_temperature_logs (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  outlet_id TEXT,
  location TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('fridge','freezer','hot-holding','ambient')),
  temperature NUMERIC(5,2) NOT NULL,
  target_min NUMERIC(5,2) NOT NULL,
  target_max NUMERIC(5,2) NOT NULL,
  status TEXT NOT NULL DEFAULT 'safe' CHECK (status IN ('safe','warning','critical')),
  logged_by TEXT,
  logged_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  property_id UUID
);
ALTER TABLE fb_temperature_logs ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_fb_temperature_logs_outlet ON fb_temperature_logs(outlet_id);
CREATE INDEX IF NOT EXISTS idx_fb_temperature_logs_logged_at ON fb_temperature_logs(logged_at);

-- ── fb_haccp_checks ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS fb_haccp_checks (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  outlet_id TEXT,
  checkpoint TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('receiving','storage','preparation','cooking','cooling','serving')),
  status TEXT NOT NULL DEFAULT 'pass' CHECK (status IN ('pass','fail','corrected')),
  notes TEXT,
  checked_by TEXT,
  checked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  property_id UUID
);
ALTER TABLE fb_haccp_checks ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_fb_haccp_checks_outlet ON fb_haccp_checks(outlet_id);
CREATE INDEX IF NOT EXISTS idx_fb_haccp_checks_checked_at ON fb_haccp_checks(checked_at);

-- ── fb_allergen_controls ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS fb_allergen_controls (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  outlet_id TEXT,
  item TEXT NOT NULL,
  allergen TEXT NOT NULL,
  control_measure TEXT,
  last_verified DATE,
  status TEXT NOT NULL DEFAULT 'verified' CHECK (status IN ('verified','needs-review','non-compliant')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  property_id UUID
);
ALTER TABLE fb_allergen_controls ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_fb_allergen_controls_outlet ON fb_allergen_controls(outlet_id);

-- ── fb_expiry_items ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS fb_expiry_items (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  outlet_id TEXT,
  item TEXT NOT NULL,
  batch TEXT,
  expiry_date DATE NOT NULL,
  quantity NUMERIC(10,2) NOT NULL DEFAULT 0,
  unit TEXT NOT NULL DEFAULT 'kg',
  status TEXT NOT NULL DEFAULT 'safe' CHECK (status IN ('safe','expiring-soon','expired')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  property_id UUID
);
ALTER TABLE fb_expiry_items ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_fb_expiry_items_outlet ON fb_expiry_items(outlet_id);
CREATE INDEX IF NOT EXISTS idx_fb_expiry_items_expiry_date ON fb_expiry_items(expiry_date);

-- ── fb_quality_service_standards ──────────────────────────────────
-- (Named fb_quality_service_standards to avoid collision with the existing
--  fb_service_standards table from migration 130_staff_management.sql.)
CREATE TABLE IF NOT EXISTS fb_quality_service_standards (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  outlet_id TEXT,
  standard TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('grooming','presentation','greeting','upselling','plate-presentation')),
  score INTEGER NOT NULL DEFAULT 0,
  max_score INTEGER NOT NULL DEFAULT 100,
  last_audited DATE,
  auditor TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  property_id UUID
);
ALTER TABLE fb_quality_service_standards ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_fb_quality_service_standards_outlet ON fb_quality_service_standards(outlet_id);

-- ── fb_cleaning_checklists ────────────────────────────────────────
-- checklist_type distinguishes cleaning vs opening/closing/safety/equipment/etc.
CREATE TABLE IF NOT EXISTS fb_cleaning_checklists (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  outlet_id TEXT,
  area TEXT NOT NULL,
  task TEXT NOT NULL,
  checklist_type TEXT NOT NULL DEFAULT 'cleaning' CHECK (checklist_type IN ('cleaning','opening','closing','daily-ops','safety','equipment','other')),
  frequency TEXT NOT NULL DEFAULT 'daily' CHECK (frequency IN ('hourly','daily','weekly','monthly')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','in-progress','completed','overdue')),
  assigned_to TEXT,
  due_date TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  property_id UUID
);
ALTER TABLE fb_cleaning_checklists ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_fb_cleaning_checklists_outlet ON fb_cleaning_checklists(outlet_id);
CREATE INDEX IF NOT EXISTS idx_fb_cleaning_checklists_status ON fb_cleaning_checklists(status);
CREATE INDEX IF NOT EXISTS idx_fb_cleaning_checklists_type ON fb_cleaning_checklists(checklist_type);

-- ── fb_compliance_audits ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS fb_compliance_audits (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  outlet_id TEXT,
  title TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'internal' CHECK (type IN ('internal','external','health-inspection','self-assessment')),
  status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','in-progress','completed','failed')),
  score INTEGER,
  max_score INTEGER DEFAULT 100,
  auditor TEXT,
  audit_date DATE,
  findings TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  property_id UUID
);
ALTER TABLE fb_compliance_audits ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_fb_compliance_audits_outlet ON fb_compliance_audits(outlet_id);
CREATE INDEX IF NOT EXISTS idx_fb_compliance_audits_status ON fb_compliance_audits(status);

-- ── Foreign keys to outlets(id) ───────────────────────────────────
ALTER TABLE fb_temperature_logs ADD CONSTRAINT fb_temperature_logs_outlet_id_fkey
  FOREIGN KEY (outlet_id) REFERENCES outlets(id) ON DELETE SET NULL;
ALTER TABLE fb_haccp_checks ADD CONSTRAINT fb_haccp_checks_outlet_id_fkey
  FOREIGN KEY (outlet_id) REFERENCES outlets(id) ON DELETE SET NULL;
ALTER TABLE fb_allergen_controls ADD CONSTRAINT fb_allergen_controls_outlet_id_fkey
  FOREIGN KEY (outlet_id) REFERENCES outlets(id) ON DELETE SET NULL;
ALTER TABLE fb_expiry_items ADD CONSTRAINT fb_expiry_items_outlet_id_fkey
  FOREIGN KEY (outlet_id) REFERENCES outlets(id) ON DELETE SET NULL;
ALTER TABLE fb_quality_service_standards ADD CONSTRAINT fb_quality_service_standards_outlet_id_fkey
  FOREIGN KEY (outlet_id) REFERENCES outlets(id) ON DELETE SET NULL;
ALTER TABLE fb_cleaning_checklists ADD CONSTRAINT fb_cleaning_checklists_outlet_id_fkey
  FOREIGN KEY (outlet_id) REFERENCES outlets(id) ON DELETE SET NULL;
ALTER TABLE fb_compliance_audits ADD CONSTRAINT fb_compliance_audits_outlet_id_fkey
  FOREIGN KEY (outlet_id) REFERENCES outlets(id) ON DELETE SET NULL;

-- ── Permission ────────────────────────────────────────────────────
INSERT INTO permissions (id, code, module, description)
SELECT 'perm_fb_compliance_manage', 'fb:compliance:manage', 'fnb',
       'Manage F&B quality & compliance (temperature, HACCP, allergens, expiry, service standards, cleaning, audits)'
WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE code = 'fb:compliance:manage');

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.code = 'fb:compliance:manage'
WHERE r.name IN ('admin','super_admin','executive','general_manager','owner','fb_manager')
  AND NOT EXISTS (SELECT 1 FROM role_permissions rp WHERE rp.role_id = r.id AND rp.permission_id = p.id);

-- ── Seed: Temperature logs ────────────────────────────────────────
-- Outlet map: Main Restaurant=8f7a343f..., Bar(Sky Lounge)=907e8a05..., Room Service=4a3f6574...
INSERT INTO fb_temperature_logs (id, outlet_id, location, type, temperature, target_min, target_max, status, logged_by, logged_at)
SELECT * FROM (VALUES
  ('TL-001','8f7a343f-1dc2-47a1-b7b5-a133c47a9a7f','Walk-in Fridge 1','fridge',3.5,1,4,'safe','Chef Marco','2026-08-18 08:00'::timestamptz),
  ('TL-002','8f7a343f-1dc2-47a1-b7b5-a133c47a9a7f','Freezer A','freezer',-18,-20,-15,'safe','Chef Marco','2026-08-18 08:00'::timestamptz),
  ('TL-003','8f7a343f-1dc2-47a1-b7b5-a133c47a9a7f','Hot Holding Unit','hot-holding',65,63,70,'safe','Sara','2026-08-18 12:00'::timestamptz),
  ('TL-004','907e8a05-57f7-4159-81d3-ad53a1745fa3','Walk-in Fridge','fridge',5.5,1,4,'warning','Ana','2026-08-18 09:00'::timestamptz),
  ('TL-005','4a3f6574-bde9-47e4-bf8d-1b0c64ca6841','Ambient Storage','ambient',22,18,25,'safe','Pedro','2026-08-18 07:00'::timestamptz)
) AS v(id, outlet_id, location, type, temperature, target_min, target_max, status, logged_by, logged_at)
WHERE NOT EXISTS (SELECT 1 FROM fb_temperature_logs t WHERE t.id = v.id);

-- ── Seed: HACCP checks ────────────────────────────────────────────
INSERT INTO fb_haccp_checks (id, outlet_id, checkpoint, category, status, notes, checked_by, checked_at)
SELECT * FROM (VALUES
  ('HC-001','8f7a343f-1dc2-47a1-b7b5-a133c47a9a7f','Receiving temperature check','receiving','pass','All deliveries at correct temperature','Chef Marco','2026-08-18 08:30'::timestamptz),
  ('HC-002','8f7a343f-1dc2-47a1-b7b5-a133c47a9a7f','Cold storage verification','storage','pass','Fridge and freezer temps within range','Chef Marco','2026-08-18 08:30'::timestamptz),
  ('HC-003','8f7a343f-1dc2-47a1-b7b5-a133c47a9a7f','Cooking temperature verification','cooking','corrected','One item below 75C, reheated to target','Sara','2026-08-18 12:30'::timestamptz),
  ('HC-004','907e8a05-57f7-4159-81d3-ad53a1745fa3','Glassware sanitization','serving','pass','Sanitizer concentration correct','Ana','2026-08-18 09:00'::timestamptz),
  ('HC-005','4a3f6574-bde9-47e4-bf8d-1b0c64ca6841','Hot holding verification','serving','pass','All items at safe temperature','Pedro','2026-08-18 10:00'::timestamptz)
) AS v(id, outlet_id, checkpoint, category, status, notes, checked_by, checked_at)
WHERE NOT EXISTS (SELECT 1 FROM fb_haccp_checks h WHERE h.id = v.id);

-- ── Seed: Allergen controls ───────────────────────────────────────
INSERT INTO fb_allergen_controls (id, outlet_id, item, allergen, control_measure, last_verified, status)
SELECT * FROM (VALUES
  ('AL-001','8f7a343f-1dc2-47a1-b7b5-a133c47a9a7f','Grilled Salmon','Fish','Dedicated prep area, separate utensils','2026-08-18'::date,'verified'),
  ('AL-002','8f7a343f-1dc2-47a1-b7b5-a133c47a9a7f','Caesar Salad','Eggs, Fish','Anchovy-free option available, labeled menu','2026-08-17'::date,'verified'),
  ('AL-003','907e8a05-57f7-4159-81d3-ad53a1745fa3','Old Fashioned','None','Standard cocktail, no allergens','2026-08-18'::date,'verified'),
  ('AL-004','8f7a343f-1dc2-47a1-b7b5-a133c47a9a7f','Pasta Carbonara','Gluten, Eggs, Dairy','Gluten-free pasta available, labeled menu','2026-08-16'::date,'needs-review')
) AS v(id, outlet_id, item, allergen, control_measure, last_verified, status)
WHERE NOT EXISTS (SELECT 1 FROM fb_allergen_controls a WHERE a.id = v.id);

-- ── Seed: Expiry items ────────────────────────────────────────────
INSERT INTO fb_expiry_items (id, outlet_id, item, batch, expiry_date, quantity, unit, status)
SELECT * FROM (VALUES
  ('EX-001','8f7a343f-1dc2-47a1-b7b5-a133c47a9a7f','Fresh Salmon','BATCH-2026-0818','2026-08-19'::date,5,'kg','expiring-soon'),
  ('EX-002','8f7a343f-1dc2-47a1-b7b5-a133c47a9a7f','Heavy Cream','BATCH-2026-0816','2026-08-20'::date,2,'L','expiring-soon'),
  ('EX-003','907e8a05-57f7-4159-81d3-ad53a1745fa3','Open Wine','BATCH-2026-0814','2026-08-17'::date,1,'bottle','expired'),
  ('EX-004','8f7a343f-1dc2-47a1-b7b5-a133c47a9a7f','Fresh Herbs','BATCH-2026-0817','2026-08-21'::date,0.5,'kg','expiring-soon')
) AS v(id, outlet_id, item, batch, expiry_date, quantity, unit, status)
WHERE NOT EXISTS (SELECT 1 FROM fb_expiry_items e WHERE e.id = v.id);

-- ── Seed: Quality service standards ──────────────────────────────
INSERT INTO fb_quality_service_standards (id, outlet_id, standard, category, score, max_score, last_audited, auditor)
SELECT * FROM (VALUES
  ('SS-001','8f7a343f-1dc2-47a1-b7b5-a133c47a9a7f','Staff Grooming & Uniform','grooming',95,100,'2026-08-18'::date,'Manager James'),
  ('SS-002','8f7a343f-1dc2-47a1-b7b5-a133c47a9a7f','Table Presentation','presentation',92,100,'2026-08-18'::date,'Manager James'),
  ('SS-003','907e8a05-57f7-4159-81d3-ad53a1745fa3','Cocktail Presentation','presentation',98,100,'2026-08-17'::date,'Manager Ana'),
  ('SS-004','8f7a343f-1dc2-47a1-b7b5-a133c47a9a7f','Guest Greeting Protocol','greeting',88,100,'2026-08-16'::date,'Manager James'),
  ('SS-005','4a3f6574-bde9-47e4-bf8d-1b0c64ca6841','Delivery Time Standard','upselling',85,100,'2026-08-18'::date,'Manager Pedro')
) AS v(id, outlet_id, standard, category, score, max_score, last_audited, auditor)
WHERE NOT EXISTS (SELECT 1 FROM fb_quality_service_standards s WHERE s.id = v.id);

-- ── Seed: Cleaning checklists ─────────────────────────────────────
INSERT INTO fb_cleaning_checklists (id, outlet_id, area, task, checklist_type, frequency, status, assigned_to, due_date, completed_at)
SELECT * FROM (VALUES
  ('CL-001','8f7a343f-1dc2-47a1-b7b5-a133c47a9a7f','Kitchen Floor','Deep clean and sanitize','cleaning','daily','completed','Pedro','2026-08-18 06:00'::timestamptz,'2026-08-18 05:45'::timestamptz),
  ('CL-002','8f7a343f-1dc2-47a1-b7b5-a133c47a9a7f','Prep Stations','Sanitize work surfaces','cleaning','hourly','in-progress','Sara','2026-08-18 13:00'::timestamptz,NULL),
  ('CL-003','907e8a05-57f7-4159-81d3-ad53a1745fa3','Glasswasher','Clean and descale','cleaning','daily','completed','Ana','2026-08-18 07:00'::timestamptz,'2026-08-18 06:30'::timestamptz),
  ('CL-004','8f7a343f-1dc2-47a1-b7b5-a133c47a9a7f','Walk-in Fridge','Deep clean and organize','cleaning','weekly','pending','Luca','2026-08-22'::timestamptz,NULL),
  ('CL-005','4a3f6574-bde9-47e4-bf8d-1b0c64ca6841','Service Cart','Sanitize and restock','cleaning','daily','overdue','Pedro','2026-08-18 08:00'::timestamptz,NULL),
  ('CL-006','8f7a343f-1dc2-47a1-b7b5-a133c47a9a7f','Kitchen','Equipment inspection and startup','opening','daily','completed','Chef Marco','2026-08-18 06:00'::timestamptz,'2026-08-18 05:50'::timestamptz),
  ('CL-007','8f7a343f-1dc2-47a1-b7b5-a133c47a9a7f','Front of House','Dining area setup and station prep','opening','daily','completed','Sara','2026-08-18 06:30'::timestamptz,'2026-08-18 06:15'::timestamptz),
  ('CL-008','8f7a343f-1dc2-47a1-b7b5-a133c47a9a7f','Kitchen','Equipment shutdown and cleaning','closing','daily','pending','Luca','2026-08-18 22:00'::timestamptz,NULL),
  ('CL-009','8f7a343f-1dc2-47a1-b7b5-a133c47a9a7f','Front of House','Waste disposal and area reset','closing','daily','pending','Pedro','2026-08-18 22:30'::timestamptz,NULL),
  ('CL-010','907e8a05-57f7-4159-81d3-ad53a1745fa3','Bar','Fire extinguisher check','safety','weekly','completed','Ana','2026-08-18 07:00'::timestamptz,'2026-08-18 06:45'::timestamptz),
  ('CL-011','8f7a343f-1dc2-47a1-b7b5-a133c47a9a7f','Kitchen','Refrigeration unit inspection','equipment','weekly','pending','Chef Marco','2026-08-22 08:00'::timestamptz,NULL)
) AS v(id, outlet_id, area, task, checklist_type, frequency, status, assigned_to, due_date, completed_at)
WHERE NOT EXISTS (SELECT 1 FROM fb_cleaning_checklists c WHERE c.id = v.id);

-- ── Seed: Compliance audits ───────────────────────────────────────
INSERT INTO fb_compliance_audits (id, outlet_id, title, type, status, score, max_score, auditor, audit_date, findings)
SELECT * FROM (VALUES
  ('AU-001','8f7a343f-1dc2-47a1-b7b5-a133c47a9a7f','Monthly Kitchen Inspection','internal','completed',94,100,'Manager James','2026-08-15'::date,'Minor: re-label prepped items. Overall excellent hygiene.'),
  ('AU-002','907e8a05-57f7-4159-81d3-ad53a1745fa3','Bar Sanitation Audit','internal','completed',91,100,'Manager Ana','2026-08-14'::date,'Ice machine needs deep clean. Glassware standards met.'),
  ('AU-003','4a3f6574-bde9-47e4-bf8d-1b0c64ca6841','Room Service Compliance','self-assessment','in-progress',NULL,100,'Manager Pedro','2026-08-20'::date,NULL),
  ('AU-004','8f7a343f-1dc2-47a1-b7b5-a133c47a9a7f','Health Department Inspection','health-inspection','scheduled',NULL,100,'Health Dept.','2026-08-25'::date,NULL),
  ('AU-005','8f7a343f-1dc2-47a1-b7b5-a133c47a9a7f','HACCP Annual Review','external','scheduled',NULL,100,'External Auditor','2026-09-01'::date,NULL)
) AS v(id, outlet_id, title, type, status, score, max_score, auditor, audit_date, findings)
WHERE NOT EXISTS (SELECT 1 FROM fb_compliance_audits a WHERE a.id = v.id);
