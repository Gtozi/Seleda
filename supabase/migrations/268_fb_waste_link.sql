-- Migration: relate fb_waste_records to the inventory wastage_logs table
-- Wastage logs are the source of truth; a trigger creates/updates the
-- financial waste record from each wastage log entry.

-- 1. Add optional FK from financial waste records to inventory wastage logs
ALTER TABLE fb_waste_records ADD COLUMN IF NOT EXISTS wastage_log_id TEXT;
CREATE INDEX IF NOT EXISTS idx_fb_waste_records_wastage_log_id ON fb_waste_records(wastage_log_id);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fb_waste_records_wastage_log_id_fkey') THEN
    ALTER TABLE fb_waste_records
      ADD CONSTRAINT fb_waste_records_wastage_log_id_fkey
      FOREIGN KEY (wastage_log_id) REFERENCES wastage_logs(id) ON DELETE SET NULL;
  END IF;
END $$;

-- 2. Seed wastage_logs for the existing 5 financial waste records.
--    We use the first 5 ingredients and a single outlet stock location for
--    the link; the financial record remains the place for outlet/type
--    enrichment, while quantity, unit, cost, and reason flow from the log.
--    wastage_logs.reason is restricted to an enum, so we map the free-text
--    fb_waste_records.reason to the closest category.
WITH waste_list AS (
  SELECT id, quantity, unit, reason, cost, row_number() OVER (ORDER BY id) AS rn,
    CASE
      WHEN reason ILIKE '%expir%' THEN 'Spoilage'
      WHEN reason ILIKE '%satisfi%' OR reason ILIKE '%reject%' OR reason ILIKE '%quality%' THEN 'QualityReject'
      WHEN reason ILIKE '%over%' OR reason ILIKE '%demand%' THEN 'Overproduction'
      WHEN reason ILIKE '%break%' THEN 'Breakage'
      ELSE 'Other'
    END AS mapped_reason
  FROM fb_waste_records
),
ing_list AS (
  SELECT id, name, row_number() OVER (ORDER BY name) AS rn
  FROM (SELECT id, name FROM ingredients ORDER BY name LIMIT 5) t
),
loc AS (
  SELECT id FROM stock_locations WHERE id = 'loc-main-bb' LIMIT 1
)
INSERT INTO wastage_logs (
  id, ingredient_id, location_id, quantity, unit, reason,
  cost_value, logged_by, approved_by, notes
)
SELECT
  'WLOG-' || LPAD(w.rn::text, 3, '0'),
  i.id,
  loc.id,
  w.quantity,
  w.unit,
  w.mapped_reason,
  w.cost,
  'system',
  'system',
  'Auto-linked to fb_waste_record ' || w.id
FROM waste_list w
JOIN ing_list i ON i.rn = w.rn
CROSS JOIN loc
WHERE w.wastage_log_id IS NULL
ON CONFLICT (id) DO NOTHING;

-- 3. Link the existing financial waste records to the newly seeded logs
WITH mapping AS (
  SELECT id, row_number() OVER (ORDER BY id) AS rn FROM fb_waste_records
)
UPDATE fb_waste_records f
SET wastage_log_id = 'WLOG-' || LPAD(m.rn::text, 3, '0')
FROM mapping m
WHERE f.id = m.id;

-- 4. Trigger function: mirror wastage_logs into fb_waste_records
CREATE OR REPLACE FUNCTION sync_waste_record_from_log()
RETURNS TRIGGER AS $$
DECLARE
  ing_name TEXT;
  out_id TEXT;
BEGIN
  -- Look up ingredient name and outlet from the related tables
  SELECT name INTO ing_name FROM ingredients WHERE id = NEW.ingredient_id;
  SELECT outlet_id INTO out_id FROM stock_locations WHERE id = NEW.location_id;

  IF TG_OP = 'INSERT' THEN
    -- Only create a financial record if one does not already exist for this log
    IF NOT EXISTS (SELECT 1 FROM fb_waste_records WHERE wastage_log_id = NEW.id) THEN
      INSERT INTO fb_waste_records (
        wastage_log_id,
        outlet_id,
        record_date,
        type,
        item,
        quantity,
        unit,
        cost,
        reason
      ) VALUES (
        NEW.id,
        out_id,
        COALESCE(NEW.created_at::date, CURRENT_DATE),
        'preparation',
        COALESCE(ing_name, 'Unknown'),
        NEW.quantity,
        NEW.unit,
        NEW.cost_value,
        NEW.reason
      );
    END IF;

  ELSIF TG_OP = 'UPDATE' THEN
    -- Update only fields that originate from the wastage log.
    -- Preserve financial enrichment: outlet_id, record_date, and type are
    -- intentionally NOT overwritten so the F&B team can classify them.
    UPDATE fb_waste_records
    SET item = COALESCE(ing_name, 'Unknown'),
        quantity = NEW.quantity,
        unit = NEW.unit,
        cost = NEW.cost_value,
        reason = NEW.reason,
        updated_at = NOW()
    WHERE wastage_log_id = NEW.id;

  ELSIF TG_OP = 'DELETE' THEN
    DELETE FROM fb_waste_records WHERE wastage_log_id = OLD.id;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS wastage_log_sync ON wastage_logs;
CREATE TRIGGER wastage_log_sync
AFTER INSERT OR UPDATE OR DELETE ON wastage_logs
FOR EACH ROW EXECUTE FUNCTION sync_waste_record_from_log();
