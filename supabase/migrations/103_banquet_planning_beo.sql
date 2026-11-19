-- Banquet & Events planning and BEO tables

CREATE TABLE IF NOT EXISTS public.banquet_schedules (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  property_id uuid,
  event_id text REFERENCES public.banquet_events(id) ON DELETE CASCADE,
  task_name text NOT NULL,
  start_time timestamptz,
  end_time timestamptz,
  assigned_to text,
  department text,
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_banquet_schedules_event ON public.banquet_schedules(event_id);

CREATE TABLE IF NOT EXISTS public.banquet_checklists (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  property_id uuid,
  event_id text REFERENCES public.banquet_events(id) ON DELETE CASCADE,
  item_name text NOT NULL,
  category text,
  due_date date,
  assigned_to text,
  is_completed boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_banquet_checklists_event ON public.banquet_checklists(event_id);

CREATE TABLE IF NOT EXISTS public.banquet_beos (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  property_id uuid,
  event_id text REFERENCES public.banquet_events(id) ON DELETE CASCADE,
  event_name text,
  client_name text,
  event_date date,
  venue_ids text[] DEFAULT '{}'::text[],
  setup_time timestamptz,
  event_start_time timestamptz,
  event_end_time timestamptz,
  breakdown_time timestamptz,
  menu_items text[] DEFAULT '{}'::text[],
  beverage_items text[] DEFAULT '{}'::text[],
  equipment text[] DEFAULT '{}'::text[],
  staffing jsonb DEFAULT '[]'::jsonb,
  special_requests text[] DEFAULT '{}'::text[],
  vip_information text[] DEFAULT '{}'::text[],
  distributed_to text[] DEFAULT '{}'::text[],
  distributed_at timestamptz,
  status text NOT NULL DEFAULT 'Draft' CHECK (status IN ('Draft','Review','Approved','Distributed','Revised','Final','Completed')),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_banquet_beos_event ON public.banquet_beos(event_id);
CREATE INDEX IF NOT EXISTS idx_banquet_beos_status ON public.banquet_beos(status);