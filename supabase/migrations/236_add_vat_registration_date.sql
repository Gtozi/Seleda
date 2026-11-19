-- Migration 236: Add vat_registration_date to group_profiles
ALTER TABLE public.group_profiles ADD COLUMN IF NOT EXISTS vat_registration_date date;
