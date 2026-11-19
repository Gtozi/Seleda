-- Disciplinary ↔ Performance Linkage
-- ──────────────────────────────────────────────────────────────────────────
-- Closes the gap between hr_disciplinary_actions and hr_performance_reviews.
-- Previously these were siloed: disciplinary actions stored only a text
-- `employee` name (no ID), and performance reviews had no visibility into
-- an employee's conduct history.
--
-- Changes:
--   1. hr_disciplinary_actions gets `employee_id` + `score_impact` columns
--      so actions can be linked to reviews and carry a quantified impact.
--   2. hr_performance_reviews gets `conduct_score` + `disciplinary_summary`
--      so a reviewer can record an adjusted conduct rating and a summary of
--      active disciplinary actions at review time.
--   3. Backfill `employee_id` from the `employee` text column where possible
--      by matching against employees.name.

-- ============================================================================
-- hr_disciplinary_actions: add employee_id + score_impact
-- ============================================================================
ALTER TABLE hr_disciplinary_actions ADD COLUMN IF NOT EXISTS employee_id TEXT;
ALTER TABLE hr_disciplinary_actions ADD COLUMN IF NOT EXISTS score_impact NUMERIC NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_hr_disciplinary_actions_employee_id
  ON hr_disciplinary_actions(property_id, employee_id)
  WHERE employee_id IS NOT NULL;

-- Backfill employee_id from employees.name where the text matches
UPDATE hr_disciplinary_actions da
  SET employee_id = e.id
  FROM employees e
  WHERE da.employee_id IS NULL
    AND da.property_id = e.property_id
    AND da.employee = e.name;

-- ============================================================================
-- hr_performance_reviews: add conduct_score + disciplinary_summary
-- ============================================================================
ALTER TABLE hr_performance_reviews ADD COLUMN IF NOT EXISTS conduct_score NUMERIC(3,1);
ALTER TABLE hr_performance_reviews ADD COLUMN IF NOT EXISTS disciplinary_summary TEXT;
ALTER TABLE hr_performance_reviews ADD COLUMN IF NOT EXISTS linked_disciplinary_ids UUID[] DEFAULT '{}';

-- ============================================================================
-- RLS already enabled on both tables (migration 424 / 429). No new tables,
-- so no additional grants or policies needed — the existing admin-write
-- policies cover the new columns.
-- ============================================================================
