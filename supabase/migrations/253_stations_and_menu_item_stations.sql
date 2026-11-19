-- Migration 253: Stations/KDS Support for Menu Items
-- Links menu items to preparation stations (KDS) in addition to outlets and menus

-- ════════════════════════════════════════════════════════════════════════
-- 1. Stations (KDS preparation stations)
-- ════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.stations (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  outlet_id text NOT NULL REFERENCES public.outlets(id) ON DELETE CASCADE,
  name text NOT NULL,
  code text UNIQUE, -- e.g., "GRILL", "BAR", "DESSERT"
  description text,
  station_type text NOT NULL DEFAULT 'prep', -- prep, cooking, assembly, service, bar, dessert
  display_order integer NOT NULL DEFAULT 0,
  kds_enabled boolean NOT NULL DEFAULT true, -- shown on KDS
  printer_id text, -- link to printer system
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_stations_outlet ON public.stations(outlet_id);
CREATE INDEX IF NOT EXISTS idx_stations_type ON public.stations(station_type);
CREATE INDEX IF NOT EXISTS idx_stations_active ON public.stations(is_active);
ALTER TABLE public.stations ENABLE ROW LEVEL SECURITY;

-- ════════════════════════════════════════════════════════════════════════
-- 2. Menu Items ↔ Stations Link (preparation routing)
-- ════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.menu_item_stations (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  menu_item_id text NOT NULL REFERENCES public.menu_items(id) ON DELETE CASCADE,
  station_id text NOT NULL REFERENCES public.stations(id) ON DELETE CASCADE,
  is_primary boolean NOT NULL DEFAULT false, -- primary station for the item
  preparation_time_minutes integer, -- optional override per station
  display_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_menu_item_stations_item ON public.menu_item_stations(menu_item_id);
CREATE INDEX IF NOT EXISTS idx_menu_item_stations_station ON public.menu_item_stations(station_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_menu_item_stations_unique ON public.menu_item_stations(menu_item_id, station_id);
ALTER TABLE public.menu_item_stations ENABLE ROW LEVEL SECURITY;

-- ════════════════════════════════════════════════════════════════════════
-- 3. Default station assignment to menu_items (optional for backward compat)
-- ════════════════════════════════════════════════════════════════════════
ALTER TABLE public.menu_items ADD COLUMN IF NOT EXISTS default_station_id text REFERENCES public.stations(id) ON DELETE SET NULL;

-- ════════════════════════════════════════════════════════════════════════
-- 4. RLS Policies
-- ════════════════════════════════════════════════════════════════════════
DO $$
DECLARE t text;
  tables text[] := ARRAY['stations', 'menu_item_stations'];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    BEGIN
      EXECUTE format('CREATE POLICY "service_role all %s" ON public.%I FOR ALL USING (auth.role() = ''service_role'') WITH CHECK (auth.role() = ''service_role'')', t, t);
    EXCEPTION WHEN duplicate_object THEN NULL; END;
    BEGIN
      EXECUTE format('CREATE POLICY "authenticated read %s" ON public.%I FOR SELECT USING (auth.role() = ''authenticated'')', t, t);
    EXCEPTION WHEN duplicate_object THEN NULL; END;
  END LOOP;
END $$;

-- ════════════════════════════════════════════════════════════════════════
-- 5. updated_at triggers
-- ════════════════════════════════════════════════════════════════════════
DO $$
DECLARE t text;
  tables text[] := ARRAY['stations', 'menu_item_stations'];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    BEGIN
      EXECUTE format(
        'CREATE TRIGGER update_%s_updated_at BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()',
        t, t
      );
    EXCEPTION WHEN duplicate_object THEN NULL; END;
  END LOOP;
END $$;

-- ════════════════════════════════════════════════════════════════════════
-- 6. Insert default stations (optional - can be done in app)
-- ════════════════════════════════════════════════════════════════════════
-- Uncomment to create default stations for each outlet
-- INSERT INTO public.stations (outlet_id, name, code, station_type, display_order)
-- SELECT id, 'Kitchen Prep', 'PREP', 'prep', 1 FROM public.outlets
-- ON CONFLICT DO NOTHING;