/**
 * Apply migration 341: eng_compliance (eng_compliance_items table + seed)
 * Run: npx tsx supabase/run-migration-341.ts
 */
import dotenv from 'dotenv';
dotenv.config();
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

if (!url || !key) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars.');
  process.exit(1);
}

const sqlPath = path.join(__dirname, 'migrations', '341_eng_compliance.sql');
const sql = fs.readFileSync(sqlPath, 'utf-8');

async function main() {
  console.log('Applying migration 341: eng_compliance');
  const res = await fetch(`${url}/rest/v1/rpc/exec_sql`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: key,
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({ query: sql }),
  });

  const text = await res.text();
  if (!res.ok) {
    console.error(`exec_sql failed: ${res.status} ${text}`);
    process.exit(1);
  }
  console.log('  ✓ Migration 341 applied successfully.');
  console.log(`  Response: ${text.substring(0, 200)}`);
}

main().catch((err) => {
  console.error('Migration failed:', err.message);
  process.exit(1);
});
