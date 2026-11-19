-- Migration: F&B Financial Control
-- Backs the /erp/fb/financial-control screen. Owns operational financial
-- tracking for F&B: revenue, COGS (with variance), labor cost, discounts/comps/
-- voids, waste, batch production costs, journal entries, and POS reconciliation.
-- Finance remains the system of record for accounting; these tables capture
-- operational financial data for analysis and reconciliation.
-- References outlets(id).

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Outlet map (for seed data):
--   Main Restaurant (MAIN) = 8f7a343f-1dc2-47a1-b7b5-a133c47a9a7f
--   Sky Lounge Bar        = 907e8a05-57f7-4159-81d3-ad53a1745fa3
--   Room Service          = 4a3f6574-bde9-47e4-bf8d-1b0c64ca6841
--   La Maison Restaurant  = 8ad72723-fb18-43b2-9333-6cc6f709f749
--   Grand Ballroom Banquet= fb9937b9-1139-4dcc-b3d0-c26dd25a1f3b
--   Minibar               = d99e976c-0edf-4151-8db3-5547e6cab2b5

-- ── fb_revenue_records ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS fb_revenue_records (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  outlet_id TEXT,
  record_date DATE NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('food','beverage','other')),
  gross_revenue NUMERIC(18,2) NOT NULL DEFAULT 0,
  tax NUMERIC(18,2) NOT NULL DEFAULT 0,
  net_revenue NUMERIC(18,2) NOT NULL DEFAULT 0,
  covers INTEGER NOT NULL DEFAULT 0,
  avg_check NUMERIC(18,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  property_id UUID
);
ALTER TABLE fb_revenue_records ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_fb_revenue_records_outlet ON fb_revenue_records(outlet_id);
CREATE INDEX IF NOT EXISTS idx_fb_revenue_records_date ON fb_revenue_records(record_date);

-- ── fb_cogs_records ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS fb_cogs_records (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  outlet_id TEXT,
  record_date DATE NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('food','beverage')),
  actual_cost NUMERIC(18,2) NOT NULL DEFAULT 0,
  theoretical_cost NUMERIC(18,2) NOT NULL DEFAULT 0,
  variance NUMERIC(18,2) NOT NULL DEFAULT 0,
  variance_percent NUMERIC(8,2) NOT NULL DEFAULT 0,
  cost_percentage NUMERIC(8,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  property_id UUID
);
ALTER TABLE fb_cogs_records ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_fb_cogs_records_outlet ON fb_cogs_records(outlet_id);
CREATE INDEX IF NOT EXISTS idx_fb_cogs_records_date ON fb_cogs_records(record_date);

-- ── fb_labor_records ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS fb_labor_records (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  outlet_id TEXT,
  record_date DATE NOT NULL,
  regular_hours NUMERIC(8,2) NOT NULL DEFAULT 0,
  overtime_hours NUMERIC(8,2) NOT NULL DEFAULT 0,
  total_hours NUMERIC(8,2) NOT NULL DEFAULT 0,
  labor_cost NUMERIC(18,2) NOT NULL DEFAULT 0,
  revenue NUMERIC(18,2) NOT NULL DEFAULT 0,
  labor_percent NUMERIC(8,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  property_id UUID
);
ALTER TABLE fb_labor_records ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_fb_labor_records_outlet ON fb_labor_records(outlet_id);
CREATE INDEX IF NOT EXISTS idx_fb_labor_records_date ON fb_labor_records(record_date);

-- ── fb_discount_records ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS fb_discount_records (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  outlet_id TEXT,
  record_date DATE NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('discount','comp','void')),
  reason TEXT NOT NULL,
  amount NUMERIC(18,2) NOT NULL DEFAULT 0,
  approved_by TEXT,
  reference TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  property_id UUID
);
ALTER TABLE fb_discount_records ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_fb_discount_records_outlet ON fb_discount_records(outlet_id);
CREATE INDEX IF NOT EXISTS idx_fb_discount_records_date ON fb_discount_records(record_date);

-- ── fb_waste_records ───────────────────────────────────────────────
-- Operational waste tracking for the F&B Financial Control view (distinct
-- from inventory wastage_logs; this captures the financial-control perspective
-- with item/outlet/type/reason/cost).
CREATE TABLE IF NOT EXISTS fb_waste_records (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  outlet_id TEXT,
  record_date DATE NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('preparation','spoilage','expired','overproduction','plate-waste','breakage')),
  item TEXT NOT NULL,
  quantity NUMERIC(10,2) NOT NULL DEFAULT 0,
  unit TEXT NOT NULL DEFAULT 'kg',
  cost NUMERIC(18,2) NOT NULL DEFAULT 0,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  property_id UUID
);
ALTER TABLE fb_waste_records ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_fb_waste_records_outlet ON fb_waste_records(outlet_id);
CREATE INDEX IF NOT EXISTS idx_fb_waste_records_date ON fb_waste_records(record_date);

-- ── fb_production_batches ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS fb_production_batches (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  outlet_id TEXT,
  batch_date DATE NOT NULL,
  batch_number TEXT NOT NULL,
  product TEXT NOT NULL,
  quantity NUMERIC(10,2) NOT NULL DEFAULT 0,
  unit TEXT NOT NULL DEFAULT 'kg',
  raw_cost NUMERIC(18,2) NOT NULL DEFAULT 0,
  labor_cost NUMERIC(18,2) NOT NULL DEFAULT 0,
  overhead_cost NUMERIC(18,2) NOT NULL DEFAULT 0,
  total_cost NUMERIC(18,2) NOT NULL DEFAULT 0,
  unit_cost NUMERIC(18,2) NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','completed','transferred')),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  property_id UUID
);
ALTER TABLE fb_production_batches ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_fb_production_batches_outlet ON fb_production_batches(outlet_id);
CREATE INDEX IF NOT EXISTS idx_fb_production_batches_date ON fb_production_batches(batch_date);
CREATE INDEX IF NOT EXISTS idx_fb_production_batches_status ON fb_production_batches(status);

-- ── fb_journal_entries ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS fb_journal_entries (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  outlet_id TEXT,
  entry_date DATE NOT NULL,
  reference TEXT NOT NULL,
  description TEXT NOT NULL,
  debit_account TEXT NOT NULL,
  credit_account TEXT NOT NULL,
  amount NUMERIC(18,2) NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','posted','reversed')),
  posted_by TEXT,
  posted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  property_id UUID
);
ALTER TABLE fb_journal_entries ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_fb_journal_entries_outlet ON fb_journal_entries(outlet_id);
CREATE INDEX IF NOT EXISTS idx_fb_journal_entries_date ON fb_journal_entries(entry_date);
CREATE INDEX IF NOT EXISTS idx_fb_journal_entries_status ON fb_journal_entries(status);

-- ── fb_reconciliation_records ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS fb_reconciliation_records (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  outlet_id TEXT,
  reconciliation_date DATE NOT NULL,
  pos_total NUMERIC(18,2) NOT NULL DEFAULT 0,
  financial_total NUMERIC(18,2) NOT NULL DEFAULT 0,
  variance NUMERIC(18,2) NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','matched','variance','investigating')),
  reconciled_by TEXT,
  reconciled_at TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  property_id UUID
);
ALTER TABLE fb_reconciliation_records ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_fb_reconciliation_records_outlet ON fb_reconciliation_records(outlet_id);
CREATE INDEX IF NOT EXISTS idx_fb_reconciliation_records_date ON fb_reconciliation_records(reconciliation_date);
CREATE INDEX IF NOT EXISTS idx_fb_reconciliation_records_status ON fb_reconciliation_records(status);

-- ── Foreign keys to outlets(id) ────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fb_revenue_records_outlet_id_fkey') THEN
    ALTER TABLE fb_revenue_records ADD CONSTRAINT fb_revenue_records_outlet_id_fkey
      FOREIGN KEY (outlet_id) REFERENCES outlets(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fb_cogs_records_outlet_id_fkey') THEN
    ALTER TABLE fb_cogs_records ADD CONSTRAINT fb_cogs_records_outlet_id_fkey
      FOREIGN KEY (outlet_id) REFERENCES outlets(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fb_labor_records_outlet_id_fkey') THEN
    ALTER TABLE fb_labor_records ADD CONSTRAINT fb_labor_records_outlet_id_fkey
      FOREIGN KEY (outlet_id) REFERENCES outlets(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fb_discount_records_outlet_id_fkey') THEN
    ALTER TABLE fb_discount_records ADD CONSTRAINT fb_discount_records_outlet_id_fkey
      FOREIGN KEY (outlet_id) REFERENCES outlets(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fb_waste_records_outlet_id_fkey') THEN
    ALTER TABLE fb_waste_records ADD CONSTRAINT fb_waste_records_outlet_id_fkey
      FOREIGN KEY (outlet_id) REFERENCES outlets(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fb_production_batches_outlet_id_fkey') THEN
    ALTER TABLE fb_production_batches ADD CONSTRAINT fb_production_batches_outlet_id_fkey
      FOREIGN KEY (outlet_id) REFERENCES outlets(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fb_journal_entries_outlet_id_fkey') THEN
    ALTER TABLE fb_journal_entries ADD CONSTRAINT fb_journal_entries_outlet_id_fkey
      FOREIGN KEY (outlet_id) REFERENCES outlets(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fb_reconciliation_records_outlet_id_fkey') THEN
    ALTER TABLE fb_reconciliation_records ADD CONSTRAINT fb_reconciliation_records_outlet_id_fkey
      FOREIGN KEY (outlet_id) REFERENCES outlets(id) ON DELETE SET NULL;
  END IF;
END $$;

-- ── Permission ─────────────────────────────────────────────────────
INSERT INTO permissions (id, code, module, description)
SELECT 'perm_fb_financial_control_manage', 'fb:financial_control:manage', 'fnb',
       'Manage F&B financial control data (revenue, COGS, labor, discounts, waste, production, journal entries, reconciliation)'
WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE code = 'fb:financial_control:manage');

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.code = 'fb:financial_control:manage'
WHERE r.name IN ('admin','super_admin','executive','general_manager','owner','fb_manager','finance_controller','cfo')
  AND NOT EXISTS (SELECT 1 FROM role_permissions rp WHERE rp.role_id = r.id AND rp.permission_id = p.id);

-- ── Seed: Revenue records ──────────────────────────────────────────
INSERT INTO fb_revenue_records (id, outlet_id, record_date, category, gross_revenue, tax, net_revenue, covers, avg_check)
SELECT * FROM (VALUES
  ('REV-001','8f7a343f-1dc2-47a1-b7b5-a133c47a9a7f'::text,'2026-08-17'::date,'food'::text,8500.00,850.00,7650.00,120,63.75),
  ('REV-002','8f7a343f-1dc2-47a1-b7b5-a133c47a9a7f','2026-08-17','beverage',4000.00,400.00,3600.00,120,30.00),
  ('REV-003','907e8a05-57f7-4159-81d3-ad53a1745fa3','2026-08-17','beverage',3200.00,320.00,2880.00,80,36.00),
  ('REV-004','4a3f6574-bde9-47e4-bf8d-1b0c64ca6841','2026-08-17','food',1800.00,180.00,1620.00,25,64.80),
  ('REV-005','8ad72723-fb18-43b2-9333-6cc6f709f749','2026-08-17','food',6200.00,620.00,5580.00,90,62.00),
  ('REV-006','8ad72723-fb18-43b2-9333-6cc6f709f749','2026-08-17','beverage',2400.00,240.00,2160.00,90,24.00)
) AS t(id,outlet_id,record_date,category,gross_revenue,tax,net_revenue,covers,avg_check)
WHERE NOT EXISTS (SELECT 1 FROM fb_revenue_records WHERE id = t.id);

-- ── Seed: COGS records ─────────────────────────────────────────────
INSERT INTO fb_cogs_records (id, outlet_id, record_date, category, actual_cost, theoretical_cost, variance, variance_percent, cost_percentage)
SELECT * FROM (VALUES
  ('COGS-001','8f7a343f-1dc2-47a1-b7b5-a133c47a9a7f'::text,'2026-08-17'::date,'food'::text,2800.00,2600.00,200.00,7.69,36.60),
  ('COGS-002','8f7a343f-1dc2-47a1-b7b5-a133c47a9a7f','2026-08-17','beverage',1200.00,1100.00,100.00,9.09,33.30),
  ('COGS-003','907e8a05-57f7-4159-81d3-ad53a1745fa3','2026-08-17','beverage',960.00,880.00,80.00,9.09,33.30),
  ('COGS-004','4a3f6574-bde9-47e4-bf8d-1b0c64ca6841','2026-08-17','food',650.00,600.00,50.00,8.33,40.10),
  ('COGS-005','8ad72723-fb18-43b2-9333-6cc6f709f749','2026-08-17','food',2050.00,1980.00,70.00,3.54,37.10),
  ('COGS-006','8ad72723-fb18-43b2-9333-6cc6f709f749','2026-08-17','beverage',720.00,700.00,20.00,2.86,30.00)
) AS t(id,outlet_id,record_date,category,actual_cost,theoretical_cost,variance,variance_percent,cost_percentage)
WHERE NOT EXISTS (SELECT 1 FROM fb_cogs_records WHERE id = t.id);

-- ── Seed: Labor records ────────────────────────────────────────────
INSERT INTO fb_labor_records (id, outlet_id, record_date, regular_hours, overtime_hours, total_hours, labor_cost, revenue, labor_percent)
SELECT * FROM (VALUES
  ('LAB-001','8f7a343f-1dc2-47a1-b7b5-a133c47a9a7f'::text,'2026-08-17'::date,48.00,8.00,56.00,1680.00,12150.00,13.83),
  ('LAB-002','907e8a05-57f7-4159-81d3-ad53a1745fa3','2026-08-17',24.00,4.00,28.00,840.00,3200.00,26.25),
  ('LAB-003','4a3f6574-bde9-47e4-bf8d-1b0c64ca6841','2026-08-17',16.00,2.00,18.00,540.00,1800.00,30.00),
  ('LAB-004','8ad72723-fb18-43b2-9333-6cc6f709f749','2026-08-17',40.00,6.00,46.00,1380.00,8600.00,16.05)
) AS t(id,outlet_id,record_date,regular_hours,overtime_hours,total_hours,labor_cost,revenue,labor_percent)
WHERE NOT EXISTS (SELECT 1 FROM fb_labor_records WHERE id = t.id);

-- ── Seed: Discount records ─────────────────────────────────────────
INSERT INTO fb_discount_records (id, outlet_id, record_date, type, reason, amount, approved_by, reference)
SELECT * FROM (VALUES
  ('DISC-001','8f7a343f-1dc2-47a1-b7b5-a133c47a9a7f'::text,'2026-08-17'::date,'discount'::text,'Loyalty member'::text,150.00,'Manager James','LOY-001'),
  ('DISC-002','8f7a343f-1dc2-47a1-b7b5-a133c47a9a7f','2026-08-17','comp','Service recovery',85.00,'Manager James','COMP-001'),
  ('DISC-003','907e8a05-57f7-4159-81d3-ad53a1745fa3','2026-08-17','void','Customer dissatisfaction',45.00,'Manager Ana','VOID-001'),
  ('DISC-004','4a3f6574-bde9-47e4-bf8d-1b0c64ca6841','2026-08-17','discount','Promotional',60.00,'Manager Pedro','PROMO-001'),
  ('DISC-005','8ad72723-fb18-43b2-9333-6cc6f709f749','2026-08-17','discount','Corporate account',220.00,'Manager Sofia','CORP-014')
) AS t(id,outlet_id,record_date,type,reason,amount,approved_by,reference)
WHERE NOT EXISTS (SELECT 1 FROM fb_discount_records WHERE id = t.id);

-- ── Seed: Waste records ────────────────────────────────────────────
INSERT INTO fb_waste_records (id, outlet_id, record_date, type, item, quantity, unit, cost, reason)
SELECT * FROM (VALUES
  ('WASTE-001','8f7a343f-1dc2-47a1-b7b5-a133c47a9a7f'::text,'2026-08-17'::date,'preparation'::text,'Vegetable trimmings'::text,2.50,'kg'::text,15.00,'Standard prep waste'::text),
  ('WASTE-002','8f7a343f-1dc2-47a1-b7b5-a133c47a9a7f','2026-08-17','plate-waste','Returned food',1.20,'kg',35.00,'Customer not satisfied'),
  ('WASTE-003','907e8a05-57f7-4159-81d3-ad53a1745fa3','2026-08-17','breakage','Wine glasses',3.00,'pcs',45.00,'Accidental breakage'),
  ('WASTE-004','4a3f6574-bde9-47e4-bf8d-1b0c64ca6841','2026-08-17','spoilage','Fresh berries',0.50,'kg',25.00,'Expired'),
  ('WASTE-005','8ad72723-fb18-43b2-9333-6cc6f709f749','2026-08-17','overproduction','Soup of the day',4.00,'l',28.00,'Overestimated demand')
) AS t(id,outlet_id,record_date,type,item,quantity,unit,cost,reason)
WHERE NOT EXISTS (SELECT 1 FROM fb_waste_records WHERE id = t.id);

-- ── Seed: Production batches ───────────────────────────────────────
INSERT INTO fb_production_batches (id, outlet_id, batch_date, batch_number, product, quantity, unit, raw_cost, labor_cost, overhead_cost, total_cost, unit_cost, status, notes)
SELECT * FROM (VALUES
  ('PRD-001','8f7a343f-1dc2-47a1-b7b5-a133c47a9a7f'::text,'2026-08-17'::date,'BATCH-2026-001'::text,'Beef Stock Base'::text,20.00,'l'::text,180.00,60.00,20.00,260.00,13.00,'completed'::text,'Used for today''s service'::text),
  ('PRD-002','8f7a343f-1dc2-47a1-b7b5-a133c47a9a7f','2026-08-17','BATCH-2026-002','Tomato Sauce',15.00,'kg',120.00,45.00,15.00,180.00,12.00,'transferred','Transferred to La Maison'),
  ('PRD-003','8ad72723-fb18-43b2-9333-6cc6f709f749','2026-08-17','BATCH-2026-003','Demi-glace',8.00,'kg',240.00,80.00,30.00,350.00,43.75,'completed','Slow reduction 12h'),
  ('PRD-004','907e8a05-57f7-4159-81d3-ad53a1745fa3','2026-08-17','BATCH-2026-004','House Sour Mix',12.00,'l',90.00,30.00,10.00,130.00,10.83,'draft','Pending QC'),
  ('PRD-005','4a3f6574-bde9-47e4-bf8d-1b0c64ca6841','2026-08-17','BATCH-2026-005','Pre-portioned desserts',50.00,'pcs',150.00,40.00,10.00,200.00,4.00,'completed','For room service plating')
) AS t(id,outlet_id,batch_date,batch_number,product,quantity,unit,raw_cost,labor_cost,overhead_cost,total_cost,unit_cost,status,notes)
WHERE NOT EXISTS (SELECT 1 FROM fb_production_batches WHERE id = t.id);

-- ── Seed: Journal entries ──────────────────────────────────────────
INSERT INTO fb_journal_entries (id, outlet_id, entry_date, reference, description, debit_account, credit_account, amount, status, posted_by, posted_at)
SELECT * FROM (VALUES
  ('JE-001','8f7a343f-1dc2-47a1-b7b5-a133c47a9a7f'::text,'2026-08-17'::date,'FB-REV-001'::text,'Daily F&B revenue posting - Main Restaurant food'::text,'1100-Cash'::text,'4000-F&B Revenue'::text,7650.00,'posted'::text,'Night Auditor'::text,'2026-08-18 02:15'::timestamptz),
  ('JE-002','8f7a343f-1dc2-47a1-b7b5-a133c47a9a7f','2026-08-17','FB-REV-002','Daily F&B revenue posting - Main Restaurant beverage','1100-Cash','4000-F&B Revenue',3600.00,'posted','Night Auditor','2026-08-18 02:15'::timestamptz),
  ('JE-003','907e8a05-57f7-4159-81d3-ad53a1745fa3','2026-08-17','FB-REV-003','Daily F&B revenue posting - Sky Lounge Bar','1100-Cash','4000-F&B Revenue',2880.00,'posted','Night Auditor','2026-08-18 02:15'::timestamptz),
  ('JE-004','8f7a343f-1dc2-47a1-b7b5-a133c47a9a7f','2026-08-17','FB-COGS-001','COGS posting - Main Restaurant food','5000-F&B Cost of Sales','1300-Inventory',2800.00,'posted','Night Auditor','2026-08-18 02:16'::timestamptz),
  ('JE-005','8f7a343f-1dc2-47a1-b7b5-a133c47a9a7f','2026-08-17','FB-LAB-001','Labor cost accrual - Main Restaurant','6000-Payroll Expense','2100-Accrued Payroll',1680.00,'draft',NULL,NULL),
  ('JE-006','4a3f6574-bde9-47e4-bf8d-1b0c64ca6841','2026-08-17','FB-DISC-001','Discount write-off - Room Service promotional','7000-Discounts Allowed','1100-Cash',60.00,'draft',NULL,NULL)
) AS t(id,outlet_id,entry_date,reference,description,debit_account,credit_account,amount,status,posted_by,posted_at)
WHERE NOT EXISTS (SELECT 1 FROM fb_journal_entries WHERE id = t.id);

-- ── Seed: Reconciliation records ───────────────────────────────────
INSERT INTO fb_reconciliation_records (id, outlet_id, reconciliation_date, pos_total, financial_total, variance, status, reconciled_by, reconciled_at, notes)
SELECT * FROM (VALUES
  ('REC-001','8f7a343f-1dc2-47a1-b7b5-a133c47a9a7f'::text,'2026-08-17'::date,12500.00,12500.00,0.00,'matched'::text,'Night Auditor'::text,'2026-08-18 02:30'::timestamptz,'All POS Z-reports matched GL'::text),
  ('REC-002','907e8a05-57f7-4159-81d3-ad53a1745fa3','2026-08-17',3200.00,3180.00,-20.00,'variance','Night Auditor','2026-08-18 02:32'::timestamptz,'20 variance - void not posted to GL'::text),
  ('REC-003','4a3f6574-bde9-47e4-bf8d-1b0c64ca6841','2026-08-17',1800.00,1800.00,0.00,'matched','Night Auditor','2026-08-18 02:35'::timestamptz,'Matched'),
  ('REC-004','8ad72723-fb18-43b2-9333-6cc6f709f749','2026-08-17',8600.00,8420.00,-180.00,'investigating','Night Auditor','2026-08-18 02:40'::timestamptz,'Under investigation - possible missing settlement'),
  ('REC-005','fb9937b9-1139-4dcc-b3d0-c26dd25a1f3b','2026-08-17',0.00,0.00,0.00,'pending',NULL,NULL,'No banquet events yesterday')
) AS t(id,outlet_id,reconciliation_date,pos_total,financial_total,variance,status,reconciled_by,reconciled_at,notes)
WHERE NOT EXISTS (SELECT 1 FROM fb_reconciliation_records WHERE id = t.id);
