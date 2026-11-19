-- =============================================================================
-- 490_spa_fitness_services.sql
-- Makes personal-trainer sessions bookable through the unified appointment
-- flow: adds a 'Fitness Studio' room and 'Fitness'-category treatments to
-- spa_treatments so the Appointment Management picker covers them, same as
-- the Beauty Services merge in migration 489.
-- =============================================================================

-- ── Bookable fitness space ───────────────────────────────────────────────────

INSERT INTO public.spa_rooms
  (id, name, room_type, capacity, status, category, equipment, features,
   last_maintenance, next_maintenance, last_cleaning, is_bookable)
VALUES
  ('SRM-009', 'Fitness Studio', 'Fitness Studio', 6, 'Available', 'Treatment Room',
   '{Cardio Equipment,Free Weights,Resistance Bands,Exercise Mats}',
   '{Mirrored Wall,Sound System,Climate Control}',
   '2026-07-15', '2026-10-15', '2026-09-13T07:45:00Z', true)
ON CONFLICT (id) DO NOTHING;

-- ── Fitness / personal-training services ─────────────────────────────────────

INSERT INTO public.spa_treatments
  (id, name, category, duration_minutes, price, description, room_type)
VALUES
  ('TRT-022', 'Personal Training Session', 'Fitness', 60, 80,
   'One-on-one session with a certified personal trainer — strength, cardio, or flexibility focus', 'Fitness Studio'),
  ('TRT-023', 'Fitness Assessment', 'Fitness', 45, 60,
   'Body composition, mobility screening and goal-setting consultation with a trainer', 'Fitness Studio')
ON CONFLICT (id) DO NOTHING;
