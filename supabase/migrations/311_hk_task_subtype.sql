-- Migration 311: Housekeeping task subtype
--
-- Deep Cleaning (§18) and Preventive Cleaning (§19) were rebased onto the
-- unified housekeeping_task_mgmt engine so their tasks participate in
-- workload, supervisor console, and reports. Both have a *specific* subtype
-- that the parent `type` CHECK constraint cannot express:
--
--   Deep Cleaning       → Carpet Shampoo, Curtain Cleaning, Mattress Rotation,
--                         Upholstery Cleaning, Wall Cleaning, Air Vent Cleaning
--   Preventive Cleaning → Air Filters, Furniture Polish, Tile Grout,
--                         Window Cleaning, Balcony Cleaning, Ceiling Cleaning
--
-- The first implementation stored the subtype in `notes`, but `notes` is a
-- user-facing free-text field with its own editor in the Task Management
-- module — a supervisor editing notes would silently destroy the subtype.
-- This migration adds a dedicated column so the two concerns are separate.
--
-- Left nullable and unconstrained: subtypes are owned by the client modules
-- (mirrors how `frequency` and `service_type` labels are handled) and new
-- subtypes should not require a migration.

ALTER TABLE housekeeping_task_mgmt
  ADD COLUMN IF NOT EXISTS subtype TEXT;

CREATE INDEX IF NOT EXISTS idx_hk_task_mgmt_subtype
  ON housekeeping_task_mgmt(subtype)
  WHERE subtype IS NOT NULL;

-- Back-fill: recover any subtype previously written into `notes` by the
-- first Deep/Preventive implementation. Only migrates rows whose notes
-- exactly match a known subtype label, then clears notes so the field is
-- returned to the user. Rows where the user already typed real notes are
-- left untouched.
UPDATE housekeeping_task_mgmt
SET subtype = TRIM(notes),
    notes   = NULL
WHERE type IN ('Deep Cleaning', 'Preventive Cleaning')
  AND subtype IS NULL
  AND TRIM(COALESCE(notes, '')) IN (
    'Carpet Shampoo', 'Curtain Cleaning', 'Mattress Rotation',
    'Upholstery Cleaning', 'Wall Cleaning', 'Air Vent Cleaning',
    'Air Filters', 'Furniture Polish', 'Tile Grout',
    'Window Cleaning', 'Balcony Cleaning', 'Ceiling Cleaning'
  );
