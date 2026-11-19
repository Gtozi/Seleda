-- 448_event_execution_actuals.sql
--
-- Add event execution issues table and actuals columns.
-- Execution is the on-event-day phase: track real issues, capture actuals.

-- ── 1. Event execution issues ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.banquet_event_issues (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  property_id uuid,
  event_id text NOT NULL,
  issue_text text NOT NULL,
  severity text NOT NULL DEFAULT 'Medium',  -- Low | Medium | High | Critical
  status text NOT NULL DEFAULT 'Open',       -- Open | Resolved
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_banquet_event_issues_event ON public.banquet_event_issues (event_id);

-- ── 2. Add actual timing columns to event_bookings ──────────────────
ALTER TABLE public.event_bookings
  ADD COLUMN IF NOT EXISTS actual_start_time timestamptz,
  ADD COLUMN IF NOT EXISTS actual_end_time timestamptz;

-- actual_attendance and actual_revenue already exist.
