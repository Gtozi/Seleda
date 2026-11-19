-- Generic event-type-specific items (wedding details, conference sessions, meeting agenda, social details, room blocks)
CREATE TABLE IF NOT EXISTS public.banquet_event_type_items (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  property_id uuid,
  event_id text REFERENCES public.banquet_events(id) ON DELETE CASCADE,
  item_type text NOT NULL,
  item_data jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_banquet_event_type_items_type ON public.banquet_event_type_items(item_type);
CREATE INDEX IF NOT EXISTS idx_banquet_event_type_items_event ON public.banquet_event_type_items(event_id);

-- Generic per-event-type checklist (replaces static placeholders)
CREATE TABLE IF NOT EXISTS public.banquet_event_type_checklists (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  property_id uuid,
  event_id text REFERENCES public.banquet_events(id) ON DELETE CASCADE,
  item_type text NOT NULL,
  item_name text NOT NULL,
  is_completed boolean DEFAULT false,
  due_date date,
  assigned_to text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_banquet_event_type_checklists_type ON public.banquet_event_type_checklists(item_type);
CREATE INDEX IF NOT EXISTS idx_banquet_event_type_checklists_event ON public.banquet_event_type_checklists(event_id);