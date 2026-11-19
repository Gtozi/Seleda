-- ============================================================
-- Finance — Financial Consolidation
-- (Migration 401)
-- ============================================================
-- Brings /erp/finance/consolidation fully online:
--   • fin_consolidation_entities  — subsidiaries / entities with
--     revenue, expenses, profit, base currency, and inclusion status.
--   • fin_consolidation_fx_rates  — currency translation rates.
--   • fin_consolidation_eliminations — inter-entity elimination entries.
-- All tables are RLS-enabled and seeded with demo rows.
-- ============================================================

-- Demo property: '18762279-a389-41c9-9169-7ebc682e9703' = Gheralta Main Property

-- ════════════════════════════════════════════════════════════════
-- 1. fin_consolidation_entities
-- ════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.fin_consolidation_entities (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  property_id uuid,
  entity_code text NOT NULL,
  entity_name text NOT NULL,
  entity_type text NOT NULL DEFAULT 'Hotel' CHECK (entity_type IN (
    'Hotel','Resort','Corporate','Subsidiary','JV','Other'
  )),
  base_currency text NOT NULL DEFAULT 'ETB',
  functional_currency text NOT NULL DEFAULT 'ETB',
  revenue numeric(18,2) NOT NULL DEFAULT 0,
  expenses numeric(18,2) NOT NULL DEFAULT 0,
  profit numeric(18,2) NOT NULL DEFAULT 0,
  ownership_pct numeric(5,2) NOT NULL DEFAULT 100.00,
  consolidation_status text NOT NULL DEFAULT 'Included' CHECK (consolidation_status IN (
    'Included','Excluded','Pending','Equity'
  )),
  period text,
  notes text,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_fin_ce_property ON public.fin_consolidation_entities(property_id);
CREATE INDEX IF NOT EXISTS idx_fin_ce_status ON public.fin_consolidation_entities(consolidation_status);
CREATE INDEX IF NOT EXISTS idx_fin_ce_type ON public.fin_consolidation_entities(entity_type);

ALTER TABLE public.fin_consolidation_entities ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "authenticated can CRUD fin_consolidation_entities" ON public.fin_consolidation_entities;
CREATE POLICY "authenticated can CRUD fin_consolidation_entities" ON public.fin_consolidation_entities
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "service_role all fin_consolidation_entities" ON public.fin_consolidation_entities;
CREATE POLICY "service_role all fin_consolidation_entities" ON public.fin_consolidation_entities
  FOR ALL TO service_role USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.fin_consolidation_entities TO authenticated;

-- ════════════════════════════════════════════════════════════════
-- 2. fin_consolidation_fx_rates
-- ════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.fin_consolidation_fx_rates (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  property_id uuid,
  from_currency text NOT NULL,
  to_currency text NOT NULL,
  rate numeric(18,6) NOT NULL,
  effective_date date NOT NULL,
  period text,
  source text,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_fin_fx_property ON public.fin_consolidation_fx_rates(property_id);
CREATE INDEX IF NOT EXISTS idx_fin_fx_pair ON public.fin_consolidation_fx_rates(from_currency, to_currency);
CREATE INDEX IF NOT EXISTS idx_fin_fx_date ON public.fin_consolidation_fx_rates(effective_date);

ALTER TABLE public.fin_consolidation_fx_rates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "authenticated can CRUD fin_consolidation_fx_rates" ON public.fin_consolidation_fx_rates;
CREATE POLICY "authenticated can CRUD fin_consolidation_fx_rates" ON public.fin_consolidation_fx_rates
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "service_role all fin_consolidation_fx_rates" ON public.fin_consolidation_fx_rates;
CREATE POLICY "service_role all fin_consolidation_fx_rates" ON public.fin_consolidation_fx_rates
  FOR ALL TO service_role USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.fin_consolidation_fx_rates TO authenticated;

-- ════════════════════════════════════════════════════════════════
-- 3. fin_consolidation_eliminations
-- ════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.fin_consolidation_eliminations (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  property_id uuid,
  elimination_number text,
  period text,
  description text,
  from_entity text,
  to_entity text,
  amount numeric(18,2) NOT NULL DEFAULT 0,
  elimination_type text NOT NULL DEFAULT 'Intercompany' CHECK (elimination_type IN (
    'Intercompany','Interentity','Goodwill','Unrealized Profit','Investment','Other'
  )),
  status text NOT NULL DEFAULT 'Pending' CHECK (status IN (
    'Pending','Posted','Reversed'
  )),
  posted_by text,
  posted_at timestamptz,
  notes text,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_fin_el_property ON public.fin_consolidation_eliminations(property_id);
CREATE INDEX IF NOT EXISTS idx_fin_el_status ON public.fin_consolidation_eliminations(status);
CREATE INDEX IF NOT EXISTS idx_fin_el_period ON public.fin_consolidation_eliminations(period);

ALTER TABLE public.fin_consolidation_eliminations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "authenticated can CRUD fin_consolidation_eliminations" ON public.fin_consolidation_eliminations;
CREATE POLICY "authenticated can CRUD fin_consolidation_eliminations" ON public.fin_consolidation_eliminations
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "service_role all fin_consolidation_eliminations" ON public.fin_consolidation_eliminations;
CREATE POLICY "service_role all fin_consolidation_eliminations" ON public.fin_consolidation_eliminations
  FOR ALL TO service_role USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.fin_consolidation_eliminations TO authenticated;

-- ════════════════════════════════════════════════════════════════
-- 4. Seed data
-- ════════════════════════════════════════════════════════════════
DO $$
DECLARE
  v_property_id uuid := '18762279-a389-41c9-9169-7ebc682e9703';
BEGIN
  -- Entities
  INSERT INTO public.fin_consolidation_entities (property_id, entity_code, entity_name, entity_type, base_currency, functional_currency, revenue, expenses, profit, ownership_pct, consolidation_status, period) VALUES
    (v_property_id, 'ENT-001', 'Gheralta Hotel', 'Hotel', 'ETB', 'ETB', 15000000, 12000000, 3000000, 100.00, 'Included', 'Q1 2024'),
    (v_property_id, 'ENT-002', 'Gheralta Resort', 'Resort', 'ETB', 'ETB', 8500000, 7000000, 1500000, 100.00, 'Included', 'Q1 2024'),
    (v_property_id, 'ENT-003', 'Corporate Office', 'Corporate', 'ETB', 'ETB', 2000000, 3500000, -1500000, 100.00, 'Included', 'Q1 2024')
  ON CONFLICT DO NOTHING;

  -- FX Rates
  INSERT INTO public.fin_consolidation_fx_rates (property_id, from_currency, to_currency, rate, effective_date, period, source) VALUES
    (v_property_id, 'USD', 'ETB', 57.50, '2024-01-31', 'Q1 2024', 'NBE'),
    (v_property_id, 'EUR', 'ETB', 62.30, '2024-01-31', 'Q1 2024', 'NBE')
  ON CONFLICT DO NOTHING;

  -- Eliminations
  INSERT INTO public.fin_consolidation_eliminations (property_id, elimination_number, period, description, from_entity, to_entity, amount, elimination_type, status) VALUES
    (v_property_id, 'ELIM-001', 'Q1 2024', 'Intercompany revenue elimination', 'Gheralta Hotel', 'Gheralta Resort', 300000, 'Intercompany', 'Posted'),
    (v_property_id, 'ELIM-002', 'Q1 2024', 'Intercompany expense elimination', 'Gheralta Resort', 'Gheralta Hotel', 200000, 'Intercompany', 'Posted')
  ON CONFLICT DO NOTHING;
END $$;
