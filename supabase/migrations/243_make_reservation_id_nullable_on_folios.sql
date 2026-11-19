-- Make reservation_id nullable on folios so Company/Master folios
-- (which are per-company, not per-reservation) can be created.
ALTER TABLE folios ALTER COLUMN reservation_id DROP NOT NULL;
