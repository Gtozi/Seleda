-- Add erp_logo, erp_name, and erp_favicon columns to global_settings for SuperAdmin-configured ERP/POS/KDS branding
ALTER TABLE global_settings
  ADD COLUMN IF NOT EXISTS erp_logo TEXT,
  ADD COLUMN IF NOT EXISTS erp_name TEXT,
  ADD COLUMN IF NOT EXISTS erp_favicon TEXT;
