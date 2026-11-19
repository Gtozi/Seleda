-- 321_hk_task_durations.sql
-- Adds estimated_duration and actual_duration columns to housekeeping_task_mgmt.
-- The productivity endpoint (groupCleaningTimeByTaskType) references these
-- columns but they didn't exist, so it always fell back to 30 min.
-- estimated_duration is set from the task type config (estMinutes).
-- actual_duration is computed from started_at/completed_at timestamps.

ALTER TABLE housekeeping_task_mgmt
  ADD COLUMN IF NOT EXISTS estimated_duration integer DEFAULT 30,
  ADD COLUMN IF NOT EXISTS actual_duration integer;

-- Backfill actual_duration from existing timestamps where possible.
UPDATE housekeeping_task_mgmt
SET actual_duration = EXTRACT(EPOCH FROM (completed_at - started_at)) / 60
WHERE completed_at IS NOT NULL
  AND started_at IS NOT NULL
  AND completed_at > started_at
  AND actual_duration IS NULL;

-- Backfill estimated_duration with sensible defaults per task type.
UPDATE housekeeping_task_mgmt SET estimated_duration = 30 WHERE type = 'Checkout Cleaning' AND estimated_duration = 30;
UPDATE housekeeping_task_mgmt SET estimated_duration = 20 WHERE type = 'Stayover Service' AND estimated_duration = 30;
UPDATE housekeeping_task_mgmt SET estimated_duration = 45 WHERE type = 'VIP Preparation' AND estimated_duration = 30;
UPDATE housekeeping_task_mgmt SET estimated_duration = 15 WHERE type = 'Turndown Service' AND estimated_duration = 30;
UPDATE housekeeping_task_mgmt SET estimated_duration = 25 WHERE type = 'Early Arrival Preparation' AND estimated_duration = 30;
UPDATE housekeeping_task_mgmt SET estimated_duration = 90 WHERE type = 'Deep Cleaning' AND estimated_duration = 30;
UPDATE housekeeping_task_mgmt SET estimated_duration = 60 WHERE type = 'Preventive Cleaning' AND estimated_duration = 30;
UPDATE housekeeping_task_mgmt SET estimated_duration = 30 WHERE type = 'Public Area Cleaning' AND estimated_duration = 30;
UPDATE housekeeping_task_mgmt SET estimated_duration = 25 WHERE type = 'Special Cleaning' AND estimated_duration = 30;
UPDATE housekeeping_task_mgmt SET estimated_duration = 15 WHERE type = 'Emergency Cleaning' AND estimated_duration = 30;
UPDATE housekeeping_task_mgmt SET estimated_duration = 60 WHERE type = 'Biohazard Cleaning' AND estimated_duration = 30;
UPDATE housekeeping_task_mgmt SET estimated_duration = 10 WHERE type = 'Room Refresh' AND estimated_duration = 30;
UPDATE housekeeping_task_mgmt SET estimated_duration = 20 WHERE type = 'Guest Complaint Follow-up' AND estimated_duration = 30;
