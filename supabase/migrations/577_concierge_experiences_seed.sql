-- Migration 577: Concierge experience catalog seed
--
-- The Experience & Activity Booking module reads the bookable catalog from
-- `guest_services` filtered by category='concierge'. The table previously
-- held a single generic "Concierge" row, so the catalog rendered nearly
-- empty. These rows are real bookable experiences shown to guests.

INSERT INTO guest_services (id, name, description, category, price, available) VALUES
('gs_exp_01', 'National Museum Guided Tour', 'Private guided tour of the National Museum of Ethiopia, including the Lucy exhibit and the royal artifacts wing. ~2 hours.', 'concierge', 45.00, true),
('gs_exp_02', 'Entoto Hills Day Hike', 'Guided morning hike through the eucalyptus forests of Entoto with panoramic views over Addis Ababa. Includes transport and water. ~4 hours.', 'concierge', 60.00, true),
('gs_exp_03', 'Merkato Market Experience', 'Walking tour through Africa''s largest open-air market with a local guide — spices, textiles, and traditional crafts. ~3 hours.', 'concierge', 35.00, true),
('gs_exp_04', 'Traditional Coffee Ceremony', 'Authentic Ethiopian coffee ceremony with roasting, brewing, and popcorn, hosted at the hotel lounge or a local home. ~1 hour.', 'concierge', 20.00, true),
('gs_exp_05', 'Addis Food Tour', 'Evening tasting tour across three restaurants — injera, kitfo, and tej sampling with a culinary guide. ~3.5 hours.', 'concierge', 75.00, true),
('gs_exp_06', 'Debre Libanos Day Trip', 'Full-day excursion to the Debre Libanos monastery and Portuguese Bridge, with picnic lunch and gelada baboon viewing. ~9 hours.', 'concierge', 120.00, true),
('gs_exp_07', 'Unity Park & Palace Tour', 'Skip-the-line entry and guided tour of Unity Park — the imperial palace grounds, zoo, and historical exhibits. ~3 hours.', 'concierge', 55.00, true),
('gs_exp_08', 'Art Gallery Circuit', 'Afternoon visit to Addis''s contemporary art galleries (Makush, Zoma, Alliance Ethio-Française) with a curator. ~3 hours.', 'concierge', 40.00, true),
('gs_exp_09', 'Hot Air Balloon Flight', 'Sunrise balloon flight over the Rift Valley lakes region with champagne breakfast. Weather-dependent, advance booking required. ~5 hours.', 'concierge', 350.00, false)
ON CONFLICT (id) DO NOTHING;
