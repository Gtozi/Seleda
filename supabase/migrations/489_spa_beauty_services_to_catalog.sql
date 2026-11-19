-- =============================================================================
-- 489_spa_beauty_services_to_catalog.sql
-- Merges the standalone Beauty Salon module's service list into the unified
-- spa_treatments catalog under the existing 'Beauty Services' category.
-- TRT-012/013/014 already cover Manicure/Pedicure/Haircut — only the three
-- remaining salon services are inserted; the existing rows gain the salon
-- descriptions and are pinned to the 'Salon Station' room type.
-- =============================================================================

INSERT INTO public.spa_treatments
  (id, name, category, duration_minutes, price, description, room_type)
VALUES
  ('TRT-019', 'Hair Coloring',      'Beauty Services', 120, 150,
   'Hair Services — Full hair coloring service with premium products', 'Salon Station'),
  ('TRT-020', 'Bridal Makeup',      'Beauty Services',  90, 200,
   'Makeup — Full bridal makeup application with trial', 'Salon Station'),
  ('TRT-021', 'Beard Trim & Style', 'Beauty Services',  30,  40,
   'Barber Services — Professional beard trimming and styling', 'Salon Station')
ON CONFLICT (id) DO NOTHING;

UPDATE public.spa_treatments SET
  description = CASE id
    WHEN 'TRT-012' THEN 'Nail Services — Classic manicure with nail shaping and polish'
    WHEN 'TRT-013' THEN 'Nail Services — Relaxing pedicure with foot massage and polish'
    WHEN 'TRT-014' THEN 'Hair Services — Professional haircut and styling session'
  END,
  room_type  = COALESCE(room_type, 'Salon Station'),
  updated_at = now()
WHERE id IN ('TRT-012', 'TRT-013', 'TRT-014');
