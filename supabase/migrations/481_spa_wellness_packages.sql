-- ─── Spa wellness packages + purchases ───────────────────────────────────────
-- Bundled treatment packages. purchase_count is derived live from
-- spa_package_purchases; sessions_used tracks redemption.

CREATE TABLE IF NOT EXISTS public.spa_wellness_packages (
  id                  text PRIMARY KEY,
  name                text NOT NULL,
  package_type        text NOT NULL,
  description         text,
  price               numeric NOT NULL DEFAULT 0,
  original_price      numeric,
  duration_minutes    integer NOT NULL DEFAULT 60,
  sessions            integer NOT NULL DEFAULT 1,
  validity_days       integer NOT NULL DEFAULT 90,
  included_treatments text[] NOT NULL DEFAULT '{}',
  amenities           text[] NOT NULL DEFAULT '{}',
  is_active           boolean NOT NULL DEFAULT true,
  property_id         uuid REFERENCES public.properties(id),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.spa_package_purchases (
  id              text PRIMARY KEY,
  package_id      text NOT NULL REFERENCES public.spa_wellness_packages(id) ON DELETE CASCADE,
  guest_id        text NOT NULL REFERENCES public.guests(id) ON DELETE CASCADE,
  guest_name      text NOT NULL,
  purchase_date   date NOT NULL DEFAULT CURRENT_DATE,
  amount_paid     numeric NOT NULL DEFAULT 0,
  sessions_used   integer NOT NULL DEFAULT 0,
  status          text NOT NULL DEFAULT 'Active'
                  CHECK (status IN ('Active','Redeemed','Expired','Refunded')),
  notes           text,
  property_id     uuid REFERENCES public.properties(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.spa_wellness_packages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS spa_wellness_packages_authenticated ON public.spa_wellness_packages;
CREATE POLICY spa_wellness_packages_authenticated ON public.spa_wellness_packages
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.spa_wellness_packages TO authenticated;

ALTER TABLE public.spa_package_purchases ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS spa_package_purchases_authenticated ON public.spa_package_purchases;
CREATE POLICY spa_package_purchases_authenticated ON public.spa_package_purchases
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.spa_package_purchases TO authenticated;

-- ── Seed: packages ───────────────────────────────────────────────────────────

INSERT INTO public.spa_wellness_packages
  (id, name, package_type, description, price, original_price, duration_minutes,
   sessions, validity_days, included_treatments, amenities, is_active)
VALUES
  ('PKG-001', 'Couples Retreat Package', 'Couples Retreat',
   'Romantic spa experience for two including couples massage, champagne, and private relaxation time',
   450, 550, 180, 2, 90,
   '{Couples Massage (90 min),Champagne Service,Chocolate Strawberries,Private Use of Thermal Facilities}',
   '{Private Couples Room,Robes & Slippers,Aromatherapy,Music Selection}', true),
  ('PKG-002', 'Weekend Spa Escape', 'Weekend Spa Package',
   'Full weekend of wellness with unlimited spa access, daily treatments, and healthy meals',
   899, 1200, 2880, 6, 30,
   '{3 Massages,2 Facials,1 Body Treatment,Unlimited Thermal Facilities,Healthy Meals}',
   '{Spa Access,Locker Room,Healthy Meals,Yoga Classes,Fitness Center Access}', true),
  ('PKG-003', 'Honeymoon Bliss Package', 'Honeymoon Package',
   'Luxurious honeymoon experience with romantic treatments and special amenities',
   1299, 1600, 480, 4, 180,
   '{Couples Massage,His & Hers Facials,Romantic Bath,Candlelight Dinner}',
   '{Private Suite,Rose Petals,Champagne,Photography Session,Late Checkout}', true),
  ('PKG-004', 'Bridal Glow Package', 'Bridal Package',
   'Complete bridal beauty preparation for the perfect wedding day look',
   599, 750, 240, 3, 60,
   '{Bridal Makeup Trial,Bridal Makeup Application,Hair Styling,Manicure & Pedicure}',
   '{Private Styling Area,Complimentary Touch-up Kit,Champagne,Light Refreshments}', true),
  ('PKG-005', 'Executive Wellness Program', 'Executive Wellness',
   'Stress relief and rejuvenation package designed for busy executives',
   750, 950, 300, 5, 90,
   '{Deep Tissue Massage,Stress Relief Facial,Reflexology,Meditation Session,Nutrition Consultation}',
   '{Executive Lounge Access,Priority Booking,Healthy Lunch,Workspace Available}', true),
  ('PKG-006', 'Family Wellness Day', 'Family Wellness',
   'Fun wellness activities for the whole family',
   399, 500, 240, 4, 30,
   '{Family Massage (2 adults),Kids Mini Facial,Family Yoga Class,Healthy Snacks}',
   '{Family Changing Room,Kids Activity Area,Family Lockers,Photo Session}', false)
ON CONFLICT (id) DO NOTHING;

-- ── Seed: purchases (counts match former mock purchasedBy) ───────────────────

WITH gl AS (
  SELECT array_agg(id ORDER BY id) AS ids, array_agg(name ORDER BY id) AS names
  FROM public.guests WHERE id LIKE 'GST-%'
)
INSERT INTO public.spa_package_purchases (id, package_id, guest_id, guest_name, purchase_date, amount_paid, sessions_used, status)
SELECT 'PUR-1-' || LPAD(n::text, 3, '0'), 'PKG-001',
       gl.ids[1 + (n - 1) % array_length(gl.ids, 1)],
       gl.names[1 + (n - 1) % array_length(gl.names, 1)],
       '2026-09-05', 450, 0, 'Active'
FROM generate_series(1, 24) n, gl;

WITH gl AS (
  SELECT array_agg(id ORDER BY id) AS ids, array_agg(name ORDER BY id) AS names
  FROM public.guests WHERE id LIKE 'GST-%'
)
INSERT INTO public.spa_package_purchases (id, package_id, guest_id, guest_name, purchase_date, amount_paid, sessions_used, status)
SELECT 'PUR-2-' || LPAD(n::text, 3, '0'), 'PKG-002',
       gl.ids[1 + (n - 1) % array_length(gl.ids, 1)],
       gl.names[1 + (n - 1) % array_length(gl.names, 1)],
       '2026-09-07', 899, 1, 'Active'
FROM generate_series(1, 18) n, gl;

WITH gl AS (
  SELECT array_agg(id ORDER BY id) AS ids, array_agg(name ORDER BY id) AS names
  FROM public.guests WHERE id LIKE 'GST-%'
)
INSERT INTO public.spa_package_purchases (id, package_id, guest_id, guest_name, purchase_date, amount_paid, sessions_used, status)
SELECT 'PUR-3-' || LPAD(n::text, 3, '0'), 'PKG-003',
       gl.ids[1 + (n - 1) % array_length(gl.ids, 1)],
       gl.names[1 + (n - 1) % array_length(gl.names, 1)],
       '2026-09-02', 1299, 0, 'Active'
FROM generate_series(1, 12) n, gl;

WITH gl AS (
  SELECT array_agg(id ORDER BY id) AS ids, array_agg(name ORDER BY id) AS names
  FROM public.guests WHERE id LIKE 'GST-%'
)
INSERT INTO public.spa_package_purchases (id, package_id, guest_id, guest_name, purchase_date, amount_paid, sessions_used, status)
SELECT 'PUR-4-' || LPAD(n::text, 3, '0'), 'PKG-004',
       gl.ids[1 + (n - 1) % array_length(gl.ids, 1)],
       gl.names[1 + (n - 1) % array_length(gl.names, 1)],
       '2026-09-08', 599, 1, 'Active'
FROM generate_series(1, 15) n, gl;

WITH gl AS (
  SELECT array_agg(id ORDER BY id) AS ids, array_agg(name ORDER BY id) AS names
  FROM public.guests WHERE id LIKE 'GST-%'
)
INSERT INTO public.spa_package_purchases (id, package_id, guest_id, guest_name, purchase_date, amount_paid, sessions_used, status)
SELECT 'PUR-5-' || LPAD(n::text, 3, '0'), 'PKG-005',
       gl.ids[1 + (n - 1) % array_length(gl.ids, 1)],
       gl.names[1 + (n - 1) % array_length(gl.names, 1)],
       '2026-09-09', 750, 2, 'Active'
FROM generate_series(1, 8) n, gl;

WITH gl AS (
  SELECT array_agg(id ORDER BY id) AS ids, array_agg(name ORDER BY id) AS names
  FROM public.guests WHERE id LIKE 'GST-%'
)
INSERT INTO public.spa_package_purchases (id, package_id, guest_id, guest_name, purchase_date, amount_paid, sessions_used, status)
SELECT 'PUR-6-' || LPAD(n::text, 3, '0'), 'PKG-006',
       gl.ids[1 + (n - 1) % array_length(gl.ids, 1)],
       gl.names[1 + (n - 1) % array_length(gl.names, 1)],
       '2026-08-20', 399, 4, 'Redeemed'
FROM generate_series(1, 6) n, gl;
