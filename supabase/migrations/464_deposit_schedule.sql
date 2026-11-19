-- =============================================================================
-- Migration 464: Banquet & Events — deposit schedule + progressive billing
-- =============================================================================
-- GAP: Billing & Deposits (§27) calls for a Deposit Schedule and Progressive
-- Billing, but event_bookings had a single deposit_required amount and
-- settle_event() produced exactly one final invoice (event.invoice_id is
-- single-valued). Large events need staged deposits (e.g. 20% on signing,
-- 30% at T-30) and interim invoices before final settlement.
--
-- Adds:
--   event_deposit_schedule — dated deposit milestones per event.
--   event_deposit_schedule_status (view) — allocates the event's deposit
--     payments (folio_payments.payment_sub_type='EventDeposit') across the
--     schedule in due-date order, deriving Paid/PartiallyPaid/Due/Overdue.
--   issue_event_interim_invoice() — posts unbilled folio charges onto a new
--     invoice_documents row (invoice_type='Interim') without closing the
--     event. Settle still produces the final invoice; interim rows never set
--     event_bookings.invoice_id and never post to AR (AR stays the terminal
--     step's job so nothing is double-posted).
--
-- Depends on: 444 (event_bookings), 445 (event billing), 458 (RLS helper)
-- =============================================================================

-- ── 1. Deposit schedule ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.event_deposit_schedule (
  id          text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  property_id uuid,
  event_id    text NOT NULL REFERENCES public.event_bookings(id) ON DELETE CASCADE,
  label       text NOT NULL DEFAULT 'Deposit',
  due_date    date,
  amount      numeric(14,2) NOT NULL DEFAULT 0 CHECK (amount >= 0),
  notes       text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_event_deposit_schedule_event
  ON public.event_deposit_schedule (event_id);

ALTER TABLE public.event_deposit_schedule ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS event_deposit_schedule_property_scoped ON public.event_deposit_schedule;
CREATE POLICY event_deposit_schedule_property_scoped ON public.event_deposit_schedule
  FOR ALL TO authenticated
  USING (public.banquet_can_access_property(property_id))
  WITH CHECK (public.banquet_can_access_property(property_id));

DROP TRIGGER IF EXISTS trg_event_deposit_schedule_updated_at ON public.event_deposit_schedule;
CREATE TRIGGER trg_event_deposit_schedule_updated_at
  BEFORE UPDATE ON public.event_deposit_schedule
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ── 2. Paid/derived status per schedule line ────────────────────────────────
-- Deposit money arrives as folio_payments flagged 'EventDeposit'. The pool is
-- allocated across the schedule oldest-due-first; a line's paid share is
-- whatever remains after earlier lines are covered.

CREATE OR REPLACE VIEW public.event_deposit_schedule_status AS
WITH alloc AS (
  SELECT
    s.*,
    COALESCE(
      SUM(s.amount) OVER (
        PARTITION BY s.event_id
        ORDER BY s.due_date NULLS LAST, s.created_at
        ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
      ), 0) AS preceding_amount
  FROM public.event_deposit_schedule s
),
paid AS (
  SELECT f.event_id, COALESCE(SUM(fp.amount), 0) AS total_deposits
  FROM public.folio_payments fp
  JOIN public.folios f ON f.id = fp.folio_id
  WHERE NOT fp.is_voided
    AND NOT fp.is_refund
    AND fp.payment_sub_type = 'EventDeposit'
    AND f.event_id IS NOT NULL
  GROUP BY f.event_id
)
SELECT
  a.id,
  a.property_id,
  a.event_id,
  a.label,
  a.due_date,
  a.amount,
  a.notes,
  a.created_at,
  a.updated_at,
  COALESCE(p.total_deposits, 0)                                        AS event_deposits_total,
  LEAST(a.amount,
        GREATEST(COALESCE(p.total_deposits, 0) - a.preceding_amount, 0)) AS amount_paid,
  CASE
    WHEN LEAST(a.amount,
         GREATEST(COALESCE(p.total_deposits, 0) - a.preceding_amount, 0)) >= a.amount
      THEN 'Paid'
    WHEN GREATEST(COALESCE(p.total_deposits, 0) - a.preceding_amount, 0) > 0
      THEN 'PartiallyPaid'
    WHEN a.due_date IS NOT NULL AND a.due_date < CURRENT_DATE
      THEN 'Overdue'
    ELSE 'Due'
  END                                                                  AS status
FROM alloc a
LEFT JOIN paid p ON p.event_id = a.event_id;

GRANT SELECT ON public.event_deposit_schedule_status TO authenticated;

COMMENT ON VIEW public.event_deposit_schedule_status IS
  'Backs GET /api/banquet-events/events/:id/deposit-schedule. Paid status is '
  'derived from EventDeposit folio payments — never hand-maintained.';

-- ── 3. Interim invoices (progressive billing) ───────────────────────────────
-- An interim invoice covers charges posted to the event folio that no earlier
-- invoice has billed. Nothing is double-billed because each invoice only
-- claims the delta between total folio charges and previously invoiced totals.

ALTER TABLE public.invoice_documents
  ADD COLUMN IF NOT EXISTS event_id text;

CREATE INDEX IF NOT EXISTS idx_invoice_documents_event
  ON public.invoice_documents (event_id) WHERE event_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.issue_event_interim_invoice(
  p_event_id text,
  p_user_id  text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_event    public.event_bookings%ROWTYPE;
  v_folio    public.folios%ROWTYPE;
  v_settings record;
  v_invoice  text;
  v_number   text;
  v_charges  numeric;
  v_billed   numeric;
  v_delta    numeric;
  v_terms    text;
  v_due      date;
BEGIN
  SELECT * INTO v_event FROM public.event_bookings WHERE id = p_event_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Event not found');
  END IF;

  IF v_event.status IN ('Inquiry','Tentative','Cancelled') THEN
    RETURN jsonb_build_object('success', false,
      'error', format('Cannot invoice a %s event', v_event.status));
  END IF;

  -- Sweep pending charge lines onto the folio so the invoice sees everything.
  PERFORM public.rebuild_event_charges(p_event_id);
  PERFORM public.post_event_charges_to_folio(p_event_id, p_user_id);

  SELECT * INTO v_folio FROM public.folios WHERE id = v_event.folio_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Event has no folio');
  END IF;

  SELECT COALESCE(SUM(fl.amount + fl.tax_amount), 0) INTO v_charges
  FROM public.folio_lines fl WHERE fl.folio_id = v_folio.id AND NOT fl.is_voided;

  SELECT COALESCE(SUM(i.total), 0) INTO v_billed
  FROM public.invoice_documents i
  WHERE i.folio_id = v_folio.id AND NOT i.is_voided;

  v_delta := v_charges - v_billed;
  IF v_delta <= 0 THEN
    RETURN jsonb_build_object('success', false,
      'error', 'No unbilled charges — nothing to invoice');
  END IF;

  SELECT credit_terms INTO v_terms
  FROM public.corporate_accounts WHERE id = v_event.corporate_account_id;
  v_terms := COALESCE(v_terms, 'Net 30');
  v_due := (CURRENT_DATE + COALESCE(
    NULLIF(regexp_replace(v_terms, '\D', '', 'g'), '')::integer, 30))::date;

  SELECT custom_hotel_name, hotel_tin, hotel_vat_no, hotel_vat_date
  INTO v_settings FROM public.global_settings WHERE id = 'main';

  v_number  := 'EINT-' || to_char(CURRENT_DATE, 'YYYYMMDD') || '-'
               || upper(substr(md5(random()::text || p_event_id), 1, 6));
  v_invoice := gen_random_uuid()::text;

  INSERT INTO public.invoice_documents (
    id, folio_id, event_id, invoice_number, invoice_type, issue_date, due_date,
    subtotal, tax_total, discount_total, total, amount_paid, status,
    customer_name, customer_email, customer_tin, customer_vat_no,
    hotel_tin, hotel_vat_no, hotel_vat_date, payment_terms, notes,
    is_voided, created_by
  ) VALUES (
    v_invoice, v_folio.id, p_event_id, v_number, 'Interim',
    CURRENT_DATE, v_due,
    v_delta, 0, 0, v_delta, 0, 'Issued',
    v_event.client_name,
    v_event.contact_email,
    (SELECT tax_id FROM public.corporate_accounts WHERE id = v_event.corporate_account_id),
    NULL,
    v_settings.hotel_tin, v_settings.hotel_vat_no, v_settings.hotel_vat_date,
    v_terms,
    format('Interim invoice — Event %s — %s',
           COALESCE(v_event.event_code, p_event_id), v_event.event_name),
    false, p_user_id
  );

  RETURN jsonb_build_object(
    'success',       true,
    'invoiceId',     v_invoice,
    'invoiceNumber', v_number,
    'folioId',       v_folio.id,
    'billedToDate',  v_billed + v_delta,
    'invoiceTotal',  v_delta
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.issue_event_interim_invoice(text, text) TO authenticated;

COMMENT ON FUNCTION public.issue_event_interim_invoice(text, text) IS
  'Progressive billing: invoices the delta between folio charges and amounts '
  'already invoiced. Does not touch event_bookings.invoice_id or AR — '
  'settle_event remains the terminal step.';
