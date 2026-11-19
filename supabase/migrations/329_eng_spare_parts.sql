-- ============================================================
-- Engineering Portal — Spare Parts Enhancement (Migration 329)
-- ============================================================
-- The spare_parts table already exists (created by an earlier
-- migration) with 10 rows. This migration:
--   1. Adds `supplier` column to spare_parts.
--   2. Backfills property_id on existing rows to the demo property.
--   3. Creates spare_parts_transactions table for stock movements
--      (Reserve / Issue / Return / Consumption).
--   4. Seeds a few transactions matching the mock data in
--      SparePartsInterface.tsx.
-- ============================================================

-- ── 1. Add supplier column ───────────────────────────────────────
ALTER TABLE public.spare_parts
  ADD COLUMN IF NOT EXISTS supplier text;

-- ── 2. Backfill property_id on existing rows ─────────────────────
UPDATE public.spare_parts
SET property_id = '18762279-a389-41c9-9169-7ebc682e9703'
WHERE property_id IS NULL;

-- ── 3. spare_parts_transactions ──────────────────────────────────
CREATE TABLE IF NOT EXISTS public.spare_parts_transactions (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  property_id uuid,
  part_id text NOT NULL REFERENCES public.spare_parts(id) ON DELETE CASCADE,
  transaction_type text NOT NULL CHECK (transaction_type IN ('Reserve', 'Issue', 'Return', 'Consumption')),
  quantity integer NOT NULL DEFAULT 0,
  transaction_date timestamptz NOT NULL DEFAULT now(),
  work_order text,
  technician text,
  notes text,
  created_by text,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_spt_property_id ON public.spare_parts_transactions(property_id);
CREATE INDEX IF NOT EXISTS idx_spt_part_id ON public.spare_parts_transactions(part_id);
CREATE INDEX IF NOT EXISTS idx_spt_date ON public.spare_parts_transactions(transaction_date);

-- RLS
ALTER TABLE public.spare_parts_transactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated can CRUD spare_parts_transactions"
  ON public.spare_parts_transactions FOR ALL TO authenticated
  USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.spare_parts_transactions TO authenticated;

-- ── 4. Seed transactions ─────────────────────────────────────────
-- Match the mock transactions from SparePartsInterface.tsx.
-- Existing part IDs are SP-001 through SP-010.
INSERT INTO public.spare_parts_transactions (
  property_id, part_id, transaction_type, quantity, transaction_date, work_order, technician, notes
) VALUES
('18762279-a389-41c9-9169-7ebc682e9703', 'SP-001', 'Issue', 1, '2026-07-29 10:30:00', 'WO-2026-001', 'John Electrician', 'For chiller unit repair'),
('18762279-a389-41c9-9169-7ebc682e9703', 'SP-002', 'Consumption', 2, '2026-07-29 09:15:00', 'WO-2026-002', 'Maria HVAC', 'Regular filter replacement'),
('18762279-a389-41c9-9169-7ebc682e9703', 'SP-004', 'Reserve', 5, '2026-07-28 14:00:00', 'WO-2026-003', 'Carlos Mechanic', NULL)
ON CONFLICT DO NOTHING;
