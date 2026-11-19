-- ============================================================================
-- Migration: 570_channel_seed_test_mode.sql
-- ----------------------------------------------------------------------------
-- Seed OTA channels carry placeholder credentials (e.g. 'placeholder_api_key')
-- against real supplier base URLs. They are demo integrations, not live OTA
-- connections. Mark them test_mode so the channel sync layer routes them
-- through the simulated adapter instead of making real HTTP calls with fake
-- credentials, and correct their previously optimistic last_sync_status so
-- the UI stops reporting 'success' for syncs that never contacted a supplier.
-- ============================================================================

UPDATE channel_connections
SET test_mode = true,
    last_sync_status = 'simulated',
    last_sync_error = NULL,
    updated_at = NOW()
WHERE credentials::text LIKE '%placeholder%'
   OR api_endpoint LIKE '%placeholder%'
   OR api_endpoint LIKE '%example.com%';
