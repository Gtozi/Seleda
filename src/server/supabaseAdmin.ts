import { createClient } from '@supabase/supabase-js';

// Server-only module — never bundled for the browser, so read env vars
// from process.env directly (avoids import.meta warnings in cjs builds).
const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

export const hasSupabaseAdminConfig = Boolean(supabaseUrl && serviceRoleKey);

export const supabaseAdmin = hasSupabaseAdminConfig
  ? createClient(supabaseUrl, serviceRoleKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
      db: {
        schema: 'public',
      },
      global: {
        headers: { 'x-connection-pool': 'true' },
      },
      // Connection pooling: Supabase handles pooling server-side via PgBouncer,
      // but we configure the client to reuse connections efficiently.
      realtime: {
        params: {
          eventsPerSecond: 5,
        },
      },
    })
  : null;
