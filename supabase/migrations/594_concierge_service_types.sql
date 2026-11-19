-- 594_concierge_service_types.sql
-- Moves the hardcoded concierge service-type catalogs (bell desk, parcels,
-- VIP services, reminders) into `guest_services` so they can be managed
-- (add/edit/remove) like the experience, tour, ticketing, shopping, and
-- itinerary catalogs.

-- ── Allow the new service categories ─────────────────────────────────────────
ALTER TABLE guest_services DROP CONSTRAINT IF EXISTS guest_services_category_check;
ALTER TABLE guest_services ADD CONSTRAINT guest_services_category_check
  CHECK (category = ANY (ARRAY[
    'dining','transportation','laundry','spa','room_service','concierge',
    'tour','ticketing','shopping','itinerary',
    'luggage','parcel','vip','wakeup'
  ]));

-- ── Bell desk / luggage services (was SERVICE_TYPES in LuggageServicesModule) ─
INSERT INTO guest_services (id, name, description, category, price, available) VALUES
  ('svc_lug_delivery', 'Baggage Delivery',  'Deliver guest bags to or from the room',              'luggage', 0.00, TRUE),
  ('svc_lug_storage',  'Luggage Storage',   'Secure short-term storage at the bell desk',          'luggage', 0.00, TRUE),
  ('svc_lug_pickup',   'Luggage Pickup',    'Collect luggage from the room for departure',         'luggage', 0.00, TRUE),
  ('svc_lug_porter',   'Porter Assistance', 'Porter help with bags, errands, and heavy items',     'luggage', 0.00, TRUE)
ON CONFLICT (id) DO NOTHING;

-- ── Parcel services (was SERVICE_TYPES in ParcelManagementModule) ────────────
INSERT INTO guest_services (id, name, description, category, price, available) VALUES
  ('svc_parcel_received', 'Package Received', 'Incoming — hold & notify',  'parcel', 0.00, TRUE),
  ('svc_parcel_pickup',   'Package Pickup',   'Collect from room',         'parcel', 0.00, TRUE),
  ('svc_parcel_delivery', 'Package Delivery', 'Deliver to room',           'parcel', 0.00, TRUE),
  ('svc_parcel_courier',  'Outgoing Courier', 'Ship for guest',            'parcel', 0.00, TRUE)
ON CONFLICT (id) DO NOTHING;

-- ── VIP services (was SERVICE_TYPES in VIPServicesModule) ────────────────────
INSERT INTO guest_services (id, name, description, category, price, available) VALUES
  ('svc_vip_arrival',  'Arrival Preparation', 'Suite check & greet',              'vip', 0.00, TRUE),
  ('svc_vip_amenity',  'Welcome Amenity',     'Champagne, fruit, cards',          'vip', 0.00, TRUE),
  ('svc_vip_butler',   'Butler Request',      'Unpack, press, errands',           'vip', 0.00, TRUE),
  ('svc_vip_occasion', 'Special Occasion',    'Birthday, anniversary',            'vip', 0.00, TRUE)
ON CONFLICT (id) DO NOTHING;

-- ── Reminder services (was REMINDER_TYPES in WakeUpReminderModule) ───────────
INSERT INTO guest_services (id, name, description, category, price, available) VALUES
  ('svc_wake_call',      'Wake-up Call',        'Scheduled morning call to the room phone',           'wakeup', 0.00, TRUE),
  ('svc_wake_activity',  'Activity Reminder',   'Remind guest before a tour or booking',              'wakeup', 0.00, TRUE),
  ('svc_wake_departure', 'Departure Reminder',  'Checkout and luggage reminder before departure',     'wakeup', 0.00, TRUE),
  ('svc_wake_dinner',    'Dinner Reminder',     'Reminder ahead of a restaurant reservation',         'wakeup', 0.00, TRUE)
ON CONFLICT (id) DO NOTHING;
