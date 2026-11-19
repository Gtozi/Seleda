-- =============================================================================
-- Migration 500: Spa & Wellness — 'Cancelled' communication status
-- =============================================================================
-- A Scheduled message could only be stopped by deleting the row — which also
-- destroys the audit trail. 'Cancelled' lets staff withdraw a scheduled send
-- while keeping the record.

alter table public.spa_communications
  drop constraint if exists spa_communications_status_check;
alter table public.spa_communications
  add constraint spa_communications_status_check
  check (status in ('Sent','Delivered','Opened','Failed','Scheduled','Cancelled'));

-- The due-dispatch sweep only looks at status='Scheduled', so a cancelled row
-- can keep its original scheduled_for timestamp for audit without risk of
-- being sent.
