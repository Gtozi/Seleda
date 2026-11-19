-- =============================================================================
-- Migration 461: Banquet & Events — real status on schedule tasks
-- =============================================================================
-- GAP: Task Management (§18). banquet_schedules had no status, priority or
-- dependency columns, so GET /tasks mapped every schedule task to
-- status='Pending' / priority='Normal' / completedAt=null — schedule tasks
-- could never be completed and the Execution tab's task list was dead.
--
-- Adds: status, priority, completed_at, depends_on (self-FK).
-- Also updates event_department_readiness (446) to count real completion
-- instead of inferring done-ness from elapsed time windows.
--
-- Depends on: 103 (banquet_schedules), 446 (event_department_readiness)
-- =============================================================================

ALTER TABLE public.banquet_schedules
  ADD COLUMN IF NOT EXISTS status       text NOT NULL DEFAULT 'Pending',
  ADD COLUMN IF NOT EXISTS priority     text NOT NULL DEFAULT 'Normal',
  ADD COLUMN IF NOT EXISTS completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS depends_on   text REFERENCES public.banquet_schedules(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.banquet_schedules.status IS
  'Pending | InProgress | Completed | Cancelled';
COMMENT ON COLUMN public.banquet_schedules.priority IS
  'Low | Normal | High | Urgent';
COMMENT ON COLUMN public.banquet_schedules.depends_on IS
  'Optional predecessor schedule task — finish-start dependency.';

-- Readiness: a task counts as done when explicitly completed, or when its
-- window has elapsed (legacy behaviour for rows nobody ever marks).
CREATE OR REPLACE VIEW public.event_department_readiness AS
SELECT
  eb.id                                                     AS event_id,
  eb.property_id,
  eb.event_name,
  eb.start_date,
  s.department,
  count(*)                                                  AS total_tasks,
  count(*) FILTER (
    WHERE s.status = 'Completed'
       OR (s.status <> 'Cancelled' AND s.end_time < now())
  )                                                         AS elapsed_tasks,
  CASE
    WHEN count(*) FILTER (
      WHERE s.status = 'Completed'
         OR (s.status <> 'Cancelled' AND s.end_time < now())
    ) = count(*)                                                THEN 'Ready'
    WHEN count(*) FILTER (
      WHERE s.status = 'InProgress'
         OR (s.status NOT IN ('Completed','Cancelled') AND s.start_time <= now())
    ) > 0                                                       THEN 'InProgress'
    ELSE 'NotStarted'
  END                                                       AS status,
  min(s.start_time)                                         AS first_task_at,
  max(s.end_time)                                           AS last_task_at,
  max(s.updated_at)                                         AS updated_at
FROM public.event_bookings eb
JOIN public.banquet_schedules s ON s.event_id = eb.id
WHERE eb.status NOT IN ('Cancelled')
  AND COALESCE(s.department, '') <> ''
  AND s.status <> 'Cancelled'
GROUP BY eb.id, eb.property_id, eb.event_name, eb.start_date, s.department;
