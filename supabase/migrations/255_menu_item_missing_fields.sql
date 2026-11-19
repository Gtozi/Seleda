-- Migration 255: Add Missing Menu Item Fields per FB Portal Spec
-- Adds: item_code, sku, description, images, preparation_time, multiple_price_levels, revenue_account, nutritional_info, allergen_info, subcategory

-- ════════════════════════════════════════════════════════════════════════
-- 1. Add new columns to menu_items
-- ════════════════════════════════════════════════════════════════════════
ALTER TABLE public.menu_items ADD COLUMN IF NOT EXISTS item_code text UNIQUE;
ALTER TABLE public.menu_items ADD COLUMN IF NOT EXISTS sku text UNIQUE;
ALTER TABLE public.menu_items ADD COLUMN IF NOT EXISTS description text;
ALTER TABLE public.menu_items ADD COLUMN IF NOT EXISTS images text[] DEFAULT '{}';
ALTER TABLE public.menu_items ADD COLUMN IF NOT EXISTS preparation_time_minutes integer;
ALTER TABLE public.menu_items ADD COLUMN IF NOT EXISTS multiple_price_levels jsonb DEFAULT '{}'::jsonb;
ALTER TABLE public.menu_items ADD COLUMN IF NOT EXISTS revenue_account text;
ALTER TABLE public.menu_items ADD COLUMN IF NOT EXISTS nutritional_info jsonb DEFAULT '{}'::jsonb;
ALTER TABLE public.menu_items ADD COLUMN IF NOT EXISTS allergen_info text[] DEFAULT '{}';
ALTER TABLE public.menu_items ADD COLUMN IF NOT EXISTS subcategory text;

-- ════════════════════════════════════════════════════════════════════════
-- 2. Add nutrition_facts and dietary_labels to digital_menu_items
-- ════════════════════════════════════════════════════════════════════════
ALTER TABLE public.digital_menu_items ADD COLUMN IF NOT EXISTS nutrition_facts jsonb DEFAULT '{}'::jsonb;
ALTER TABLE public.digital_menu_items ADD COLUMN IF NOT EXISTS dietary_labels text[] DEFAULT '{}';

-- ════════════════════════════════════════════════════════════════════════
-- 3. Create indexes for new fields
-- ════════════════════════════════════════════════════════════════════════
CREATE INDEX IF NOT EXISTS idx_menu_items_item_code ON public.menu_items(item_code);
CREATE INDEX IF NOT EXISTS idx_menu_items_sku ON public.menu_items(sku);
CREATE INDEX IF NOT EXISTS idx_menu_items_subcategory ON public.menu_items(subcategory);
CREATE INDEX IF NOT EXISTS idx_menu_items_revenue_account ON public.menu_items(revenue_account);

-- ════════════════════════════════════════════════════════════════════════
-- 4. Add comments for documentation
-- ════════════════════════════════════════════════════════════════════════
COMMENT ON COLUMN public.menu_items.item_code IS 'Unique item identifier code';
COMMENT ON COLUMN public.menu_items.sku IS 'Stock Keeping Unit for inventory tracking';
COMMENT ON COLUMN public.menu_items.description IS 'Detailed description of the menu item';
COMMENT ON COLUMN public.menu_items.images IS 'Array of image URLs';
COMMENT ON COLUMN public.menu_items.preparation_time_minutes IS 'Standard preparation time in minutes';
COMMENT ON COLUMN public.menu_items.multiple_price_levels IS 'JSON object with price levels: {"standard": 10.00, "happy_hour": 8.00, "member": 9.00}';
COMMENT ON COLUMN public.menu_items.revenue_account IS 'GL account code for revenue posting';
COMMENT ON COLUMN public.menu_items.nutritional_info IS 'JSON object: {"calories": 500, "protein": "20g", "carbs": "50g", "fat": "25g", "fiber": "5g", "sugar": "10g", "sodium": "800mg"}';
COMMENT ON COLUMN public.menu_items.allergen_info IS 'Array of allergens: ["gluten", "dairy", "nuts", "shellfish", "eggs", "soy"]';
COMMENT ON COLUMN public.menu_items.subcategory IS 'Subcategory within the main category (e.g., "Appetizers" → "Hot Appetizers")';

COMMENT ON COLUMN public.digital_menu_items.nutrition_facts IS 'JSON object with nutrition facts for digital menu display';
COMMENT ON COLUMN public.digital_menu_items.dietary_labels IS 'Array of dietary labels: ["vegetarian", "vegan", "gluten-free", "keto", "low-sodium"]';