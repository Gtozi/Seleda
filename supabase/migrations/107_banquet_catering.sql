-- Banquet & Events catering tables (menu items and beverages)

CREATE TABLE IF NOT EXISTS public.banquet_menu_items (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  property_id uuid,
  event_id text REFERENCES public.banquet_events(id) ON DELETE CASCADE,
  menu_type text,
  course_type text,
  dish_name text NOT NULL,
  dietary text,
  quantity integer DEFAULT 0,
  special_notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_banquet_menu_items_event ON public.banquet_menu_items(event_id);

CREATE TABLE IF NOT EXISTS public.banquet_beverages (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  property_id uuid,
  event_id text REFERENCES public.banquet_events(id) ON DELETE CASCADE,
  beverage_type text,
  category text,
  name text NOT NULL,
  quantity integer DEFAULT 0,
  service_type text,
  special_notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_banquet_beverages_event ON public.banquet_beverages(event_id);
