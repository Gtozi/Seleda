-- ─── Spa memberships ─────────────────────────────────────────────────────────
-- Guest membership records. visits_remaining NULL = unlimited plan.
-- total_visits is computed live from spa_appointments (since start_date).

CREATE TABLE IF NOT EXISTS public.spa_memberships (
  id                text PRIMARY KEY,
  guest_id          text NOT NULL REFERENCES public.guests(id) ON DELETE CASCADE,
  member_name       text NOT NULL,
  membership_type   text NOT NULL
                    CHECK (membership_type IN ('Monthly','Quarterly','Annual','Family','Corporate','VIP')),
  status            text NOT NULL DEFAULT 'Pending'
                    CHECK (status IN ('Active','Expired','Frozen','Pending','Cancelled')),
  start_date        date NOT NULL,
  end_date          date NOT NULL,
  price             numeric NOT NULL DEFAULT 0,
  benefits          text[] NOT NULL DEFAULT '{}',
  visits_remaining  integer,            -- NULL = unlimited
  auto_renew        boolean NOT NULL DEFAULT false,
  payment_method    text,
  property_id       uuid REFERENCES public.properties(id),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS spa_memberships_guest_idx ON public.spa_memberships (guest_id);
CREATE INDEX IF NOT EXISTS spa_memberships_status_idx ON public.spa_memberships (status);

ALTER TABLE public.spa_memberships ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS spa_memberships_authenticated ON public.spa_memberships;
CREATE POLICY spa_memberships_authenticated ON public.spa_memberships
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.spa_memberships TO authenticated;

-- ── Seed ─────────────────────────────────────────────────────────────────────

INSERT INTO public.spa_memberships
  (id, guest_id, member_name, membership_type, status, start_date, end_date,
   price, benefits, visits_remaining, auto_renew, payment_method)
VALUES
  ('MBR-001', 'GST-001', 'Sarah Johnson', 'Annual', 'Active',
   '2026-01-15', '2027-01-15', 1299,
   '{Unlimited Spa Access,20% Retail Discount,Priority Booking,Monthly Massage}',
   NULL, true, 'Credit Card'),
  ('MBR-002', 'GST-002', 'Michael Williams', 'Monthly', 'Active',
   '2026-08-20', '2026-09-20', 149,
   '{4 Spa Visits,10% Retail Discount,Standard Booking}',
   2, true, 'Credit Card'),
  ('MBR-003', 'GST-003', 'Emma Davis', 'VIP', 'Active',
   '2026-03-01', '2027-03-01', 2499,
   '{Unlimited Everything,30% Retail Discount,VIP Booking,Personal Concierge,Free Guest Passes}',
   NULL, true, 'Credit Card'),
  ('MBR-004', 'GST-004', 'James Brown', 'Family', 'Active',
   '2026-05-15', '2027-05-15', 1999,
   '{Family Spa Access (4 members),15% Retail Discount,Family Booking Priority}',
   NULL, false, 'Bank Transfer'),
  ('MBR-005', 'GST-005', 'Olivia Wilson', 'Quarterly', 'Expired',
   '2026-06-01', '2026-09-01', 399,
   '{12 Spa Visits,10% Retail Discount}',
   0, false, 'Credit Card')
ON CONFLICT (id) DO NOTHING;
