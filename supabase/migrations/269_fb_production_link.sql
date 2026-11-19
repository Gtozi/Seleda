-- Migration: relate fb_production_batches to production-coordination fb_batch_production
-- Production coordination batches are the source of truth; a trigger creates
-- the financial production batch from each fb_batch_production entry.

-- 1. Add optional FK from financial production batches to production coordination batches
ALTER TABLE fb_production_batches ADD COLUMN IF NOT EXISTS batch_production_id UUID;
CREATE INDEX IF NOT EXISTS idx_fb_production_batches_batch_production_id ON fb_production_batches(batch_production_id);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fb_production_batches_batch_production_id_fkey') THEN
    ALTER TABLE fb_production_batches
      ADD CONSTRAINT fb_production_batches_batch_production_id_fkey
      FOREIGN KEY (batch_production_id) REFERENCES fb_batch_production(id) ON DELETE SET NULL;
  END IF;
END $$;

-- 2. Seed fb_batch_production rows for the existing 5 financial production records
--    and link them using a temp table so the generated UUIDs stay consistent.
CREATE TEMP TABLE IF NOT EXISTS tmp_prod_link (prod_id TEXT PRIMARY KEY, batch_id UUID);
TRUNCATE tmp_prod_link;

INSERT INTO tmp_prod_link (prod_id, batch_id)
SELECT id, gen_random_uuid()
FROM fb_production_batches
WHERE batch_production_id IS NULL
ORDER BY id;

INSERT INTO fb_batch_production (id, name, outlet_id, batch_type, yield_qty, yield_unit, prepared_by, status)
SELECT
  l.batch_id,
  p.product,
  p.outlet_id,
  CASE
    WHEN p.product ILIKE '%stock%' THEN 'Stock'
    WHEN p.product ILIKE '%sauce%' OR p.product ILIKE '%glace%' OR p.product ILIKE '%mix%' THEN 'Sauce'
    WHEN p.product ILIKE '%soup%' THEN 'Soup'
    WHEN p.product ILIKE '%dough%' THEN 'Dough'
    WHEN p.product ILIKE '%dessert%' OR p.product ILIKE '%crème%' THEN 'Dessert Base'
    WHEN p.product ILIKE '%marinade%' THEN 'Marinade'
    ELSE 'Stock'
  END,
  p.quantity,
  p.unit,
  'system',
  CASE p.status
    WHEN 'completed' THEN 'Ready'
    WHEN 'transferred' THEN 'Used'
    ELSE 'Scheduled'
  END
FROM tmp_prod_link l
JOIN fb_production_batches p ON p.id = l.prod_id;

UPDATE fb_production_batches p
SET batch_production_id = l.batch_id
FROM tmp_prod_link l
WHERE p.id = l.prod_id;

-- 3. Trigger function: mirror fb_batch_production into fb_production_batches
CREATE OR REPLACE FUNCTION sync_production_batch_from_batch()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NOT EXISTS (SELECT 1 FROM fb_production_batches WHERE batch_production_id = NEW.id) THEN
      INSERT INTO fb_production_batches (
        batch_production_id,
        outlet_id,
        batch_date,
        batch_number,
        product,
        quantity,
        unit,
        raw_cost,
        labor_cost,
        overhead_cost,
        total_cost,
        unit_cost,
        status,
        notes
      ) VALUES (
        NEW.id,
        NEW.outlet_id,
        COALESCE(NEW.created_at::date, CURRENT_DATE),
        'BATCH-' || NEW.id::text,
        NEW.name,
        NEW.yield_qty,
        NEW.yield_unit,
        0,
        0,
        0,
        0,
        0,
        'draft',
        'Sourced from batch production'
      );
    END IF;

  ELSIF TG_OP = 'UPDATE' THEN
    UPDATE fb_production_batches
    SET outlet_id = NEW.outlet_id,
        product = NEW.name,
        quantity = NEW.yield_qty,
        unit = NEW.yield_unit,
        updated_at = NOW()
    WHERE batch_production_id = NEW.id;

  ELSIF TG_OP = 'DELETE' THEN
    DELETE FROM fb_production_batches WHERE batch_production_id = OLD.id;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS batch_production_sync ON fb_batch_production;
CREATE TRIGGER batch_production_sync
AFTER INSERT OR UPDATE OR DELETE ON fb_batch_production
FOR EACH ROW EXECUTE FUNCTION sync_production_batch_from_batch();
