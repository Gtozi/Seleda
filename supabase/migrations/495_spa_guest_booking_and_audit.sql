-- =============================================================================
-- 495_spa_guest_booking_and_audit.sql
-- Remaining gap fixes for the Spa & Wellness portal:
--   1. spa_retail_products.uinv_item_id — links retail products to unified
--      inventory items so sales/voids write uinv_stock_ledger rows
--   2. spa_appointment_history — audit trail for booking create/cancel/
--      status transitions (previously transitions left no record)
--   3. Seed refresh — the demo seeds were hardcoded to July/August 2026 and
--      are now stale: today's dashboard KPIs render zero and the new
--      spa_daily_maintenance job would mass-expire still-'Active' seeds.
--      Seed rows are updated by their known IDs only — real data untouched.
-- =============================================================================

-- ── 1. Retail ↔ unified inventory link ─────────────────────────────────────

ALTER TABLE public.spa_retail_products
  ADD COLUMN IF NOT EXISTS uinv_item_id text REFERENCES public.uinv_items(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_spa_retail_products_uinv_item
  ON public.spa_retail_products(uinv_item_id) WHERE uinv_item_id IS NOT NULL;

-- ── 2. Appointment history / audit ─────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.spa_appointment_history (
  id             text PRIMARY KEY,
  appointment_id text NOT NULL REFERENCES public.spa_appointments(id) ON DELETE CASCADE,
  action         text NOT NULL,               -- created | status_change | rescheduled | cancelled | note
  from_status    text,
  to_status      text,
  changed_by     text,                        -- user id or 'guest'/'system'
  changed_by_name text,
  notes          text,
  property_id    uuid REFERENCES public.properties(id),
  created_at     timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.spa_appointment_history ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS spa_appointment_history_all ON public.spa_appointment_history;
CREATE POLICY spa_appointment_history_all ON public.spa_appointment_history
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
GRANT SELECT, INSERT ON public.spa_appointment_history TO authenticated;

CREATE INDEX IF NOT EXISTS idx_spa_appt_history_appt ON public.spa_appointment_history(appointment_id);
CREATE INDEX IF NOT EXISTS idx_spa_appt_history_created ON public.spa_appointment_history(created_at DESC);

-- ── 3. Seed refresh (known seed IDs only) ──────────────────────────────────

-- Demo appointments were seeded on 2026-07-31 with live statuses
-- ('In Treatment', 'Checked In', 'Confirmed') — shift them to today so the
-- dashboard's today view and the schedule calendar show realistic data.
UPDATE public.spa_appointments
SET appointment_date = CURRENT_DATE, updated_at = now()
WHERE id IN ('APT-001','APT-002','APT-003','APT-004','APT-005')
  AND appointment_date < CURRENT_DATE;

-- Seed transactions dated late July — spread them across the last few days
-- so month-to-date revenue charts have shape.
UPDATE public.spa_transactions
SET transaction_date = CURRENT_DATE - 1, updated_at = now()
WHERE id IN ('TXN-001','TXN-002') AND transaction_date < CURRENT_DATE - 1;
UPDATE public.spa_transactions
SET transaction_date = CURRENT_DATE - 2, updated_at = now()
WHERE id = 'TXN-003' AND transaction_date < CURRENT_DATE - 2;
UPDATE public.spa_transactions
SET transaction_date = CURRENT_DATE - 3, updated_at = now()
WHERE id = 'TXN-005' AND transaction_date < CURRENT_DATE - 3;
UPDATE public.spa_transactions
SET transaction_date = CURRENT_DATE, updated_at = now()
WHERE id = 'TXN-004' AND transaction_date < CURRENT_DATE;

-- COM-005 was 'Scheduled' for 2026-08-14 — long past, and the package it
-- references already happened. Cancel it so dispatch-due doesn't send a
-- stale confirmation SMS.
UPDATE public.spa_communications
SET status = 'Cancelled', updated_at = now()
WHERE id = 'COM-005' AND status = 'Scheduled' AND scheduled_for < now();

-- The summer promo card expired 2026-08-31 while still 'Active' — mark it
-- now rather than waiting for the nightly maintenance sweep.
UPDATE public.spa_gift_cards
SET status = 'Expired', updated_at = now()
WHERE id = 'GFT-003' AND status = 'Active' AND expiry_date < CURRENT_DATE;

-- Seed the history table for the demo appointments so the audit trail has
-- an initial entry per seed row.
INSERT INTO public.spa_appointment_history
  (id, appointment_id, action, from_status, to_status, changed_by, changed_by_name, notes)
SELECT
  'AH-SEED-' || a.id,
  a.id,
  'created',
  NULL,
  a.status,
  'system',
  'System',
  'Seed appointment (dates refreshed by migration 495)'
FROM public.spa_appointments a
WHERE a.id IN ('APT-001','APT-002','APT-003','APT-004','APT-005')
ON CONFLICT (id) DO NOTHING;

-- Counter for history IDs (next_spa_seq was created in migration 494).
INSERT INTO public.spa_id_counters (prefix, value)
SELECT 'AH-', COALESCE(MAX((regexp_match(id, '(\d+)$'))[1]::int), 0)
FROM public.spa_appointment_history
ON CONFLICT (prefix) DO NOTHING;
