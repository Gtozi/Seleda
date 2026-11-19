-- Migration 237: Add customer_vat_date to invoice_documents
ALTER TABLE public.invoice_documents ADD COLUMN IF NOT EXISTS customer_vat_date text;
