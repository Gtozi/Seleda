-- ════════════════════════════════════════════════════════════════
-- Migration 380: Add parent_transfer_id and leg columns to uinv_transfers
-- Supports two-leg department transfers routed through Central Warehouse:
--   Leg 1: Department A → Central (Main Warehouse)
--   Leg 2: Central → Department B
-- The parent_transfer_id links the two legs together.
-- ════════════════════════════════════════════════════════════════

ALTER TABLE public.uinv_transfers
  ADD COLUMN IF NOT EXISTS parent_transfer_id text;

ALTER TABLE public.uinv_transfers
  ADD COLUMN IF NOT EXISTS leg int DEFAULT 1;

ALTER TABLE public.uinv_transfers
  ADD COLUMN IF NOT EXISTS via_store_id text;

CREATE INDEX IF NOT EXISTS idx_uinv_transfers_parent ON public.uinv_transfers(parent_transfer_id);

COMMENT ON COLUMN public.uinv_transfers.parent_transfer_id IS 'Links two-leg transfers (Dept→Central→Dept). Leg 2 references Leg 1 id.';
COMMENT ON COLUMN public.uinv_transfers.leg IS '1 = first leg (Dept→Central), 2 = second leg (Central→Dept). Default 1 for normal transfers.';
COMMENT ON COLUMN public.uinv_transfers.via_store_id IS 'The intermediate store (Central) for two-leg department transfers.';

DO $$
BEGIN
  RAISE NOTICE 'Migration 380 complete: uinv_transfers now supports two-leg transfers via Central.';
END $$;
