-- Migration 129: Sales Reports — add format, frequency, and normalized status

-- Add format and frequency columns to the sales_reports table.
ALTER TABLE public.sales_reports
  ADD COLUMN IF NOT EXISTS format text DEFAULT 'PDF',
  ADD COLUMN IF NOT EXISTS frequency text DEFAULT 'Daily';

-- Normalize existing status values: any 'Active' row becomes 'Ready'.
UPDATE public.sales_reports
  SET status = 'Ready'
  WHERE status = 'Active';

-- Set sensible default format/frequency for all existing rows.
UPDATE public.sales_reports
  SET format = 'PDF',
      frequency = 'Daily'
  WHERE format IS NULL OR frequency IS NULL;
