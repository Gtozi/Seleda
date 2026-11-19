-- =============================================================================
-- Migration 444: Unified Event Booking Entity
-- =============================================================================
-- PROBLEM
--   Three parallel "event" entities existed with no shared identity:
--     * public.events                (Sales/CRM portal, migration 443)
--     * public.banquet_events        (Banquet ops portal, migration 082 + 101-113)
--     * public.banquet_event_orders  (dead third BEO table, migration 443)
--   The only bridge was a "shadow row" hack in POST /sales-events/events/:id/beo
--   which inserted a throwaway banquet_events row per BEO purely to satisfy a
--   foreign key. That polluted the ops event list and made revenue, attendance
--   and status impossible to reconcile across the two portals.
--
-- SOLUTION
--   public.event_bookings becomes the single canonical event entity for the
--   whole lifecycle: Inquiry -> Tentative -> Confirmed -> Planning -> InProgress
--   -> Completed. Every child table (BEO, catering, logistics, resources,
--   actuals, charges) hangs off it. `events` and `banquet_events` survive only
--   as READ-ONLY compatibility views so that any straggling reader keeps working
--   while any straggling writer fails loudly instead of silently forking data.
--
-- Depends on: 082_fb_core, 101-113_banquet_*, 115_sales_events_tables,
--             443_sales_portal_gap_fixes
-- =============================================================================

-- â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
-- 1. Canonical entity
-- â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

CREATE TABLE IF NOT EXISTS public.event_bookings (
  id                    text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  property_id           uuid,
  event_code            text UNIQUE,

  -- Identity
  event_name            text NOT NULL,
  event_type            text,

  -- Client / CRM linkage (single source of truth for "who is this for")
  client_id             text,
  client_name           text NOT NULL DEFAULT 'Unassigned',
  organizer_name        text,
  contact_email         text,
  contact_phone         text,
  corporate_account_id  text REFERENCES public.corporate_accounts(id) ON DELETE SET NULL,

  -- Commercial provenance: how this event entered the funnel
  lead_id               text REFERENCES public.sales_leads(id)     ON DELETE SET NULL,
  proposal_id           text REFERENCES public.sales_proposals(id) ON DELETE SET NULL,
  contract_id           text REFERENCES public.sales_contracts(id) ON DELETE SET NULL,

  -- Schedule
  start_date            date NOT NULL,
  end_date              date,
  setup_time            timestamptz,
  event_start_time      timestamptz,
  event_end_time        timestamptz,
  breakdown_time        timestamptz,

  -- Venue & scale
  venue_ids             text[] NOT NULL DEFAULT '{}'::text[],
  expected_attendance   integer NOT NULL DEFAULT 0,
  actual_attendance     integer,
  service_style         text,
  package_id            text,
  special_requirements  text,
  notes                 text,

  -- Single linear lifecycle
  status                text NOT NULL DEFAULT 'Inquiry',
  confirmed_at          timestamptz,
  completed_at          timestamptz,
  cancelled_at          timestamptz,
  cancellation_reason   text,

  -- Money. Quoted values are inputs; everything else is DERIVED from
  -- event_charges by recalc_event_totals() (migration 445). Never hand-edit.
  quoted_amount         numeric(14,2) NOT NULL DEFAULT 0,
  contracted_amount     numeric(14,2) NOT NULL DEFAULT 0,
  charges_subtotal      numeric(14,2) NOT NULL DEFAULT 0,
  discount_total        numeric(14,2) NOT NULL DEFAULT 0,
  service_charge_total  numeric(14,2) NOT NULL DEFAULT 0,
  tax_total             numeric(14,2) NOT NULL DEFAULT 0,
  grand_total           numeric(14,2) NOT NULL DEFAULT 0,
  deposit_required      numeric(14,2) NOT NULL DEFAULT 0,
  deposit_paid_amount   numeric(14,2) NOT NULL DEFAULT 0,
  paid_total            numeric(14,2) NOT NULL DEFAULT 0,
  balance_due           numeric(14,2) NOT NULL DEFAULT 0,
  actual_revenue        numeric(14,2) NOT NULL DEFAULT 0,
  currency              text NOT NULL DEFAULT 'ETB',

  -- Billing linkage (populated in migration 445)
  billing_mode          text NOT NULL DEFAULT 'direct',
  folio_id              text,
  invoice_id            text,
  billing_status        text NOT NULL DEFAULT 'Unbilled',

  -- Ops flags
  beo_generated         boolean NOT NULL DEFAULT false,
  beo_generated_at      timestamptz,

  -- Post-event
  satisfaction_score    numeric(4,2),
  feedback              text,

  created_by            text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.event_bookings DROP CONSTRAINT IF EXISTS event_bookings_status_check;
ALTER TABLE public.event_bookings ADD CONSTRAINT event_bookings_status_check
  CHECK (status = ANY (ARRAY[
    'Inquiry','Tentative','Confirmed','Planning','InProgress','Completed','Cancelled'
  ]));

ALTER TABLE public.event_bookings DROP CONSTRAINT IF EXISTS event_bookings_billing_mode_check;
ALTER TABLE public.event_bookings ADD CONSTRAINT event_bookings_billing_mode_check
  CHECK (billing_mode = ANY (ARRAY['direct','corporate']));

ALTER TABLE public.event_bookings DROP CONSTRAINT IF EXISTS event_bookings_billing_status_check;
ALTER TABLE public.event_bookings ADD CONSTRAINT event_bookings_billing_status_check
  CHECK (billing_status = ANY (ARRAY[
    'Unbilled','DepositDue','DepositPaid','Invoiced','PartiallyPaid','Paid','WrittenOff','Cancelled'
  ]));

-- A corporate-billed event must name the account it is billed to.
ALTER TABLE public.event_bookings DROP CONSTRAINT IF EXISTS event_bookings_corporate_billing_check;
ALTER TABLE public.event_bookings ADD CONSTRAINT event_bookings_corporate_billing_check
  CHECK (billing_mode <> 'corporate' OR corporate_account_id IS NOT NULL);

ALTER TABLE public.event_bookings DROP CONSTRAINT IF EXISTS event_bookings_date_order_check;
ALTER TABLE public.event_bookings ADD CONSTRAINT event_bookings_date_order_check
  CHECK (end_date IS NULL OR end_date >= start_date);

CREATE INDEX IF NOT EXISTS idx_event_bookings_property   ON public.event_bookings(property_id);
CREATE INDEX IF NOT EXISTS idx_event_bookings_start_date ON public.event_bookings(start_date);
CREATE INDEX IF NOT EXISTS idx_event_bookings_status     ON public.event_bookings(status);
CREATE INDEX IF NOT EXISTS idx_event_bookings_contract   ON public.event_bookings(contract_id);
CREATE INDEX IF NOT EXISTS idx_event_bookings_corporate  ON public.event_bookings(corporate_account_id);
CREATE INDEX IF NOT EXISTS idx_event_bookings_billing    ON public.event_bookings(billing_status);
-- Venue conflict detection scans venue_ids by overlapping date range.
CREATE INDEX IF NOT EXISTS idx_event_bookings_venue_ids  ON public.event_bookings USING gin(venue_ids);

DROP TRIGGER IF EXISTS trg_event_bookings_updated_at ON public.event_bookings;
CREATE TRIGGER trg_event_bookings_updated_at
  BEFORE UPDATE ON public.event_bookings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

COMMENT ON TABLE public.event_bookings IS
  'Canonical event entity. Replaces events + banquet_events + banquet_event_orders. '
  'Monetary columns other than quoted_amount/contracted_amount/deposit_required are '
  'derived from event_charges by recalc_event_totals(); do not write them directly.';

-- â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
-- 2. Human-readable event codes
-- â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

CREATE SEQUENCE IF NOT EXISTS public.event_code_seq;

CREATE OR REPLACE FUNCTION public.assign_event_code()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.event_code IS NULL THEN
    NEW.event_code := 'EVT-' || to_char(COALESCE(NEW.start_date, CURRENT_DATE), 'YYYY')
                    || '-' || lpad(nextval('public.event_code_seq')::text, 5, '0');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_event_bookings_code ON public.event_bookings;
CREATE TRIGGER trg_event_bookings_code
  BEFORE INSERT ON public.event_bookings
  FOR EACH ROW EXECUTE FUNCTION public.assign_event_code();

-- â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
-- 3. Backfill from both legacy tables
-- â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
-- banquet_events first (it is the richer source and owns all child FKs, so its
-- ids must be preserved verbatim). Shadow rows created by the old BEO hack are
-- excluded â€” they are duplicates of `events` rows and are re-linked in step 3b.

INSERT INTO public.event_bookings (
  id, property_id, event_name, event_type, client_id, client_name, organizer_name,
  start_date, end_date, venue_ids, expected_attendance, package_id, notes,
  status, quoted_amount, deposit_required, actual_revenue, created_at, updated_at
)
SELECT
  be.id,
  be.property_id,
  be.event_name,
  be.event_type,
  be.client_id,
  COALESCE(NULLIF(be.client_name, ''), 'Unassigned'),
  be.organizer_name,
  be.event_date,
  be.end_date,
  COALESCE(be.venue_ids, '{}'::text[]),
  COALESCE(be.guest_count, 0),
  be.package_id,
  be.notes,
  CASE be.status
    WHEN 'Draft'      THEN 'Inquiry'
    WHEN 'Tentative'  THEN 'Tentative'
    WHEN 'Planning'   THEN 'Planning'
    WHEN 'Confirmed'  THEN 'Confirmed'
    WHEN 'InProgress' THEN 'InProgress'
    WHEN 'Completed'  THEN 'Completed'
    WHEN 'Cancelled'  THEN 'Cancelled'
    ELSE 'Inquiry'
  END,
  COALESCE(be.estimated_revenue, 0),
  COALESCE(be.deposit_amount, 0),
  COALESCE(be.actual_revenue, 0),
  be.created_at,
  be.updated_at
FROM public.banquet_events be
WHERE COALESCE(be.notes, '') NOT LIKE 'Auto-created from Sales Events BEO for event %'
ON CONFLICT (id) DO NOTHING;

-- 3b. Now the sales-side `events`. Rows already represented by a shadow
-- banquet_events row are inserted under their own id; the shadow's children
-- (BEOs) are re-parented onto them further down.

INSERT INTO public.event_bookings (
  id, property_id, event_name, event_type, client_name, corporate_account_id,
  start_date, end_date, expected_attendance, service_style, special_requirements,
  status, quoted_amount, actual_revenue, beo_generated, beo_generated_at,
  created_at, updated_at
)
SELECT
  e.id,
  e.property_id,
  e.name,
  e.event_type,
  COALESCE(NULLIF(e.name, ''), 'Unassigned'),
  e.corporate_account_id,
  e.event_date,
  e.end_date,
  COALESCE(e.expected_attendees, 0),
  e.service_style,
  e.special_requirements,
  CASE e.status
    WHEN 'pending'   THEN 'Tentative'
    WHEN 'confirmed' THEN 'Confirmed'
    WHEN 'completed' THEN 'Completed'
    WHEN 'cancelled' THEN 'Cancelled'
    ELSE 'Inquiry'
  END,
  COALESCE(e.estimated_revenue, 0),
  COALESCE(e.actual_revenue, 0),
  COALESCE(e.beo_generated, false),
  e.beo_generated_at,
  e.created_at,
  e.updated_at
FROM public.events e
ON CONFLICT (id) DO NOTHING;

-- 3c. Fold post-event actuals into the canonical row (they were a side table
-- that never propagated back to the event, so actual_revenue was always 0).
UPDATE public.event_bookings eb
SET actual_attendance  = COALESCE(a.actual_attendees, eb.actual_attendance),
    actual_revenue     = GREATEST(COALESCE(a.actual_revenue, 0), eb.actual_revenue),
    satisfaction_score = COALESCE(a.satisfaction_score, eb.satisfaction_score),
    feedback           = COALESCE(a.feedback, eb.feedback)
FROM (
  SELECT DISTINCT ON (event_id) event_id, actual_attendees, actual_revenue,
         satisfaction_score, feedback
  FROM public.event_actuals
  ORDER BY event_id, recorded_at DESC
) a
WHERE a.event_id = eb.id;

-- 3d. Link events back to their originating contract (sales_contracts.beo_id
-- pointed at banquet_events).
UPDATE public.event_bookings eb
SET contract_id          = sc.id,
    corporate_account_id = COALESCE(eb.corporate_account_id, sc.corporate_account_id),
    proposal_id          = COALESCE(eb.proposal_id, sc.proposal_id),
    lead_id              = COALESCE(eb.lead_id, sc.lead_id),
    contracted_amount    = COALESCE(sc.total_value, 0),
    deposit_required     = GREATEST(eb.deposit_required, COALESCE(sc.deposit_amount, 0))
FROM public.sales_contracts sc
WHERE sc.beo_id = eb.id;

-- Corporate accounts get corporate billing by default.
UPDATE public.event_bookings
SET billing_mode = 'corporate'
WHERE corporate_account_id IS NOT NULL;

-- â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
-- 4. Re-parent BEOs that hung off shadow rows
-- â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
-- The old hack encoded the real event id in the shadow's notes field.

UPDATE public.banquet_beos b
SET event_id = substring(shadow.notes from 'for event ([^ ]+)$')
FROM public.banquet_events shadow
WHERE b.event_id = shadow.id
  AND shadow.notes LIKE 'Auto-created from Sales Events BEO for event %'
  AND EXISTS (
    SELECT 1 FROM public.event_bookings eb
    WHERE eb.id = substring(shadow.notes from 'for event ([^ ]+)$')
  );

-- Anything still pointing at a shadow (real event since deleted) is orphaned.
DELETE FROM public.banquet_beos b
WHERE EXISTS (
  SELECT 1 FROM public.banquet_events shadow
  WHERE shadow.id = b.event_id
    AND shadow.notes LIKE 'Auto-created from Sales Events BEO for event %'
);

-- â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
-- 5. Repoint every child foreign key onto event_bookings
-- â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

DO $$
DECLARE
  child     text;
  children  text[] := ARRAY[
    -- were referencing banquet_events
    'banquet_schedules','banquet_checklists','banquet_beos',
    'banquet_event_type_items','banquet_event_type_checklists',
    'banquet_menu_items','banquet_beverages',
    'banquet_resources','banquet_equipment','banquet_vendors','banquet_transportation',
    -- were referencing events
    'event_resource_bookings','event_actuals'
  ];
  fk_name   text;
BEGIN
  FOREACH child IN ARRAY children LOOP
    IF to_regclass('public.' || child) IS NULL THEN
      CONTINUE;
    END IF;

    -- Drop whatever FK currently constrains event_id, whatever it was named.
    FOR fk_name IN
      SELECT con.conname
      FROM pg_constraint con
      JOIN pg_class rel ON rel.oid = con.conrelid
      JOIN pg_namespace ns ON ns.oid = rel.relnamespace
      WHERE ns.nspname = 'public'
        AND rel.relname = child
        AND con.contype = 'f'
        AND EXISTS (
          SELECT 1
          FROM unnest(con.conkey) AS k(attnum)
          JOIN pg_attribute att
            ON att.attrelid = con.conrelid AND att.attnum = k.attnum
          WHERE att.attname = 'event_id'
        )
    LOOP
      EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT %I', child, fk_name);
    END LOOP;

    -- Clear rows whose parent did not survive the merge, so the new FK is valid.
    EXECUTE format(
      'DELETE FROM public.%I c WHERE c.event_id IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM public.event_bookings eb WHERE eb.id = c.event_id)',
      child
    );

    EXECUTE format(
      'ALTER TABLE public.%I ADD CONSTRAINT %I
         FOREIGN KEY (event_id) REFERENCES public.event_bookings(id) ON DELETE CASCADE',
      child, child || '_event_id_fkey'
    );

    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS %I ON public.%I(event_id)',
      'idx_' || child || '_event_id', child
    );
  END LOOP;
END $$;

-- sales_contracts.beo_id -> event_bookings
ALTER TABLE public.sales_contracts DROP CONSTRAINT IF EXISTS sales_contracts_beo_id_fkey;
UPDATE public.sales_contracts sc
SET beo_id = NULL
WHERE sc.beo_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM public.event_bookings eb WHERE eb.id = sc.beo_id);
ALTER TABLE public.sales_contracts
  ADD CONSTRAINT sales_contracts_beo_id_fkey
  FOREIGN KEY (beo_id) REFERENCES public.event_bookings(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.sales_contracts.beo_id IS
  'The event_bookings row generated from this contract (create_event_from_contract).';

-- â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
-- 6. Retire the legacy tables
-- â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
-- banquet_event_orders was never read or written by any code path â€” it is the
-- third, fully dead BEO table. banquet_beos is the survivor.

DROP TABLE IF EXISTS public.banquet_event_orders CASCADE;
DROP TABLE IF EXISTS public.banquet_events       CASCADE;
DROP TABLE IF EXISTS public.events               CASCADE;

-- Read-only compatibility views. Reads keep working; writes raise an error
-- rather than silently forking data into a second event universe.

CREATE OR REPLACE VIEW public.banquet_events AS
SELECT
  id,
  property_id,
  event_name,
  start_date            AS event_date,
  end_date,
  client_name,
  client_id,
  organizer_name,
  event_type,
  expected_attendance   AS guest_count,
  expected_attendance   AS expected_attendees,
  package_id            AS menu_package,
  package_id,
  venue_ids,
  status,
  quoted_amount         AS estimated_revenue,
  actual_revenue,
  deposit_required      AS deposit_amount,
  notes,
  created_at,
  updated_at
FROM public.event_bookings;

CREATE OR REPLACE VIEW public.events AS
SELECT
  id,
  property_id,
  event_name            AS name,
  start_date            AS event_date,
  end_date,
  event_type,
  lower(status)         AS status,
  expected_attendance   AS expected_attendees,
  quoted_amount         AS estimated_revenue,
  actual_revenue,
  setup_time,
  event_start_time      AS start_time,
  event_end_time        AS end_time,
  service_style,
  special_requirements,
  beo_generated,
  beo_generated_at,
  corporate_account_id,
  created_at,
  updated_at
FROM public.event_bookings;

COMMENT ON VIEW public.banquet_events IS
  'DEPRECATED read-only compatibility view over event_bookings. Migration 444. '
  'Do not write through this view â€” target event_bookings directly.';
COMMENT ON VIEW public.events IS
  'DEPRECATED read-only compatibility view over event_bookings. Migration 444. '
  'Do not write through this view â€” target event_bookings directly.';

-- â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
-- 7. Linear lifecycle enforcement
-- â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
-- One ladder, forward-only, with Cancelled reachable from any pre-Completed
-- state. This is what makes the flow linear instead of a free-for-all status
-- write (the old PUT /events/:id/status accepted any value from any state).

CREATE OR REPLACE FUNCTION public.event_status_rank(p_status text)
RETURNS integer
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE p_status
    WHEN 'Inquiry'    THEN 1
    WHEN 'Tentative'  THEN 2
    WHEN 'Confirmed'  THEN 3
    WHEN 'Planning'   THEN 4
    WHEN 'InProgress' THEN 5
    WHEN 'Completed'  THEN 6
    WHEN 'Cancelled'  THEN 99
    ELSE 0
  END;
$$;

CREATE OR REPLACE FUNCTION public.advance_event_status(
  p_event_id text,
  p_status   text,
  p_user_id  text DEFAULT NULL,
  p_reason   text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_event    public.event_bookings%ROWTYPE;
  v_from     integer;
  v_to       integer;
  v_venue    text;
  v_conflict text;
BEGIN
  SELECT * INTO v_event FROM public.event_bookings WHERE id = p_event_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Event not found');
  END IF;

  v_from := public.event_status_rank(v_event.status);
  v_to   := public.event_status_rank(p_status);

  IF v_to = 0 THEN
    RETURN jsonb_build_object('success', false, 'error', format('Unknown status %L', p_status));
  END IF;

  IF v_event.status = 'Completed' OR v_event.status = 'Cancelled' THEN
    RETURN jsonb_build_object('success', false,
      'error', format('Event is %s and cannot change status', v_event.status));
  END IF;

  -- Forward-only, one step at a time (Cancelled is always reachable).
  IF p_status <> 'Cancelled' AND v_to <> v_from + 1 THEN
    RETURN jsonb_build_object('success', false,
      'error', format('Invalid transition %s -> %s. Events must progress one stage at a time.',
                      v_event.status, p_status));
  END IF;

  -- Gate: confirming an event requires a client, a venue and a date range.
  IF p_status = 'Confirmed' THEN
    IF v_event.client_name IS NULL OR v_event.client_name = 'Unassigned' THEN
      RETURN jsonb_build_object('success', false,
        'error', 'Cannot confirm: event has no client');
    END IF;
    IF array_length(v_event.venue_ids, 1) IS NULL THEN
      RETURN jsonb_build_object('success', false,
        'error', 'Cannot confirm: no venue assigned');
    END IF;

    -- Gate: no double-booking a venue against another confirmed event.
    FOREACH v_venue IN ARRAY v_event.venue_ids LOOP
      SELECT eb.event_code INTO v_conflict
      FROM public.event_bookings eb
      WHERE eb.id <> v_event.id
        AND eb.status IN ('Confirmed','Planning','InProgress')
        AND v_venue = ANY (eb.venue_ids)
        AND daterange(eb.start_date, COALESCE(eb.end_date, eb.start_date), '[]')
            && daterange(v_event.start_date, COALESCE(v_event.end_date, v_event.start_date), '[]')
      LIMIT 1;

      IF v_conflict IS NOT NULL THEN
        RETURN jsonb_build_object('success', false,
          'error', format('Venue conflict: %s is already held by event %s', v_venue, v_conflict));
      END IF;
    END LOOP;
  END IF;

  -- Gate: an event cannot be marked Completed before its end date.
  IF p_status = 'Completed'
     AND COALESCE(v_event.end_date, v_event.start_date) > CURRENT_DATE THEN
    RETURN jsonb_build_object('success', false,
      'error', 'Cannot complete an event before its end date');
  END IF;

  UPDATE public.event_bookings
  SET status              = p_status,
      confirmed_at        = CASE WHEN p_status = 'Confirmed' THEN now() ELSE confirmed_at END,
      completed_at        = CASE WHEN p_status = 'Completed' THEN now() ELSE completed_at END,
      cancelled_at        = CASE WHEN p_status = 'Cancelled' THEN now() ELSE cancelled_at END,
      cancellation_reason = CASE WHEN p_status = 'Cancelled' THEN p_reason ELSE cancellation_reason END,
      billing_status      = CASE WHEN p_status = 'Cancelled' AND billing_status = 'Unbilled'
                                 THEN 'Cancelled' ELSE billing_status END,
      updated_at          = now()
  WHERE id = p_event_id;

  RETURN jsonb_build_object(
    'success',    true,
    'eventId',    p_event_id,
    'fromStatus', v_event.status,
    'toStatus',   p_status
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.advance_event_status(text, text, text, text) TO authenticated;

-- â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
-- 8. Contract -> Event, replacing create_beo_from_contract
-- â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
-- The old function created a BEO-shaped row directly in banquet_events, which
-- conflated "the event" with "the BEO". Now a contract produces an EVENT; the
-- BEO is produced later from the event, in the ops portal.

DROP FUNCTION IF EXISTS public.create_beo_from_contract(text) CASCADE;

CREATE OR REPLACE FUNCTION public.create_event_from_contract(p_contract_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_contract public.sales_contracts%ROWTYPE;
  v_client   text;
  v_event_id text;
BEGIN
  SELECT * INTO v_contract FROM public.sales_contracts WHERE id = p_contract_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Contract not found');
  END IF;

  -- Idempotent: one contract yields at most one event.
  IF v_contract.beo_id IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.event_bookings WHERE id = v_contract.beo_id) THEN
    RETURN jsonb_build_object('success', true, 'eventId', v_contract.beo_id, 'created', false);
  END IF;

  SELECT company_name INTO v_client
  FROM public.corporate_accounts WHERE id = v_contract.corporate_account_id;

  v_event_id := gen_random_uuid()::text;

  INSERT INTO public.event_bookings (
    id, property_id, event_name, event_type,
    client_name, corporate_account_id, contract_id, proposal_id, lead_id,
    start_date, end_date, expected_attendance,
    status, quoted_amount, contracted_amount, deposit_required,
    billing_mode, billing_status, notes, created_by
  ) VALUES (
    v_event_id,
    v_contract.property_id,
    v_contract.title,
    v_contract.event_type,
    COALESCE(v_client, v_contract.signed_by_client, 'Unassigned'),
    v_contract.corporate_account_id,
    v_contract.id,
    v_contract.proposal_id,
    v_contract.lead_id,
    COALESCE(v_contract.start_date, CURRENT_DATE),
    v_contract.end_date,
    COALESCE(v_contract.guest_count, 0),
    'Confirmed',
    COALESCE(v_contract.total_value, 0),
    COALESCE(v_contract.total_value, 0),
    COALESCE(v_contract.deposit_amount, 0),
    CASE WHEN v_contract.corporate_account_id IS NOT NULL THEN 'corporate' ELSE 'direct' END,
    CASE WHEN COALESCE(v_contract.deposit_amount, 0) > 0 AND NOT COALESCE(v_contract.deposit_paid, false)
         THEN 'DepositDue' ELSE 'Unbilled' END,
    format('Generated from contract %s', COALESCE(v_contract.contract_number, v_contract.id)),
    v_contract.created_by
  );

  UPDATE public.event_bookings SET confirmed_at = now() WHERE id = v_event_id;
  UPDATE public.sales_contracts SET beo_id = v_event_id WHERE id = p_contract_id;

  RETURN jsonb_build_object('success', true, 'eventId', v_event_id, 'created', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_event_from_contract(text) TO authenticated;

-- â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
-- 9. Event -> BEO, single entry point
-- â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
-- Replaces both the shadow-row hack and the ad-hoc POST /beos insert. One BEO
-- per event, seeded from the event and its already-captured catering/logistics.

CREATE OR REPLACE FUNCTION public.generate_beo_for_event(
  p_event_id text,
  p_user_id  text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_event  public.event_bookings%ROWTYPE;
  v_beo_id text;
BEGIN
  SELECT * INTO v_event FROM public.event_bookings WHERE id = p_event_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Event not found');
  END IF;

  IF v_event.status IN ('Inquiry','Tentative') THEN
    RETURN jsonb_build_object('success', false,
      'error', 'Confirm the event before generating a BEO');
  END IF;

  -- Idempotent: reuse the existing BEO for this event.
  SELECT id INTO v_beo_id FROM public.banquet_beos WHERE event_id = p_event_id LIMIT 1;
  IF v_beo_id IS NOT NULL THEN
    RETURN jsonb_build_object('success', true, 'beoId', v_beo_id, 'created', false);
  END IF;

  v_beo_id := gen_random_uuid()::text;

  INSERT INTO public.banquet_beos (
    id, property_id, event_id, event_name, client_name, event_date, venue_ids,
    setup_time, event_start_time, event_end_time, breakdown_time,
    menu_items, beverage_items, equipment, staffing, special_requests,
    vip_information, status
  ) VALUES (
    v_beo_id,
    v_event.property_id,
    v_event.id,
    v_event.event_name,
    v_event.client_name,
    v_event.start_date,
    v_event.venue_ids,
    v_event.setup_time,
    v_event.event_start_time,
    v_event.event_end_time,
    v_event.breakdown_time,
    COALESCE((SELECT array_agg(dish_name ORDER BY course_type, dish_name)
              FROM public.banquet_menu_items WHERE event_id = p_event_id), '{}'::text[]),
    COALESCE((SELECT array_agg(name ORDER BY category, name)
              FROM public.banquet_beverages WHERE event_id = p_event_id), '{}'::text[]),
    COALESCE((SELECT array_agg(equipment_name ORDER BY equipment_name)
              FROM public.banquet_equipment WHERE event_id = p_event_id), '{}'::text[]),
    '[]'::jsonb,
    CASE WHEN v_event.special_requirements IS NULL OR v_event.special_requirements = ''
         THEN '{}'::text[] ELSE ARRAY[v_event.special_requirements] END,
    '{}'::text[],
    'Draft'
  );

  UPDATE public.event_bookings
  SET beo_generated    = true,
      beo_generated_at = now(),
      status           = CASE WHEN status = 'Confirmed' THEN 'Planning' ELSE status END,
      updated_at       = now()
  WHERE id = p_event_id;

  RETURN jsonb_build_object('success', true, 'beoId', v_beo_id, 'created', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.generate_beo_for_event(text, text) TO authenticated;

-- One BEO per event, enforced.
CREATE UNIQUE INDEX IF NOT EXISTS idx_banquet_beos_event_unique
  ON public.banquet_beos(event_id) WHERE event_id IS NOT NULL;

-- â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
-- 10. BEO distribution fans out real department tasks
-- â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
-- Previously "Distributed" only stamped distributed_at; no department was ever
-- told. Now it materialises schedule rows so Kitchen/Bar/HK/Eng/Service see it.

CREATE OR REPLACE FUNCTION public.distribute_beo(
  p_beo_id  text,
  p_user_id text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_beo   public.banquet_beos%ROWTYPE;
  v_event public.event_bookings%ROWTYPE;
  v_dept  text;
  v_depts text[] := ARRAY['Kitchen','Bar','Housekeeping','Engineering','Service','AV'];
  v_made  integer := 0;
BEGIN
  SELECT * INTO v_beo FROM public.banquet_beos WHERE id = p_beo_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'BEO not found');
  END IF;

  SELECT * INTO v_event FROM public.event_bookings WHERE id = v_beo.event_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'BEO has no parent event');
  END IF;

  IF v_beo.status NOT IN ('Approved','Revised') THEN
    RETURN jsonb_build_object('success', false,
      'error', 'BEO must be Approved before distribution');
  END IF;

  FOREACH v_dept IN ARRAY v_depts LOOP
    -- Skip departments with nothing to do for this event.
    IF v_dept = 'Kitchen' AND NOT EXISTS (
         SELECT 1 FROM public.banquet_menu_items WHERE event_id = v_event.id) THEN
      CONTINUE;
    END IF;
    IF v_dept = 'Bar' AND NOT EXISTS (
         SELECT 1 FROM public.banquet_beverages WHERE event_id = v_event.id) THEN
      CONTINUE;
    END IF;
    IF v_dept IN ('Engineering','AV') AND NOT EXISTS (
         SELECT 1 FROM public.banquet_equipment WHERE event_id = v_event.id) THEN
      CONTINUE;
    END IF;

    -- Idempotent: re-distributing a revised BEO must not duplicate tasks.
    IF EXISTS (
      SELECT 1 FROM public.banquet_schedules
      WHERE event_id = v_event.id AND department = v_dept
        AND task_name = format('BEO %s: %s readiness', v_beo.id, v_dept)
    ) THEN
      CONTINUE;
    END IF;

    INSERT INTO public.banquet_schedules (
      id, property_id, event_id, task_name, start_time, end_time, department, notes
    ) VALUES (
      gen_random_uuid()::text,
      v_event.property_id,
      v_event.id,
      format('BEO %s: %s readiness', v_beo.id, v_dept),
      COALESCE(v_beo.setup_time, v_event.setup_time,
               (v_event.start_date::timestamptz - interval '4 hours')),
      COALESCE(v_beo.event_start_time, v_event.event_start_time,
               v_event.start_date::timestamptz),
      v_dept,
      format('Auto-created on BEO distribution for %s (%s pax)',
             v_event.event_name, v_event.expected_attendance)
    );
    v_made := v_made + 1;
  END LOOP;

  UPDATE public.banquet_beos
  SET status         = 'Distributed',
      distributed_at = now(),
      distributed_to = v_depts,
      updated_at     = now()
  WHERE id = p_beo_id;

  RETURN jsonb_build_object('success', true, 'beoId', p_beo_id, 'tasksCreated', v_made);
END;
$$;

GRANT EXECUTE ON FUNCTION public.distribute_beo(text, text) TO authenticated;

-- â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
-- 11. RLS
-- â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

ALTER TABLE public.event_bookings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS event_bookings_authenticated ON public.event_bookings;
CREATE POLICY event_bookings_authenticated ON public.event_bookings
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.event_bookings TO authenticated;
GRANT SELECT ON public.banquet_events TO authenticated;
GRANT SELECT ON public.events TO authenticated;

