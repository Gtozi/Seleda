-- 636: VIP guest profiles for the Operations VIP Management tab.
-- Guests/reservations/requests stay in their FO tables; this stores ops-level
-- VIP profile overrides: finer category than guests.status, assigned butler,
-- notification flag, and private ops notes. Keyed by guests.id (text).

CREATE TABLE IF NOT EXISTS public.ops_vip_profiles (
  id            text        PRIMARY KEY DEFAULT 'vip-' || gen_random_uuid()::text,
  property_id   uuid        REFERENCES public.properties(id) ON DELETE CASCADE,
  guest_id      text        NOT NULL UNIQUE,
  category      text        NOT NULL DEFAULT 'VIP' CHECK (category IN (
    'VIP','VVIP','Loyalty Elite','Corporate Executive','Government Official','Celebrity')),
  butler        text,
  notifications boolean     NOT NULL DEFAULT true,
  notes         text,
  created_by    text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ops_vip_profiles_prop ON public.ops_vip_profiles (property_id);

CREATE OR REPLACE FUNCTION public.set_ops_vip_profiles_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_ops_vip_profiles_updated_at ON public.ops_vip_profiles;
CREATE TRIGGER trg_ops_vip_profiles_updated_at
  BEFORE UPDATE ON public.ops_vip_profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_ops_vip_profiles_updated_at();

ALTER TABLE public.ops_vip_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ops_vip_profiles_auth ON public.ops_vip_profiles;
CREATE POLICY ops_vip_profiles_auth ON public.ops_vip_profiles
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.ops_vip_profiles TO authenticated;

-- Seed profiles for the real VIP guests (sets finer categories + butlers that
-- the mock component showed).
INSERT INTO public.ops_vip_profiles (property_id, guest_id, category, butler, notifications, created_by)
SELECT g.property_id, g.id, 'VIP', 'James Wilson', true, 'seed'
FROM public.guests g WHERE g.status = 'VIP' AND NOT EXISTS (SELECT 1 FROM public.ops_vip_profiles p WHERE p.guest_id = g.id);
INSERT INTO public.ops_vip_profiles (property_id, guest_id, category, butler, notifications, created_by)
SELECT g.property_id, g.id, 'Loyalty Elite', 'Emily Brown', true, 'seed'
FROM public.guests g WHERE g.status = 'Loyalty Member' AND NOT EXISTS (SELECT 1 FROM public.ops_vip_profiles p WHERE p.guest_id = g.id);
