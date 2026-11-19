-- 630_backfill_property_id.sql
-- Backfill property_id on legacy operational tables.
--
-- These tables were seeded before multi-property scoping existed, so their
-- rows carry property_id = NULL. Every property-scoped query
-- (ops command center, daily briefing, morning meeting, HK dashboard,
-- FO staffing views, etc.) silently excludes them — e.g. all 31
-- reservations, 62 guest_requests, 11 work_orders and 25 guests vanish
-- when a property is selected. The DB currently has no rows tagged to any
-- other property (the "Gheralta Airport Branch" is empty), so all NULL
-- rows belong to the main demo hotel
-- 18762279-a389-41c9-9169-7ebc682e9703 ("Gheralta Main Property").

UPDATE public.reservations
  SET property_id = '18762279-a389-41c9-9169-7ebc682e9703'
  WHERE property_id IS NULL;

UPDATE public.guest_requests
  SET property_id = '18762279-a389-41c9-9169-7ebc682e9703'
  WHERE property_id IS NULL;

UPDATE public.work_orders
  SET property_id = '18762279-a389-41c9-9169-7ebc682e9703'
  WHERE property_id IS NULL;

UPDATE public.guests
  SET property_id = '18762279-a389-41c9-9169-7ebc682e9703'
  WHERE property_id IS NULL;

UPDATE public.orders
  SET property_id = '18762279-a389-41c9-9169-7ebc682e9703'
  WHERE property_id IS NULL;

UPDATE public.banquet_events
  SET property_id = '18762279-a389-41c9-9169-7ebc682e9703'
  WHERE property_id IS NULL;

UPDATE public.inventory_items
  SET property_id = '18762279-a389-41c9-9169-7ebc682e9703'
  WHERE property_id IS NULL;

UPDATE public.guest_feedback
  SET property_id = '18762279-a389-41c9-9169-7ebc682e9703'
  WHERE property_id IS NULL;

UPDATE public.group_blocks
  SET property_id = '18762279-a389-41c9-9169-7ebc682e9703'
  WHERE property_id IS NULL;
