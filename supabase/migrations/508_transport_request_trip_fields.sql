-- Transportation Requests — trip lifecycle fields
-- Adds actual timing, fare amount and payment method so a request row carries
-- the full trip lifecycle (Request → Dispatch → Trip → Billing).

ALTER TABLE transport_requests ADD COLUMN IF NOT EXISTS actual_start_time TIMESTAMPTZ;
ALTER TABLE transport_requests ADD COLUMN IF NOT EXISTS actual_end_time   TIMESTAMPTZ;
ALTER TABLE transport_requests ADD COLUMN IF NOT EXISTS amount            NUMERIC(12,2) NOT NULL DEFAULT 0;
ALTER TABLE transport_requests ADD COLUMN IF NOT EXISTS payment_method    TEXT
  CHECK (payment_method IN ('Guest Folio', 'Corporate Billing', 'Event Billing', 'Cash Payment', 'Credit Card', 'Complimentary', 'Internal Department Charge'));

-- ============================================================================
-- Backfill trip details for seeded GH-MAIN rows + add cancelled TR-007
-- ============================================================================
DO $$
DECLARE
  v_main UUID := '18762279-a389-41c9-9169-7ebc682e9703';
BEGIN
  UPDATE transport_requests SET
    estimated_duration = '45 min', estimated_distance = 25, amount = 85.00,
    payment_method = 'Guest Folio', actual_start_time = '2026-07-30 14:35:00+00'
  WHERE property_id = v_main AND request_number = 'TR-001';

  UPDATE transport_requests SET
    estimated_duration = '30 min', estimated_distance = 12, amount = 45.00,
    payment_method = 'Guest Folio'
  WHERE property_id = v_main AND request_number = 'TR-002';

  UPDATE transport_requests SET
    estimated_duration = '35 min', estimated_distance = 18, amount = 150.00,
    payment_method = 'Event Billing', actual_start_time = '2026-07-30 18:05:00+00'
  WHERE property_id = v_main AND request_number = 'TR-003';

  UPDATE transport_requests SET
    estimated_duration = '55 min', estimated_distance = 32, actual_duration = '52 min',
    actual_distance = 32, amount = 95.00, payment_method = 'Guest Folio',
    actual_start_time = '2026-07-30 19:28:00+00', actual_end_time = '2026-07-30 20:20:00+00'
  WHERE property_id = v_main AND request_number = 'TR-004';

  UPDATE transport_requests SET
    estimated_duration = '4 hours', estimated_distance = 80, amount = 200.00,
    payment_method = 'Guest Folio'
  WHERE property_id = v_main AND request_number = 'TR-005';

  UPDATE transport_requests SET
    estimated_duration = '1 hour', estimated_distance = 45, amount = 350.00,
    payment_method = 'Corporate Billing', actual_start_time = '2026-07-31 06:05:00+00'
  WHERE property_id = v_main AND request_number = 'TR-006';

  IF NOT EXISTS (SELECT 1 FROM transport_requests WHERE property_id = v_main AND request_number = 'TR-007') THEN
    INSERT INTO transport_requests
      (property_id, request_number, guest_id, guest_name, room, type, source, pickup_location, destination,
       scheduled_time, passenger_count, luggage_count, status, priority, estimated_duration, estimated_distance, amount)
    VALUES
      (v_main, 'TR-007',
        (SELECT id FROM guests WHERE name ILIKE 'Robert Wilson' LIMIT 1),
        'Robert Wilson', '318', 'Airport Pickup', 'Front Office',
        'JFK Airport - Terminal 1', 'Hotel Main Entrance',
        '2026-07-30 15:00:00+00', 1, 2, 'Cancelled', 'Normal', '40 min', 22, 0.00);
  END IF;
END $$;
