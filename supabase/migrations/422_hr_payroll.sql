-- HR Payroll seed data
-- Ensures payroll_runs and payslips have property-scoped mock data for GH-MAIN.
-- Tables payroll_runs, payslips, tax_bands, pension_rates already exist.

-- ============================================================================
-- Seed payroll runs for GH-MAIN
-- ============================================================================
DO $$
DECLARE
  v_main UUID := '18762279-a389-41c9-9169-7ebc682e9703';
  v_run1 TEXT;
  v_run2 TEXT;
  v_run3 TEXT;
BEGIN
  -- June 2024 run (Posted)
  IF NOT EXISTS (SELECT 1 FROM payroll_runs WHERE property_id = v_main AND period = '2024-06' AND status = 'Posted') THEN
    v_run1 := gen_random_uuid()::text;
    INSERT INTO payroll_runs (id, property_id, period, run_date, status, total_gross, total_tax, total_pension_employee, total_pension_employer, total_deductions, total_net, employee_count, posted_by, posted_at, created_by)
    VALUES (v_run1, v_main, '2024-06', '2024-06-30', 'Posted', 185600, 42300, 12992, 20416, 55292, 130308, 24, 'system', '2024-06-30 10:00:00+00', 'system');

    INSERT INTO payslips (payroll_run_id, property_id, employee_id, period, basic_salary, allowances, overtime, gross_pay, income_tax, pension_employee, pension_employer, total_deductions, net_pay, ytd_gross, ytd_tax, ytd_pension, ytd_net, status, paid_at) VALUES
      (v_run1, v_main, 'EMP-DIR-003', '2024-06', 95000, 5000, 0, 100000, 24500, 7000, 11000, 31500, 68500, 600000, 147000, 42000, 411000, 'Paid', '2024-06-30 10:00:00+00'),
      (v_run1, v_main, 'EMP-DIR-004', '2024-06', 72000, 3500, 0, 75500, 17500, 5285, 8305, 22785, 52715, 453000, 105000, 31710, 316290, 'Paid', '2024-06-30 10:00:00+00'),
      (v_run1, v_main, 'EMP-DIR-007', '2024-06', 35000, 1500, 0, 36500, 7200, 2555, 4015, 9755, 26745, 219000, 43200, 15330, 160470, 'Paid', '2024-06-30 10:00:00+00'),
      (v_run1, v_main, 'EMP-DIR-009', '2024-06', 45000, 2000, 0, 47000, 9800, 3290, 5170, 13090, 33910, 282000, 58800, 19740, 203460, 'Paid', '2024-06-30 10:00:00+00'),
      (v_run1, v_main, 'EMP-DIR-010', '2024-06', 30000, 1200, 0, 31200, 5800, 2184, 3432, 7984, 23216, 187200, 34800, 13104, 139296, 'Paid', '2024-06-30 10:00:00+00');
  END IF;

  -- May 2024 run (Posted)
  IF NOT EXISTS (SELECT 1 FROM payroll_runs WHERE property_id = v_main AND period = '2024-05' AND status = 'Posted') THEN
    v_run2 := gen_random_uuid()::text;
    INSERT INTO payroll_runs (id, property_id, period, run_date, status, total_gross, total_tax, total_pension_employee, total_pension_employer, total_deductions, total_net, employee_count, posted_by, posted_at, created_by)
    VALUES (v_run2, v_main, '2024-05', '2024-05-31', 'Posted', 182400, 41200, 12768, 20064, 53968, 128432, 24, 'system', '2024-05-31 10:00:00+00', 'system');

    INSERT INTO payslips (payroll_run_id, property_id, employee_id, period, basic_salary, allowances, overtime, gross_pay, income_tax, pension_employee, pension_employer, total_deductions, net_pay, ytd_gross, ytd_tax, ytd_pension, ytd_net, status, paid_at) VALUES
      (v_run2, v_main, 'EMP-DIR-003', '2024-05', 95000, 5000, 0, 100000, 24500, 7000, 11000, 31500, 68500, 500000, 122500, 35000, 342500, 'Paid', '2024-05-31 10:00:00+00'),
      (v_run2, v_main, 'EMP-DIR-004', '2024-05', 72000, 3500, 0, 75500, 17500, 5285, 8305, 22785, 52715, 377500, 87500, 26425, 263575, 'Paid', '2024-05-31 10:00:00+00'),
      (v_run2, v_main, 'EMP-DIR-007', '2024-05', 35000, 1500, 0, 36500, 7200, 2555, 4015, 9755, 26745, 182500, 36000, 12775, 133725, 'Paid', '2024-05-31 10:00:00+00'),
      (v_run2, v_main, 'EMP-DIR-009', '2024-05', 45000, 2000, 0, 47000, 9800, 3290, 5170, 13090, 33910, 235000, 49000, 16450, 169550, 'Paid', '2024-05-31 10:00:00+00'),
      (v_run2, v_main, 'EMP-DIR-010', '2024-05', 30000, 1200, 0, 31200, 5800, 2184, 3432, 7984, 23216, 156000, 29000, 10920, 116080, 'Paid', '2024-05-31 10:00:00+00');
  END IF;

  -- July 2024 run (Calculated - pending approval)
  IF NOT EXISTS (SELECT 1 FROM payroll_runs WHERE property_id = v_main AND period = '2024-07' AND status = 'Calculated') THEN
    v_run3 := gen_random_uuid()::text;
    INSERT INTO payroll_runs (id, property_id, period, run_date, status, total_gross, total_tax, total_pension_employee, total_pension_employer, total_deductions, total_net, employee_count, created_by)
    VALUES (v_run3, v_main, '2024-07', '2024-07-31', 'Calculated', 188800, 43500, 13216, 20768, 56716, 132084, 24, 'system');

    INSERT INTO payslips (payroll_run_id, property_id, employee_id, period, basic_salary, allowances, overtime, gross_pay, income_tax, pension_employee, pension_employer, total_deductions, net_pay, ytd_gross, ytd_tax, ytd_pension, ytd_net, status) VALUES
      (v_run3, v_main, 'EMP-DIR-003', '2024-07', 95000, 5000, 2000, 102000, 25200, 7140, 11220, 32340, 69660, 702000, 172200, 49140, 480660, 'Calculated'),
      (v_run3, v_main, 'EMP-DIR-004', '2024-07', 72000, 3500, 0, 75500, 17500, 5285, 8305, 22785, 52715, 528500, 122500, 36995, 391505, 'Calculated'),
      (v_run3, v_main, 'EMP-DIR-007', '2024-07', 35000, 1500, 500, 37000, 7350, 2590, 4070, 9940, 27060, 256000, 50550, 17920, 187480, 'Calculated'),
      (v_run3, v_main, 'EMP-DIR-009', '2024-07', 45000, 2000, 1000, 48000, 10100, 3360, 5280, 13460, 34540, 330000, 68900, 23100, 238800, 'Calculated'),
      (v_run3, v_main, 'EMP-DIR-010', '2024-07', 30000, 1200, 0, 31200, 5800, 2184, 3432, 7984, 23216, 218400, 40600, 15324, 162776, 'Calculated');
  END IF;
END $$;
