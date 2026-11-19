/**
 * Vercel Serverless Function Entry Point
 * Simple Express app wrapper for Vercel deployment
 */

import express from 'express';
import './src/server/env';
import apiRouter from '../src/server/routes/index';
import {
  IS_FALLBACK_MODE,
  ensureAuditEventsTable,
  ensurePendingAdminChangesTable,
} from '../src/server/services/sessionService';

if (typeof globalThis.DOMException === 'undefined') {
  // @ts-ignore
  import('node-domexception').then((mod) => {
    globalThis.DOMException = mod.default;
  }).catch(() => {});
}

const app = express();

// Initialize tables (only on cold start)
let initialized = false;
async function initializeTables() {
  if (initialized) return;
  await ensurePendingAdminChangesTable();
  await ensureAuditEventsTable();
  initialized = true;
}

// Production guard
if (process.env.NODE_ENV === 'production' && (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY)) {
  console.error('[FATAL] SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required in production.');
}

app.use(express.json());

app.get('/api/health', (_req, res) => {
  res.json({
    status: 'operational',
    system: 'Hotel Management ERP Global Node',
    authStore: IS_FALLBACK_MODE ? 'development-fallback' : 'database',
    timestamp: new Date().toISOString(),
  });
});

// API router
app.use('/api', apiRouter);

// Export for Vercel - the app itself is the handler
export default app;
