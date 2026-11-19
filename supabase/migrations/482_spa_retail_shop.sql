-- 482: Spa Retail Shop — products + sales transactions
-- Replaces mock retail catalog. sold_this_month is computed live from
-- spa_retail_sales; stock is decremented on each recorded sale.

create table if not exists public.spa_retail_products (
  id            text primary key,
  name          text not null,
  category      text not null
                check (category in ('Skincare','Haircare','Massage Oils','Supplements','Wellness Products','Gift Items')),
  sku           text not null unique,
  price         numeric(10,2) not null default 0 check (price >= 0),
  cost          numeric(10,2) not null default 0 check (cost >= 0),
  stock         integer not null default 0 check (stock >= 0),
  min_stock     integer not null default 5 check (min_stock >= 0),
  description   text,
  brand         text,
  is_active     boolean not null default true,
  property_id   text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table if not exists public.spa_retail_sales (
  id            text primary key,
  product_id    text not null references public.spa_retail_products(id) on delete cascade,
  guest_id      text references public.guests(id) on delete set null,
  guest_name    text,
  quantity      integer not null default 1 check (quantity > 0),
  unit_price    numeric(10,2) not null default 0,
  total         numeric(10,2) not null default 0,
  payment_method text,
  sold_by       text,
  sale_date     date not null default current_date,
  property_id   text,
  created_at    timestamptz not null default now()
);

alter table public.spa_retail_products enable row level security;
alter table public.spa_retail_sales enable row level security;

drop policy if exists spa_retail_products_all on public.spa_retail_products;
create policy spa_retail_products_all on public.spa_retail_products
  for all to authenticated using (true) with check (true);

drop policy if exists spa_retail_sales_all on public.spa_retail_sales;
create policy spa_retail_sales_all on public.spa_retail_sales
  for all to authenticated using (true) with check (true);

grant select, insert, update, delete on public.spa_retail_products to authenticated;
grant select, insert, update, delete on public.spa_retail_sales to authenticated;

create index if not exists idx_spa_retail_products_category on public.spa_retail_products(category);
create index if not exists idx_spa_retail_sales_product on public.spa_retail_sales(product_id);
create index if not exists idx_spa_retail_sales_date on public.spa_retail_sales(sale_date);

-- ── Seed products (former mock catalog) ─────────────────────────────
insert into public.spa_retail_products
  (id, name, category, sku, price, cost, stock, min_stock, description, brand, is_active)
values
  ('RTL-001','Lavender Massage Oil','Massage Oils','SKU-LAV-001',45,22,24,10,
   'Premium lavender essential oil blend for relaxation','Spa Essentials',true),
  ('RTL-002','Hydrating Face Serum','Skincare','SKU-HYD-002',85,40,8,15,
   'Intensive hydration serum with hyaluronic acid','Glow Beauty',true),
  ('RTL-003','Deep Conditioning Hair Mask','Haircare','SKU-HAI-003',38,18,15,8,
   'Repairing hair mask for damaged hair','Hair Care Pro',true),
  ('RTL-004','Vitamin C Supplement','Supplements','SKU-SUP-004',35,15,50,20,
   'Immune support vitamin C complex','Wellness Plus',true),
  ('RTL-005','Aromatherapy Candle Set','Gift Items','SKU-GFT-005',55,25,12,5,
   'Set of 3 soy wax aromatherapy candles','Zen Scents',true),
  ('RTL-006','Epsom Salt Bath Soak','Wellness Products','SKU-WEL-006',28,12,30,15,
   'Muscle relaxation epsom salt blend','Spa Essentials',true)
on conflict (id) do nothing;

-- ── Seed sales matching former mock soldThisMonth counts ────────────
-- (18 / 32 / 12 / 45 / 8 / 22) spread across this month
do $$
declare
  g record;
  i int;
  seed record;
  sale_id text;
  seq int := 0;
  sold_qtys int[];
  products text[] := array['RTL-001','RTL-002','RTL-003','RTL-004','RTL-005','RTL-006'];
  counts int[] := array[18,32,12,45,8,22];
  p_id text;
  p_price numeric;
begin
  for i in 1..6 loop
    p_id := products[i];
    select price into p_price from public.spa_retail_products where id = p_id;
    for n in 1..counts[i] loop
      seq := seq + 1;
      select id, name into g
      from public.guests
      order by md5(p_id || '-' || n)
      limit 1;
      sale_id := 'SAL-' || p_id || '-' || lpad(n::text, 3, '0');
      insert into public.spa_retail_sales
        (id, product_id, guest_id, guest_name, quantity, unit_price, total,
         payment_method, sold_by, sale_date)
      values
        (sale_id, p_id, g.id, g.name, 1, p_price, p_price,
         case when n % 3 = 0 then 'Card' when n % 3 = 1 then 'Room Charge' else 'Cash' end,
         'Front Desk',
         date_trunc('month', current_date)::date + ((n * 37) % extract(day from current_date)::int))
      on conflict (id) do nothing;
    end loop;
  end loop;
end $$;
