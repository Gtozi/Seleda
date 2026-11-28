-- Add erp_logo and erp_name columns to global_settings for SuperAdmin-configured ERP/POS/KDS branding
ALTER TABLE global_settings
  ADD COLUMN IF NOT EXISTS erp_logo TEXT,
  ADD COLUMN IF NOT EXISTS erp_name TEXT;
