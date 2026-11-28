-- Add erp_logo column to global_settings for SuperAdmin-configured ERP branding logo
ALTER TABLE global_settings
  ADD COLUMN IF NOT EXISTS erp_logo TEXT;
