-- Fix existing folio hierarchy for group/corporate reservations
-- Creates missing Company, Group, and shared Master folios
-- Moves charges from per-reservation Master folios to the shared Master folio
-- Run after 243_make_reservation_id_nullable_on_folios.sql

DO $$
DECLARE
    v_company_folio_id TEXT;
    v_group_folio_id TEXT;
    v_master_folio_id TEXT;
    v_old_master_folio_id TEXT;
    v_user_id TEXT := 'U-1721568083-9';
    r RECORD;
BEGIN
    -- 1. Company folio for TA-ETT001 (parent of GRP-UCD77R / lemele)
    SELECT id INTO v_company_folio_id FROM folios WHERE owner_type = 'group_profile' AND owner_id = 'TA-ETT001' AND status = 'Open' LIMIT 1;
    IF v_company_folio_id IS NULL THEN
        v_company_folio_id := gen_random_uuid()::text;
        INSERT INTO folios (id, folio_type, status, balance, total_charges, total_payments, currency, owner_type, owner_id, opened_at, created_by, notes)
        VALUES (v_company_folio_id, 'Company', 'Open', 0, 0, 0, 'USD', 'group_profile', 'TA-ETT001', NOW(), v_user_id, 'Company folio for TA-ETT001 (ETT)');
    END IF;

    -- 2. Group folio for GRP-UCD77R (lemele)
    SELECT id INTO v_group_folio_id FROM folios WHERE folio_type = 'Group' AND group_id = 'GRP-UCD77R' AND status = 'Open' LIMIT 1;
    IF v_group_folio_id IS NULL THEN
        v_group_folio_id := gen_random_uuid()::text;
        INSERT INTO folios (id, folio_type, status, balance, total_charges, total_payments, currency, group_id, parent_folio_id, opened_at, created_by, notes)
        VALUES (v_group_folio_id, 'Group', 'Open', 0, 0, 0, 'USD', 'GRP-UCD77R', v_company_folio_id, NOW(), v_user_id, 'Group folio for GRP-UCD77R (lemele)');
    END IF;

    -- 3. ONE shared Master folio for TA-ETT001
    SELECT id INTO v_master_folio_id FROM folios WHERE folio_type = 'Master' AND owner_type = 'group_profile' AND owner_id = 'TA-ETT001' AND status = 'Open' LIMIT 1;
    IF v_master_folio_id IS NULL THEN
        v_master_folio_id := gen_random_uuid()::text;
        INSERT INTO folios (id, folio_type, target_folio, status, balance, total_charges, total_payments, currency, owner_type, owner_id, parent_folio_id, opened_at, created_by, notes)
        VALUES (v_master_folio_id, 'Master', 'A', 'Open', 0, 0, 0, 'USD', 'group_profile', 'TA-ETT001', v_group_folio_id, NOW(), v_user_id, 'Master folio for company TA-ETT001 (ETT)');
    END IF;

    -- 4. Move charges from per-reservation Master folios to shared Master
    FOR r IN SELECT id, reservation_id FROM folios WHERE folio_type = 'Master' AND owner_type IS NULL AND reservation_id IN ('4RSO0BHE', 'UGX8HVEX') AND status = 'Open'
    LOOP
        v_old_master_folio_id := r.id;
        UPDATE folio_lines SET folio_id = v_master_folio_id WHERE folio_id = v_old_master_folio_id AND is_voided = false;
        UPDATE folios SET status = 'Closed', closed_at = NOW(), balance = 0, total_charges = 0, notes = COALESCE(notes, '') || ' | Consolidated into shared Master ' || v_master_folio_id WHERE id = v_old_master_folio_id;
    END LOOP;

    -- Update shared Master folio totals
    UPDATE folios SET total_charges = COALESCE((SELECT SUM(amount) FROM folio_lines WHERE folio_id = v_master_folio_id AND is_voided = false), 0), balance = COALESCE((SELECT SUM(amount) FROM folio_lines WHERE folio_id = v_master_folio_id AND is_voided = false), 0) - total_payments WHERE id = v_master_folio_id;

    -- 5. Link Guest (B) folios to shared Master
    UPDATE folios SET parent_folio_id = v_master_folio_id WHERE folio_type = 'Guest' AND target_folio = 'B' AND reservation_id IN ('4RSO0BHE', 'UGX8HVEX') AND parent_folio_id IS NULL;

    -- 6. Company + Group for GRP-18XQBM (carter) -> TA-4M6N8U (Awazie)
    SELECT id INTO v_company_folio_id FROM folios WHERE owner_type = 'group_profile' AND owner_id = 'TA-4M6N8U' AND status = 'Open' LIMIT 1;
    IF v_company_folio_id IS NULL THEN
        v_company_folio_id := gen_random_uuid()::text;
        INSERT INTO folios (id, folio_type, status, balance, total_charges, total_payments, currency, owner_type, owner_id, opened_at, created_by, notes)
        VALUES (v_company_folio_id, 'Company', 'Open', 0, 0, 0, 'USD', 'group_profile', 'TA-4M6N8U', NOW(), v_user_id, 'Company folio for TA-4M6N8U (Awazie)');
    END IF;
    SELECT id INTO v_group_folio_id FROM folios WHERE folio_type = 'Group' AND group_id = 'GRP-18XQBM' AND status = 'Open' LIMIT 1;
    IF v_group_folio_id IS NULL THEN
        v_group_folio_id := gen_random_uuid()::text;
        INSERT INTO folios (id, folio_type, status, balance, total_charges, total_payments, currency, group_id, parent_folio_id, opened_at, created_by, notes)
        VALUES (v_group_folio_id, 'Group', 'Open', 0, 0, 0, 'USD', 'GRP-18XQBM', v_company_folio_id, NOW(), v_user_id, 'Group folio for GRP-18XQBM (carter)');
    END IF;
    UPDATE folios SET parent_folio_id = v_group_folio_id, group_id = 'GRP-18XQBM' WHERE folio_type = 'Guest' AND reservation_id IN ('Z3Z8R5SC', 'LVH89VXP') AND parent_folio_id IS NULL;

    -- 7. Company + Group for GRP-3OQ9MR (Aurther) -> TA-LUCY01 (lucy)
    SELECT id INTO v_company_folio_id FROM folios WHERE owner_type = 'group_profile' AND owner_id = 'TA-LUCY01' AND status = 'Open' LIMIT 1;
    IF v_company_folio_id IS NULL THEN
        v_company_folio_id := gen_random_uuid()::text;
        INSERT INTO folios (id, folio_type, status, balance, total_charges, total_payments, currency, owner_type, owner_id, opened_at, created_by, notes)
        VALUES (v_company_folio_id, 'Company', 'Open', 0, 0, 0, 'USD', 'group_profile', 'TA-LUCY01', NOW(), v_user_id, 'Company folio for TA-LUCY01 (lucy)');
    END IF;
    SELECT id INTO v_group_folio_id FROM folios WHERE folio_type = 'Group' AND group_id = 'GRP-3OQ9MR' AND status = 'Open' LIMIT 1;
    IF v_group_folio_id IS NULL THEN
        v_group_folio_id := gen_random_uuid()::text;
        INSERT INTO folios (id, folio_type, status, balance, total_charges, total_payments, currency, group_id, parent_folio_id, opened_at, created_by, notes)
        VALUES (v_group_folio_id, 'Group', 'Open', 0, 0, 0, 'USD', 'GRP-3OQ9MR', v_company_folio_id, NOW(), v_user_id, 'Group folio for GRP-3OQ9MR (Aurther)');
    END IF;

    -- 8. Group for GRP-USSO90 (Aden) -> TA-ETT001 (ETT)
    SELECT id INTO v_company_folio_id FROM folios WHERE owner_type = 'group_profile' AND owner_id = 'TA-ETT001' AND status = 'Open' LIMIT 1;
    SELECT id INTO v_group_folio_id FROM folios WHERE folio_type = 'Group' AND group_id = 'GRP-USSO90' AND status = 'Open' LIMIT 1;
    IF v_group_folio_id IS NULL THEN
        v_group_folio_id := gen_random_uuid()::text;
        INSERT INTO folios (id, folio_type, status, balance, total_charges, total_payments, currency, group_id, parent_folio_id, opened_at, created_by, notes)
        VALUES (v_group_folio_id, 'Group', 'Open', 0, 0, 0, 'USD', 'GRP-USSO90', v_company_folio_id, NOW(), v_user_id, 'Group folio for GRP-USSO90 (Aden)');
    END IF;
END $$;
