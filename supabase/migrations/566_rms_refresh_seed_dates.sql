-- Migration: refresh stale 2024/2025 RMS demo/seed dates to the current date
-- Only touches rows with property_id IS NULL (seed data) and shifts each
-- date column so the earliest seed value for that column becomes CURRENT_DATE.
-- This keeps the relative spacing between dates intact (e.g. a 30-day
-- promotion stays 30 days long).

-- Demand forecasts
WITH off AS (
  SELECT GREATEST(0, COALESCE(CURRENT_DATE - MIN(forecast_date), 0))::INT AS days
  FROM rms_demand_forecasts
  WHERE property_id IS NULL
)
UPDATE rms_demand_forecasts
SET forecast_date = forecast_date + off.days
FROM off
WHERE property_id IS NULL;

WITH off AS (
  SELECT GREATEST(0, COALESCE(CURRENT_DATE - MIN(snapshot_date), 0))::INT AS days
  FROM rms_forecast_accuracy
  WHERE property_id IS NULL
)
UPDATE rms_forecast_accuracy
SET snapshot_date = snapshot_date + off.days
FROM off
WHERE property_id IS NULL;

-- Rate management seasonal rates
WITH off AS (
  SELECT GREATEST(0, COALESCE(CURRENT_DATE - MIN(start_date), 0))::INT AS days
  FROM rms_seasonal_rates
  WHERE property_id IS NULL
)
UPDATE rms_seasonal_rates
SET start_date = start_date + off.days,
    end_date   = end_date   + off.days
FROM off
WHERE property_id IS NULL;

-- Inventory controls
WITH off AS (
  SELECT GREATEST(0, COALESCE(CURRENT_DATE - MIN(expiry), 0))::INT AS days
  FROM rms_inventory_allotments
  WHERE property_id IS NULL
)
UPDATE rms_inventory_allotments
SET expiry = expiry + off.days
FROM off
WHERE property_id IS NULL;

WITH off AS (
  SELECT GREATEST(0, COALESCE(CURRENT_DATE - MIN(start_date), 0))::INT AS days
  FROM rms_inventory_stop_sell
  WHERE property_id IS NULL
)
UPDATE rms_inventory_stop_sell
SET start_date = start_date + off.days,
    end_date   = end_date   + off.days
FROM off
WHERE property_id IS NULL;

-- Group evaluation
WITH off AS (
  SELECT GREATEST(0, COALESCE(CURRENT_DATE - MIN(check_in), 0))::INT AS days
  FROM rms_group_inquiries
  WHERE property_id IS NULL
)
UPDATE rms_group_inquiries
SET check_in  = check_in  + off.days,
    check_out = check_out + off.days
FROM off
WHERE property_id IS NULL;

-- Overbooking
WITH off AS (
  SELECT GREATEST(0, COALESCE(CURRENT_DATE - MIN(date), 0))::INT AS days
  FROM rms_noshow_predictions
  WHERE property_id IS NULL
)
UPDATE rms_noshow_predictions
SET date = date + off.days
FROM off
WHERE property_id IS NULL;

WITH off AS (
  SELECT GREATEST(0, COALESCE(CURRENT_DATE - MIN(date), 0))::INT AS days
  FROM rms_risk_assessment
  WHERE property_id IS NULL
)
UPDATE rms_risk_assessment
SET date = date + off.days
FROM off
WHERE property_id IS NULL;

-- Promotions
WITH off AS (
  SELECT GREATEST(0, COALESCE(CURRENT_DATE - MIN(start_date), 0))::INT AS days
  FROM rms_promotions
  WHERE property_id IS NULL
)
UPDATE rms_promotions
SET start_date = start_date + off.days,
    end_date   = end_date   + off.days
FROM off
WHERE property_id IS NULL;

-- Re-sync promotion statuses with the refreshed dates
UPDATE rms_promotions
SET status = CASE
  WHEN start_date > CURRENT_DATE THEN 'scheduled'
  WHEN end_date   < CURRENT_DATE THEN 'ended'
  ELSE 'active'
END
WHERE property_id IS NULL;

-- Scenario planning
WITH off AS (
  SELECT GREATEST(0, COALESCE(CURRENT_DATE - MIN(created_at::DATE), 0))::INT AS days
  FROM rms_scenarios
  WHERE property_id IS NULL
)
UPDATE rms_scenarios
SET created_at = created_at + (off.days || ' days')::INTERVAL
FROM off
WHERE property_id IS NULL;

-- Reports registry
WITH off AS (
  SELECT GREATEST(0, COALESCE(CURRENT_DATE - MIN(last_run::DATE), 0))::INT AS days
  FROM public.rms_reports
  WHERE property_id IS NULL AND last_run IS NOT NULL
)
UPDATE public.rms_reports
SET last_run = last_run + (off.days || ' days')::INTERVAL
FROM off
WHERE property_id IS NULL AND last_run IS NOT NULL;
