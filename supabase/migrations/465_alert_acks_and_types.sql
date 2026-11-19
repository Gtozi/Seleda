-- =============================================================================
-- Migration 465: Banquet & Events — alert acknowledgment + missing alert types
-- =============================================================================
-- GAPS (spec §4 Alerts):
--   1. Alerts could never be acknowledged — GET /alerts hardcoded isRead:false.
--      banquet_alert_acks stores per-user acknowledgments keyed by the view's
--      stable alert_id.
--   2. Missing alert types vs spec: ContractPending, RoomSetupDelay,
--      EquipmentShortage, VIPEvent, LastMinuteChange.
--   3. The old 'MenuApprovalPending' actually fired when no menu existed —
--      renamed to 'MenuMissing'; MenuApprovalPending now means what it says
--      (menu captured, approval outstanding — uses 462's menu_status).
--   4. TaskOverdue only watched checklists; schedule tasks (461) now covered.
--   5. InvoiceOverdue only watched the final invoice; interim invoices (464)
--      are covered too.
--
-- Depends on: 446 (event_alerts), 458 (RLS helper), 461–464
-- =============================================================================

-- ── 1. Per-user acknowledgments ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.banquet_alert_acks (
  id          text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  property_id uuid,
  alert_id    text NOT NULL,
  user_id     text NOT NULL,
  acked_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (alert_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_banquet_alert_acks_user
  ON public.banquet_alert_acks (user_id);

ALTER TABLE public.banquet_alert_acks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS banquet_alert_acks_property_scoped ON public.banquet_alert_acks;
CREATE POLICY banquet_alert_acks_property_scoped ON public.banquet_alert_acks
  FOR ALL TO authenticated
  USING (public.banquet_can_access_property(property_id))
  WITH CHECK (public.banquet_can_access_property(property_id));

-- ── 2. Alerts view — original branches preserved, spec gaps filled ─────────

CREATE OR REPLACE VIEW public.event_alerts AS
-- Deposit outstanding on an event that is close at hand
SELECT
  'deposit-' || eb.id                                          AS alert_id,
  eb.property_id,
  'DepositDue'                                                 AS alert_type,
  eb.id                                                        AS event_id,
  eb.event_name,
  format('Deposit of %s outstanding for %s (%s away)',
         to_char(eb.deposit_required - eb.deposit_paid_amount, 'FM999,999,990.00'),
         eb.event_name,
         (eb.start_date - CURRENT_DATE) || ' day(s)')          AS message,
  CASE WHEN eb.start_date - CURRENT_DATE <= 7 THEN 'Critical' ELSE 'Warning' END AS severity,
  eb.start_date                                                AS due_date,
  eb.updated_at                                                AS created_at
FROM public.event_bookings eb
WHERE eb.status IN ('Tentative','Confirmed','Planning')
  AND eb.deposit_required > eb.deposit_paid_amount
  AND eb.start_date >= CURRENT_DATE
  AND eb.start_date <= CURRENT_DATE + 30

UNION ALL

-- NEW: deposit milestones past their due date and not fully covered
SELECT
  'dep-sched-' || s.id,
  s.property_id,
  'DepositDue',
  s.event_id,
  eb.event_name,
  format('%s of %s for %s was due %s and is %s paid',
         s.label,
         to_char(s.amount, 'FM999,999,990.00'),
         eb.event_name,
         s.due_date,
         to_char(s.amount_paid, 'FM999,999,990.00')),
  CASE WHEN s.due_date < CURRENT_DATE - 7 THEN 'Critical' ELSE 'Warning' END,
  s.due_date,
  s.updated_at
FROM public.event_deposit_schedule_status s
JOIN public.event_bookings eb ON eb.id = s.event_id
WHERE s.status IN ('Due','PartiallyPaid','Overdue')
  AND s.due_date IS NOT NULL
  AND s.due_date <= CURRENT_DATE
  AND eb.status NOT IN ('Completed','Cancelled')

UNION ALL

-- NEW: tentative booking near the date with no signed contract behind it
SELECT
  'contract-' || eb.id,
  eb.property_id,
  'ContractPending',
  eb.id,
  eb.event_name,
  format('%s is still Tentative %s day(s) out — contract not signed',
         eb.event_name, eb.start_date - CURRENT_DATE),
  CASE WHEN eb.start_date - CURRENT_DATE <= 7 THEN 'Critical' ELSE 'Warning' END,
  eb.start_date,
  eb.updated_at
FROM public.event_bookings eb
WHERE eb.status = 'Tentative'
  AND eb.start_date BETWEEN CURRENT_DATE AND CURRENT_DATE + 21
  AND (
    eb.contract_id IS NULL
    OR EXISTS (SELECT 1 FROM public.sales_contracts c
               WHERE c.id = eb.contract_id AND c.signed_date IS NULL)
  )

UNION ALL

-- Confirmed event with no BEO as the date approaches
SELECT
  'beo-' || eb.id,
  eb.property_id,
  'BEOMissing',
  eb.id,
  eb.event_name,
  format('%s is in %s day(s) with no BEO generated',
         eb.event_name, eb.start_date - CURRENT_DATE),
  CASE WHEN eb.start_date - CURRENT_DATE <= 3 THEN 'Critical' ELSE 'Warning' END,
  eb.start_date,
  eb.updated_at
FROM public.event_bookings eb
WHERE eb.status IN ('Confirmed','Planning')
  AND eb.start_date BETWEEN CURRENT_DATE AND CURRENT_DATE + 14
  AND NOT EXISTS (SELECT 1 FROM public.banquet_beos b WHERE b.event_id = eb.id)

UNION ALL

-- BEO built but never distributed to the departments that have to execute it
SELECT
  'beo-undistributed-' || b.id,
  eb.property_id,
  'BEONotDistributed',
  eb.id,
  eb.event_name,
  format('BEO for %s is %s and has not been distributed (event in %s day(s))',
         eb.event_name, b.status, eb.start_date - CURRENT_DATE),
  CASE WHEN eb.start_date - CURRENT_DATE <= 2 THEN 'Critical' ELSE 'Warning' END,
  eb.start_date,
  b.updated_at
FROM public.banquet_beos b
JOIN public.event_bookings eb ON eb.id = b.event_id
WHERE b.status NOT IN ('Distributed','Final','Completed')
  AND eb.status IN ('Confirmed','Planning','InProgress')
  AND eb.start_date BETWEEN CURRENT_DATE AND CURRENT_DATE + 7

UNION ALL

-- Confirmed event with no catering captured yet (was MenuApprovalPending)
SELECT
  'menu-' || eb.id,
  eb.property_id,
  'MenuMissing',
  eb.id,
  eb.event_name,
  format('No menu captured for %s (%s pax, in %s day(s))',
         eb.event_name, eb.expected_attendance, eb.start_date - CURRENT_DATE),
  'Warning',
  eb.start_date,
  eb.updated_at
FROM public.event_bookings eb
WHERE eb.status IN ('Confirmed','Planning')
  AND eb.start_date BETWEEN CURRENT_DATE AND CURRENT_DATE + 10
  AND NOT EXISTS (SELECT 1 FROM public.banquet_menu_items m WHERE m.event_id = eb.id)

UNION ALL

-- NEW: menu captured but approval still outstanding
SELECT
  'menu-approval-' || eb.id,
  eb.property_id,
  'MenuApprovalPending',
  eb.id,
  eb.event_name,
  format('Menu for %s is %s — approval pending (event in %s day(s))',
         eb.event_name, lower(eb.menu_status), eb.start_date - CURRENT_DATE),
  CASE WHEN eb.start_date - CURRENT_DATE <= 3 THEN 'Critical' ELSE 'Warning' END,
  eb.start_date,
  eb.updated_at
FROM public.event_bookings eb
WHERE eb.status IN ('Confirmed','Planning')
  AND eb.start_date BETWEEN CURRENT_DATE AND CURRENT_DATE + 10
  AND eb.menu_status <> 'Approved'
  AND EXISTS (SELECT 1 FROM public.banquet_menu_items m WHERE m.event_id = eb.id)

UNION ALL

-- Overdue checklist items
SELECT
  'task-' || c.id,
  eb.property_id,
  'TaskOverdue',
  eb.id,
  eb.event_name,
  format('%s overdue since %s (%s)', c.item_name, c.due_date, eb.event_name),
  CASE WHEN CURRENT_DATE - c.due_date > 3 THEN 'Critical' ELSE 'Warning' END,
  c.due_date,
  c.updated_at
FROM public.banquet_checklists c
JOIN public.event_bookings eb ON eb.id = c.event_id
WHERE NOT c.is_completed
  AND c.due_date IS NOT NULL
  AND c.due_date < CURRENT_DATE
  AND eb.status NOT IN ('Completed','Cancelled')

UNION ALL

-- NEW: overdue schedule tasks (461 added real status to banquet_schedules)
SELECT
  'stask-' || s.id,
  eb.property_id,
  'TaskOverdue',
  eb.id,
  eb.event_name,
  format('%s overdue since %s (%s)', s.task_name, s.end_time::date, eb.event_name),
  CASE WHEN now() - s.end_time > interval '3 days' THEN 'Critical' ELSE 'Warning' END,
  s.end_time::date,
  s.updated_at
FROM public.banquet_schedules s
JOIN public.event_bookings eb ON eb.id = s.event_id
WHERE s.status NOT IN ('Completed','Cancelled')
  AND s.end_time IS NOT NULL
  AND s.end_time < now()
  AND eb.status NOT IN ('Completed','Cancelled')

UNION ALL

-- NEW: event day arrived but setup departments haven't reported ready
SELECT DISTINCT ON (eb.id)
  'setup-' || eb.id,
  eb.property_id,
  'RoomSetupDelay',
  eb.id,
  eb.event_name,
  format('Setup for %s should have started at %s; departments still pending',
         eb.event_name, to_char(eb.setup_time, 'HH24:MI')),
  'Critical',
  eb.start_date,
  eb.updated_at
FROM public.event_bookings eb
WHERE eb.status = 'InProgress'
  AND eb.setup_time IS NOT NULL
  AND eb.setup_time < now()
  AND EXISTS (SELECT 1 FROM public.banquet_dept_coordination dc
              WHERE dc.event_id = eb.id AND dc.status = 'Pending')

UNION ALL

-- NEW: catalog equipment over-committed across overlapping live events (463)
SELECT
  'equip-short-' || eb.id || '-' || d.cat_id,
  eb.property_id,
  'EquipmentShortage',
  eb.id,
  eb.event_name,
  format('%s %s in stock but %s committed across overlapping events (%s in %s day(s))',
         d.total_quantity, d.item_name, d.demand, eb.event_name, eb.start_date - CURRENT_DATE),
  CASE WHEN eb.start_date - CURRENT_DATE <= 3 THEN 'Critical' ELSE 'Warning' END,
  eb.start_date,
  eb.updated_at
FROM public.event_bookings eb
JOIN LATERAL (
  SELECT c.id AS cat_id, c.item_name, c.total_quantity,
         (SELECT COALESCE(SUM(e2.quantity), 0)
          FROM public.banquet_equipment e2
          JOIN public.event_bookings eb2 ON eb2.id = e2.event_id
          WHERE e2.catalog_item_id = c.id
            AND eb2.status IN ('Confirmed','Planning','InProgress')
            AND daterange(eb2.start_date, COALESCE(eb2.end_date, eb2.start_date), '[]')
                && daterange(eb.start_date, COALESCE(eb.end_date, eb.start_date), '[]'))
         AS demand
  FROM public.banquet_equipment_catalog c
  WHERE c.is_active
    AND EXISTS (SELECT 1 FROM public.banquet_equipment e1
                WHERE e1.catalog_item_id = c.id AND e1.event_id = eb.id)
) d ON d.demand > d.total_quantity
WHERE eb.status IN ('Confirmed','Planning','InProgress')
  AND eb.start_date >= CURRENT_DATE

UNION ALL

-- Vendor contracts still unconfirmed near the event
SELECT
  'vendor-' || v.id,
  eb.property_id,
  'VendorDelay',
  eb.id,
  eb.event_name,
  format('Vendor %s still %s for %s (in %s day(s))',
         v.vendor_name, v.status, eb.event_name, eb.start_date - CURRENT_DATE),
  CASE WHEN eb.start_date - CURRENT_DATE <= 3 THEN 'Critical' ELSE 'Warning' END,
  eb.start_date,
  v.updated_at
FROM public.banquet_vendors v
JOIN public.event_bookings eb ON eb.id = v.event_id
WHERE COALESCE(v.status, 'Pending') NOT IN ('Confirmed','Completed')
  AND eb.status IN ('Confirmed','Planning','InProgress')
  AND eb.start_date BETWEEN CURRENT_DATE AND CURRENT_DATE + 7

UNION ALL

-- NEW: VIP arrangements flagged on an upcoming event
SELECT
  'vip-' || eb.id,
  eb.property_id,
  'VIPEvent',
  eb.id,
  eb.event_name,
  format('VIP arrangements flagged for %s (in %s day(s))',
         eb.event_name, eb.start_date - CURRENT_DATE),
  'Info',
  eb.start_date,
  eb.updated_at
FROM public.event_bookings eb
WHERE eb.status IN ('Confirmed','Planning','InProgress')
  AND eb.start_date BETWEEN CURRENT_DATE AND CURRENT_DATE + 14
  AND (
    EXISTS (SELECT 1 FROM public.banquet_beos b
            WHERE b.event_id = eb.id AND array_length(b.vip_information, 1) > 0)
    OR EXISTS (SELECT 1 FROM public.banquet_event_registrations r
               WHERE r.event_id = eb.id AND r.registration_type = 'VIP')
    OR EXISTS (SELECT 1 FROM public.banquet_event_seating s
               WHERE s.event_id = eb.id AND s.is_vip)
  )

UNION ALL

-- NEW: booking touched in the last 24h with the event imminent
SELECT
  'lmc-' || eb.id,
  eb.property_id,
  'LastMinuteChange',
  eb.id,
  eb.event_name,
  format('%s was modified within the last 24h and starts in %s day(s)',
         eb.event_name, eb.start_date - CURRENT_DATE),
  'Warning',
  eb.start_date,
  eb.updated_at
FROM public.event_bookings eb
WHERE eb.status IN ('Confirmed','Planning','InProgress')
  AND eb.start_date BETWEEN CURRENT_DATE AND CURRENT_DATE + 3
  AND eb.updated_at > now() - interval '24 hours'
  AND eb.created_at < now() - interval '24 hours'

UNION ALL

-- Finished but never billed
SELECT
  'unsettled-' || eb.id,
  eb.property_id,
  'EventUnsettled',
  eb.id,
  eb.event_name,
  format('%s completed %s day(s) ago and has not been invoiced',
         eb.event_name, CURRENT_DATE - COALESCE(eb.end_date, eb.start_date)),
  CASE WHEN CURRENT_DATE - COALESCE(eb.end_date, eb.start_date) > 7
       THEN 'Critical' ELSE 'Warning' END,
  COALESCE(eb.end_date, eb.start_date),
  eb.updated_at
FROM public.event_bookings eb
WHERE eb.status = 'Completed'
  AND eb.invoice_id IS NULL
  AND COALESCE(eb.end_date, eb.start_date) < CURRENT_DATE

UNION ALL

-- Invoiced, past due, still unpaid
SELECT
  'overdue-' || eb.id,
  eb.property_id,
  'InvoiceOverdue',
  eb.id,
  eb.event_name,
  format('Invoice %s for %s is %s day(s) overdue (%s outstanding)',
         inv.invoice_number, eb.event_name,
         CURRENT_DATE - inv.due_date,
         to_char(eb.balance_due, 'FM999,999,990.00')),
  'Critical',
  inv.due_date,
  eb.updated_at
FROM public.event_bookings eb
JOIN public.invoice_documents inv ON inv.id = eb.invoice_id
WHERE eb.balance_due > 0
  AND inv.due_date IS NOT NULL
  AND inv.due_date < CURRENT_DATE
  AND NOT inv.is_voided

UNION ALL

-- NEW: interim invoices (464) past due
SELECT
  'overdue-int-' || inv.id,
  eb.property_id,
  'InvoiceOverdue',
  eb.id,
  eb.event_name,
  format('Interim invoice %s for %s is %s day(s) overdue (%s)',
         inv.invoice_number, eb.event_name,
         CURRENT_DATE - inv.due_date,
         to_char(inv.total - inv.amount_paid, 'FM999,999,990.00')),
  'Critical',
  inv.due_date,
  eb.updated_at
FROM public.invoice_documents inv
JOIN public.event_bookings eb ON eb.id = inv.event_id
WHERE inv.invoice_type = 'Interim'
  AND inv.status <> 'Paid'
  AND inv.due_date IS NOT NULL
  AND inv.due_date < CURRENT_DATE
  AND NOT inv.is_voided

UNION ALL

-- Venue double-booking, which the old free-form status writes made possible
SELECT DISTINCT
  'venue-conflict-' || LEAST(a.id, b2.id) || '-' || GREATEST(a.id, b2.id),
  a.property_id,
  'VenueConflict',
  a.id,
  a.event_name,
  format('%s and %s are both holding a venue on overlapping dates',
         a.event_name, b2.event_name),
  'Critical',
  a.start_date,
  a.updated_at
FROM public.event_bookings a
JOIN public.event_bookings b2
  ON b2.id <> a.id
 AND b2.venue_ids && a.venue_ids
 AND b2.status IN ('Confirmed','Planning','InProgress')
 AND daterange(b2.start_date, COALESCE(b2.end_date, b2.start_date), '[]')
     && daterange(a.start_date, COALESCE(a.end_date, a.start_date), '[]')
WHERE a.status IN ('Confirmed','Planning','InProgress')
  AND COALESCE(a.end_date, a.start_date) >= CURRENT_DATE;

GRANT SELECT ON public.event_alerts TO authenticated;

COMMENT ON VIEW public.event_alerts IS
  'Backs GET /api/banquet-events/alerts. Alerts are derived exceptions — '
  'there is no alerts table to keep in sync. Per-user acknowledgment state '
  'lives in banquet_alert_acks and is joined in the route.';
