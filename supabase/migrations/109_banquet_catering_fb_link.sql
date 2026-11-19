-- Link banquet catering items to F&B menu_items catalog

ALTER TABLE public.banquet_menu_items
  ADD COLUMN IF NOT EXISTS menu_item_id text REFERENCES public.menu_items(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS unit_price numeric(10,2);

CREATE INDEX IF NOT EXISTS idx_banquet_menu_items_menu_item ON public.banquet_menu_items(menu_item_id);

ALTER TABLE public.banquet_beverages
  ADD COLUMN IF NOT EXISTS menu_item_id text REFERENCES public.menu_items(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS unit_price numeric(10,2);

CREATE INDEX IF NOT EXISTS idx_banquet_beverages_menu_item ON public.banquet_beverages(menu_item_id);
