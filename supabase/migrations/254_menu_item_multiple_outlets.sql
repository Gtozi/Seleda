-- Migration 254: Enable Multiple Outlets per Menu Item
-- Changes from single outlet_id to many-to-many relationship

-- ════════════════════════════════════════════════════════════════════════
-- 1. Create junction table for menu items ↔ outlets
-- ════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.menu_item_outlets (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  menu_item_id text NOT NULL REFERENCES public.menu_items(id) ON DELETE CASCADE,
  outlet_id text NOT NULL REFERENCES public.outlets(id) ON DELETE CASCADE,
  is_primary boolean NOT NULL DEFAULT false, -- primary outlet for this item
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_menu_item_outlets_item ON public.menu_item_outlets(menu_item_id);
CREATE INDEX IF NOT EXISTS idx_menu_item_outlets_outlet ON public.menu_item_outlets(outlet_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_menu_item_outlets_unique ON public.menu_item_outlets(menu_item_id, outlet_id);
ALTER TABLE public.menu_item_outlets ENABLE ROW LEVEL SECURITY;

-- ════════════════════════════════════════════════════════════════════════
-- 2. Migrate existing outlet_id data to junction table
-- ════════════════════════════════════════════════════════════════════════
INSERT INTO public.menu_item_outlets (menu_item_id, outlet_id, is_primary)
SELECT id, outlet_id, true
FROM public.menu_items
WHERE outlet_id IS NOT NULL
ON CONFLICT (menu_item_id, outlet_id) DO NOTHING;

-- ════════════════════════════════════════════════════════════════════════
-- 3. Drop outlet_id column from menu_items (optional - can keep for backward compat)
-- ════════════════════════════════════════════════════════════════════════
-- Option A: Remove the column completely
-- ALTER TABLE public.menu_items DROP COLUMN IF EXISTS outlet_id;

-- Option B: Make nullable and keep as deprecated/legacy (safer)
ALTER TABLE public.menu_items ALTER COLUMN outlet_id DROP NOT NULL;

-- ════════════════════════════════════════════════════════════════════════
-- 4. RLS Policies
-- ════════════════════════════════════════════════════════════════════════
DO $$
BEGIN
  EXECUTE 'CREATE POLICY "service_role all menu_item_outlets" ON public.menu_item_outlets FOR ALL USING (auth.role() = ''service_role'') WITH CHECK (auth.role() = ''service_role'')';
EXCEPTION WHEN duplicate_object THEN NULL; END;

BEGIN
  EXECUTE 'CREATE POLICY "authenticated read menu_item_outlets" ON public.menu_item_outlets FOR SELECT USING (auth.role() = ''authenticated'')';
EXCEPTION WHEN duplicate_object THEN NULL; END;
END $$;