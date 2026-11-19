-- Migration: make rms_pricing_recommendations.applied_by a real FK to auth.users

-- Remove any non-UUID text (e.g. 'John Doe', 'Jane Smith') before casting.
UPDATE rms_pricing_recommendations
SET applied_by = NULL
WHERE applied_by IS NOT NULL
  AND applied_by !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';

ALTER TABLE rms_pricing_recommendations
  ALTER COLUMN applied_by TYPE UUID USING applied_by::UUID,
  ADD CONSTRAINT fk_rms_pricing_recommendations_applied_by
    FOREIGN KEY (applied_by) REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_rms_pricing_rec_applied_by
  ON rms_pricing_recommendations(applied_by);
