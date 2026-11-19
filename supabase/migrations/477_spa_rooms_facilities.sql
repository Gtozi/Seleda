-- ─── Spa rooms & facilities consolidation ────────────────────────────────────
-- Extends spa_rooms into a unified facilities table covering treatment rooms,
-- salon stations, studios, and thermal & hydro facilities (previously a
-- separate mock-only module). Adds occupancy, equipment, temperature,
-- maintenance and cleaning tracking, plus a bookable flag so non-bookable
-- facilities (sauna, lounges) stay out of the appointment room picker.

ALTER TABLE public.spa_rooms
  ADD COLUMN IF NOT EXISTS category           text NOT NULL DEFAULT 'Treatment Room',
  ADD COLUMN IF NOT EXISTS current_occupancy  integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS equipment          text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS features           text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS temperature        numeric,
  ADD COLUMN IF NOT EXISTS target_temperature numeric,
  ADD COLUMN IF NOT EXISTS last_maintenance   date,
  ADD COLUMN IF NOT EXISTS next_maintenance   date,
  ADD COLUMN IF NOT EXISTS last_cleaning      timestamptz,
  ADD COLUMN IF NOT EXISTS is_bookable        boolean NOT NULL DEFAULT true;

ALTER TABLE public.spa_rooms
  DROP CONSTRAINT IF EXISTS spa_rooms_category_check;
ALTER TABLE public.spa_rooms
  ADD CONSTRAINT spa_rooms_category_check
  CHECK (category IN ('Treatment Room', 'Thermal & Hydro'));

ALTER TABLE public.spa_rooms
  DROP CONSTRAINT IF EXISTS spa_rooms_status_check;
ALTER TABLE public.spa_rooms
  ADD CONSTRAINT spa_rooms_status_check
  CHECK (status IN ('Available', 'In Use', 'Cleaning', 'Maintenance', 'Out of Service'));

-- ── Backfill: existing treatment rooms ───────────────────────────────────────

UPDATE public.spa_rooms SET
  current_occupancy = 1,
  equipment = '{Massage Table,Hot Stone Heater,Aromatherapy Diffuser}',
  features = '{Sound System,Dimmable Lighting,Temperature Control}',
  last_maintenance = '2026-07-15', next_maintenance = '2026-09-15',
  last_cleaning = '2026-09-12T18:00:00Z', status = 'In Use'
WHERE id = 'SRM-001';

UPDATE public.spa_rooms SET
  equipment = '{Massage Table,Hot Stone Heater}',
  features = '{Sound System,Dimmable Lighting}',
  last_maintenance = '2026-07-10', next_maintenance = '2026-09-10',
  last_cleaning = '2026-09-13T07:00:00Z'
WHERE id = 'SRM-002';

UPDATE public.spa_rooms SET
  equipment = '{Facial Bed,Steamer,Magnifying Lamp,Product Warmer}',
  features = '{LED Lighting,Extraction System,Storage Cabinet}',
  last_maintenance = '2026-07-18', next_maintenance = '2026-09-18',
  last_cleaning = '2026-09-12T19:00:00Z'
WHERE id = 'SRM-003';

UPDATE public.spa_rooms SET
  capacity = 4,
  equipment = '{2 Massage Tables,Jacuzzi,Champagne Cooler}',
  features = '{Privacy Curtains,Sound System,Ambient Lighting,Mini Bar}',
  last_maintenance = '2026-07-20', next_maintenance = '2026-09-20',
  last_cleaning = '2026-09-13T06:30:00Z'
WHERE id = 'SRM-004';

UPDATE public.spa_rooms SET
  capacity = 2,
  equipment = '{Hydrotherapy Tub,Vichy Shower,Body Wrap Station}',
  features = '{Temperature Control,Water Jets,Aromatherapy System}',
  last_maintenance = '2026-09-01', next_maintenance = '2026-09-30',
  last_cleaning = '2026-09-13T08:00:00Z', status = 'Maintenance'
WHERE id = 'SRM-005';

UPDATE public.spa_rooms SET
  equipment = '{Styling Chair,Mirror Station,Hair Dryer}',
  features = '{Electrical Outlets,Tool Storage,Lighting}',
  last_maintenance = '2026-07-12', next_maintenance = '2026-09-12',
  last_cleaning = '2026-09-13T07:30:00Z'
WHERE id = 'SRM-006';

UPDATE public.spa_rooms SET
  capacity = 15,
  equipment = '{Yoga Mats,Blocks,Straps,Bolsters}',
  features = '{Hardwood Floor,Mirrors,Sound System,Climate Control}',
  last_maintenance = '2026-07-25', next_maintenance = '2026-09-25',
  last_cleaning = '2026-09-13T05:30:00Z'
WHERE id = 'SRM-007';

INSERT INTO public.spa_rooms
  (id, name, room_type, capacity, status, category, equipment, features,
   last_maintenance, next_maintenance, last_cleaning)
VALUES
  ('SRM-008', 'Consultation Room', 'Consultation Room', 4, 'Available', 'Treatment Room',
   '{Consultation Table,Computer Station,Printer}',
   '{Privacy Glass,Whiteboard,Display Screen}',
   '2026-07-08', '2026-10-08', '2026-09-13T07:45:00Z')
ON CONFLICT (id) DO NOTHING;

-- ── Seed: thermal & hydro facilities ─────────────────────────────────────────

INSERT INTO public.spa_rooms
  (id, name, room_type, capacity, current_occupancy, status, category,
   temperature, target_temperature, features, last_cleaning,
   next_maintenance, is_bookable)
VALUES
  ('SRM-101', 'Finnish Sauna', 'Sauna', 8, 5, 'In Use', 'Thermal & Hydro',
   85, 85, '{Wood Interior,Temperature Control,Aromatherapy,LED Lighting}',
   '2026-09-13T06:00:00Z', '2026-10-15', false),
  ('SRM-102', 'Steam Room', 'Steam Room', 10, 0, 'Available', 'Thermal & Hydro',
   45, 45, '{Eucalyptus Scent,Humidity Control,Ambient Lighting,Music System}',
   '2026-09-13T07:00:00Z', '2026-10-10', false),
  ('SRM-103', 'Outdoor Jacuzzi', 'Jacuzzi', 12, 8, 'In Use', 'Thermal & Hydro',
   38, 39, '{Jets,LED Lighting,Temperature Control,Privacy Screens}',
   '2026-09-13T05:00:00Z', '2026-10-05', false),
  ('SRM-104', 'Hydrotherapy Pool', 'Hydrotherapy Pool', 6, 0, 'Available', 'Thermal & Hydro',
   34, 34, '{Massage Jets,Counter-Current,Temperature Zones,Accessibility Lift}',
   '2026-09-13T08:00:00Z', '2026-10-20', true),
  ('SRM-105', 'Cold Plunge Pool', 'Cold Plunge', 4, 0, 'Available', 'Thermal & Hydro',
   10, 10, '{Temperature Control,Non-Slip Surface,Handrails}',
   '2026-09-13T08:00:00Z', '2026-10-12', false),
  ('SRM-106', 'Relaxation Lounge', 'Relaxation Lounge', 20, 3, 'In Use', 'Thermal & Hydro',
   22, 22, '{Comfortable Seating,Herbal Tea Station,Reading Materials,Ambient Music}',
   '2026-09-13T09:00:00Z', '2026-10-01', false)
ON CONFLICT (id) DO NOTHING;
