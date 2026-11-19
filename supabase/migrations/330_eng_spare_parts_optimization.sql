-- ============================================================
-- Engineering Portal — Spare Parts Optimization (Migration 330)
-- ============================================================
-- Inspired by the HK inventory patterns (adjustHkStore, rich
-- transaction logging, waste recording, variance tracking, reorder
-- recommendations). Optimized for the maintenance use case.
--
-- Enhances the spare_parts_transactions table (created in migration
-- 329) with:
--   1. Cost tracking: unit_cost, total_cost
--   2. Audit fields: performed_by, reason, reference_number
--   3. Waste tracking: waste_type (damaged/expired/lost/obsolete/other)
--   4. Variance tracking: theoretical_qty, actual_qty (stock count)
--   5. Expanded transaction types: Restock, Waste, Adjustment,
--      Stock Count (in addition to Reserve/Issue/Return/Consumption)
--
-- Also adds reorder_point to spare_parts (distinct from min_stock:
-- min_stock = absolute minimum; reorder_point = when to trigger
-- a reorder, typically higher than min_stock for safety).
-- ============================================================

-- ── 1. Enhance spare_parts_transactions ──────────────────────────
ALTER TABLE public.spare_parts_transactions
  ADD COLUMN IF NOT EXISTS unit_cost numeric(18,2) DEFAULT 0;
ALTER TABLE public.spare_parts_transactions
  ADD COLUMN IF NOT EXISTS total_cost numeric(18,2) DEFAULT 0;
ALTER TABLE public.spare_parts_transactions
  ADD COLUMN IF NOT EXISTS performed_by text DEFAULT 'system';
ALTER TABLE public.spare_parts_transactions
  ADD COLUMN IF NOT EXISTS reason text;
ALTER TABLE public.spare_parts_transactions
  ADD COLUMN IF NOT EXISTS reference_number text;
ALTER TABLE public.spare_parts_transactions
  ADD COLUMN IF NOT EXISTS waste_type text CHECK (waste_type IN ('damaged', 'expired', 'lost', 'obsolete', 'other'));
ALTER TABLE public.spare_parts_transactions
  ADD COLUMN IF NOT EXISTS theoretical_qty integer;
ALTER TABLE public.spare_parts_transactions
  ADD COLUMN IF NOT EXISTS actual_qty integer;

-- Expand transaction_type to include maintenance-optimized types
ALTER TABLE public.spare_parts_transactions
  DROP CONSTRAINT IF EXISTS spare_parts_transactions_transaction_type_check;
ALTER TABLE public.spare_parts_transactions
  ADD CONSTRAINT spare_parts_transactions_transaction_type_check
  CHECK (transaction_type IN (
    'Reserve', 'Issue', 'Return', 'Consumption',
    'Restock', 'Waste', 'Adjustment', 'Stock Count'
  ));

-- ── 2. Add reorder_point to spare_parts ──────────────────────────
ALTER TABLE public.spare_parts
  ADD COLUMN IF NOT EXISTS reorder_point integer DEFAULT 0;

-- ── 3. Backfill reorder_point from min_stock where not set ───────
UPDATE public.spare_parts
SET reorder_point = min_stock
WHERE reorder_point IS NULL OR reorder_point = 0;

-- ── 4. Update existing seed transactions with cost data ──────────
UPDATE public.spare_parts_transactions t
SET
  unit_cost = COALESCE(p.unit_cost, 0),
  total_cost = COALESCE(t.quantity, 0) * COALESCE(p.unit_cost, 0),
  performed_by = COALESCE(t.technician, 'system')
FROM public.spare_parts p
WHERE t.part_id = p.id
  AND (t.unit_cost IS NULL OR t.unit_cost = 0);
