-- Migration 390: Add missing property_id FKs on Cash & Bank tables
-- The petty_cash_floats and cash_transactions tables have property_id uuid
-- columns but no foreign key to properties(id). The bank-reconciliation routes
-- use explicit FK names (petty_cash_floats_property_id_fkey /
-- cash_transactions_property_id_fkey) in their Supabase select joins, so the
-- FKs must exist with those exact names.

-- petty_cash_floats.property_id -> properties.id
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'petty_cash_floats_property_id_fkey'
      AND conrelid = 'public.petty_cash_floats'::regclass
  ) THEN
    ALTER TABLE public.petty_cash_floats
      ADD CONSTRAINT petty_cash_floats_property_id_fkey
      FOREIGN KEY (property_id) REFERENCES public.properties(id) ON DELETE SET NULL;
  END IF;
END $$;

-- cash_transactions.property_id -> properties.id
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'cash_transactions_property_id_fkey'
      AND conrelid = 'public.cash_transactions'::regclass
  ) THEN
    ALTER TABLE public.cash_transactions
      ADD CONSTRAINT cash_transactions_property_id_fkey
      FOREIGN KEY (property_id) REFERENCES public.properties(id) ON DELETE SET NULL;
  END IF;
END $$;
