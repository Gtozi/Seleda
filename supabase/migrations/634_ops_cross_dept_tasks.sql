-- 634_ops_cross_dept_tasks.sql
-- Operations Portal — Cross-Department Task Center
-- (/erp/operations/cross-department-tasks).
--
-- Backs CrossDepartmentTaskCenter.tsx. Each task is a multi-department
-- coordination record (VIP arrivals, weddings, conferences, emergencies,
-- renovations). Per-department assignment state lives in `departments`
-- JSONB: [{department, status, lead}] with status
-- pending|in-progress|completed|on-hold. `source_ref` links a task to the
-- live record it was adopted from (banquet_events/<id>,
-- reservation/<id>, group-block/<id>, work-order/<id>) so the live
-- "suggested tasks" feed can suppress already-adopted items.
--
-- Seeded with the 5 tasks previously hardcoded in the component.

CREATE TABLE IF NOT EXISTS public.ops_cross_dept_tasks (
  id          TEXT PRIMARY KEY,
  property_id UUID,
  title       TEXT NOT NULL,
  description TEXT,
  type        TEXT NOT NULL DEFAULT 'other' CHECK (type IN (
                'vip-arrival','wedding','conference','emergency',
                'maintenance','renovation','other'
              )),
  priority    TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN (
                'low','medium','high','critical'
              )),
  status      TEXT NOT NULL DEFAULT 'planning' CHECK (status IN (
                'planning','in-progress','completed','on-hold'
              )),
  departments JSONB NOT NULL DEFAULT '[]',
  start_at    TIMESTAMPTZ,
  end_at      TIMESTAMPTZ,
  source_ref  TEXT,
  created_by  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ops_cross_dept_tasks_property
  ON public.ops_cross_dept_tasks(property_id);
CREATE INDEX IF NOT EXISTS idx_ops_cross_dept_tasks_status
  ON public.ops_cross_dept_tasks(status);
CREATE INDEX IF NOT EXISTS idx_ops_cross_dept_tasks_source_ref
  ON public.ops_cross_dept_tasks(source_ref);

CREATE OR REPLACE FUNCTION public.update_ops_cross_dept_tasks_timestamp()
RETURNS TRIGGER AS $$ BEGIN NEW.updated_at = NOW(); RETURN NEW; END; $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_ops_cross_dept_tasks_updated_at ON public.ops_cross_dept_tasks;
CREATE TRIGGER trg_ops_cross_dept_tasks_updated_at
  BEFORE UPDATE ON public.ops_cross_dept_tasks
  FOR EACH ROW EXECUTE FUNCTION public.update_ops_cross_dept_tasks_timestamp();

ALTER TABLE public.ops_cross_dept_tasks ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ops_cross_dept_tasks TO authenticated;

-- ── Seed mock data ───────────────────────────────────────────────────────
-- The 5 tasks previously hardcoded in CrossDepartmentTaskCenter.tsx.
INSERT INTO public.ops_cross_dept_tasks
  (id, property_id, title, description, type, priority, status, departments,
   start_at, end_at, created_by, created_at)
VALUES
  ('ops-task-seed-001', '18762279-a389-41c9-9169-7ebc682e9703',
   'VVIP Guest Arrival - Mr. John Smith',
   'Complete preparation for VVIP guest including suite readiness, amenities, security, and transportation',
   'vip-arrival', 'critical', 'in-progress',
   '[{"department":"Front Office","status":"completed","lead":"Sarah Johnson"},
     {"department":"Housekeeping","status":"in-progress","lead":"Emily Brown"},
     {"department":"Engineering","status":"completed","lead":"Mike Wilson"},
     {"department":"Security","status":"in-progress","lead":"Robert Taylor"},
     {"department":"F&B","status":"pending","lead":"David Lee"},
     {"department":"Transportation","status":"pending","lead":"Chris Anderson"}]'::jsonb,
   CURRENT_DATE + interval '10 hours', CURRENT_DATE + interval '14 hours',
   'General Manager', NOW() - interval '1 day'),
  ('ops-task-seed-002', '18762279-a389-41c9-9169-7ebc682e9703',
   'Johnson Wedding Reception Setup',
   'Coordinate wedding reception setup including banquet preparation, decoration, audio-visual, and service staffing',
   'wedding', 'high', 'in-progress',
   '[{"department":"F&B","status":"in-progress","lead":"David Lee"},
     {"department":"Events","status":"in-progress","lead":"Jessica Martinez"},
     {"department":"Engineering","status":"completed","lead":"Mike Wilson"},
     {"department":"Housekeeping","status":"pending","lead":"Emily Brown"}]'::jsonb,
   CURRENT_DATE + interval '8 hours', CURRENT_DATE + interval '19 hours',
   'Events Manager', NOW() - interval '2 days'),
  ('ops-task-seed-003', '18762279-a389-41c9-9169-7ebc682e9703',
   'TechCorp Annual Conference',
   'Large-scale conference requiring coordination across all departments for 200 attendees',
   'conference', 'high', 'planning',
   '[{"department":"Front Office","status":"pending","lead":"Sarah Johnson"},
     {"department":"F&B","status":"pending","lead":"David Lee"},
     {"department":"Events","status":"pending","lead":"Jessica Martinez"},
     {"department":"Engineering","status":"pending","lead":"Mike Wilson"},
     {"department":"IT","status":"pending","lead":"Kevin Chen"},
     {"department":"Security","status":"pending","lead":"Robert Taylor"},
     {"department":"Housekeeping","status":"pending","lead":"Emily Brown"}]'::jsonb,
   CURRENT_DATE + interval '15 days 9 hours', CURRENT_DATE + interval '15 days 18 hours',
   'Sales Director', NOW() - interval '7 days'),
  ('ops-task-seed-004', '18762279-a389-41c9-9169-7ebc682e9703',
   'HVAC Emergency Repair - Floor 3',
   'Emergency repair coordination for HVAC system failure affecting 12 rooms',
   'emergency', 'critical', 'in-progress',
   '[{"department":"Engineering","status":"in-progress","lead":"Mike Wilson"},
     {"department":"Front Office","status":"completed","lead":"Sarah Johnson"},
     {"department":"Housekeeping","status":"completed","lead":"Emily Brown"}]'::jsonb,
   CURRENT_DATE + interval '6 hours', CURRENT_DATE + interval '18 hours',
   'Duty Manager', NOW() - interval '6 hours'),
  ('ops-task-seed-005', '18762279-a389-41c9-9169-7ebc682e9703',
   'Pool Area Renovation',
   'Coordinate pool area renovation including construction, guest communication, and alternative arrangements',
   'renovation', 'medium', 'on-hold',
   '[{"department":"Engineering","status":"on-hold","lead":"Mike Wilson"},
     {"department":"Front Office","status":"on-hold","lead":"Sarah Johnson"},
     {"department":"Housekeeping","status":"on-hold","lead":"Emily Brown"},
     {"department":"Security","status":"on-hold","lead":"Robert Taylor"}]'::jsonb,
   CURRENT_DATE + interval '1 day 8 hours', CURRENT_DATE + interval '15 days 18 hours',
   'General Manager', NOW() - interval '14 days')
ON CONFLICT (id) DO NOTHING;
