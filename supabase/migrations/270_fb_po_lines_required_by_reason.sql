-- Migration: F&B Purchase Order Lines — per-line required_by + reason
-- Backs the per-item "Required By" and "Reason" columns in the
-- Supplier Procurement Coordination requisitions table.
--
-- fb_purchase_order_lines already has an `expected_date` column (migration 129)
-- which is the natural home for the per-line "required by" date. This migration
-- only adds the missing `reason` column. No data migration is required —
-- existing rows simply have NULL reason and are back-filled from po.notes at
-- read time (see foodBeverage.routes.ts GET handler).

ALTER TABLE fb_purchase_order_lines
  ADD COLUMN IF NOT EXISTS reason TEXT;
