-- Migration 257: Sub-Recipes (preparations used as components in other recipes)
-- Sub-recipes are intermediate preparations like tomato sauce, pizza dough, beef stock, etc.
-- They have their own ingredient lines and can be referenced from recipe_lines.

-- ── 1. Sub-Recipes ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.sub_recipes (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  name text NOT NULL UNIQUE,
  description text,
  category text NOT NULL DEFAULT 'Sauce', -- Sauce, Dough, Stock, Marinade, Dressing, Base, Other
  yield_qty numeric(10,3) NOT NULL DEFAULT 1.000, -- produced quantity (e.g., 2.000 kg)
  yield_unit text NOT NULL DEFAULT 'kg', -- unit of the produced quantity
  portions integer NOT NULL DEFAULT 1,
  prep_time_minutes integer NOT NULL DEFAULT 0,
  cook_time_minutes integer NOT NULL DEFAULT 0,
  shelf_life_hours integer, -- how long it stays fresh
  storage_temp text, -- e.g., 'Refrigerated', 'Frozen', 'Room Temp'
  haccp_control text, -- e.g., 'Cold Chain', 'Core Temp'
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sub_recipes_category ON public.sub_recipes(category);
CREATE INDEX IF NOT EXISTS idx_sub_recipes_active ON public.sub_recipes(is_active);
ALTER TABLE public.sub_recipes ENABLE ROW LEVEL SECURITY;

-- ── 2. Sub-Recipe Lines (ingredients for sub-recipes) ───────────────────
CREATE TABLE IF NOT EXISTS public.sub_recipe_lines (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  sub_recipe_id text NOT NULL REFERENCES public.sub_recipes(id) ON DELETE CASCADE,
  ingredient_id text NOT NULL REFERENCES public.ingredients(id) ON DELETE CASCADE,
  quantity numeric(10,3) NOT NULL,
  unit text NOT NULL,
  cost_at_time_of_costing numeric(18,2) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sub_recipe_lines_sub_recipe ON public.sub_recipe_lines(sub_recipe_id);
CREATE INDEX IF NOT EXISTS idx_sub_recipe_lines_ingredient ON public.sub_recipe_lines(ingredient_id);
ALTER TABLE public.sub_recipe_lines ENABLE ROW LEVEL SECURITY;

-- ── 3. Link sub-recipes to recipe_lines (optional) ──────────────────────
-- Allows a recipe_line to reference a sub_recipe instead of (or in addition to) an ingredient.
ALTER TABLE public.recipe_lines ADD COLUMN IF NOT EXISTS sub_recipe_id text REFERENCES public.sub_recipes(id) ON DELETE SET NULL;

-- ── 4. RLS Policies ─────────────────────────────────────────────────────
DO $$
DECLARE t text;
  tables text[] := ARRAY['sub_recipes', 'sub_recipe_lines'];
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

-- ── 5. updated_at triggers ──────────────────────────────────────────────
DO $$
DECLARE t text;
  tables text[] := ARRAY['sub_recipes', 'sub_recipe_lines'];
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
