-- Migration 586: Concierge local recommendations knowledge base
--
-- The Local Recommendations module is a curated knowledge base of nearby
-- restaurants, attractions, shopping, and cultural sites. No canonical
-- table existed (guest_services lacks address/phone/rating fields), so
-- this creates a dedicated table and seeds realistic Addis Ababa entries.

CREATE TABLE IF NOT EXISTS local_recommendations (
  id          text PRIMARY KEY,
  name        text NOT NULL,
  category    text NOT NULL CHECK (category IN ('restaurants','attractions','shopping','cultural')),
  rating      numeric(2,1) CHECK (rating >= 0 AND rating <= 5),
  address     text,
  phone       text,
  notes       text,
  price_tier  text CHECK (price_tier IN ('$','$$','$$$','$$$$')),
  active      boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- ── Restaurants ──────────────────────────────────────────────────────────
INSERT INTO local_recommendations (id, name, category, rating, address, phone, notes, price_tier) VALUES
('lr_rest_01', 'Yod Abyssinia Traditional Restaurant', 'restaurants', 4.6, 'Bole Road, near Edna Mall, Addis Ababa', '+251 11 661 2985', 'Best traditional cuisine in Bole — live cultural dance nightly at 19:30. Book ahead Fri/Sat.', '$$'),
('lr_rest_02', 'Kategna Restaurant', 'restaurants', 4.4, 'Off Cameroon Street, Bole, Addis Ababa', '+251 11 646 4243', 'Modern Ethiopian dining — excellent doro wat and fasting platters. Good for business dinners.', '$$'),
('lr_rest_03', '2000 Habesha Cultural Restaurant', 'restaurants', 4.3, 'Namibia Street, Bole, Addis Ababa', '+251 11 553 9000', 'Cultural dinner with full traditional dance show — great for first-time visitors.', '$$'),
('lr_rest_04', 'Castelli''s Restaurant', 'restaurants', 4.5, 'Churchill Avenue, Piazza, Addis Ababa', '+251 11 156 8750', 'Historic Italian restaurant since 1948 — candlelit, old-world charm. Cash preferred.', '$$$')
ON CONFLICT (id) DO NOTHING;

-- ── Attractions ──────────────────────────────────────────────────────────
INSERT INTO local_recommendations (id, name, category, rating, address, phone, notes, price_tier) VALUES
('lr_attr_01', 'National Museum of Ethiopia', 'attractions', 4.7, 'King George VI Street, Arat Kilo, Addis Ababa', '+251 11 111 7150', 'Home of the Lucy fossil — allow 1.5–2 hours. Closed Mondays.', '$'),
('lr_attr_02', 'Entoto Natural Park', 'attractions', 4.6, 'Entoto Hills, north Addis Ababa', '+251 11 123 4500', 'Eucalyptus forest, city viewpoints, hiking and zip-line. Best in the morning.', '$'),
('lr_attr_03', 'Unity Park', 'attractions', 4.5, 'Grand Palace compound, Arat Kilo', '+251 11 126 6200', 'Palace tour, zoo, and gardens — advance reservation required, bring passport.', '$$'),
('lr_attr_04', 'Red Terror Martyrs Memorial Museum', 'attractions', 4.2, 'Meskel Square, Addis Ababa', NULL, 'Compact but moving history of the Derg era — free entry, 45 minutes.', '$')
ON CONFLICT (id) DO NOTHING;

-- ── Shopping ─────────────────────────────────────────────────────────────
INSERT INTO local_recommendations (id, name, category, rating, address, phone, notes, price_tier) VALUES
('lr_shop_01', 'Merkato', 'shopping', 4.3, 'West of city center, Addis Ketema', NULL, 'Largest open-air market in Africa — arrange an escort, keep belongings secure.', '$'),
('lr_shop_02', 'Shiromeda Market', 'shopping', 4.4, 'Near Entoto Road, Addis Ababa', NULL, 'Best prices for habesha kemis and handwoven cotton — bargain expected.', '$'),
('lr_shop_03', 'Friendship City Center', 'shopping', 4.2, 'Bole Road, Addis Ababa', '+251 11 618 5500', 'Modern mall — international brands, electronics, supermarket on ground floor.', '$$'),
('lr_shop_04', 'Sabahar Weaving Workshop', 'shopping', 4.7, 'Bole, behind Atlas Hotel', '+251 11 618 2137', 'Fair-trade handwoven scarves and textiles — workshop tours by appointment.', '$$')
ON CONFLICT (id) DO NOTHING;

-- ── Cultural Sites ───────────────────────────────────────────────────────
INSERT INTO local_recommendations (id, name, category, rating, address, phone, notes, price_tier) VALUES
('lr_cult_01', 'Holy Trinity Cathedral', 'cultural', 4.6, 'Arat Kilo, Addis Ababa', '+251 11 123 3400', 'Haile Selassie''s tomb and stunning stained glass — modest dress required.', '$'),
('lr_cult_02', 'Ethnological Museum', 'cultural', 4.5, 'Addis Ababa University, Sidist Kilo campus', '+251 11 122 0639', 'Inside Haile Selassie''s former palace — excellent ethnographic collection.', '$'),
('lr_cult_03', 'St. George Cathedral & Museum', 'cultural', 4.4, 'Piazza, Addis Ababa', NULL, 'Octagonal church with museum upstairs — beautiful mosaics and royal artifacts.', '$'),
('lr_cult_04', 'Fendika Azmari Bet', 'cultural', 4.8, 'Kazanchis, Addis Ababa', '+251 91 150 0215', 'Traditional azmari music house — Fri/Sat nights, small cover charge, cash only.', '$$')
ON CONFLICT (id) DO NOTHING;
