-- Migration 252: Menu Types and Multi-Menu Support
-- Support for different menu types: a la carte, table d'hôte, drink menus, fixed/rotational menus, etc.

-- ── 1. Menu Types (predefined categories) ───────────────────────────────
CREATE TABLE IF NOT EXISTS public.menu_types (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  name text NOT NULL UNIQUE,
  description text,
  icon text,
  allows_multiple_courses boolean NOT NULL DEFAULT false, -- e.g., table d'hôte
  allows_substitutions boolean NOT NULL DEFAULT true, -- e.g., a la carte
  is_fixed_price boolean NOT NULL DEFAULT false, -- e.g., table d'hôte, fixed menu
  is_rotational boolean NOT NULL DEFAULT false, -- e.g., seasonal rotation
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Insert predefined menu types
INSERT INTO public.menu_types (name, description, icon, allows_multiple_courses, allows_substitutions, is_fixed_price, is_rotational, sort_order) VALUES
  ('a_la_carte', 'A la carte - individual items priced separately', 'utensils', false, true, false, false, 1),
  ('table_dhote', 'Table d''hôte - fixed price multi-course meal', 'book-open', true, false, true, false, 2),
  ('drink_menu', 'Beverage and drink menu', 'wine', false, true, false, false, 3),
  ('fixed_menu', 'Fixed menu with no substitutions', 'lock', false, false, true, false, 4),
  ('rotational_menu', 'Seasonal or rotational menu', 'refresh-cw', false, true, false, true, 5),
  ('banquet_menu', 'Banquet or event menu', 'users', true, false, true, false, 6),
  ('room_service', 'In-room dining menu', 'bed-double', false, true, false, false, 7),
  ('kids_menu', 'Children''s menu', 'smile', false, true, false, false, 8)
ON CONFLICT (name) DO NOTHING;

CREATE INDEX IF NOT EXISTS idx_menu_types_active ON public.menu_types(is_active);
ALTER TABLE public.menu_types ENABLE ROW LEVEL SECURITY;

-- ── 2. Menus (menu collections) ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.menus (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  outlet_id text REFERENCES public.outlets(id) ON DELETE CASCADE,
  menu_type_id text REFERENCES public.menu_types(id) ON DELETE RESTRICT,
  name text NOT NULL,
  description text,
  base_price numeric(10,2), -- for fixed-price menus like table d'hôte
  currency text NOT NULL DEFAULT 'USD',
  course_structure jsonb DEFAULT '[]'::jsonb, -- e.g., [{name: "Appetizer", items: []}, {name: "Main", items: []}]
  valid_from date,
  valid_to date,
  is_published boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_menus_outlet ON public.menus(outlet_id);
CREATE INDEX IF NOT EXISTS idx_menus_type ON public.menus(menu_type_id);
CREATE INDEX IF NOT EXISTS idx_menus_active ON public.menus(is_active);
CREATE INDEX IF NOT EXISTS idx_menus_published ON public.menus(is_published);
ALTER TABLE public.menus ENABLE ROW LEVEL SECURITY;

-- ── 3. Menu Items ↔ Menus link (with overrides) ────────────────────────────
CREATE TABLE IF NOT EXISTS public.menu_items_menus (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  menu_id text NOT NULL REFERENCES public.menus(id) ON DELETE CASCADE,
  menu_item_id text NOT NULL REFERENCES public.menu_items(id) ON DELETE CASCADE,
  course_name text, -- for multi-course menus (e.g., "Appetizer", "Main", "Dessert")
  course_order integer, -- ordering within a course
  display_order integer NOT NULL DEFAULT 0, -- overall display order
  override_price numeric(10,2), -- optional price override for this menu
  override_name text, -- optional name override
  override_description text, -- optional description override
  is_available boolean NOT NULL DEFAULT true,
  is_featured boolean NOT NULL DEFAULT false,
  dietary_tags text[], -- e.g., ['vegetarian', 'gluten-free']
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_menu_items_menus_menu ON public.menu_items_menus(menu_id);
CREATE INDEX IF NOT EXISTS idx_menu_items_menus_item ON public.menu_items_menus(menu_item_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_menu_items_menus_unique ON public.menu_items_menus(menu_id, menu_item_id);
ALTER TABLE public.menu_items_menus ENABLE ROW LEVEL SECURITY;

-- ── 4. Add menu_type_id to menu_items (optional default type) ───────────────
ALTER TABLE public.menu_items ADD COLUMN IF NOT EXISTS menu_type_id text REFERENCES public.menu_types(id) ON DELETE SET NULL;

-- ── 5. RLS Policies ─────────────────────────────────────────────────────
DO $$
DECLARE t text;
  tables text[] := ARRAY['menu_types', 'menus', 'menu_items_menus'];
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

-- ── 6. updated_at triggers ──────────────────────────────────────────────
DO $$
DECLARE t text;
  tables text[] := ARRAY['menu_types', 'menus', 'menu_items_menus'];
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