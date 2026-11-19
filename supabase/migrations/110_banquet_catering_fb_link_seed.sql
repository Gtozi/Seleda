-- Link existing banquet catering seed items to F&B menu_items catalog where names match

UPDATE public.banquet_menu_items b
SET menu_item_id = m.id,
    unit_price = COALESCE(b.unit_price, m.selling_price)
FROM public.menu_items m
WHERE b.menu_item_id IS NULL
  AND (b.dish_name ILIKE '%' || m.name || '%' OR m.name ILIKE '%' || b.dish_name || '%');

UPDATE public.banquet_beverages b
SET menu_item_id = m.id,
    unit_price = COALESCE(b.unit_price, m.selling_price)
FROM public.menu_items m
WHERE b.menu_item_id IS NULL
  AND (b.name ILIKE '%' || m.name || '%' OR m.name ILIKE '%' || b.name || '%');
