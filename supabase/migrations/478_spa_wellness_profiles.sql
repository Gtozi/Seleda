-- ─── Guest wellness profiles ─────────────────────────────────────────────────
-- One wellness profile per guest (per property). Visit counts, spend, last
-- visit and treatment history are computed live from spa_appointments.

CREATE TABLE IF NOT EXISTS public.spa_wellness_profiles (
  id                        text PRIMARY KEY,
  guest_id                  text NOT NULL REFERENCES public.guests(id) ON DELETE CASCADE,
  guest_name                text NOT NULL,
  wellness_goals            text[] NOT NULL DEFAULT '{}',
  medical_notes             text,
  allergies                 text[] NOT NULL DEFAULT '{}',
  skin_type                 text CHECK (skin_type IN ('Normal','Dry','Oily','Combination','Sensitive')),
  treatment_preferences     text[] NOT NULL DEFAULT '{}',
  contraindications         text[] NOT NULL DEFAULT '{}',
  favorite_therapist_id     text REFERENCES public.spa_therapists(id) ON DELETE SET NULL,
  favorite_therapist        text,
  preferred_pressure        text CHECK (preferred_pressure IN ('Light','Medium','Firm','Extra Firm')),
  communication_preference  text CHECK (communication_preference IN ('Email','SMS','Phone','In-Person')),
  property_id               uuid REFERENCES public.properties(id),
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now()
);

-- One profile per guest per property (NULL property = shared/global).
CREATE UNIQUE INDEX IF NOT EXISTS spa_wellness_profiles_guest_property_key
  ON public.spa_wellness_profiles (guest_id, COALESCE(property_id, '00000000-0000-0000-0000-000000000000'::uuid));

ALTER TABLE public.spa_wellness_profiles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS spa_wellness_profiles_authenticated ON public.spa_wellness_profiles;
CREATE POLICY spa_wellness_profiles_authenticated ON public.spa_wellness_profiles
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.spa_wellness_profiles TO authenticated;

-- ── Seed ─────────────────────────────────────────────────────────────────────

INSERT INTO public.spa_wellness_profiles
  (id, guest_id, guest_name, wellness_goals, medical_notes, allergies, skin_type,
   treatment_preferences, contraindications, favorite_therapist_id, favorite_therapist,
   preferred_pressure, communication_preference)
VALUES
  ('WLP-001', 'GST-001', 'Sarah Johnson',
   '{Stress Relief,Muscle Tension Reduction,Better Sleep}',
   'History of lower back pain. Avoid deep pressure on lumbar region.',
   '{Lavender,Peanut Oil}', 'Sensitive',
   '{Swedish Massage,Aromatherapy,Hot Stone}',
   '{Deep Tissue on lower back,Heat therapy if inflammation present}',
   'THP-001', 'Emily Chen', 'Light', 'Email'),
  ('WLP-002', 'GST-002', 'Michael Williams',
   '{Pain Management,Sports Recovery,Flexibility Improvement}',
   'Former athlete with shoulder injuries. Focus on mobility work.',
   '{}', 'Normal',
   '{Deep Tissue,Sports Massage,Reflexology}',
   '{}',
   'THP-002', 'David Miller', 'Firm', 'SMS'),
  ('WLP-003', 'GST-003', 'Emma Davis',
   '{Skin Hydration,Anti-Aging,Glow}',
   'No significant medical history. Focus on skincare.',
   '{Fragrances,Sulfates}', 'Dry',
   '{Hydrating Facial,Anti-Aging Facial,Body Scrub}',
   '{Products with fragrances,Harsh exfoliants}',
   'THP-003', 'Lisa Park', 'Medium', 'Email')
ON CONFLICT (id) DO NOTHING;
