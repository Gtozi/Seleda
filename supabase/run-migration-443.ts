/**
 * Apply migration 443: Sales Portal Gap Fixes
 * Run: npx tsx supabase/run-migration-443.ts
 */
import dotenv from 'dotenv';
dotenv.config();
import { readFileSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const url = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').replace(/\/$/, '');
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

if (!url || !key) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars.');
  process.exit(1);
}

const sql = readFileSync(join(__dirname, 'migrations/443_sales_portal_gap_fixes.sql'), 'utf8');

function splitStatements(sqlText: string): string[] {
  const statements: string[] = [];
  let current = '';
  let state: 'default' | 'dollar' | 'single' | 'comment' | 'block_comment' = 'default';
  let dollarTag = '';
  let i = 0;

  while (i < sqlText.length) {
    const ch = sqlText[i];
    const next = sqlText[i + 1];

    if (state === 'default') {
      if (ch === '-' && next === '-') {
        state = 'comment';
        i++; // skip both dashes
        continue;
      } else if (ch === '/' && next === '*') {
        state = 'block_comment';
        i++; // skip '/'
        continue;
      } else if (ch === "'") {
        state = 'single';
        current += ch;
      } else if (ch === '$') {
        // Look for dollar quote tag: $...$
        const rest = sqlText.slice(i + 1);
        const m = rest.match(/^(\w*)\$/);
        if (m) {
          dollarTag = m[1] || '';
          state = 'dollar';
          current += '$' + dollarTag + '$';
          i += 1 + dollarTag.length + 1;
          continue;
        } else {
          current += ch;
        }
      } else if (ch === ';') {
        current = current.trim();
        if (current) statements.push(current);
        current = '';
      } else {
        current += ch;
      }
    } else if (state === 'single') {
      current += ch;
      if (ch === "'" && next === "'") {
        current += next;
        i++;
      } else if (ch === "'") {
        state = 'default';
      }
    } else if (state === 'dollar') {
      const closeTag = '$' + dollarTag + '$';
      if (sqlText.slice(i, i + closeTag.length) === closeTag) {
        current += closeTag;
        i += closeTag.length - 1;
        state = 'default';
      } else {
        current += ch;
      }
    } else if (state === 'comment') {
      if (ch === '\n') {
        state = 'default';
      }
      // discard comment characters
    } else if (state === 'block_comment') {
      if (ch === '*' && next === '/') {
        state = 'default';
        i++; // skip '/'
      }
      // discard block comment characters
    }

    i++;
  }

  current = current.trim();
  if (current) statements.push(current);

  return statements
    .map(s => s.trim())
    .filter(s => s.length > 0 && !s.startsWith('--'));
}

async function rpc(functionName: string, body: any) {
  const response = await fetch(`${url}/rest/v1/rpc/${functionName}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': key,
      'Authorization': `Bearer ${key}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`RPC ${functionName} failed: ${text}`);
  }

  const contentLength = response.headers.get('content-length');
  if (!contentLength || contentLength === '0') {
    return null;
  }

  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    return response.json();
  }

  return response.text();
}

async function applyMigration() {
  try {
    console.log('Applying migration 443 (Sales Portal Gap Fixes)...');

    const statements = splitStatements(sql);
    console.log(`Split migration into ${statements.length} statements`);

    for (let idx = 0; idx < statements.length; idx++) {
      const stmt = statements[idx];
      if (!stmt.trim() || stmt.startsWith('--')) {
        console.log(`[${idx + 1}/${statements.length}] skipping comment/empty`);
        continue;
      }

      console.log(`[${idx + 1}/${statements.length}] ${stmt.slice(0, 60).replace(/\s+/g, ' ')}...`);
      await rpc('exec_sql', { query: stmt });
    }

    console.log('✓ Migration 443 applied successfully');
  } catch (err) {
    console.error('Error applying migration:', err);
    process.exitCode = 1;
  } finally {
    try {
      await rpc('exec_sql', { query: 'DROP FUNCTION IF EXISTS public.exec_sql(text);' });
      console.log('Cleaned up temporary exec_sql function');
    } catch (e) {
      console.error('Warning: could not drop exec_sql function:', e);
    }
  }
}

applyMigration();
