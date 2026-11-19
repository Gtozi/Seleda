-- =============================================================================
-- Migration 445: Event Billing — charges, folio, invoice, AR
-- =============================================================================
-- PROBLEM
--   The Banquet portal's Billing tab was decorative. It POSTed to a route that
--   did not exist (/api/banquet-events/payments), read three columns that did
--   not exist (deposit_paid, final_balance, final_paid), and there was no link
--   of any kind between an event and a folio, invoice, AR entry or the GL.
--   Event "revenue" was whatever number a salesperson typed at booking time,
--   and actual_revenue was read but never written.
--
-- SOLUTION — one linear money path, no parallel ledgers:
--
--     source tables            event_charges         folio_lines
--   (venue / catering /   ->  (priced, taxed,   ->  (+ folio_payments)  ->
--    beverage / equipment      the single                                  |
--    / vendor / transport)     event ledger)                               v
--                                                                  invoice_documents
--                                                                          |
--                                              corporate ? -> ar_ledger ---+
--
--   Every amount on event_bookings is DERIVED from event_charges. Nothing is
--   hand-typed. Both settlement styles are supported per the billing_mode
--   column: 'direct' settles on the folio, 'corporate' additionally posts the
--   closing balance to AR against the corporate account.
--
-- Depends on: 444_event_bookings_unified, folios/folio_lines/folio_payments/
--             invoice_documents (schema.sql), 047 (ar_ledger), 243, 238
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Make the shared billing primitives event-aware
-- ─────────────────────────────────────────────────────────────────────────────

-- Event folios are not attached to a reservation (243 already made the column
-- nullable) and need their own folio_type and owner.
ALTER TABLE public.folios DROP CONSTRAINT IF EXISTS folios_folio_type_check;
ALTER TABLE public.folios ADD CONSTRAINT folios_folio_type_check
  CHECK (folio_type = ANY (ARRAY['Guest','Group','Master','Company','House','Event']));

ALTER TABLE public.folios ADD COLUMN IF NOT EXISTS event_id text;
CREATE INDEX IF NOT EXISTS idx_folios_event_id ON public.folios(event_id)
  WHERE event_id IS NOT NULL;

-- Event revenue does not fit 'Room'/'F&B' alone; give the categories real names
-- so USALI reporting can split venue rental from catering from AV hire.
ALTER TABLE public.folio_lines DROP CONSTRAINT IF EXISTS folio_lines_line_type_check;
ALTER TABLE public.folio_lines ADD CONSTRAINT folio_lines_line_type_check
  CHECK (line_type = ANY (ARRAY[
    'Room','F&B','Minibar','Laundry','Spa','Extra','Tax','ServiceCharge','Discount',
    'Package','Transfer','Adjustment','Other',
    'VenueRental','Catering','Beverage','Equipment','Vendor','Transport'
  ]));

-- Revenue accounts for event lines (chart_of_accounts is what folio_lines FKs to).
INSERT INTO public.chart_of_accounts (id, code, name, category, sub_category, balance, currency, is_active)
VALUES
  (gen_random_uuid()::text, '4050', 'Banquet & Event Revenue', 'Revenue', 'Food & Beverage', 0, 'ETB', true),
  (gen_random_uuid()::text, '4060', 'Venue & Conference Rental', 'Revenue', 'Other', 0, 'ETB', true)
ON CONFLICT (code) DO NOTHING;

-- AR was keyed exclusively to tour_operators, so corporate event balances had
-- nowhere to land and corporate_accounts.unpaid_balance was hand-edited in the
-- UI. Widen ar_ledger to carry corporate accounts and events.
ALTER TABLE public.ar_ledger ALTER COLUMN operator_id DROP NOT NULL;
ALTER TABLE public.ar_ledger ADD COLUMN IF NOT EXISTS corporate_account_id text
  REFERENCES public.corporate_accounts(id) ON DELETE SET NULL;
ALTER TABLE public.ar_ledger ADD COLUMN IF NOT EXISTS event_id text
  REFERENCES public.event_bookings(id) ON DELETE SET NULL;
ALTER TABLE public.ar_ledger ADD COLUMN IF NOT EXISTS invoice_id text;

ALTER TABLE public.ar_ledger DROP CONSTRAINT IF EXISTS ar_ledger_counterparty_check;
ALTER TABLE public.ar_ledger ADD CONSTRAINT ar_ledger_counterparty_check
  CHECK (operator_id IS NOT NULL OR corporate_account_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_ar_ledger_corporate
  ON public.ar_ledger(corporate_account_id, is_reconciled)
  WHERE corporate_account_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ar_ledger_event ON public.ar_ledger(event_id)
  WHERE event_id IS NOT NULL;

-- corporate_accounts.unpaid_balance becomes derived, not hand-typed.
CREATE OR REPLACE FUNCTION public.sync_corporate_unpaid_balance()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_account text := COALESCE(NEW.corporate_account_id, OLD.corporate_account_id);
BEGIN
  IF v_account IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  UPDATE public.corporate_accounts ca
  SET unpaid_balance = COALESCE((
        SELECT SUM(l.debit_amount - l.credit_amount)
        FROM public.ar_ledger l
        WHERE l.corporate_account_id = v_account
          AND NOT l.is_reconciled
      ), 0),
      updated_at = now()
  WHERE ca.id = v_account;

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_ar_ledger_sync_corporate ON public.ar_ledger;
CREATE TRIGGER trg_ar_ledger_sync_corporate
  AFTER INSERT OR UPDATE OR DELETE ON public.ar_ledger
  FOR EACH ROW EXECUTE FUNCTION public.sync_corporate_unpaid_balance();

COMMENT ON COLUMN public.corporate_accounts.unpaid_balance IS
  'DERIVED from unreconciled ar_ledger entries by sync_corporate_unpaid_balance(). '
  'Do not write directly.';

-- Unit prices on the logistics tables, which previously had no way to be priced
-- at all (banquet_menu_items / banquet_beverages already got unit_price in 109).
ALTER TABLE public.banquet_equipment      ADD COLUMN IF NOT EXISTS unit_price numeric(12,2) NOT NULL DEFAULT 0;
ALTER TABLE public.banquet_resources      ADD COLUMN IF NOT EXISTS unit_price numeric(12,2) NOT NULL DEFAULT 0;
ALTER TABLE public.banquet_transportation ADD COLUMN IF NOT EXISTS unit_price numeric(12,2) NOT NULL DEFAULT 0;
ALTER TABLE public.banquet_transportation ADD COLUMN IF NOT EXISTS is_chargeable boolean NOT NULL DEFAULT true;
ALTER TABLE public.banquet_vendors        ADD COLUMN IF NOT EXISTS is_rebillable boolean NOT NULL DEFAULT false;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. event_charges — the single event billing ledger
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.event_charges (
  id                   text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  property_id          uuid,
  event_id             text NOT NULL REFERENCES public.event_bookings(id) ON DELETE CASCADE,

  charge_type          text NOT NULL,
  description          text NOT NULL,
  quantity             numeric(12,3) NOT NULL DEFAULT 1,
  unit_price           numeric(12,2) NOT NULL DEFAULT 0,
  gross_amount         numeric(14,2) NOT NULL DEFAULT 0,
  discount_percent     numeric(6,3)  NOT NULL DEFAULT 0,
  discount_amount      numeric(14,2) NOT NULL DEFAULT 0,
  net_amount           numeric(14,2) NOT NULL DEFAULT 0,
  service_charge_amount numeric(14,2) NOT NULL DEFAULT 0,
  tax_amount           numeric(14,2) NOT NULL DEFAULT 0,
  total_amount         numeric(14,2) NOT NULL DEFAULT 0,

  is_taxable           boolean NOT NULL DEFAULT true,
  is_service_charged   boolean NOT NULL DEFAULT true,
  revenue_account_code text,

  -- Provenance: which source row generated this line. Lets rebuild be
  -- idempotent and keeps the charge traceable back to the catering/logistics
  -- entry the ops team actually made.
  source_table         text,
  source_id            text,

  is_manual            boolean NOT NULL DEFAULT false,
  is_voided            boolean NOT NULL DEFAULT false,
  voided_at            timestamptz,
  void_reason          text,

  folio_line_id        text REFERENCES public.folio_lines(id) ON DELETE SET NULL,
  posted_at            timestamptz,

  created_by           text,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.event_charges DROP CONSTRAINT IF EXISTS event_charges_charge_type_check;
ALTER TABLE public.event_charges ADD CONSTRAINT event_charges_charge_type_check
  CHECK (charge_type = ANY (ARRAY[
    'VenueRental','Catering','Beverage','Equipment','Vendor','Transport',
    'Labour','Decoration','Discount','Other'
  ]));

CREATE INDEX IF NOT EXISTS idx_event_charges_event ON public.event_charges(event_id);
CREATE INDEX IF NOT EXISTS idx_event_charges_unposted
  ON public.event_charges(event_id) WHERE folio_line_id IS NULL AND NOT is_voided;
-- One charge line per source row, so rebuild never duplicates. Deliberately not
-- a partial index: manual lines leave source_table/source_id NULL and NULLs are
-- distinct, so they are exempt automatically — and ON CONFLICT inference works.
CREATE UNIQUE INDEX IF NOT EXISTS idx_event_charges_source
  ON public.event_charges(source_table, source_id);

DROP TRIGGER IF EXISTS trg_event_charges_updated_at ON public.event_charges;
CREATE TRIGGER trg_event_charges_updated_at
  BEFORE UPDATE ON public.event_charges
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

COMMENT ON TABLE public.event_charges IS
  'Single priced ledger for an event. Auto-generated from catering/logistics '
  'source rows by rebuild_event_charges(); manual lines allowed with is_manual. '
  'Rolled up onto event_bookings by recalc_event_totals() and pushed to '
  'folio_lines by post_event_charges_to_folio().';

ALTER TABLE public.event_charges ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS event_charges_authenticated ON public.event_charges;
CREATE POLICY event_charges_authenticated ON public.event_charges
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.event_charges TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Tax / service charge rates, read from the same place as room billing
-- ─────────────────────────────────────────────────────────────────────────────

-- Resolve the VAT rate from the same fee_components definition that
-- post_folio_charge_with_routing uses, so events and rooms tax identically.
-- Falls back to global_settings.tax_percent, then 15%.
CREATE OR REPLACE FUNCTION public.event_vat_rate()
RETURNS numeric
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(
    (SELECT (elem->>'value')::numeric
     FROM public.global_settings g, jsonb_array_elements(g.fee_components) AS elem
     WHERE g.id = 'main'
       AND COALESCE((elem->>'isEnabled')::boolean, false)
       AND (lower(elem->>'name') LIKE '%vat%' OR lower(elem->>'name') LIKE '%tax%')
     LIMIT 1),
    (SELECT tax_percent FROM public.global_settings WHERE id = 'main'),
    15.0
  );
$$;

CREATE OR REPLACE FUNCTION public.event_service_charge_rate()
RETURNS numeric
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(
    (SELECT service_charge_percent FROM public.global_settings WHERE id = 'main'),
    10.0
  );
$$;

GRANT EXECUTE ON FUNCTION public.event_vat_rate() TO authenticated;
GRANT EXECUTE ON FUNCTION public.event_service_charge_rate() TO authenticated;

-- Price one charge line consistently: discount, then service charge on the
-- discounted net, then VAT on (net + service charge).
CREATE OR REPLACE FUNCTION public.price_event_charge(p_charge_id text)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_vat numeric := public.event_vat_rate();
  v_svc numeric := public.event_service_charge_rate();
BEGIN
  UPDATE public.event_charges c
  SET gross_amount          = round(c.quantity * c.unit_price, 2),
      discount_amount       = round(c.quantity * c.unit_price * c.discount_percent / 100.0, 2),
      net_amount            = round(c.quantity * c.unit_price
                                    - c.quantity * c.unit_price * c.discount_percent / 100.0, 2),
      service_charge_amount = CASE WHEN c.is_service_charged
        THEN round((c.quantity * c.unit_price
                    - c.quantity * c.unit_price * c.discount_percent / 100.0) * v_svc / 100.0, 2)
        ELSE 0 END,
      tax_amount = CASE WHEN c.is_taxable THEN round((
          (c.quantity * c.unit_price - c.quantity * c.unit_price * c.discount_percent / 100.0)
          + CASE WHEN c.is_service_charged
              THEN round((c.quantity * c.unit_price
                          - c.quantity * c.unit_price * c.discount_percent / 100.0) * v_svc / 100.0, 2)
              ELSE 0 END
        ) * v_vat / 100.0, 2) ELSE 0 END
  WHERE c.id = p_charge_id;

  UPDATE public.event_charges
  SET total_amount = net_amount + service_charge_amount + tax_amount
  WHERE id = p_charge_id;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. rebuild_event_charges — derive the ledger from what ops actually captured
-- ─────────────────────────────────────────────────────────────────────────────
-- Idempotent: re-running after the catering or logistics lists change refreshes
-- prices, adds new lines and removes lines whose source row is gone. Lines
-- already posted to a folio, and manual lines, are never touched.

CREATE OR REPLACE FUNCTION public.rebuild_event_charges(p_event_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_event public.event_bookings%ROWTYPE;
  v_days  integer;
  v_row   record;
  v_id    text;
  v_count integer := 0;
BEGIN
  SELECT * INTO v_event FROM public.event_bookings WHERE id = p_event_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Event not found');
  END IF;

  v_days := GREATEST(1, (COALESCE(v_event.end_date, v_event.start_date) - v_event.start_date) + 1);

  -- Drop auto-generated, unposted lines whose source row no longer exists.
  DELETE FROM public.event_charges c
  WHERE c.event_id = p_event_id
    AND NOT c.is_manual
    AND c.folio_line_id IS NULL
    AND c.source_table IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.banquet_menu_items      s WHERE c.source_table = 'banquet_menu_items'      AND s.id = c.source_id
      UNION ALL SELECT 1 FROM public.banquet_beverages      s WHERE c.source_table = 'banquet_beverages'      AND s.id = c.source_id
      UNION ALL SELECT 1 FROM public.banquet_equipment      s WHERE c.source_table = 'banquet_equipment'      AND s.id = c.source_id
      UNION ALL SELECT 1 FROM public.banquet_vendors        s WHERE c.source_table = 'banquet_vendors'        AND s.id = c.source_id
      UNION ALL SELECT 1 FROM public.banquet_transportation s WHERE c.source_table = 'banquet_transportation' AND s.id = c.source_id
      UNION ALL SELECT 1 FROM public.banquet_venues         s WHERE c.source_table = 'banquet_venues'         AND s.id = c.source_id
    );

  -- Venues can also be de-assigned without the venue row disappearing, so drop
  -- rental lines for venues no longer on the event.
  DELETE FROM public.event_charges c
  WHERE c.event_id = p_event_id
    AND c.source_table = 'banquet_venues'
    AND NOT c.is_manual
    AND c.folio_line_id IS NULL
    AND NOT (c.source_id = ANY (v_event.venue_ids));

  -- 4a. Venue rental: daily rate x nights, per assigned venue.
  FOR v_row IN
    SELECT v.id, v.venue_name, v.daily_rate
    FROM public.banquet_venues v
    WHERE v.id = ANY (v_event.venue_ids) AND COALESCE(v.daily_rate, 0) > 0
  LOOP
    v_id := NULL;
    INSERT INTO public.event_charges (
      property_id, event_id, charge_type, description, quantity, unit_price,
      revenue_account_code, source_table, source_id
    ) VALUES (
      v_event.property_id, p_event_id, 'VenueRental',
      format('%s rental (%s day%s)', v_row.venue_name, v_days, CASE WHEN v_days = 1 THEN '' ELSE 's' END),
      v_days, v_row.daily_rate, '4060', 'banquet_venues', v_row.id
    )
    ON CONFLICT (source_table, source_id) DO UPDATE
      SET quantity = EXCLUDED.quantity, unit_price = EXCLUDED.unit_price,
          description = EXCLUDED.description, updated_at = now()
      WHERE public.event_charges.folio_line_id IS NULL
    RETURNING id INTO v_id;
    IF v_id IS NOT NULL THEN PERFORM public.price_event_charge(v_id); v_count := v_count + 1; END IF;
  END LOOP;

  -- 4b. Catering: menu line x quantity (defaults to headcount when unset).
  FOR v_row IN
    SELECT m.id, m.dish_name, m.course_type, m.quantity, m.unit_price
    FROM public.banquet_menu_items m
    WHERE m.event_id = p_event_id AND COALESCE(m.unit_price, 0) > 0
  LOOP
    v_id := NULL;
    INSERT INTO public.event_charges (
      property_id, event_id, charge_type, description, quantity, unit_price,
      revenue_account_code, source_table, source_id
    ) VALUES (
      v_event.property_id, p_event_id, 'Catering',
      format('%s%s', v_row.dish_name,
             CASE WHEN v_row.course_type IS NULL THEN '' ELSE ' (' || v_row.course_type || ')' END),
      GREATEST(COALESCE(NULLIF(v_row.quantity, 0), v_event.expected_attendance), 1),
      v_row.unit_price, '4050', 'banquet_menu_items', v_row.id
    )
    ON CONFLICT (source_table, source_id) DO UPDATE
      SET quantity = EXCLUDED.quantity, unit_price = EXCLUDED.unit_price,
          description = EXCLUDED.description, updated_at = now()
      WHERE public.event_charges.folio_line_id IS NULL
    RETURNING id INTO v_id;
    IF v_id IS NOT NULL THEN PERFORM public.price_event_charge(v_id); v_count := v_count + 1; END IF;
  END LOOP;

  -- 4c. Beverages.
  FOR v_row IN
    SELECT b.id, b.name, b.category, b.quantity, b.unit_price
    FROM public.banquet_beverages b
    WHERE b.event_id = p_event_id AND COALESCE(b.unit_price, 0) > 0
  LOOP
    v_id := NULL;
    INSERT INTO public.event_charges (
      property_id, event_id, charge_type, description, quantity, unit_price,
      revenue_account_code, source_table, source_id
    ) VALUES (
      v_event.property_id, p_event_id, 'Beverage',
      format('%s%s', v_row.name,
             CASE WHEN v_row.category IS NULL THEN '' ELSE ' (' || v_row.category || ')' END),
      GREATEST(COALESCE(NULLIF(v_row.quantity, 0), v_event.expected_attendance), 1),
      v_row.unit_price, '4050', 'banquet_beverages', v_row.id
    )
    ON CONFLICT (source_table, source_id) DO UPDATE
      SET quantity = EXCLUDED.quantity, unit_price = EXCLUDED.unit_price,
          description = EXCLUDED.description, updated_at = now()
      WHERE public.event_charges.folio_line_id IS NULL
    RETURNING id INTO v_id;
    IF v_id IS NOT NULL THEN PERFORM public.price_event_charge(v_id); v_count := v_count + 1; END IF;
  END LOOP;

  -- 4d. Equipment / AV hire.
  FOR v_row IN
    SELECT e.id, e.equipment_name, e.equipment_type, e.quantity, e.unit_price
    FROM public.banquet_equipment e
    WHERE e.event_id = p_event_id AND COALESCE(e.unit_price, 0) > 0
  LOOP
    v_id := NULL;
    INSERT INTO public.event_charges (
      property_id, event_id, charge_type, description, quantity, unit_price,
      revenue_account_code, source_table, source_id
    ) VALUES (
      v_event.property_id, p_event_id, 'Equipment',
      format('%s hire%s', v_row.equipment_name,
             CASE WHEN v_row.equipment_type IS NULL THEN '' ELSE ' - ' || v_row.equipment_type END),
      GREATEST(COALESCE(NULLIF(v_row.quantity, 0), 1), 1),
      v_row.unit_price, '4040', 'banquet_equipment', v_row.id
    )
    ON CONFLICT (source_table, source_id) DO UPDATE
      SET quantity = EXCLUDED.quantity, unit_price = EXCLUDED.unit_price,
          description = EXCLUDED.description, updated_at = now()
      WHERE public.event_charges.folio_line_id IS NULL
    RETURNING id INTO v_id;
    IF v_id IS NOT NULL THEN PERFORM public.price_event_charge(v_id); v_count := v_count + 1; END IF;
  END LOOP;

  -- 4e. Third-party vendors, only where explicitly re-billable to the client.
  FOR v_row IN
    SELECT ve.id, ve.vendor_name, ve.vendor_type, ve.contract_value
    FROM public.banquet_vendors ve
    WHERE ve.event_id = p_event_id
      AND ve.is_rebillable
      AND COALESCE(ve.contract_value, 0) > 0
  LOOP
    v_id := NULL;
    INSERT INTO public.event_charges (
      property_id, event_id, charge_type, description, quantity, unit_price,
      revenue_account_code, source_table, source_id
    ) VALUES (
      v_event.property_id, p_event_id, 'Vendor',
      format('%s (%s)', v_row.vendor_name, COALESCE(v_row.vendor_type, 'vendor')),
      1, v_row.contract_value, '4040', 'banquet_vendors', v_row.id
    )
    ON CONFLICT (source_table, source_id) DO UPDATE
      SET unit_price = EXCLUDED.unit_price, description = EXCLUDED.description, updated_at = now()
      WHERE public.event_charges.folio_line_id IS NULL
    RETURNING id INTO v_id;
    IF v_id IS NOT NULL THEN PERFORM public.price_event_charge(v_id); v_count := v_count + 1; END IF;
  END LOOP;

  -- 4f. Guest transportation.
  FOR v_row IN
    SELECT t.id, t.vehicle_type, t.pickup_location, t.dropoff_location, t.unit_price
    FROM public.banquet_transportation t
    WHERE t.event_id = p_event_id AND t.is_chargeable AND COALESCE(t.unit_price, 0) > 0
  LOOP
    v_id := NULL;
    INSERT INTO public.event_charges (
      property_id, event_id, charge_type, description, quantity, unit_price,
      revenue_account_code, source_table, source_id
    ) VALUES (
      v_event.property_id, p_event_id, 'Transport',
      format('%s transfer: %s to %s', v_row.vehicle_type,
             COALESCE(v_row.pickup_location, '?'), COALESCE(v_row.dropoff_location, '?')),
      1, v_row.unit_price, '4040', 'banquet_transportation', v_row.id
    )
    ON CONFLICT (source_table, source_id) DO UPDATE
      SET unit_price = EXCLUDED.unit_price, description = EXCLUDED.description, updated_at = now()
      WHERE public.event_charges.folio_line_id IS NULL
    RETURNING id INTO v_id;
    IF v_id IS NOT NULL THEN PERFORM public.price_event_charge(v_id); v_count := v_count + 1; END IF;
  END LOOP;

  PERFORM public.recalc_event_totals(p_event_id);

  RETURN jsonb_build_object('success', true, 'eventId', p_event_id, 'linesTouched', v_count);
END;
$$;

GRANT EXECUTE ON FUNCTION public.rebuild_event_charges(text) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. recalc_event_totals — the only writer of event money columns
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.recalc_event_totals(p_event_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_net      numeric := 0;
  v_disc     numeric := 0;
  v_svc      numeric := 0;
  v_tax      numeric := 0;
  v_total    numeric := 0;
  v_deposit  numeric := 0;
  v_paid     numeric := 0;
  v_folio    text;
  v_status   text;
  v_event    public.event_bookings%ROWTYPE;
BEGIN
  SELECT * INTO v_event FROM public.event_bookings WHERE id = p_event_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Event not found');
  END IF;

  SELECT COALESCE(SUM(net_amount), 0), COALESCE(SUM(discount_amount), 0),
         COALESCE(SUM(service_charge_amount), 0), COALESCE(SUM(tax_amount), 0),
         COALESCE(SUM(total_amount), 0)
  INTO v_net, v_disc, v_svc, v_tax, v_total
  FROM public.event_charges
  WHERE event_id = p_event_id AND NOT is_voided;

  v_folio := v_event.folio_id;

  -- Payments live on the folio; deposits are the payments flagged as such.
  IF v_folio IS NOT NULL THEN
    SELECT COALESCE(SUM(amount), 0) INTO v_paid
    FROM public.folio_payments
    WHERE folio_id = v_folio AND NOT is_voided AND NOT is_refund;

    SELECT COALESCE(SUM(amount), 0) INTO v_deposit
    FROM public.folio_payments
    WHERE folio_id = v_folio AND NOT is_voided AND NOT is_refund
      AND COALESCE(payment_sub_type, '') = 'EventDeposit';
  END IF;

  v_status := CASE
    WHEN v_event.status = 'Cancelled'                       THEN 'Cancelled'
    WHEN v_total = 0 AND v_paid = 0                         THEN 'Unbilled'
    WHEN v_event.invoice_id IS NOT NULL AND v_paid >= v_total THEN 'Paid'
    WHEN v_event.invoice_id IS NOT NULL AND v_paid > 0      THEN 'PartiallyPaid'
    WHEN v_event.invoice_id IS NOT NULL                     THEN 'Invoiced'
    WHEN v_paid >= v_total AND v_total > 0                  THEN 'Paid'
    WHEN v_deposit > 0 OR v_paid > 0                        THEN 'DepositPaid'
    WHEN v_event.deposit_required > 0                       THEN 'DepositDue'
    ELSE 'Unbilled'
  END;

  UPDATE public.event_bookings
  SET charges_subtotal     = v_net,
      discount_total       = v_disc,
      service_charge_total = v_svc,
      tax_total            = v_tax,
      grand_total          = v_total,
      deposit_paid_amount  = v_deposit,
      paid_total           = v_paid,
      balance_due          = v_total - v_paid,
      -- Actual revenue is recognised only once the event has happened.
      actual_revenue       = CASE WHEN status IN ('Completed') THEN v_total ELSE actual_revenue END,
      billing_status       = v_status,
      updated_at           = now()
  WHERE id = p_event_id;

  RETURN jsonb_build_object(
    'success',       true,
    'eventId',       p_event_id,
    'subtotal',      v_net,
    'serviceCharge', v_svc,
    'tax',           v_tax,
    'grandTotal',    v_total,
    'depositPaid',   v_deposit,
    'paidTotal',     v_paid,
    'balanceDue',    v_total - v_paid,
    'billingStatus', v_status
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.recalc_event_totals(text) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. ensure_event_folio — one folio per event, lazily created
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.ensure_event_folio(p_event_id text, p_user_id text DEFAULT NULL)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_event public.event_bookings%ROWTYPE;
  v_folio text;
BEGIN
  SELECT * INTO v_event FROM public.event_bookings WHERE id = p_event_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Event % not found', p_event_id;
  END IF;

  IF v_event.folio_id IS NOT NULL THEN
    RETURN v_event.folio_id;
  END IF;

  SELECT id INTO v_folio FROM public.folios
  WHERE event_id = p_event_id AND status <> 'Voided' LIMIT 1;

  IF v_folio IS NULL THEN
    v_folio := gen_random_uuid()::text;
    INSERT INTO public.folios (
      id, reservation_id, event_id, folio_type, owner_type, owner_id,
      status, currency, opened_at, created_by, notes
    ) VALUES (
      v_folio, NULL, p_event_id, 'Event', 'Event', p_event_id,
      'Open', COALESCE(v_event.currency, 'ETB'), now(), p_user_id,
      format('Event folio for %s (%s)', v_event.event_name,
             COALESCE(v_event.event_code, p_event_id))
    );
  END IF;

  UPDATE public.event_bookings SET folio_id = v_folio, updated_at = now()
  WHERE id = p_event_id;

  RETURN v_folio;
END;
$$;

GRANT EXECUTE ON FUNCTION public.ensure_event_folio(text, text) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. post_event_charges_to_folio — event_charges -> folio_lines
-- ─────────────────────────────────────────────────────────────────────────────
-- Only unposted, unvoided lines move; folio_line_id back-links each one so a
-- charge can never be posted twice.

CREATE OR REPLACE FUNCTION public.post_event_charges_to_folio(
  p_event_id text,
  p_user_id  text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_folio  text;
  v_charge record;
  v_line   text;
  v_next   integer;
  v_posted integer := 0;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.event_bookings WHERE id = p_event_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Event not found');
  END IF;

  v_folio := public.ensure_event_folio(p_event_id, p_user_id);

  IF (SELECT status FROM public.folios WHERE id = v_folio) <> 'Open' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Event folio is not open');
  END IF;

  SELECT COALESCE(MAX(line_number), 0) INTO v_next
  FROM public.folio_lines WHERE folio_id = v_folio;

  FOR v_charge IN
    SELECT * FROM public.event_charges
    WHERE event_id = p_event_id AND folio_line_id IS NULL AND NOT is_voided
      AND total_amount <> 0
    ORDER BY charge_type, created_at
  LOOP
    v_next := v_next + 1;
    v_line := gen_random_uuid()::text;

    INSERT INTO public.folio_lines (
      id, folio_id, line_number, transaction_date, posting_date, description,
      amount, quantity, unit_price, line_type, revenue_account_code,
      tax_amount, source_module, source_reference, created_by
    ) VALUES (
      v_line, v_folio, v_next, CURRENT_DATE, now(),
      v_charge.description,
      v_charge.net_amount + v_charge.service_charge_amount,
      v_charge.quantity, v_charge.unit_price,
      v_charge.charge_type, v_charge.revenue_account_code,
      v_charge.tax_amount, 'banquet_events', v_charge.id, p_user_id
    );

    -- Tax as its own line, matching how room charges are posted.
    IF v_charge.tax_amount <> 0 THEN
      v_next := v_next + 1;
      INSERT INTO public.folio_lines (
        id, folio_id, line_number, transaction_date, posting_date, description,
        amount, quantity, line_type, source_module, source_reference, created_by
      ) VALUES (
        gen_random_uuid()::text, v_folio, v_next, CURRENT_DATE, now(),
        format('VAT on %s', v_charge.description),
        v_charge.tax_amount, 1, 'Tax', 'banquet_events', v_charge.id, p_user_id
      );
    END IF;

    UPDATE public.event_charges
    SET folio_line_id = v_line, posted_at = now()
    WHERE id = v_charge.id;

    v_posted := v_posted + 1;
  END LOOP;

  PERFORM public.recompute_folio_totals(v_folio);
  PERFORM public.recalc_event_totals(p_event_id);

  RETURN jsonb_build_object(
    'success', true, 'eventId', p_event_id, 'folioId', v_folio, 'linesPosted', v_posted
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.post_event_charges_to_folio(text, text) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. record_event_payment — deposits and settlements, one entry point
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.record_event_payment(
  p_event_id        text,
  p_amount          numeric,
  p_payment_method  text,
  p_is_deposit      boolean DEFAULT false,
  p_reference       text    DEFAULT NULL,
  p_notes           text    DEFAULT NULL,
  p_user_id         text    DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_event   public.event_bookings%ROWTYPE;
  v_folio   text;
  v_payment text;
BEGIN
  SELECT * INTO v_event FROM public.event_bookings WHERE id = p_event_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Event not found');
  END IF;

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Amount must be greater than zero');
  END IF;

  IF v_event.status = 'Cancelled' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Cannot take payment on a cancelled event');
  END IF;

  v_folio := public.ensure_event_folio(p_event_id, p_user_id);

  v_payment := gen_random_uuid()::text;
  INSERT INTO public.folio_payments (
    id, folio_id, payment_date, amount, payment_method, payment_sub_type,
    reference_number, created_by
  ) VALUES (
    v_payment, v_folio, now(), p_amount, p_payment_method,
    CASE WHEN p_is_deposit THEN 'EventDeposit' ELSE 'EventSettlement' END,
    p_reference, p_user_id
  );

  IF p_notes IS NOT NULL AND p_notes <> '' THEN
    UPDATE public.folios
    SET notes = COALESCE(notes, '') || E'\n' || p_notes
    WHERE id = v_folio;
  END IF;

  -- A deposit on a corporate contract marks the contract's deposit as paid.
  IF p_is_deposit AND v_event.contract_id IS NOT NULL THEN
    UPDATE public.sales_contracts SET deposit_paid = true WHERE id = v_event.contract_id;
  END IF;

  PERFORM public.recompute_folio_totals(v_folio);

  RETURN public.recalc_event_totals(p_event_id)
         || jsonb_build_object('paymentId', v_payment, 'folioId', v_folio);
END;
$$;

GRANT EXECUTE ON FUNCTION public.record_event_payment(text, numeric, text, boolean, text, text, text) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 9. settle_event — invoice, and for corporate events post the balance to AR
-- ─────────────────────────────────────────────────────────────────────────────
-- This is the terminal step of the linear flow. close_folio_with_invoice()
-- cannot be reused because it hard-requires a reservation.

CREATE OR REPLACE FUNCTION public.settle_event(
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
  v_payments numeric;
  v_balance  numeric;
  v_terms    text;
  v_due      date;
  v_ar       uuid;
  v_prev     numeric := 0;
BEGIN
  SELECT * INTO v_event FROM public.event_bookings WHERE id = p_event_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Event not found');
  END IF;

  IF v_event.status <> 'Completed' THEN
    RETURN jsonb_build_object('success', false,
      'error', 'Event must be Completed before it can be settled');
  END IF;

  IF v_event.invoice_id IS NOT NULL THEN
    RETURN jsonb_build_object('success', true, 'invoiceId', v_event.invoice_id, 'created', false);
  END IF;

  -- Sweep in anything not yet posted, then freeze the numbers.
  PERFORM public.rebuild_event_charges(p_event_id);
  PERFORM public.post_event_charges_to_folio(p_event_id, p_user_id);

  SELECT * INTO v_folio FROM public.folios WHERE id = v_event.folio_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Event has no folio');
  END IF;

  SELECT COALESCE(SUM(fl.amount + fl.tax_amount), 0) INTO v_charges
  FROM public.folio_lines fl WHERE fl.folio_id = v_folio.id AND NOT fl.is_voided;

  SELECT COALESCE(SUM(fp.amount), 0) INTO v_payments
  FROM public.folio_payments fp
  WHERE fp.folio_id = v_folio.id AND NOT fp.is_voided AND NOT fp.is_refund;

  v_balance := v_charges - v_payments;

  SELECT credit_terms INTO v_terms
  FROM public.corporate_accounts WHERE id = v_event.corporate_account_id;
  v_terms := COALESCE(v_terms, 'Net 30');

  -- 'Net 30' -> 30 days. Anything unparseable falls back to 30.
  v_due := (CURRENT_DATE + COALESCE(
    NULLIF(regexp_replace(v_terms, '\D', '', 'g'), '')::integer, 30))::date;

  SELECT custom_hotel_name, hotel_tin, hotel_vat_no, hotel_vat_date
  INTO v_settings FROM public.global_settings WHERE id = 'main';

  v_number := 'EINV-' || to_char(CURRENT_DATE, 'YYYYMMDD') || '-'
              || upper(substr(md5(random()::text || p_event_id), 1, 6));
  v_invoice := gen_random_uuid()::text;

  INSERT INTO public.invoice_documents (
    id, folio_id, invoice_number, invoice_type, issue_date, due_date,
    subtotal, tax_total, discount_total, total, amount_paid, status,
    customer_name, customer_email, customer_tin, customer_vat_no,
    hotel_tin, hotel_vat_no, hotel_vat_date, payment_terms, notes,
    is_voided, created_by
  ) VALUES (
    v_invoice, v_folio.id, v_number,
    CASE WHEN v_event.billing_mode = 'corporate' THEN 'Group Master' ELSE 'Tax' END,
    CURRENT_DATE, v_due,
    v_event.charges_subtotal + v_event.service_charge_total,
    v_event.tax_total,
    v_event.discount_total,
    v_charges,
    v_payments,
    CASE WHEN v_balance <= 0 THEN 'Paid' ELSE 'Issued' END,
    v_event.client_name,
    v_event.contact_email,
    (SELECT tax_id FROM public.corporate_accounts WHERE id = v_event.corporate_account_id),
    NULL,
    v_settings.hotel_tin, v_settings.hotel_vat_no, v_settings.hotel_vat_date,
    v_terms,
    format('Event %s — %s', COALESCE(v_event.event_code, p_event_id), v_event.event_name),
    false, p_user_id
  );

  -- Corporate events with a residual balance become AR, which is where the
  -- aging report and corporate_accounts.unpaid_balance now come from.
  IF v_event.billing_mode = 'corporate' AND v_balance > 0 THEN
    SELECT COALESCE(SUM(debit_amount - credit_amount), 0) INTO v_prev
    FROM public.ar_ledger WHERE corporate_account_id = v_event.corporate_account_id;

    v_ar := gen_random_uuid();
    INSERT INTO public.ar_ledger (
      id, corporate_account_id, event_id, folio_id, invoice_id, entry_type,
      description, debit_amount, credit_amount, balance_after, due_date,
      reference_no, posting_date
    ) VALUES (
      v_ar, v_event.corporate_account_id, p_event_id, v_folio.id, v_invoice, 'invoice',
      format('Event %s — %s', COALESCE(v_event.event_code, p_event_id), v_event.event_name),
      v_balance, 0, v_prev + v_balance, v_due, v_number, CURRENT_DATE
    );
  END IF;

  -- Direct-billed events with no balance can close immediately; corporate and
  -- unpaid folios stay open until the money arrives.
  IF v_balance <= 0 THEN
    UPDATE public.folios
    SET status = 'Closed', closed_at = now(), updated_at = now()
    WHERE id = v_folio.id;
  END IF;

  UPDATE public.event_bookings
  SET invoice_id     = v_invoice,
      actual_revenue = v_charges,
      updated_at     = now()
  WHERE id = p_event_id;

  PERFORM public.recalc_event_totals(p_event_id);

  RETURN jsonb_build_object(
    'success',       true,
    'created',       true,
    'invoiceId',     v_invoice,
    'invoiceNumber', v_number,
    'folioId',       v_folio.id,
    'total',         v_charges,
    'amountPaid',    v_payments,
    'balanceDue',    v_balance,
    'arPosted',      v_ar IS NOT NULL
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.settle_event(text, text) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 10. Keep totals live as charges and payments change
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.trg_recalc_event_totals()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM public.recalc_event_totals(COALESCE(NEW.event_id, OLD.event_id));
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_event_charges_recalc ON public.event_charges;
CREATE TRIGGER trg_event_charges_recalc
  AFTER INSERT OR UPDATE OF total_amount, is_voided OR DELETE ON public.event_charges
  FOR EACH ROW EXECUTE FUNCTION public.trg_recalc_event_totals();

-- Payments arrive on the folio, so map folio -> event before recalculating.
CREATE OR REPLACE FUNCTION public.trg_recalc_event_from_folio_payment()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_event text;
BEGIN
  SELECT event_id INTO v_event FROM public.folios
  WHERE id = COALESCE(NEW.folio_id, OLD.folio_id);

  IF v_event IS NOT NULL THEN
    PERFORM public.recalc_event_totals(v_event);
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_folio_payments_event_recalc ON public.folio_payments;
CREATE TRIGGER trg_folio_payments_event_recalc
  AFTER INSERT OR UPDATE OF amount, is_voided OR DELETE ON public.folio_payments
  FOR EACH ROW EXECUTE FUNCTION public.trg_recalc_event_from_folio_payment();

-- ─────────────────────────────────────────────────────────────────────────────
-- 11. Reporting views for the Billing tab and the dashboard
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE VIEW public.event_billing_summary AS
SELECT
  eb.id                         AS event_id,
  eb.property_id,
  eb.event_code,
  eb.event_name,
  eb.event_type,
  eb.client_name,
  eb.corporate_account_id,
  ca.company_name               AS corporate_account_name,
  eb.start_date,
  eb.end_date,
  eb.status,
  eb.billing_mode,
  eb.billing_status,
  eb.expected_attendance,
  eb.actual_attendance,
  eb.currency,
  eb.charges_subtotal,
  eb.discount_total,
  eb.service_charge_total,
  eb.tax_total,
  eb.grand_total,
  eb.deposit_required,
  eb.deposit_paid_amount,
  GREATEST(eb.deposit_required - eb.deposit_paid_amount, 0) AS deposit_outstanding,
  eb.deposit_required > 0 AND eb.deposit_paid_amount >= eb.deposit_required AS deposit_settled,
  eb.paid_total,
  eb.balance_due,
  eb.quoted_amount,
  eb.actual_revenue,
  eb.actual_revenue - eb.quoted_amount AS revenue_variance,
  eb.folio_id,
  eb.invoice_id,
  inv.invoice_number,
  inv.due_date                  AS invoice_due_date,
  inv.status                    AS invoice_status,
  f.status                      AS folio_status,
  (SELECT count(*) FROM public.event_charges c
    WHERE c.event_id = eb.id AND NOT c.is_voided)                       AS charge_line_count,
  (SELECT count(*) FROM public.event_charges c
    WHERE c.event_id = eb.id AND NOT c.is_voided AND c.folio_line_id IS NULL) AS unposted_line_count
FROM public.event_bookings eb
LEFT JOIN public.corporate_accounts ca ON ca.id = eb.corporate_account_id
LEFT JOIN public.invoice_documents  inv ON inv.id = eb.invoice_id
LEFT JOIN public.folios             f   ON f.id  = eb.folio_id;

GRANT SELECT ON public.event_billing_summary TO authenticated;

COMMENT ON VIEW public.event_billing_summary IS
  'Backing view for the Banquet portal Billing & Deposits tab. All figures are '
  'derived from event_charges / folio_payments — nothing here is hand-entered.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 12. Backfill: price and post existing events so the tab is not empty
-- ─────────────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  v_id text;
BEGIN
  FOR v_id IN SELECT id FROM public.event_bookings WHERE status <> 'Cancelled' LOOP
    BEGIN
      PERFORM public.rebuild_event_charges(v_id);
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'Skipped charge rebuild for event %: %', v_id, SQLERRM;
    END;
  END LOOP;
END $$;
