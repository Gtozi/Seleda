-- Migration 251: Menu Catalog Enhancements
-- Modifier groups, availability rules, and digital menus for the F&B menu_items table.
-- These tables are linked to the F&B `menu_items` table (text IDs, migration 082),
-- separate from the POS `pos_menu_items` (UUID) enhancements in migration 207.

-- ── 1. Modifier Groups ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.menu_modifier_groups (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  outlet_id text REFERENCES public.outlets(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  selection_type text NOT NULL DEFAULT 'single' CHECK (selection_type IN ('single', 'multi', 'quantity')),
  min_selections integer NOT NULL DEFAULT 0,
  max_selections integer ,
  is_required boolean NOT NULL DEFAULT false,
  sort_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_menu_modifier_groups_outlet ON public.menu_modifier_groups(outlet_id);
CREATE INDEX IF NOT EXISTS idx_menu_modifier_groups_active ON public.menu_modifier_groups(is_active);
ALTER TABLE public.menu_modifier_groups ENABLE ROW LEVEL SECURITY;

-- ── 2. Modifier Options ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.menu_modifier_options (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  modifier_group_id text NOT NULL REFERENCES public.menu_modifier_groups(id) ON DELETE CASCADE,
  name text NOT NULL,
  price_adjustment numeric(10,2) NOT NULL DEFAULT 0,
  is_default boolean NOT NULL DEFAULT false,
  sort_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_menu_modifier_options_group ON public.menu_modifier_options(modifier_group_id);
ALTER TABLE public.menu_modifier_options ENABLE ROW LEVEL SECURITY;

-- ── 3. Menu Item ↔ Modifier Group link ──────────────────────────────────
CREATE TABLE IF NOT EXISTS public.menu_item_modifier_groups (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  menu_item_id text NOT NULL REFERENCES public.menu_items(id) ON DELETE CASCADE,
  modifier_group_id text NOT NULL REFERENCES public.menu_modifier_groups(id) ON DELETE CASCADE,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_menu_item_modifier_groups_item ON public.menu_item_modifier_groups(menu_item_id);
CREATE INDEX IF NOT EXISTS idx_menu_item_modifier_groups_group ON public.menu_item_modifier_groups(modifier_group_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_menu_item_modifier_groups_unique ON public.menu_item_modifier_groups(menu_item_id, modifier_group_id);
ALTER TABLE public.menu_item_modifier_groups ENABLE ROW LEVEL SECURITY;

-- ── 4. Menu Availability Rules ──────────────────────────────────────────
-- Time-based, seasonal, and outlet-specific availability for menu items.
CREATE TABLE IF NOT EXISTS public.menu_availability_rules (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  menu_item_id text NOT NULL REFERENCES public.menu_items(id) ON DELETE CASCADE,
  outlet_id text REFERENCES public.outlets(id) ON DELETE CASCADE,
  rule_type text NOT NULL DEFAULT 'time_based' CHECK (rule_type IN ('time_based', 'seasonal', 'outlet_specific', 'daily')),
  applicable_days integer[] NOT NULL DEFAULT '{0,1,2,3,4,5,6}',
  start_time time,
  end_time time,
  start_date date,
  end_date date,
  is_available boolean NOT NULL DEFAULT true,
  reason text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_menu_availability_rules_item ON public.menu_availability_rules(menu_item_id);
CREATE INDEX IF NOT EXISTS idx_menu_availability_rules_outlet ON public.menu_availability_rules(outlet_id);
CREATE INDEX IF NOT EXISTS idx_menu_availability_rules_active ON public.menu_availability_rules(is_active);
ALTER TABLE public.menu_availability_rules ENABLE ROW LEVEL SECURITY;

-- ── 5. Digital Menus ────────────────────────────────────────────────────
-- A published digital menu collection with QR code and multi-language support.
CREATE TABLE IF NOT EXISTS public.digital_menus (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  outlet_id text REFERENCES public.outlets(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  qr_code text,
  published_url text,
  primary_language text NOT NULL DEFAULT 'en',
  supported_languages text[] NOT NULL DEFAULT '{en}',
  theme jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_published boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_digital_menus_outlet ON public.digital_menus(outlet_id);
CREATE INDEX IF NOT EXISTS idx_digital_menus_published ON public.digital_menus(is_published);
ALTER TABLE public.digital_menus ENABLE ROW LEVEL SECURITY;

-- ── 6. Digital Menu Items ───────────────────────────────────────────────
-- Link table between digital menus and menu items, with per-menu translations.
CREATE TABLE IF NOT EXISTS public.digital_menu_items (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  digital_menu_id text NOT NULL REFERENCES public.digital_menus(id) ON DELETE CASCADE,
  menu_item_id text NOT NULL REFERENCES public.menu_items(id) ON DELETE CASCADE,
  display_category text,
  sort_order integer NOT NULL DEFAULT 0,
  translated_name jsonb NOT NULL DEFAULT '{}'::jsonb,
  translated_description jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_featured boolean NOT NULL DEFAULT false,
  is_visible boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_digital_menu_items_menu ON public.digital_menu_items(digital_menu_id);
CREATE INDEX IF NOT EXISTS idx_digital_menu_items_item ON public.digital_menu_items(menu_item_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_digital_menu_items_unique ON public.digital_menu_items(digital_menu_id, menu_item_id);
ALTER TABLE public.digital_menu_items ENABLE ROW LEVEL SECURITY;

-- ── 7. RLS Policies ─────────────────────────────────────────────────────
DO $$
DECLARE t text;
  tables text[] := ARRAY[
    'menu_modifier_groups','menu_modifier_options','menu_item_modifier_groups',
    'menu_availability_rules','digital_menus','digital_menu_items'
  ];
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

-- ── 8. updated_at triggers ──────────────────────────────────────────────
DO $$
DECLARE t text;
  tables text[] := ARRAY[
    'menu_modifier_groups','menu_modifier_options','menu_availability_rules',
    'digital_menus','digital_menu_items'
  ];
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
