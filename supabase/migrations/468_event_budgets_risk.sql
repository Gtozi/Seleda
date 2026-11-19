-- =============================================================================
-- Migration 468: Banquet & Events — event budget + risk assessment
-- =============================================================================
-- GAP: the event record in the spec (§Event Detail) carries a Budget and a
-- Risk Assessment, but event_bookings had neither — only a quoted amount.
--
-- Adds:
--   event_budgets — budgeted amounts per category per event. Categories are
--     free text but aligned to event_charges.charge_type (VenueRental,
--     Catering, Beverage, Equipment, Decoration, Staffing, Other) so the
--     variance view can compare budget vs actual charges.
--   event_budget_variance — per event/category budgeted vs actual spend.
--   event_bookings.risk_level / risk_notes — the risk assessment fields.
--
-- Depends on: 444 (event_bookings), 445 (event_charges), 458 (RLS helper)
-- =============================================================================

ALTER TABLE public.event_bookings
  ADD COLUMN IF NOT EXISTS risk_level text NOT NULL DEFAULT 'Low',
  ADD COLUMN IF NOT EXISTS risk_notes text;

COMMENT ON COLUMN public.event_bookings.risk_level IS 'Low | Medium | High | Critical';

CREATE TABLE IF NOT EXISTS public.event_budgets (
  id              text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  property_id     uuid,
  event_id        text NOT NULL REFERENCES public.event_bookings(id) ON DELETE CASCADE,
  category        text NOT NULL,
  item            text,
  budgeted_amount numeric(14,2) NOT NULL DEFAULT 0 CHECK (budgeted_amount >= 0),
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_event_budgets_event
  ON public.event_budgets (event_id);

ALTER TABLE public.event_budgets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS event_budgets_property_scoped ON public.event_budgets;
CREATE POLICY event_budgets_property_scoped ON public.event_budgets
  FOR ALL TO authenticated
  USING (public.banquet_can_access_property(property_id))
  WITH CHECK (public.banquet_can_access_property(property_id));

DROP TRIGGER IF EXISTS trg_event_budgets_updated_at ON public.event_budgets;
CREATE TRIGGER trg_event_budgets_updated_at
  BEFORE UPDATE ON public.event_budgets
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Budget vs actual, per event/category. Actual comes from non-voided
-- event_charges; budget categories use charge_type names for a clean join.
CREATE OR REPLACE VIEW public.event_budget_variance AS
SELECT
  eb.id                                              AS event_id,
  eb.property_id,
  eb.event_name,
  b.category,
  SUM(b.budgeted_amount)                             AS budgeted,
  COALESCE(act.actual, 0)                            AS actual,
  SUM(b.budgeted_amount) - COALESCE(act.actual, 0)   AS variance
FROM public.event_bookings eb
JOIN public.event_budgets b ON b.event_id = eb.id
LEFT JOIN (
  SELECT event_id, charge_type, SUM(total_amount) AS actual
  FROM public.event_charges
  WHERE NOT is_voided
  GROUP BY event_id, charge_type
) act ON act.event_id = eb.id AND act.charge_type = b.category
GROUP BY eb.id, eb.property_id, eb.event_name, b.category, act.actual;

GRANT SELECT ON public.event_budget_variance TO authenticated;

COMMENT ON VIEW public.event_budget_variance IS
  'Backs GET /api/banquet-events/events/:id/budget-variance.';
