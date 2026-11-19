-- 654_guest_faqs.sql
-- Guest Portal — Help Center module.
-- Backs the /guest/help tab (HelpCenterModule.tsx).
-- Adds `guest_faqs` — property-scoped FAQ content (property_id NULL = global,
-- applies to every property). Seeded with generic hotel FAQs that staff can
-- edit/disable; the module renders only live rows.

-- ── Table ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.guest_faqs (
  id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  property_id UUID REFERENCES public.properties(id) ON DELETE CASCADE,
  category    TEXT NOT NULL DEFAULT 'General',
  question    TEXT NOT NULL,
  answer      TEXT NOT NULL,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  is_active   BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_guest_faqs_property
  ON public.guest_faqs(property_id) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_guest_faqs_active
  ON public.guest_faqs(is_active, sort_order);

-- ── updated_at trigger ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.update_guest_faqs_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_guest_faqs_updated ON public.guest_faqs;
CREATE TRIGGER trg_guest_faqs_updated
  BEFORE UPDATE ON public.guest_faqs
  FOR EACH ROW EXECUTE FUNCTION public.update_guest_faqs_timestamp();

-- ── RLS ──────────────────────────────────────────────────────────────────
ALTER TABLE public.guest_faqs ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'guest_faqs'
      AND policyname = 'guest_faqs_authenticated'
  ) THEN
    CREATE POLICY guest_faqs_authenticated
      ON public.guest_faqs
      FOR ALL
      TO authenticated
      USING (true)
      WITH CHECK (true);
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.guest_faqs TO authenticated;

-- ── Seed: global FAQs (property_id NULL = all properties) ───────────────
INSERT INTO public.guest_faqs (category, question, answer, sort_order) VALUES
  ('General',  'What are the check-in and check-out times?',
   'Standard check-in is from 3:00 PM and check-out is by 11:00 AM. Early check-in and late check-out can be requested subject to availability — ask at the front desk or via the Concierge tab.', 10),
  ('General',  'Is parking available?',
   'Complimentary parking is available for guests. Valet parking may be offered for an additional fee — please confirm with the front desk.', 20),
  ('Technology', 'How do I connect to the hotel Wi-Fi?',
   'Join the guest Wi-Fi network shown in your welcome packet. If you need the password, dial the front desk or send us a message via the Messages tab.', 30),
  ('Dining',   'Is breakfast included in my reservation?',
   'Breakfast inclusion depends on your rate plan — check your reservation details under the Reservations tab, or ask the front desk.', 40),
  ('Services', 'How do I request housekeeping?',
   'Use the Housekeeping tab in this portal to submit a request — it goes straight to the housekeeping team''s queue. You can also dial the front desk from your room phone.', 50),
  ('Services', 'How do I book spa treatments?',
   'Open the Spa & Wellness tab to browse the treatment menu, pick a therapist and time slot, and book instantly. Your appointment appears under "My Bookings".', 60),
  ('Payment',  'What payment methods are accepted?',
   'We accept major credit and debit cards, mobile money, bank transfer, and cash. You can save a card-on-file reference under the Wallet tab and view your folio under Billing.', 70),
  ('Policies', 'What is the cancellation policy?',
   'Standard reservations allow free cancellation up to 24 hours before check-in. Special or prepaid rates may differ — the policy for your booking is shown on your reservation.', 80)
ON CONFLICT DO NOTHING;
