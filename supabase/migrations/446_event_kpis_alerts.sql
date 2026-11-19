-- =============================================================================
-- Migration 446: Event KPIs & Alerts
-- =============================================================================
-- GET /api/banquet-events/kpis returned `{}` and /alerts returned `[]` — both
-- were hardcoded stubs, so the portal's executive dashboard and its alert bell
-- were permanently empty. These views give both endpoints real data derived
-- from the unified event tables.
--
-- Depends on: 444_event_bookings_unified, 445_event_billing
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. KPI rollup, one row per property
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE VIEW public.event_kpis AS
WITH scoped AS (
  SELECT * FROM public.event_bookings
),
beo AS (
  SELECT
    eb.property_id,
    count(*)                                                       AS events_needing_beo,
    count(b.id)                                                    AS beos_present,
    count(*) FILTER (WHERE b.status IN ('Approved','Distributed','Final','Completed'))
                                                                   AS beos_ready
  FROM scoped eb
  LEFT JOIN public.banquet_beos b ON b.event_id = eb.id
  WHERE eb.status IN ('Confirmed','Planning','InProgress')
  GROUP BY eb.property_id
),
tasks AS (
  SELECT
    eb.property_id,
    count(c.id)                                       AS total_tasks,
    count(c.id) FILTER (WHERE c.is_completed)         AS completed_tasks
  FROM scoped eb
  JOIN public.banquet_checklists c ON c.event_id = eb.id
  WHERE eb.status NOT IN ('Completed','Cancelled')
  GROUP BY eb.property_id
)
SELECT
  s.property_id,

  -- Volume
  count(*) FILTER (WHERE CURRENT_DATE BETWEEN s.start_date
                     AND COALESCE(s.end_date, s.start_date))              AS events_today,
  count(*) FILTER (WHERE s.start_date BETWEEN CURRENT_DATE
                     AND CURRENT_DATE + 7)                                AS events_this_week,
  count(*) FILTER (WHERE date_trunc('month', s.start_date)
                       = date_trunc('month', CURRENT_DATE))               AS events_this_month,

  -- Pipeline by stage
  count(*) FILTER (WHERE s.status = 'Inquiry')                            AS inquiry_bookings,
  count(*) FILTER (WHERE s.status = 'Tentative')                          AS tentative_bookings,
  count(*) FILTER (WHERE s.status = 'Confirmed')                          AS confirmed_bookings,
  count(*) FILTER (WHERE s.status = 'Planning')                           AS planning_bookings,
  count(*) FILTER (WHERE s.status = 'InProgress')                         AS in_progress_bookings,
  count(*) FILTER (WHERE s.status = 'Completed')                          AS completed_bookings,
  count(*) FILTER (WHERE s.status = 'Cancelled')                          AS cancelled_bookings,

  -- Money (all derived from event_charges via recalc_event_totals)
  COALESCE(SUM(s.grand_total)   FILTER (WHERE s.status <> 'Cancelled'), 0) AS total_revenue,
  COALESCE(SUM(s.actual_revenue) FILTER (WHERE s.status = 'Completed'), 0) AS realised_revenue,
  COALESCE(SUM(GREATEST(s.deposit_required - s.deposit_paid_amount, 0))
           FILTER (WHERE s.status NOT IN ('Completed','Cancelled')), 0)    AS pending_deposits,
  COALESCE(SUM(s.balance_due)
           FILTER (WHERE s.status <> 'Cancelled'
                     AND s.billing_status <> 'Paid'), 0)                   AS outstanding_balance,
  COALESCE(SUM(s.grand_total) FILTER (WHERE s.billing_status = 'Paid'), 0) AS collected_revenue,

  -- Averages
  COALESCE(ROUND(AVG(s.grand_total) FILTER (
    WHERE s.status <> 'Cancelled' AND s.grand_total > 0), 2), 0)          AS average_event_value,
  COALESCE(ROUND(AVG(s.satisfaction_score) FILTER (
    WHERE s.satisfaction_score IS NOT NULL), 2), 0)                       AS average_satisfaction,

  -- Conversion: of everything that left the tentative stage, how much converted
  CASE WHEN count(*) FILTER (WHERE s.status <> 'Inquiry') = 0 THEN 0
       ELSE ROUND(100.0 * count(*) FILTER (
              WHERE s.status IN ('Confirmed','Planning','InProgress','Completed'))
            / count(*) FILTER (WHERE s.status <> 'Inquiry'), 1)
  END                                                                     AS conversion_rate,

  -- Readiness
  CASE WHEN COALESCE(MAX(b.events_needing_beo), 0) = 0 THEN 100
       ELSE ROUND(100.0 * MAX(b.beos_ready) / MAX(b.events_needing_beo), 1)
  END                                                                     AS beo_completion,
  CASE WHEN COALESCE(MAX(t.total_tasks), 0) = 0 THEN 100
       ELSE ROUND(100.0 * MAX(t.completed_tasks) / MAX(t.total_tasks), 1)
  END                                                                     AS task_completion
FROM scoped s
LEFT JOIN beo   b ON b.property_id IS NOT DISTINCT FROM s.property_id
LEFT JOIN tasks t ON t.property_id IS NOT DISTINCT FROM s.property_id
GROUP BY s.property_id;

GRANT SELECT ON public.event_kpis TO authenticated;

COMMENT ON VIEW public.event_kpis IS
  'Backs GET /api/banquet-events/kpis, which previously returned a hardcoded {}.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Alerts — derived exceptions, not a table anyone has to maintain
-- ─────────────────────────────────────────────────────────────────────────────

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

-- Confirmed event with no catering captured yet
SELECT
  'menu-' || eb.id,
  eb.property_id,
  'MenuApprovalPending',
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
  'Backs GET /api/banquet-events/alerts, which previously returned a hardcoded []. '
  'Alerts are derived exceptions — there is no alerts table to keep in sync.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Department readiness for the coordination tab
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE VIEW public.event_department_readiness AS
SELECT
  eb.id                                                     AS event_id,
  eb.property_id,
  eb.event_name,
  eb.start_date,
  s.department,
  count(*)                                                  AS total_tasks,
  count(*) FILTER (WHERE s.end_time < now())                AS elapsed_tasks,
  CASE
    WHEN count(*) FILTER (WHERE s.end_time < now()) = count(*) THEN 'Ready'
    WHEN count(*) FILTER (WHERE s.start_time <= now())  > 0    THEN 'InProgress'
    ELSE 'NotStarted'
  END                                                       AS status,
  min(s.start_time)                                         AS first_task_at,
  max(s.end_time)                                           AS last_task_at,
  max(s.updated_at)                                         AS updated_at
FROM public.event_bookings eb
JOIN public.banquet_schedules s ON s.event_id = eb.id
WHERE eb.status NOT IN ('Cancelled')
  AND COALESCE(s.department, '') <> ''
GROUP BY eb.id, eb.property_id, eb.event_name, eb.start_date, s.department;

GRANT SELECT ON public.event_department_readiness TO authenticated;
