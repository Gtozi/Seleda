-- ============================================================
-- 645_ops_store.sql
-- Dedicated Operations store in unified inventory
-- ============================================================
-- The Operations portal's Requisitions tab (DepartmentRequisitionForm
-- department="Operations") resolves its store via
-- uinv_stores.department = 'Operations'. UINV-ST-GEN is untagged
-- (it serves all non-operational departments), so the lookup never
-- matched. This gives Operations a real store, consistent with the
-- per-department stores added for Spa (488) and Revenue (563).
-- ============================================================

DO $$
DECLARE
  prop_id UUID := '18762279-a389-41c9-9169-7ebc682e9703'; -- demo property
BEGIN
  INSERT INTO public.uinv_stores (id, property_id, store_code, store_name, store_type, parent_store_id, manager, location, capacity, temperature_zone, is_active, department) VALUES
    ('UINV-ST-OPS', prop_id, 'OPS', 'Operations Store', 'Warehouse', 'UINV-ST-MAIN', 'Operations Manager', 'Admin Block', 5000, 'Ambient', true, 'Operations')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.uinv_locations (id, store_id, location_code, location_name, location_type, temperature_zone, is_active) VALUES
    ('UINV-LOC-OPS-1', 'UINV-ST-OPS', 'OPS-1', 'Ops Shelf 1', 'Shelf', 'Ambient', true),
    ('UINV-LOC-OPS-2', 'UINV-ST-OPS', 'OPS-2', 'Ops Shelf 2', 'Shelf', 'Ambient', true)
  ON CONFLICT (id) DO NOTHING;
END $$;
