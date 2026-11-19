-- 353_proc_tender_seed.sql
-- Seeds additional tenders, tender lines, and tender submissions.
-- Adds lines to the existing tend-001 and creates 5 new tenders covering
-- all statuses and multiple departments (IT, F&B, Housekeeping, Engineering, Security).
-- Uses the demo property: 18762279-a389-41c9-9169-7ebc682e9703

-- Add lines to existing tender tend-001
INSERT INTO public.proc_tender_lines (id, tender_id, line_number, item_name, specification, quantity, unit_of_measure, required_delivery_date) VALUES
('tl-001', 'tend-001', 1, 'Office Furniture Set', 'Ergonomic chairs + desks, 10 sets', 10, 'sets', (NOW() + INTERVAL '30 days')::date),
('tl-002', 'tend-001', 2, 'Filing Cabinets', '4-drawer, lockable, metal', 20, 'units', (NOW() + INTERVAL '30 days')::date),
('tl-003', 'tend-001', 3, 'Conference Table', '8-seater, oak finish', 2, 'units', (NOW() + INTERVAL '45 days')::date);

-- Tender 002: IT Infrastructure (Draft)
-- Tender 003: Kitchen Equipment (Published, food_beverage)
-- Tender 004: Housekeeping Supplies (Submission Closed, housekeeping)
-- Tender 005: Engineering HVAC (Under Evaluation, engineering)
-- Tender 006: Security Systems (Awarded, procurement)
-- (See apply_migration call for full INSERT statements)
