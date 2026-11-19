-- ════════════════════════════════════════════════════════════════
-- 374 — uinv_stock_ledger: add theoretical_qty + actual_qty columns
--
-- Problem: the HK Variance Analysis endpoint reconstructs theoretical
-- and actual quantities from `balance + (quantity_in - quantity_out)`
-- because the ledger didn't store them. This is an approximation that
-- breaks when multiple variance events accumulate on the same item.
--
-- Solution: add two nullable numeric columns so that variance-related
-- ledger entries (Consumption, Cycle Count, Stock Count, Adjustment,
-- Waste) can store the exact theoretical (expected) and actual (counted
-- / consumed) quantities at the time of the transaction. Non-variance
-- entries (Goods Receipt, Transfer, Department Issue, etc.) leave them
-- NULL — they are not variance events.
--
-- Backward compatible: existing rows get NULL for both columns, and the
-- variance endpoint falls back to the reconstruction when these are NULL.
-- ════════════════════════════════════════════════════════════════

ALTER TABLE public.uinv_stock_ledger
  ADD COLUMN IF NOT EXISTS theoretical_qty numeric(12,3),
  ADD COLUMN IF NOT EXISTS actual_qty numeric(12,3);

-- Helpful index for variance queries that filter by transaction type
CREATE INDEX IF NOT EXISTS idx_uinv_ledger_variance_types
  ON public.uinv_stock_ledger(transaction_type)
  WHERE theoretical_qty IS NOT NULL OR actual_qty IS NOT NULL;

COMMENT ON COLUMN public.uinv_stock_ledger.theoretical_qty IS
  'The expected/book quantity at the time of a variance event (Consumption, Count, Adjustment, Waste). NULL for non-variance transactions.';
COMMENT ON COLUMN public.uinv_stock_ledger.actual_qty IS
  'The actual/counted/consumed quantity at the time of a variance event. NULL for non-variance transactions.';
