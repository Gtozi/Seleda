-- Migration 710: Deduplicate scheduled_jobs and enforce one job per type
--
-- Root cause: migration 119 (and its copy inside 000_baseline.sql) seeds the
-- default jobs with `INSERT ... ON CONFLICT DO NOTHING`, but scheduled_jobs
-- has no unique constraint on name/type — only the id PK. Each INSERT gets a
-- fresh UUID, so the conflict clause never fires and re-running the seed
-- creates duplicate rows. The scheduler engine dispatches on `type`, so
-- duplicates execute the same handler twice (e.g. Night Audit posting room
-- charges twice, allotment release running twice).
--
-- Fix: keep the earliest row per type, drop the rest, then add a unique
-- index on type so future `ON CONFLICT DO NOTHING` seed inserts are
-- idempotent.

DELETE FROM scheduled_jobs
WHERE id NOT IN (
  SELECT DISTINCT ON (type) id
  FROM scheduled_jobs
  ORDER BY type, created_at ASC, id ASC
);

CREATE UNIQUE INDEX IF NOT EXISTS scheduled_jobs_type_key
  ON scheduled_jobs (type);
