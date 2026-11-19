-- Demo catering data (menu items and beverages)

INSERT INTO public.banquet_menu_items (id, property_id, event_id, menu_type, course_type, dish_name, dietary, quantity, special_notes) VALUES
  ('menu-001', '18762279-a389-41c9-9169-7ebc682e9703', 'event-002', 'Plated', 'Appetizer', 'Seared Scallops with Citrus Glaze', 'Regular', 150, 'Garnish with microgreens'),
  ('menu-002', '18762279-a389-41c9-9169-7ebc682e9703', 'event-002', 'Plated', 'Soup', 'Lobster Bisque', 'Regular', 150, 'Serve with crusty bread'),
  ('menu-003', '18762279-a389-41c9-9169-7ebc682e9703', 'event-002', 'Plated', 'Main', 'Grilled Beef Tenderloin', 'Regular', 120, 'Medium rare default'),
  ('menu-004', '18762279-a389-41c9-9169-7ebc682e9703', 'event-002', 'Plated', 'Main', 'Wild Mushroom Risotto', 'Vegetarian', 30, 'Vegan option available on request'),
  ('menu-005', '18762279-a389-41c9-9169-7ebc682e9703', 'event-002', 'Plated', 'Dessert', 'Vanilla Bean Cheesecake', 'Vegetarian', 150, 'Gluten-free base on request'),
  ('menu-006', '18762279-a389-41c9-9169-7ebc682e9703', 'event-001', 'Buffet', 'Appetizer', 'Bruschetta Trio', 'Vegetarian', 200, 'Three variations'),
  ('menu-007', '18762279-a389-41c9-9169-7ebc682e9703', 'event-001', 'Buffet', 'Main', 'Roasted Chicken with Herbs', 'Regular', 200, 'Carving station'),
  ('menu-008', '18762279-a389-41c9-9169-7ebc682e9703', 'event-001', 'Buffet', 'Main', 'Grilled Salmon', 'GlutenFree', 100, 'Lemon butter sauce on side'),
  ('menu-009', '18762279-a389-41c9-9169-7ebc682e9703', 'event-001', 'Buffet', 'Dessert', 'Assorted Mini Pastries', 'Regular', 200, 'Display on tiered stand'),
  ('menu-010', '18762279-a389-41c9-9169-7ebc682e9703', 'event-003', 'Plated', 'Appetizer', 'Foie Gras Terrine', 'Regular', 80, 'Accompanied by fig compote'),
  ('menu-011', '18762279-a389-41c9-9169-7ebc682e9703', 'event-003', 'Plated', 'Main', 'Wagyu Beef Medallions', 'Regular', 80, 'Truffle jus pairing'),
  ('menu-012', '18762279-a389-41c9-9169-7ebc682e9703', 'event-003', 'Plated', 'Dessert', 'Dark Chocolate Fondant', 'Vegetarian', 80, 'Salted caramel center'),
  ('menu-013', '18762279-a389-41c9-9169-7ebc682e9703', 'event-004', 'Cocktail', 'Appetizer', 'Mini Crab Cakes', 'Regular', 120, 'Spicy remoulade'),
  ('menu-014', '18762279-a389-41c9-9169-7ebc682e9703', 'event-004', 'Cocktail', 'Main', 'Sliders Trio', 'Regular', 120, 'Beef, chicken, veggie'),
  ('menu-015', '18762279-a389-41c9-9169-7ebc682e9703', 'event-004', 'Cocktail', 'Dessert', 'Macaron Tower', 'GlutenFree', 120, 'Six flavors'),
  ('menu-016', '18762279-a389-41c9-9169-7ebc682e9703', 'event-005', 'Plated', 'Appetizer', 'Fresh Fruit Plate', 'Vegan', 12, 'Seasonal selection'),
  ('menu-017', '18762279-a389-41c9-9169-7ebc682e9703', 'event-005', 'Plated', 'Main', 'Grilled Vegetable Quiche', 'Vegetarian', 12, 'Egg-free option on request'),
  ('menu-018', '18762279-a389-41c9-9169-7ebc682e9703', 'event-005', 'Plated', 'Dessert', 'Lemon Tart', 'Vegetarian', 12, 'Dusted with powdered sugar')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.banquet_beverages (id, property_id, event_id, beverage_type, category, name, quantity, service_type, special_notes) VALUES
  ('bev-001', '18762279-a389-41c9-9169-7ebc682e9703', 'event-002', 'Alcoholic', 'Wine', 'Champagne Brut', 60, 'Bar', 'Toast at midnight'),
  ('bev-002', '18762279-a389-41c9-9169-7ebc682e9703', 'event-002', 'Alcoholic', 'Wine', 'Cabernet Sauvignon', 40, 'Bar', 'Paired with main course'),
  ('bev-003', '18762279-a389-41c9-9169-7ebc682e9703', 'event-002', 'Alcoholic', 'Cocktails', 'Signature Elderflower Spritz', 80, 'Bar', 'House special'),
  ('bev-004', '18762279-a389-41c9-9169-7ebc682e9703', 'event-002', 'NonAlcoholic', 'Juice', 'Fresh Orange Juice', 50, 'SelfServe', 'Morning welcome drink'),
  ('bev-005', '18762279-a389-41c9-9169-7ebc682e9703', 'event-001', 'Alcoholic', 'Beer', 'Local Lager', 100, 'Bar', 'On tap'),
  ('bev-006', '18762279-a389-41c9-9169-7ebc682e9703', 'event-001', 'NonAlcoholic', 'SoftDrinks', 'Sparkling Water', 150, 'SelfServe', 'Multiple stations'),
  ('bev-007', '18762279-a389-41c9-9169-7ebc682e9703', 'event-001', 'NonAlcoholic', 'Coffee', 'Premium Coffee Blend', 200, 'Package', 'All-day service'),
  ('bev-008', '18762279-a389-41c9-9169-7ebc682e9703', 'event-003', 'Alcoholic', 'Wine', 'Vintage Bordeaux', 30, 'Bar', 'Sommelier service'),
  ('bev-009', '18762279-a389-41c9-9169-7ebc682e9703', 'event-003', 'Alcoholic', 'Spirits', 'Single Malt Whisky', 20, 'Bar', 'VIP lounge only'),
  ('bev-010', '18762279-a389-41c9-9169-7ebc682e9703', 'event-003', 'NonAlcoholic', 'Water', 'Mineral Water', 100, 'SelfServe', 'Still and sparkling'),
  ('bev-011', '18762279-a389-41c9-9169-7ebc682e9703', 'event-004', 'Alcoholic', 'Cocktails', 'Craft Gin & Tonic', 80, 'Bar', 'Botanical garnish'),
  ('bev-012', '18762279-a389-41c9-9169-7ebc682e9703', 'event-004', 'NonAlcoholic', 'SoftDrinks', 'Craft Mocktails', 60, 'Bar', 'Three varieties'),
  ('bev-013', '18762279-a389-41c9-9169-7ebc682e9703', 'event-005', 'NonAlcoholic', 'Coffee', 'Espresso', 24, 'Package', 'Continuous service'),
  ('bev-014', '18762279-a389-41c9-9169-7ebc682e9703', 'event-005', 'NonAlcoholic', 'Juice', 'Fresh Pressed Juice', 24, 'Package', 'Orange and grapefruit')
ON CONFLICT (id) DO NOTHING;
