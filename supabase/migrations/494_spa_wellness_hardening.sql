-- =============================================================================
-- 494_spa_wellness_hardening.sql
-- Gap fixes for the Spa & Wellness portal (see gap analysis):
--   1. property_id type unification: text → uuid + FK (tables from 482–487
--      were created with plain text, unlike the uuid columns in 473–481/492)
--   2. spa_transactions: therapist attribution, folio linkage, refund fields,
--      source tracking, 'Unpaid' payment method for deferred charges
--   3. spa_appointments: lifecycle timestamps + cancellation reason
--   4. spa_gift_card_redemptions ledger (balance deductions were untracked)
--   5. spa_equipment_bookings (Fitness Center equipment booking backend)
--   6. spa_reports.last_result + spa_communications.delivery payloads
--   7. Atomic ID generation via spa_id_counters + next_spa_seq()
--   8. Atomic retail stock decrement via spa_retail_sell()
--   9. spa:* permission codes registered for RBAC (route layer enforces)
--  10. Daily maintenance job: membership renewal/expiry, gift-card expiry,
--      package-purchase expiry
-- =============================================================================

-- ── 1. property_id text → uuid ─────────────────────────────────────────────

DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'spa_retail_products', 'spa_retail_sales', 'spa_gift_cards',
    'spa_transactions', 'spa_communications', 'spa_reports', 'spa_settings'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    -- Only convert when the column is still a text type.
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = t
        AND column_name = 'property_id' AND data_type = 'text'
    ) THEN
      EXECUTE format(
        'ALTER TABLE public.%I ALTER COLUMN property_id TYPE uuid
         USING CASE WHEN property_id ~* ''^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$''
                    THEN property_id::uuid ELSE NULL END', t);
    END IF;

    -- Add the FK to properties where missing.
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conname = t || '_property_id_fkey'
    ) THEN
      EXECUTE format(
        'ALTER TABLE public.%I ADD CONSTRAINT %I
         FOREIGN KEY (property_id) REFERENCES public.properties(id)', t, t || '_property_id_fkey');
    END IF;
  END LOOP;
END $$;

-- ── 2. spa_transactions enrichment ─────────────────────────────────────────

ALTER TABLE public.spa_transactions
  ADD COLUMN IF NOT EXISTS therapist_id  text REFERENCES public.spa_therapists(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS folio_id      text,
  ADD COLUMN IF NOT EXISTS folio_line_id text,
  ADD COLUMN IF NOT EXISTS refund_reason text,
  ADD COLUMN IF NOT EXISTS refunded_at   timestamptz,
  ADD COLUMN IF NOT EXISTS source        text NOT NULL DEFAULT 'manual';

-- Deferred-payment method for charges created by the system before the guest
-- pays at checkout.
ALTER TABLE public.spa_transactions
  DROP CONSTRAINT IF EXISTS spa_transactions_payment_method_check;
ALTER TABLE public.spa_transactions
  ADD CONSTRAINT spa_transactions_payment_method_check
  CHECK (payment_method IN ('Guest Folio','Credit/Debit Card','Mobile Wallet','Cash',
                            'Corporate Billing','Gift Voucher','Membership Credit','Unpaid'));

CREATE INDEX IF NOT EXISTS idx_spa_transactions_appointment ON public.spa_transactions(appointment_id);
CREATE INDEX IF NOT EXISTS idx_spa_transactions_therapist   ON public.spa_transactions(therapist_id);

-- ── 3. spa_appointments lifecycle fields ───────────────────────────────────

ALTER TABLE public.spa_appointments
  ADD COLUMN IF NOT EXISTS checked_in_at       timestamptz,
  ADD COLUMN IF NOT EXISTS completed_at        timestamptz,
  ADD COLUMN IF NOT EXISTS cancelled_at        timestamptz,
  ADD COLUMN IF NOT EXISTS cancellation_reason text;

-- ── 4. Gift-card redemption ledger ─────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.spa_gift_card_redemptions (
  id             text PRIMARY KEY,
  card_id        text NOT NULL REFERENCES public.spa_gift_cards(id) ON DELETE CASCADE,
  amount         numeric(10,2) NOT NULL CHECK (amount > 0),
  appointment_id text REFERENCES public.spa_appointments(id) ON DELETE SET NULL,
  transaction_id text REFERENCES public.spa_transactions(id) ON DELETE SET NULL,
  redeemed_by    text,
  notes          text,
  property_id    uuid REFERENCES public.properties(id),
  created_at     timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.spa_gift_card_redemptions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS spa_gift_card_redemptions_all ON public.spa_gift_card_redemptions;
CREATE POLICY spa_gift_card_redemptions_all ON public.spa_gift_card_redemptions
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.spa_gift_card_redemptions TO authenticated;

CREATE INDEX IF NOT EXISTS idx_spa_gc_redemptions_card ON public.spa_gift_card_redemptions(card_id);

-- ── 5. Fitness equipment bookings ──────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.spa_equipment_bookings (
  id               text PRIMARY KEY,
  equipment        text NOT NULL,
  guest_id         text REFERENCES public.guests(id) ON DELETE SET NULL,
  guest_name       text NOT NULL,
  booking_date     date NOT NULL,
  start_time       text NOT NULL,
  duration_minutes integer NOT NULL DEFAULT 30 CHECK (duration_minutes > 0),
  status           text NOT NULL DEFAULT 'Confirmed'
                   CHECK (status IN ('Confirmed','In Use','Completed','Cancelled','No Show')),
  notes            text,
  property_id      uuid REFERENCES public.properties(id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.spa_equipment_bookings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS spa_equipment_bookings_all ON public.spa_equipment_bookings;
CREATE POLICY spa_equipment_bookings_all ON public.spa_equipment_bookings
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.spa_equipment_bookings TO authenticated;

CREATE INDEX IF NOT EXISTS idx_spa_equipment_bookings_date ON public.spa_equipment_bookings(booking_date);
CREATE INDEX IF NOT EXISTS idx_spa_equipment_bookings_equip ON public.spa_equipment_bookings(equipment, booking_date);

-- ── 6. Report output + communication delivery payloads ─────────────────────

ALTER TABLE public.spa_reports
  ADD COLUMN IF NOT EXISTS last_result jsonb;

ALTER TABLE public.spa_communications
  ADD COLUMN IF NOT EXISTS delivery jsonb,
  ADD COLUMN IF NOT EXISTS failure_reason text;

-- ── 7. Atomic ID generation ────────────────────────────────────────────────
-- Route code previously scanned every row to compute max+1 (racy, O(n)).
-- next_spa_seq() uses an upsert row lock so concurrent inserts cannot collide.

CREATE TABLE IF NOT EXISTS public.spa_id_counters (
  prefix text PRIMARY KEY,
  value  bigint NOT NULL DEFAULT 0
);

ALTER TABLE public.spa_id_counters ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS spa_id_counters_all ON public.spa_id_counters;
CREATE POLICY spa_id_counters_all ON public.spa_id_counters
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE ON public.spa_id_counters TO authenticated;

CREATE OR REPLACE FUNCTION public.next_spa_seq(p_prefix text)
RETURNS bigint
LANGUAGE plpgsql
AS $$
DECLARE
  v bigint;
BEGIN
  INSERT INTO public.spa_id_counters (prefix, value) VALUES (p_prefix, 1)
  ON CONFLICT (prefix) DO UPDATE SET value = spa_id_counters.value + 1
  RETURNING value INTO v;
  RETURN v;
END;
$$;

GRANT EXECUTE ON FUNCTION public.next_spa_seq(text) TO authenticated, service_role;

-- Seed counters above existing data so new IDs never collide with seeds.
INSERT INTO public.spa_id_counters (prefix, value)
SELECT 'TRT-', COALESCE(MAX((regexp_match(id, '-(\d+)$'))[1]::int), 0) FROM public.spa_treatments WHERE id ~ '^TRT-\d+$'
ON CONFLICT (prefix) DO NOTHING;
INSERT INTO public.spa_id_counters (prefix, value)
SELECT 'THP-', COALESCE(MAX((regexp_match(id, '-(\d+)$'))[1]::int), 0) FROM public.spa_therapists WHERE id ~ '^[A-Z]+-\d+$'
ON CONFLICT (prefix) DO NOTHING;
INSERT INTO public.spa_id_counters (prefix, value)
SELECT 'SRM-', COALESCE(MAX((regexp_match(id, '-(\d+)$'))[1]::int), 0) FROM public.spa_rooms WHERE id ~ '^SRM-\d+$'
ON CONFLICT (prefix) DO NOTHING;
INSERT INTO public.spa_id_counters (prefix, value)
SELECT 'APT-', COALESCE(MAX((regexp_match(id, '-(\d+)$'))[1]::int), 0) FROM public.spa_appointments WHERE id ~ '^APT-\d+$'
ON CONFLICT (prefix) DO NOTHING;
INSERT INTO public.spa_id_counters (prefix, value)
SELECT 'WLP-', COALESCE(MAX((regexp_match(id, '-(\d+)$'))[1]::int), 0) FROM public.spa_wellness_profiles WHERE id ~ '^WLP-\d+$'
ON CONFLICT (prefix) DO NOTHING;
INSERT INTO public.spa_id_counters (prefix, value)
SELECT 'PRG-', COALESCE(MAX((regexp_match(id, '-(\d+)$'))[1]::int), 0) FROM public.spa_wellness_programs WHERE id ~ '^PRG-\d+$'
ON CONFLICT (prefix) DO NOTHING;
INSERT INTO public.spa_id_counters (prefix, value)
SELECT 'ENR-', COALESCE(MAX((regexp_match(id, '-(\d+)$'))[1]::int), 0) FROM public.spa_program_enrollments WHERE id ~ '^ENR-\d+$'
ON CONFLICT (prefix) DO NOTHING;
INSERT INTO public.spa_id_counters (prefix, value)
SELECT 'MBR-', COALESCE(MAX((regexp_match(id, '-(\d+)$'))[1]::int), 0) FROM public.spa_memberships WHERE id ~ '^MBR-\d+$'
ON CONFLICT (prefix) DO NOTHING;
INSERT INTO public.spa_id_counters (prefix, value)
SELECT 'PKG-', COALESCE(MAX((regexp_match(id, '-(\d+)$'))[1]::int), 0) FROM public.spa_wellness_packages WHERE id ~ '^PKG-\d+$'
ON CONFLICT (prefix) DO NOTHING;
INSERT INTO public.spa_id_counters (prefix, value)
SELECT 'PUR-', COALESCE(MAX((regexp_match(id, '-(\d+)$'))[1]::int), 0) FROM public.spa_package_purchases WHERE id ~ '^PUR-\d+$'
ON CONFLICT (prefix) DO NOTHING;
INSERT INTO public.spa_id_counters (prefix, value)
SELECT 'RTL-', COALESCE(MAX((regexp_match(id, '-(\d+)$'))[1]::int), 0) FROM public.spa_retail_products WHERE id ~ '^RTL-\d+$'
ON CONFLICT (prefix) DO NOTHING;
INSERT INTO public.spa_id_counters (prefix, value)
SELECT 'SAL-', COALESCE(MAX((regexp_match(id, '-(\d+)$'))[1]::int), 0) FROM public.spa_retail_sales WHERE id ~ '^SAL-\d+$'
ON CONFLICT (prefix) DO NOTHING;
INSERT INTO public.spa_id_counters (prefix, value)
SELECT 'GFT-', COALESCE(MAX((regexp_match(id, '-(\d+)$'))[1]::int), 0) FROM public.spa_gift_cards WHERE id ~ '^GFT-\d+$'
ON CONFLICT (prefix) DO NOTHING;
INSERT INTO public.spa_id_counters (prefix, value)
SELECT 'TXN-', COALESCE(MAX((regexp_match(id, '-(\d+)$'))[1]::int), 0) FROM public.spa_transactions WHERE id ~ '^TXN-\d+$'
ON CONFLICT (prefix) DO NOTHING;
INSERT INTO public.spa_id_counters (prefix, value)
SELECT 'GCR-', COALESCE(MAX((regexp_match(id, '-(\d+)$'))[1]::int), 0) FROM public.spa_gift_card_redemptions WHERE id ~ '^GCR-\d+$'
ON CONFLICT (prefix) DO NOTHING;
INSERT INTO public.spa_id_counters (prefix, value)
SELECT 'EQB-', COALESCE(MAX((regexp_match(id, '-(\d+)$'))[1]::int), 0) FROM public.spa_equipment_bookings WHERE id ~ '^EQB-\d+$'
ON CONFLICT (prefix) DO NOTHING;
INSERT INTO public.spa_id_counters (prefix, value)
SELECT 'COM-', COALESCE(MAX((regexp_match(id, '-(\d+)$'))[1]::int), 0) FROM public.spa_communications WHERE id ~ '^COM-\d+$'
ON CONFLICT (prefix) DO NOTHING;
INSERT INTO public.spa_id_counters (prefix, value)
SELECT 'SPA-ALT-', COALESCE(MAX((regexp_match(id, '-(\d+)$'))[1]::int), 0) FROM public.spa_alerts WHERE id ~ '^SPA-ALT-\d+$'
ON CONFLICT (prefix) DO NOTHING;
INSERT INTO public.spa_id_counters (prefix, value)
SELECT 'EMP-SPA-', COALESCE(MAX((regexp_match(id, '-(\d+)$'))[1]::int), 0) FROM public.employees WHERE id ~ '^EMP-SPA-\d+$'
ON CONFLICT (prefix) DO NOTHING;
INSERT INTO public.spa_id_counters (prefix, value)
SELECT 'STY-', COALESCE(MAX((regexp_match(id, '-(\d+)$'))[1]::int), 0) FROM public.spa_therapists WHERE id ~ '^STY-\d+$'
ON CONFLICT (prefix) DO NOTHING;

-- ── 8. Atomic retail stock decrement ───────────────────────────────────────
-- Returns the new stock level, or NULL when the product is missing or stock
-- is insufficient. Single-statement UPDATE removes the read-then-write race.

CREATE OR REPLACE FUNCTION public.spa_retail_sell(p_product_id text, p_qty integer)
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
  v_stock integer;
BEGIN
  UPDATE public.spa_retail_products
  SET stock = stock - p_qty, updated_at = now()
  WHERE id = p_product_id AND stock >= p_qty
  RETURNING stock INTO v_stock;
  RETURN v_stock; -- NULL when not found / insufficient
END;
$$;

GRANT EXECUTE ON FUNCTION public.spa_retail_sell(text, integer) TO authenticated, service_role;

-- Atomic stock restore for voided sales / restocks.
CREATE OR REPLACE FUNCTION public.spa_retail_restock(p_product_id text, p_qty integer)
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
  v_stock integer;
BEGIN
  UPDATE public.spa_retail_products
  SET stock = stock + p_qty, updated_at = now()
  WHERE id = p_product_id
  RETURNING stock INTO v_stock;
  RETURN v_stock;
END;
$$;

GRANT EXECUTE ON FUNCTION public.spa_retail_restock(text, integer) TO authenticated, service_role;

-- ── 9. RBAC permission codes ───────────────────────────────────────────────
-- Route layer enforces these via requirePermission() (with a role-string
-- bypass for spa/ops department roles, matching the banquet convention).

INSERT INTO permissions (id, code, module, description)
VALUES
  ('perm-spa-booking-manage',  'spa:booking:manage',  'spa-wellness', 'Create/modify spa appointments, equipment bookings, enrollments, provider schedules'),
  ('perm-spa-catalog-manage',  'spa:catalog:manage',  'spa-wellness', 'Manage treatment catalog, rooms and facilities, wellness programs and packages'),
  ('perm-spa-staff-manage',    'spa:staff:manage',    'spa-wellness', 'Manage therapists, staff operations, attendance'),
  ('perm-spa-profiles-manage', 'spa:profiles:manage', 'spa-wellness', 'Manage guest wellness profiles (medical data)'),
  ('perm-spa-finance-manage',  'spa:finance:manage',  'spa-wellness', 'Manage spa transactions, refunds, gift cards, memberships, retail sales'),
  ('perm-spa-comms-manage',    'spa:comms:manage',    'spa-wellness', 'Send and manage guest communications'),
  ('perm-spa-settings-manage', 'spa:settings:manage', 'spa-wellness', 'Manage spa configuration, alerts and report registry')
ON CONFLICT (id) DO NOTHING;

-- Ensure a spa manager role row exists, then grant it (and ops roles) the codes.
INSERT INTO roles (id, name, description, is_superuser, is_system)
VALUES ('role_spa_manager', 'spa_manager', 'Spa & Wellness manager — full spa portal access', false, true)
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.name IN ('spa_manager', 'spa_director', 'wellness_manager', 'spa',
                 'ops_manager', 'operations', 'operations_manager')
  AND p.code LIKE 'spa:%'
ON CONFLICT DO NOTHING;

-- ── 10. Daily maintenance (membership renewal/expiry, card + package expiry) ─

CREATE OR REPLACE FUNCTION public.spa_daily_maintenance()
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  m record;
  v_period interval;
  v_txn_id text;
BEGIN
  -- Memberships: auto-renew extends the term and raises a pending charge;
  -- otherwise the membership expires.
  FOR m IN
    SELECT * FROM public.spa_memberships
    WHERE status = 'Active' AND end_date < CURRENT_DATE
  LOOP
    IF m.auto_renew THEN
      v_period := CASE m.membership_type
        WHEN 'Monthly'   THEN interval '1 month'
        WHEN 'Quarterly' THEN interval '3 months'
        ELSE interval '1 year' END;

      UPDATE public.spa_memberships
      SET start_date = m.end_date, end_date = m.end_date + v_period, updated_at = now()
      WHERE id = m.id;

      v_txn_id := 'TXN-' || lpad(public.next_spa_seq('TXN-')::text, 3, '0');
      INSERT INTO public.spa_transactions
        (id, guest_id, guest_name, description, amount, total,
         payment_method, status, transaction_date, source, property_id)
      VALUES
        (v_txn_id, m.guest_id, m.member_name,
         'Membership renewal — ' || m.membership_type || ' (' || m.id || ')',
         COALESCE(m.price, 0), COALESCE(m.price, 0),
         'Unpaid', 'Pending', CURRENT_DATE, 'membership_renewal', m.property_id);
    ELSE
      UPDATE public.spa_memberships
      SET status = 'Expired', updated_at = now()
      WHERE id = m.id;
    END IF;
  END LOOP;

  -- Gift cards past their expiry date.
  UPDATE public.spa_gift_cards
  SET status = 'Expired', updated_at = now()
  WHERE status = 'Active' AND expiry_date IS NOT NULL AND expiry_date < CURRENT_DATE;

  -- Package purchases past their validity window.
  UPDATE public.spa_package_purchases pp
  SET status = 'Expired', updated_at = now()
  FROM public.spa_wellness_packages wp
  WHERE pp.package_id = wp.id
    AND pp.status = 'Active'
    AND pp.purchase_date + wp.validity_days < CURRENT_DATE;
END;
$$;

DO $outer$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    BEGIN
      PERFORM cron.schedule(
        'spa-daily-maintenance',
        '15 6 * * *',
        $cmd$SELECT public.spa_daily_maintenance();$cmd$
      );
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'pg_cron schedule skipped: %', SQLERRM;
    END;
    RAISE NOTICE 'pg_cron: scheduled spa_daily_maintenance daily at 06:15.';
  ELSE
    RAISE NOTICE 'pg_cron not installed — call spa_daily_maintenance() via API/scheduler.';
  END IF;
END $outer$;

-- Register with the app-level scheduler too (src/server/scheduler.ts runs
-- the spa_maintenance handler: maintenance RPC + scheduled comms dispatch).
INSERT INTO scheduled_jobs (name, type, schedule_cron, config, enabled)
SELECT 'Spa Daily Maintenance', 'spa_maintenance', '15 6 * * *', '{}', true
WHERE NOT EXISTS (
  SELECT 1 FROM scheduled_jobs WHERE type = 'spa_maintenance'
);
