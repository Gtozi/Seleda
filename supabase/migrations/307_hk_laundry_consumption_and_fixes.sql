-- Migration: Laundry Interface — permission gating, audit log, consumption tracking
--
-- Addresses the gaps identified in the Laundry Interface analysis:
--   1. Registers the 'hk:laundry:manage' permission and grants it to
--      hk_supervisor / hk_manager roles (mirrors migrations 304 & 306).
--      The route handlers now call requirePermission('hk:laundry:manage')
--      on every mutation, so non-HK roles can no longer advance/resolve
--      jobs or log consumption.
--   2. Adds a foreign key from hk_laundry_jobs.property_id → properties(id)
--      so orphaned rows cannot accumulate.
--   3. Adds hk_laundry_log — an append-only audit trail for status
--      transitions (who advanced which job, when, from→to). Previously
--      the advance endpoint overwrote status in place with no history.
--   4. Adds hk_laundry_consumption — tracks consumable supplies used by
--      the laundry operation (detergent, softener, bleach, water, energy,
--      etc.), optionally linked to a specific job. Backs the new
--      "Consumption" sub-tab and the "Chemical Consumption" inventory
--      report (docs/Housekeeping Portal new.md §23).

-- ── 1. Permission: hk:laundry:manage ───────────────────────────────────
INSERT INTO permissions (id, code, module, description)
VALUES ('perm-hk-laundry-manage', 'hk:laundry:manage', 'housekeeping',
        'Manage laundry operations: create pickup requests, advance job status, resolve exceptions, log supply consumption')
ON CONFLICT (id) DO NOTHING;

INSERT INTO permissions (id, code, module, description)
SELECT 'perm-hk-laundry-manage', 'hk:laundry:manage', 'housekeeping',
       'Manage laundry operations'
WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE code = 'hk:laundry:manage');

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.name IN ('hk_supervisor', 'hk_manager')
  AND p.code = 'hk:laundry:manage'
ON CONFLICT DO NOTHING;

-- ── 2. Foreign key on hk_laundry_jobs.property_id ─────────────────────
-- Backfill any NULL property_id with the demo property before adding the
-- FK, then make it NOT NULL. (Existing seed rows already have it set.)
UPDATE hk_laundry_jobs
  SET property_id = '18762279-a389-41c9-9169-7ebc682e9703'::uuid
  WHERE property_id IS NULL;

ALTER TABLE hk_laundry_jobs
  ALTER COLUMN property_id SET NOT NULL;

-- Drop & re-add as a clean FK (idempotent).
ALTER TABLE hk_laundry_jobs
  DROP CONSTRAINT IF EXISTS hk_laundry_jobs_property_id_fkey;
ALTER TABLE hk_laundry_jobs
  ADD CONSTRAINT hk_laundry_jobs_property_id_fkey
  FOREIGN KEY (property_id) REFERENCES properties(id) ON DELETE CASCADE;

-- ── 3. Audit log: hk_laundry_log ──────────────────────────────────────
-- Append-only record of every status transition on a laundry job.
CREATE TABLE IF NOT EXISTS hk_laundry_log (
  id            TEXT PRIMARY KEY,
  property_id   UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  job_id        TEXT NOT NULL REFERENCES hk_laundry_jobs(id) ON DELETE CASCADE,
  from_status   TEXT NOT NULL,
  to_status     TEXT NOT NULL,
  actor_id      UUID,
  actor_name    TEXT,
  note          TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_hk_laundry_log_property
  ON hk_laundry_log(property_id);
CREATE INDEX IF NOT EXISTS idx_hk_laundry_log_job
  ON hk_laundry_log(job_id);
CREATE INDEX IF NOT EXISTS idx_hk_laundry_log_created_at
  ON hk_laundry_log(created_at DESC);

GRANT SELECT, INSERT ON hk_laundry_log TO authenticated;

-- ── 4. Consumption tracking: hk_laundry_consumption ───────────────────
-- Each row is a single consumption entry for a supply (detergent, water,
-- energy, …). Optionally linked to a laundry job. category groups supplies
-- for the "Chemical Consumption" report.
CREATE TABLE IF NOT EXISTS hk_laundry_consumption (
  id            TEXT PRIMARY KEY,
  property_id   UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  job_id        TEXT REFERENCES hk_laundry_jobs(id) ON DELETE SET NULL,
  supply_name   TEXT NOT NULL CHECK (length(trim(supply_name)) > 0 AND length(supply_name) <= 80),
  category      TEXT NOT NULL DEFAULT 'Chemical'
                CHECK (category IN ('Chemical', 'Utility', 'Supply')),
  unit          TEXT NOT NULL CHECK (length(trim(unit)) > 0 AND length(unit) <= 20),
  quantity      NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  recorded_by   UUID,
  note          TEXT,
  recorded_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_hk_laundry_consumption_property
  ON hk_laundry_consumption(property_id);
CREATE INDEX IF NOT EXISTS idx_hk_laundry_consumption_job
  ON hk_laundry_consumption(job_id);
CREATE INDEX IF NOT EXISTS idx_hk_laundry_consumption_recorded_at
  ON hk_laundry_consumption(recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_hk_laundry_consumption_supply
  ON hk_laundry_consumption(supply_name);

GRANT SELECT, INSERT, DELETE ON hk_laundry_consumption TO authenticated;

-- ── Seed: consumption entries for the demo property ───────────────────
-- Mirrors the existing laundry jobs (LA-5001 … LA-5007) so the new
-- Consumption sub-tab has realistic data on first load.
INSERT INTO hk_laundry_consumption (id, property_id, job_id, supply_name, category, unit, quantity, recorded_at)
VALUES
  ('LC-9001', '18762279-a389-41c9-9169-7ebc682e9703', 'LA-5001', 'Detergent',     'Chemical', 'L',     1.50, NOW() - INTERVAL '2 hours'),
  ('LC-9002', '18762279-a389-41c9-9169-7ebc682e9703', 'LA-5001', 'Softener',      'Chemical', 'L',     0.30, NOW() - INTERVAL '2 hours'),
  ('LC-9003', '18762279-a389-41c9-9169-7ebc682e9703', 'LA-5004', 'Detergent',     'Chemical', 'L',     4.00, NOW() - INTERVAL '4 hours'),
  ('LC-9004', '18762279-a389-41c9-9169-7ebc682e9703', 'LA-5004', 'Bleach',        'Chemical', 'L',     0.80, NOW() - INTERVAL '4 hours'),
  ('LC-9005', '18762279-a389-41c9-9169-7ebc682e9703', 'LA-5004', 'Water',         'Utility',  'L',   320.00, NOW() - INTERVAL '4 hours'),
  ('LC-9006', '18762279-a389-41c9-9169-7ebc682e9703', 'LA-5004', 'Electricity',   'Utility',  'kWh',   6.50, NOW() - INTERVAL '4 hours'),
  ('LC-9007', '18762279-a389-41c9-9169-7ebc682e9703', NULL,      'Stain Remover', 'Chemical', 'mL',   45.00, NOW() - INTERVAL '6 hours'),
  ('LC-9008', '18762279-a389-41c9-9169-7ebc682e9703', 'LA-5003', 'Detergent',     'Chemical', 'L',     2.00, NOW() - INTERVAL '5 hours')
ON CONFLICT (id) DO NOTHING;
