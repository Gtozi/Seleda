-- 474_spa_treatments_catalog_details.sql
--
-- Adds the catalog-detail fields the Treatment Catalog module renders
-- (description, popular flag, therapist qualifications, room type) and
-- backfills them for the 18 treatments seeded in migration 473.

ALTER TABLE public.spa_treatments
  ADD COLUMN IF NOT EXISTS description               text,
  ADD COLUMN IF NOT EXISTS is_popular                boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS therapist_qualifications  text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS room_type                 text;

UPDATE public.spa_treatments SET
  description = 'Classic full-body massage using long, flowing strokes to promote relaxation',
  is_popular = true,
  therapist_qualifications = ARRAY['Massage Therapy Certification'],
  room_type = 'Massage Room'
WHERE id = 'TRT-001';

UPDATE public.spa_treatments SET
  description = 'Intensive massage targeting deeper muscle layers and chronic tension',
  is_popular = true,
  therapist_qualifications = ARRAY['Advanced Massage Certification', '2 years experience'],
  room_type = 'Massage Room'
WHERE id = 'TRT-002';

UPDATE public.spa_treatments SET
  description = 'Therapeutic massage using heated stones to relax muscles deeply',
  therapist_qualifications = ARRAY['Hot Stone Therapy Certification'],
  room_type = 'Massage Room'
WHERE id = 'TRT-003';

UPDATE public.spa_treatments SET
  description = 'Relaxing massage enhanced with custom-blended essential oils',
  is_popular = true,
  therapist_qualifications = ARRAY['Massage Therapy Certification', 'Aromatherapy Certification'],
  room_type = 'Massage Room'
WHERE id = 'TRT-004';

UPDATE public.spa_treatments SET
  description = 'Traditional Thai stretching and acupressure techniques on a floor mat',
  therapist_qualifications = ARRAY['Thai Massage Certification'],
  room_type = 'Massage Room'
WHERE id = 'TRT-005';

UPDATE public.spa_treatments SET
  description = 'Intensive moisture treatment for dry, dehydrated skin',
  is_popular = true,
  therapist_qualifications = ARRAY['Esthetician License'],
  room_type = 'Facial Room'
WHERE id = 'TRT-006';

UPDATE public.spa_treatments SET
  description = 'Advanced treatment targeting fine lines and wrinkles',
  therapist_qualifications = ARRAY['Advanced Esthetician License', 'Product Training'],
  room_type = 'Facial Room'
WHERE id = 'TRT-007';

UPDATE public.spa_treatments SET
  description = 'Vitamin C infused facial to even skin tone and boost radiance',
  therapist_qualifications = ARRAY['Esthetician License'],
  room_type = 'Facial Room'
WHERE id = 'TRT-008';

UPDATE public.spa_treatments SET
  description = 'Exfoliating full-body treatment using natural sea salts',
  therapist_qualifications = ARRAY['Body Treatment Certification'],
  room_type = 'Massage Room'
WHERE id = 'TRT-009';

UPDATE public.spa_treatments SET
  description = 'Nourishing mineral wrap to hydrate and firm the skin',
  therapist_qualifications = ARRAY['Body Treatment Certification'],
  room_type = 'Hydrotherapy Room'
WHERE id = 'TRT-010';

UPDATE public.spa_treatments SET
  description = 'Full-body detox combining lymphatic drainage and thermal therapy',
  therapist_qualifications = ARRAY['Body Treatment Certification', 'Hydrotherapy Training'],
  room_type = 'Hydrotherapy Room'
WHERE id = 'TRT-011';

UPDATE public.spa_treatments SET
  description = 'Classic manicure with shaping, cuticle care and polish',
  is_popular = true,
  therapist_qualifications = ARRAY['Nail Technician Certification'],
  room_type = 'Salon Station'
WHERE id = 'TRT-012';

UPDATE public.spa_treatments SET
  description = 'Relaxing pedicure with soak, exfoliation and polish',
  therapist_qualifications = ARRAY['Nail Technician Certification'],
  room_type = 'Salon Station'
WHERE id = 'TRT-013';

UPDATE public.spa_treatments SET
  description = 'Professional haircut and styling session',
  is_popular = true,
  therapist_qualifications = ARRAY['Cosmetology License'],
  room_type = 'Salon Station'
WHERE id = 'TRT-014';

UPDATE public.spa_treatments SET
  description = 'Guided yoga practice for all skill levels',
  therapist_qualifications = ARRAY['Yoga Instructor Certification (RYT-200)'],
  room_type = 'Yoga Studio'
WHERE id = 'TRT-015';

UPDATE public.spa_treatments SET
  description = 'Guided mindfulness and breathing meditation session',
  therapist_qualifications = ARRAY['Meditation Facilitator Certification'],
  room_type = 'Yoga Studio'
WHERE id = 'TRT-016';

UPDATE public.spa_treatments SET
  description = 'One-on-one consultation with a certified nutritionist',
  therapist_qualifications = ARRAY['Certified Nutritionist'],
  room_type = 'Massage Room'
WHERE id = 'TRT-017';

UPDATE public.spa_treatments SET
  description = 'Two-hour shared retreat: side-by-side massages, bath ritual and refreshments',
  is_popular = true,
  therapist_qualifications = ARRAY['Massage Therapy Certification'],
  room_type = 'Couples Room'
WHERE id = 'TRT-018';
