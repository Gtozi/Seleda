-- Seed event-type-specific items and checklists

-- Wedding details
INSERT INTO public.banquet_event_type_items (id, property_id, event_id, item_type, item_data) VALUES
  ('wedding-001', '18762279-a389-41c9-9169-7ebc682e9703', 'event-002', 'wedding', '{"brideName":"Aster Bekele","groomName":"Dawit Kebede","ceremonyLocation":"Garden Pavilion","receptionLocation":"Grand Ballroom","guestCount":180,"budget":45000,"theme":"Elegant Garden","colorScheme":"Rose Gold & Sage","specialRequests":"Live band, fireworks, late night snacks"}'),
  ('wedding-002', '18762279-a389-41c9-9169-7ebc682e9703', 'event-002', 'wedding', '{"brideName":"Meron Tadesse","groomName":"Kirubel Alemu","ceremonyLocation":"Palm Garden","receptionLocation":"Terrace Lounge","guestCount":60,"budget":12000,"theme":"Sunset Terrace","colorScheme":"Terracotta & Cream","specialRequests":"Intimate dinner, acoustic music"}')
ON CONFLICT (id) DO NOTHING;

-- Conference sessions
INSERT INTO public.banquet_event_type_items (id, property_id, event_id, item_type, item_data) VALUES
  ('conf-001', '18762279-a389-41c9-9169-7ebc682e9703', 'event-001', 'conference', '{"sessionTitle":"Opening Keynote","speaker":"Dr. Abebe Kebede","startTime":"2026-09-15T08:00:00Z","endTime":"2026-09-15T09:30:00Z","room":"Crystal Ballroom A","capacity":300,"equipment":"Projector, microphones, LED screen"}'),
  ('conf-002', '18762279-a389-41c9-9169-7ebc682e9703', 'event-001', 'conference', '{"sessionTitle":"AI in Hospitality","speaker":"Sara Lemma","startTime":"2026-09-15T10:00:00Z","endTime":"2026-09-15T11:00:00Z","room":"Marble Conference A","capacity":80,"equipment":"Demo stations, power strips"}'),
  ('conf-003', '18762279-a389-41c9-9169-7ebc682e9703', 'event-006', 'conference', '{"sessionTitle":"African Union Forum Opening","speaker":"Tigist Alemu","startTime":"2026-09-22T09:00:00Z","endTime":"2026-09-22T10:30:00Z","room":"Terrace Lounge & Azure Room","capacity":90,"equipment":"Translation headsets, projectors"}'),
  ('conf-004', '18762279-a389-41c9-9169-7ebc682e9703', 'event-011', 'conference', '{"sessionTitle":"East Africa Finance Keynote","speaker":"Solomon Lemma","startTime":"2026-10-08T09:00:00Z","endTime":"2026-10-08T10:30:00Z","room":"Crystal & Marble","capacity":250,"equipment":"Panel mics, live polling"}')
ON CONFLICT (id) DO NOTHING;

-- Meeting agenda
INSERT INTO public.banquet_event_type_items (id, property_id, event_id, item_type, item_data) VALUES
  ('meet-001', '18762279-a389-41c9-9169-7ebc682e9703', 'event-005', 'meeting', '{"agendaItem":"Q3 Review","duration":30,"presenter":"CEO","timeSlot":"08:00"}'),
  ('meet-002', '18762279-a389-41c9-9169-7ebc682e9703', 'event-005', 'meeting', '{"agendaItem":"Strategy Discussion","duration":60,"presenter":"Board Chair","timeSlot":"08:45"}'),
  ('meet-003', '18762279-a389-41c9-9169-7ebc682e9703', 'event-009', 'meeting', '{"agendaItem":"Workshop Objectives","duration":45,"presenter":"Mekdes Alemu","timeSlot":"09:00"}'),
  ('meet-004', '18762279-a389-41c9-9169-7ebc682e9703', 'event-019', 'meeting', '{"agendaItem":"Board Offsite Kickoff","duration":90,"presenter":"Dawit Bekele","timeSlot":"14:00"}')
ON CONFLICT (id) DO NOTHING;

-- Social event details
INSERT INTO public.banquet_event_type_items (id, property_id, event_id, item_type, item_data) VALUES
  ('soc-001', '18762279-a389-41c9-9169-7ebc682e9703', 'event-010', 'social', '{"eventType":"Anniversary","honoreeName":"Bekele Family","age":50,"theme":"Golden Anniversary","specialRequirements":"Gold and white decor, live jazz","dietaryRestrictions":"Gluten-free cake"}'),
  ('soc-002', '18762279-a389-41c9-9169-7ebc682e9703', 'event-013', 'social', '{"eventType":"ReligiousEvent","honoreeName":"St. Marys Association","age":"","theme":"Retreat Weekend","specialRequirements":"Quiet spaces, vegetarian menu","dietaryRestrictions":"All vegetarian"}'),
  ('soc-003', '18762279-a389-41c9-9169-7ebc682e9703', 'event-015', 'social', '{"eventType":"Graduation","honoreeName":"Unity University","age":"","theme":"Class of 2026","specialRequirements":"Stage, podium, live streaming","dietaryRestrictions":""}'),
  ('soc-004', '18762279-a389-41c9-9169-7ebc682e9703', 'event-016', 'social', '{"eventType":"Birthday","honoreeName":"Nati Mekonnen","age":30,"theme":"Neon Night","specialRequirements":"DJ, cake table","dietaryRestrictions":""}')
ON CONFLICT (id) DO NOTHING;

-- Room blocks
INSERT INTO public.banquet_event_type_items (id, property_id, event_id, item_type, item_data) VALUES
  ('room-001', '18762279-a389-41c9-9169-7ebc682e9703', 'event-002', 'roomblock', '{"roomType":"Deluxe","roomCount":40,"checkInDate":"2026-09-19","checkOutDate":"2026-09-21","ratePerRoom":180,"specialRequests":"Early check-in for bridal party"}'),
  ('room-002', '18762279-a389-41c9-9169-7ebc682e9703', 'event-002', 'roomblock', '{"roomType":"Suite","roomCount":5,"checkInDate":"2026-09-19","checkOutDate":"2026-09-21","ratePerRoom":320,"specialRequests":"Bridal suite with view"}'),
  ('room-003', '18762279-a389-41c9-9169-7ebc682e9703', 'event-006', 'roomblock', '{"roomType":"Standard","roomCount":60,"checkInDate":"2026-09-21","checkOutDate":"2026-09-24","ratePerRoom":140,"specialRequests":"Close to conference rooms"}'),
  ('room-004', '18762279-a389-41c9-9169-7ebc682e9703', 'event-011', 'roomblock', '{"roomType":"Executive","roomCount":20,"checkInDate":"2026-10-07","checkOutDate":"2026-10-11","ratePerRoom":250,"specialRequests":"VIP floor"}')
ON CONFLICT (id) DO NOTHING;

-- Event-type checklists
INSERT INTO public.banquet_event_type_checklists (id, property_id, event_id, item_type, item_name, is_completed, due_date, assigned_to) VALUES
  ('wc-001', '18762279-a389-41c9-9169-7ebc682e9703', 'event-002', 'wedding', 'Confirm ceremony and reception venues', true, '2026-09-01', 'Sara Lemma'),
  ('wc-002', '18762279-a389-41c9-9169-7ebc682e9703', 'event-002', 'wedding', 'Finalize guest list and send invitations', false, '2026-09-05', 'Meron Tadesse'),
  ('wc-003', '18762279-a389-41c9-9169-7ebc682e9703', 'event-002', 'wedding', 'Arrange catering and menu selection', true, '2026-09-10', 'Sara Lemma'),
  ('cc-001', '18762279-a389-41c9-9169-7ebc682e9703', 'event-001', 'conference', 'Confirm conference rooms and breakout spaces', true, '2026-09-10', 'Abebe Kebede'),
  ('cc-002', '18762279-a389-41c9-9169-7ebc682e9703', 'event-001', 'conference', 'Arrange AV equipment and tech support', false, '2026-09-12', 'Abebe Kebede'),
  ('mc-001', '18762279-a389-41c9-9169-7ebc682e9703', 'event-005', 'meeting', 'Confirm meeting room booking', true, '2026-09-15', 'Meron Tadesse'),
  ('sc-001', '18762279-a389-41c9-9169-7ebc682e9703', 'event-010', 'social', 'Order cake or special desserts', false, '2026-10-01', 'Sara Lemma'),
  ('rc-001', '18762279-a389-41c9-9169-7ebc682e9703', 'event-002', 'roomblock', 'Confirm room block requirements', true, '2026-09-01', 'Front Office')
ON CONFLICT (id) DO NOTHING;