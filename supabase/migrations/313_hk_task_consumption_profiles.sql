-- Migration 313: Task consumption profiles
--
-- Problem: completing a room cleaning, public area cleaning, deep cleaning,
-- or preventive cleaning task posted ZERO inventory consumption. The
-- Inventory → Consumption tab only reflected linen/laundry/amenity/minibar
-- movements, so variance was structurally unreliable — cleaning supplies
-- were consumed in reality but never decremented from the ledger.
--
-- Fix: a property-scoped `hk_task_consumption_profiles` table that maps
-- each task type (+ optional subtype) to the inventory items and quantities
-- consumed when that task is completed. The task advance/complete endpoints
-- read this table and post consumption transactions via adjustHkStore().
--
-- Profiles are editable per property so hotels can tune quantities. A
-- NULL property_id row acts as a system default that any property falls
-- back to when no property-specific profile exists.

CREATE TABLE IF NOT EXISTS hk_task_consumption_profiles (
  id            TEXT PRIMARY KEY,
  property_id   UUID,                       -- NULL = system default
  task_type     TEXT NOT NULL,
  subtype       TEXT,                        -- nullable; NULL = all subtypes
  item_name     TEXT NOT NULL,               -- matched against inventory_items.name (ilike)
  item_category TEXT NOT NULL DEFAULT 'cleaning_supplies'
                  CHECK (item_category IN ('cleaning_supplies','linens','equipment','amenities','other')),
  quantity      NUMERIC NOT NULL DEFAULT 1 CHECK (quantity > 0),
  created_at    TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_hk_task_consumption_profiles_lookup
  ON hk_task_consumption_profiles(property_id, task_type);

CREATE OR REPLACE FUNCTION update_hk_task_consumption_profiles_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_hk_task_consumption_profiles_updated_at
  ON hk_task_consumption_profiles;
CREATE TRIGGER trigger_hk_task_consumption_profiles_updated_at
  BEFORE UPDATE ON hk_task_consumption_profiles
  FOR EACH ROW
  EXECUTE FUNCTION update_hk_task_consumption_profiles_timestamp();

GRANT SELECT, INSERT, UPDATE, DELETE ON hk_task_consumption_profiles TO authenticated;

-- ── Seed system defaults (property_id = NULL) ───────────────────────────
-- Quantities are per-task-completion. Cleaning supplies are in litres (L)
-- or pieces (PCS) matching the inventory_items.unit_of_measure.
-- Linens are NOT included here — linen consumption is driven by the
-- Linen module's Issue Linen operation, not by task completion.

INSERT INTO hk_task_consumption_profiles (id, property_id, task_type, subtype, item_name, item_category, quantity) VALUES
  -- Checkout Cleaning: full room turnover
  ('TCP-001', NULL, 'Checkout Cleaning', NULL, 'Bathroom Cleaner',      'cleaning_supplies', 0.5),
  ('TCP-002', NULL, 'Checkout Cleaning', NULL, 'Multi-Surface Cleaner', 'cleaning_supplies', 0.3),
  ('TCP-003', NULL, 'Checkout Cleaning', NULL, 'Toilet Paper Rolls',    'cleaning_supplies', 2),
  ('TCP-004', NULL, 'Checkout Cleaning', NULL, 'Glass Cleaner',         'cleaning_supplies', 0.2),
  ('TCP-005', NULL, 'Checkout Cleaning', NULL, 'Trash Bags (Small)',    'other',             1),
  -- Stayover Service: light refresh
  ('TCP-010', NULL, 'Stayover Service', NULL, 'Toilet Paper Rolls',     'cleaning_supplies', 1),
  ('TCP-011', NULL, 'Stayover Service', NULL, 'Multi-Surface Cleaner',  'cleaning_supplies', 0.15),
  ('TCP-012', NULL, 'Stayover Service', NULL, 'Trash Bags (Small)',     'other',             1),
  -- VIP Preparation: premium full clean
  ('TCP-020', NULL, 'VIP Preparation', NULL, 'Bathroom Cleaner',        'cleaning_supplies', 0.5),
  ('TCP-021', NULL, 'VIP Preparation', NULL, 'Multi-Surface Cleaner',   'cleaning_supplies', 0.3),
  ('TCP-022', NULL, 'VIP Preparation', NULL, 'Toilet Paper Rolls',      'cleaning_supplies', 2),
  ('TCP-023', NULL, 'VIP Preparation', NULL, 'Glass Cleaner',           'cleaning_supplies', 0.3),
  ('TCP-024', NULL, 'VIP Preparation', NULL, 'Floor Disinfectant',      'cleaning_supplies', 0.2),
  ('TCP-025', NULL, 'VIP Preparation', NULL, 'Trash Bags (Small)',      'other',             2),
  -- Turndown Service: evening light touch
  ('TCP-030', NULL, 'Turndown Service', NULL, 'Multi-Surface Cleaner',  'cleaning_supplies', 0.1),
  -- Early Arrival Preparation
  ('TCP-040', NULL, 'Early Arrival Preparation', NULL, 'Multi-Surface Cleaner', 'cleaning_supplies', 0.2),
  ('TCP-041', NULL, 'Early Arrival Preparation', NULL, 'Glass Cleaner',        'cleaning_supplies', 0.2),
  -- Deep Cleaning (all subtypes): heavy duty
  ('TCP-050', NULL, 'Deep Cleaning', NULL, 'Bathroom Cleaner',          'cleaning_supplies', 1),
  ('TCP-051', NULL, 'Deep Cleaning', NULL, 'Floor Disinfectant',        'cleaning_supplies', 0.5),
  ('TCP-052', NULL, 'Deep Cleaning', NULL, 'Glass Cleaner',             'cleaning_supplies', 0.5),
  ('TCP-053', NULL, 'Deep Cleaning', NULL, 'Multi-Surface Cleaner',     'cleaning_supplies', 1),
  -- Deep Cleaning subtype-specific additions
  ('TCP-060', NULL, 'Deep Cleaning', 'Carpet Shampoo', 'Multi-Surface Cleaner', 'cleaning_supplies', 0.5),
  ('TCP-061', NULL, 'Deep Cleaning', 'Wall Cleaning', 'Multi-Surface Cleaner',  'cleaning_supplies', 0.5),
  -- Preventive Cleaning (all subtypes): maintenance-level
  ('TCP-070', NULL, 'Preventive Cleaning', NULL, 'Floor Disinfectant',  'cleaning_supplies', 0.3),
  ('TCP-071', NULL, 'Preventive Cleaning', NULL, 'Glass Cleaner',       'cleaning_supplies', 0.3),
  -- Preventive Cleaning subtype-specific
  ('TCP-080', NULL, 'Preventive Cleaning', 'Air Filters', 'Multi-Surface Cleaner', 'cleaning_supplies', 0.2),
  ('TCP-081', NULL, 'Preventive Cleaning', 'Window Cleaning', 'Glass Cleaner',     'cleaning_supplies', 0.5),
  ('TCP-082', NULL, 'Preventive Cleaning', 'Balcony Cleaning', 'Floor Disinfectant','cleaning_supplies', 0.3),
  -- Public Area Cleaning: high-traffic areas
  ('TCP-090', NULL, 'Public Area Cleaning', NULL, 'Floor Disinfectant', 'cleaning_supplies', 0.5),
  ('TCP-091', NULL, 'Public Area Cleaning', NULL, 'Glass Cleaner',      'cleaning_supplies', 0.3),
  ('TCP-092', NULL, 'Public Area Cleaning', NULL, 'Multi-Surface Cleaner','cleaning_supplies', 0.5),
  ('TCP-093', NULL, 'Public Area Cleaning', NULL, 'Trash Bags (Large)', 'other',             2),
  -- Special Cleaning
  ('TCP-100', NULL, 'Special Cleaning', NULL, 'Bathroom Cleaner',       'cleaning_supplies', 0.5),
  ('TCP-101', NULL, 'Special Cleaning', NULL, 'Multi-Surface Cleaner',  'cleaning_supplies', 0.5),
  ('TCP-102', NULL, 'Special Cleaning', NULL, 'Floor Disinfectant',     'cleaning_supplies', 0.3),
  -- Emergency Cleaning
  ('TCP-110', NULL, 'Emergency Cleaning', NULL, 'Bathroom Cleaner',     'cleaning_supplies', 0.5),
  ('TCP-111', NULL, 'Emergency Cleaning', NULL, 'Multi-Surface Cleaner','cleaning_supplies', 0.5),
  ('TCP-112', NULL, 'Emergency Cleaning', NULL, 'Floor Disinfectant',   'cleaning_supplies', 0.5),
  -- Biohazard Cleaning: heavy disinfectant
  ('TCP-120', NULL, 'Biohazard Cleaning', NULL, 'Floor Disinfectant',   'cleaning_supplies', 1),
  ('TCP-121', NULL, 'Biohazard Cleaning', NULL, 'Multi-Surface Cleaner','cleaning_supplies', 1),
  -- Room Refresh
  ('TCP-130', NULL, 'Room Refresh', NULL, 'Multi-Surface Cleaner',      'cleaning_supplies', 0.2),
  ('TCP-131', NULL, 'Room Refresh', NULL, 'Toilet Paper Rolls',         'cleaning_supplies', 1),
  -- Guest Complaint Follow-up
  ('TCP-140', NULL, 'Guest Complaint Follow-up', NULL, 'Multi-Surface Cleaner', 'cleaning_supplies', 0.2)
ON CONFLICT (id) DO NOTHING;
