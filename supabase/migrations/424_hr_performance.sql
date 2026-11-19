-- HR Performance Management
-- Adds score/kpi_metric columns to hr_performance_reviews and seeds mock data.

-- Add columns if they don't exist
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'hr_performance_reviews' AND column_name = 'score') THEN
    ALTER TABLE hr_performance_reviews ADD COLUMN score NUMERIC(3,1);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'hr_performance_reviews' AND column_name = 'kpi_metric') THEN
    ALTER TABLE hr_performance_reviews ADD COLUMN kpi_metric TEXT;
  END IF;
END $$;

-- ============================================================================
-- Seed demo data for GH-MAIN
-- ============================================================================
DO $$
DECLARE
  v_main UUID := '18762279-a389-41c9-9169-7ebc682e9703';
BEGIN
  IF NOT EXISTS (SELECT 1 FROM hr_performance_reviews WHERE property_id = v_main AND employee_id = 'EMP-DIR-003') THEN
    INSERT INTO hr_performance_reviews (property_id, employee_id, employee_name, period, due_date, status, goals, completed, reviewer, score, kpi_metric)
    VALUES
      (v_main, 'EMP-DIR-003', 'Elena Martinez', 'Q2 2024', '2024-06-30', 'Completed',   5, 5, 'Sarah Johnson', 4.9, '96% Efficiency'),
      (v_main, 'EMP-DIR-007', 'Ahmed Hassan',   'Q2 2024', '2024-06-30', 'Completed',   5, 5, 'Sarah Johnson', 4.8, '92% Satisfaction'),
      (v_main, 'EMP-DIR-004', 'James Chen',     'Q2 2024', '2024-06-30', 'In Progress', 5, 4, 'Sarah Johnson', 4.2, '88% Accuracy'),
      (v_main, 'EMP-DIR-009', 'David Kim',      'Q2 2024', '2024-07-15', 'Pending',     5, 0, 'Sarah Johnson', NULL, 'PENDING'),
      (v_main, 'EMP-DIR-010', 'Fatima Noor',    'Q2 2024', '2024-07-15', 'Pending',     5, 0, 'Sarah Johnson', NULL, 'PENDING'),
      (v_main, 'EMP-HK-03',   'Aisha P.',       'Q2 2024', '2024-06-30', 'Completed',   5, 5, 'Sarah Johnson', 4.7, '94% Cleanliness'),
      (v_main, 'EMP-FO-07',   'Anna L.',        'Q2 2024', '2024-07-15', 'Pending',     5, 0, 'Sarah Johnson', NULL, 'PENDING'),
      (v_main, 'EMP-HK-02',   'Carlos M.',      'Q2 2024', '2024-06-30', 'Completed',   5, 5, 'Sarah Johnson', 4.5, '89% Productivity');
  END IF;
END $$;
