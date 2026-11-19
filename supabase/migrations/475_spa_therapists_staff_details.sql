-- 475_spa_therapists_staff_details.sql
--
-- Upgrades spa_therapists into a full staff-management profile: certifications,
-- languages, employment type, hire date and rating. Operational metrics
-- (appointments served, revenue, completion rate) are computed live from
-- spa_appointments by the API rather than stored here.
-- Also syncs the seeded roster with the data the UI previously mocked.

ALTER TABLE public.spa_therapists
  ADD COLUMN IF NOT EXISTS certifications   text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS languages        text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS employment_type  text NOT NULL DEFAULT 'Full-time',
  ADD COLUMN IF NOT EXISTS hire_date        date,
  ADD COLUMN IF NOT EXISTS rating           numeric(3,1) NOT NULL DEFAULT 4.5;

UPDATE public.spa_therapists SET
  name = 'Emily Chen',
  title = 'Senior Massage Therapist',
  specialties = ARRAY['Swedish Massage', 'Deep Tissue', 'Hot Stone', 'Aromatherapy'],
  certifications = ARRAY['Licensed Massage Therapist (LMT)', 'Hot Stone Therapy Certified'],
  languages = ARRAY['English', 'Mandarin'],
  status = 'Active',
  employment_type = 'Full-time',
  rating = 4.9,
  email = 'emily.chen@spahotel.com',
  phone = '+1-555-0101',
  hire_date = '2022-03-15'
WHERE id = 'THP-001';

UPDATE public.spa_therapists SET
  name = 'David Miller',
  title = 'Massage Therapist',
  specialties = ARRAY['Swedish Massage', 'Sports Massage', 'Reflexology'],
  certifications = ARRAY['Licensed Massage Therapist (LMT)', 'Sports Massage Certified'],
  languages = ARRAY['English', 'Spanish'],
  status = 'Active',
  employment_type = 'Full-time',
  rating = 4.7,
  email = 'david.miller@spahotel.com',
  phone = '+1-555-0102',
  hire_date = '2023-01-10'
WHERE id = 'THP-002';

UPDATE public.spa_therapists SET
  name = 'Lisa Park',
  title = 'Esthetician',
  specialties = ARRAY['Facials', 'Body Treatments', 'Skincare Consultation'],
  certifications = ARRAY['Licensed Esthetician', 'Advanced Skincare Certified'],
  languages = ARRAY['English', 'Korean'],
  status = 'Active',
  employment_type = 'Full-time',
  rating = 4.8,
  email = 'lisa.park@spahotel.com',
  phone = '+1-555-0103',
  hire_date = '2022-08-20'
WHERE id = 'THP-003';

UPDATE public.spa_therapists SET
  name = 'Sarah Johnson',
  title = 'Beauty Therapist',
  specialties = ARRAY['Hair Styling', 'Makeup', 'Manicure', 'Pedicure'],
  certifications = ARRAY['Cosmetology License', 'Makeup Artist Certified'],
  languages = ARRAY['English'],
  status = 'On Leave',
  employment_type = 'Part-time',
  rating = 4.6,
  email = 'sarah.johnson@spahotel.com',
  phone = '+1-555-0104',
  hire_date = '2023-06-01'
WHERE id = 'THP-004';

UPDATE public.spa_therapists SET
  name = 'Michael Brown',
  title = 'Personal Trainer',
  specialties = ARRAY['Fitness Training', 'Yoga', 'Nutrition Coaching'],
  certifications = ARRAY['NASM Certified Personal Trainer', 'Yoga Instructor (RYT-200)'],
  languages = ARRAY['English', 'French'],
  status = 'Active',
  employment_type = 'Full-time',
  rating = 4.9,
  email = 'michael.brown@spahotel.com',
  phone = '+1-555-0105',
  hire_date = '2022-11-15'
WHERE id = 'THP-005';
