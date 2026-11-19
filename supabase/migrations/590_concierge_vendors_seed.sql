-- Migration 590: Concierge vendor management seed
--
-- The Vendor Management module manages external service providers the
-- concierge books on behalf of guests. Existing vendors were back-office
-- suppliers (cleaning, utilities); these add guest-facing partners across
-- the module's categories with realistic contact and balance data.

INSERT INTO vendors (
  id, name, contact_name, email, phone, address,
  tax_id, withholding_rate, category, status, balance
) VALUES
('vnd_con_tour1', 'Lalibela Heritage Tours', 'Alemayehu Bekele', 'bookings@lalibelaheritage.et', '+251 91 167 4521',
 'Churchill Avenue, Addis Ababa', 'TIN-0045821', 2.00, 'Tours', 'Active', 0.00),
('vnd_con_tour2', 'Ethiopian Adventure Company', 'Sara Wolde', 'reservations@ethioadventure.com', '+251 91 234 8890',
 'Bole Road, Friendship Building 3rd Floor', 'TIN-0071203', 2.00, 'Tours', 'Active', 1450.00),
('vnd_con_trans1', 'Addis Airport Taxi Services', 'Girma Tesfa', 'dispatch@addisairporttaxi.et', '+251 11 554 3210',
 'Bole International Airport, Arrivals Hall', 'TIN-0033441', 0.00, 'Transportation', 'Active', 0.00),
('vnd_con_trans2', 'Selam VIP Transport', 'Hanna Mekonnen', 'vip@selamtransport.et', '+251 91 155 7823',
 'Kazanchis, Addis Ababa', 'TIN-0098876', 0.00, 'Transportation', 'Hold', 820.00),
('vnd_con_fb1', 'Mama''s Kitchen Catering', 'Tigist Alemu', 'orders@mamaskitchen.et', '+251 91 278 5566',
 'Bole Medhanealem, Addis Ababa', 'TIN-0055902', 2.00, 'Food & Beverage', 'Active', 340.00),
('vnd_con_med1', 'International Clinic (IK Clinic)', 'Dr. Ruth Abate', 'appointments@ikclinic.et', '+251 11 551 8990',
 'Bole Sub-City, near Edna Mall', 'TIN-0011229', 0.00, 'Medical', 'Active', 0.00),
('vnd_con_ent1', 'Fendika Cultural Center', 'Melaku Belay', 'events@fendika.et', '+251 91 150 0215',
 'Kazanchis, Addis Ababa', 'TIN-0088445', 0.00, 'Entertainment', 'Active', 0.00),
('vnd_con_ops1', 'Zema Flowers & Events', 'Selamawit Girma', 'hello@zemaflowers.et', '+251 91 133 4477',
 'Sarbet, Addis Ababa', 'TIN-0066117', 2.00, 'Operations', 'Inactive', 0.00)
ON CONFLICT (id) DO NOTHING;
