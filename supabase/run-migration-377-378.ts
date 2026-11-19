/**
 * Apply migrations 377 + 378:
 *   377 — Department Store Hierarchy Fix (parent_store_id + store_type)
 *   378 — issue_stock_to_department RPC: department-column fallback
 *
 * Run: npx tsx supabase/run-migration-377-378.ts
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

const migrations = [
  { num: '377', file: '377_uinv_dept_store_hierarchy_fix.sql', desc: 'Department store hierarchy fix (parent_store_id + store_type)' },
  { num: '378', file: '378_issue_stock_rpc_dept_fallback.sql', desc: 'issue_stock_to_department RPC dept-column fallback' },
];

async function main() {
  for (const mig of migrations) {
    const sqlPath = path.join(__dirname, 'migrations', mig.file);
    if (!fs.existsSync(sqlPath)) {
      console.error(`Migration file not found: ${sqlPath}`);
      process.exit(1);
    }
    const sql = fs.readFileSync(sqlPath, 'utf-8');

    console.log(`Applying migration ${mig.num}: ${mig.desc}`);
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
      console.error(`exec_sql failed for migration ${mig.num}: ${res.status} ${text}`);
      process.exit(1);
    }
    console.log(`  ✓ Migration ${mig.num} applied successfully.`);
    console.log(`  Response: ${text.substring(0, 200)}`);
  }
  console.log('\nAll migrations applied.');
}

main().catch((err) => {
  console.error('Migration failed:', err.message);
  process.exit(1);
});
