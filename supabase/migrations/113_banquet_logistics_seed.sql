-- Demo data for Banquet & Events logistics (resources, equipment, vendors, transportation)
-- Idempotent: inserts only if id does not already exist

INSERT INTO public.banquet_resources (id, property_id, event_id, resource_type, resource_name, quantity, allocated_to, start_date, end_date, notes) VALUES
  ('res-001', '18762279-a389-41c9-9169-7ebc682e9703', 'event-001', 'Furniture', 'Round banquet tables', 15, 'Room setup crew', '2026-09-15', '2026-09-16', 'With white linens'),
  ('res-002', '18762279-a389-41c9-9169-7ebc682e9703', 'event-001', 'Linens', 'Chair covers', 120, 'Room setup crew', '2026-09-15', '2026-09-16', 'Ivory'),
  ('res-003', '18762279-a389-41c9-9169-7ebc682e9703', 'event-002', 'Decorations', 'Floral centerpieces', 24, 'Decor team', '2026-09-18', '2026-09-19', 'Pink and white'),
  ('res-004', '18762279-a389-41c9-9169-7ebc682e9703', 'event-003', 'Equipment', 'Wireless microphones', 4, 'AV team', '2026-09-20', '2026-09-21', 'For panel and Q&A'),
  ('res-005', '18762279-a389-41c9-9169-7ebc682e9703', 'event-004', 'Staff', 'Banquet servers', 8, 'F&B supervisor', '2026-09-12', '2026-09-13', 'Dinner service'),
  ('res-006', '18762279-a389-41c9-9169-7ebc682e9703', 'event-005', 'Vehicles', 'Guest shuttle van', 2, 'Transportation coordinator', '2026-09-10', '2026-09-11', 'Airport pickup')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.banquet_equipment (id, property_id, event_id, equipment_name, equipment_type, quantity, specifications, assigned_to, status) VALUES
  ('eq-001', '18762279-a389-41c9-9169-7ebc682e9703', 'event-001', 'Stage lighting kit', 'Lighting', 2, 'RGB LED par cans', 'Events team', 'Available'),
  ('eq-002', '18762279-a389-41c9-9169-7ebc682e9703', 'event-001', 'Wireless PA system', 'Audio Visual', 1, '2 speakers + mixer', 'AV team', 'In Use'),
  ('eq-003', '18762279-a389-41c9-9169-7ebc682e9703', 'event-002', 'Portable stage', 'Staging', 1, '12x8ft modular', 'Setup crew', 'Available'),
  ('eq-004', '18762279-a389-41c9-9169-7ebc682e9703', 'event-003', 'Projector 4K', 'Audio Visual', 2, '5000 lumens', 'AV team', 'In Use'),
  ('eq-005', '18762279-a389-41c9-9169-7ebc682e9703', 'event-004', 'Chafing dishes', 'Kitchen', 12, 'Stainless steel full size', 'Kitchen', 'Available'),
  ('eq-006', '18762279-a389-41c9-9169-7ebc682e9703', 'event-005', 'Pipe and drape', 'Decor', 8, '8ft panels, navy blue', 'Decor team', 'In Use')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.banquet_vendors (id, property_id, event_id, vendor_name, vendor_type, contact_person, phone, email, services, contract_value, status) VALUES
  ('ven-001', '18762279-a389-41c9-9169-7ebc682e9703', 'event-001', 'Addis Florals', 'Florist', 'Meron Tadesse', '+2519110001', 'meron@addisflorals.et', 'Centerpieces and stage arrangements', 2500.00, 'Confirmed'),
  ('ven-002', '18762279-a389-41c9-9169-7ebc682e9703', 'event-001', 'Premium Sound', 'Entertainment', 'Dawit Bekele', '+2519110002', 'dawit@premiumset.et', 'DJ and sound setup', 1800.00, 'Confirmed'),
  ('ven-003', '18762279-a389-41c9-9169-7ebc682e9703', 'event-002', 'Sunshine Catering', 'Catering', 'Hirut Alemu', '+2519110003', 'hirut@sunshine.et', 'Cocktail catering', 4500.00, 'Pending'),
  ('ven-004', '18762279-a389-41c9-9169-7ebc682e9703', 'event-003', 'Lens Studio', 'Photography', 'Solomon Lemma', '+2519110004', 'solomon@lensstudio.et', 'Event photography', 1200.00, 'Confirmed'),
  ('ven-005', '18762279-a389-41c9-9169-7ebc682e9703', 'event-004', 'Ethio Decor', 'Decor', 'Bethlehem Girma', '+2519110005', 'beth@ethiodecor.et', 'Theme decor', 3200.00, 'Confirmed'),
  ('ven-006', '18762279-a389-41c9-9169-7ebc682e9703', 'event-005', 'Elite Transport', 'Transportation', 'Yonas Tadesse', '+2519110006', 'yonas@elitetransport.et', 'Guest shuttles', 900.00, 'Pending')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.banquet_transportation (id, property_id, event_id, guest_name, pickup_location, dropoff_location, pickup_time, vehicle_type, passenger_count, special_requests, driver_name, contact_number) VALUES
  ('tr-001', '18762279-a389-41c9-9169-7ebc682e9703', 'event-001', 'Abebe Kebede', 'Bole International Airport', 'Hotel Crystal Ballroom', '2026-09-15T14:00:00+00:00', 'Sedan', 2, 'Wheelchair accessible', 'Tesfaye Alemu', '+2519111001'),
  ('tr-002', '18762279-a389-41c9-9169-7ebc682e9703', 'event-001', 'Sara Hailu', 'Bole International Airport', 'Hotel Crystal Ballroom', '2026-09-15T15:30:00+00:00', 'Luxury', 1, 'VIP meet and greet', 'Dawit Bekele', '+2519111002'),
  ('tr-003', '18762279-a389-41c9-9169-7ebc682e9703', 'event-002', 'Wedding Party', 'Unity University', 'Palm Garden', '2026-09-18T16:00:00+00:00', 'Van', 10, 'Decorated with ribbons', 'Hanna Bekele', '+2519111003'),
  ('tr-004', '18762279-a389-41c9-9169-7ebc682e9703', 'event-003', 'Delegate Group A', 'Bole International Airport', 'Hotel Conference Center', '2026-09-20T08:00:00+00:00', 'Bus', 28, 'Water bottles included', 'Mekonnen Abebe', '+2519111004'),
  ('tr-005', '18762279-a389-41c9-9169-7ebc682e9703', 'event-004', 'Family Group', 'Residence', 'Ocean View Restaurant', '2026-09-12T18:00:00+00:00', 'SUV', 6, 'Child seat required', 'Tigist Alemu', '+2519111005'),
  ('tr-006', '18762279-a389-41c9-9169-7ebc682e9703', 'event-005', 'Corporate Guests', 'Airport', 'Hotel', '2026-09-10T09:00:00+00:00', 'Sedan', 3, 'Early morning pickup', 'Yonas Tadesse', '+2519111006')
ON CONFLICT (id) DO NOTHING;
