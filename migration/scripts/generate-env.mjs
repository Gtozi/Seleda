#!/usr/bin/env node
/**
 * Generates migration/contabo/.env for the self-hosted Supabase stack.
 *
 * Usage:
 *   node migration/scripts/generate-env.mjs --api-domain supabase.example.com --app-url https://app.example.com
 *
 * --api-domain : public hostname that will front the API gateway (Envoy, port 8000)
 * --app-url    : public URL of your ERP frontend (used for Auth Site URL)
 *
 * If flags are omitted, placeholder domains are written — edit .env afterwards.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { randomBytes, createHmac } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const envPath = join(here, '..', 'contabo', '.env');
const example = readFileSync(join(here, '..', 'contabo', '.env.example'), 'utf8');

const args = process.argv.slice(2);
const arg = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};

const apiDomain = arg('api-domain') || 'supabase.YOURDOMAIN.com';
const appUrl = arg('app-url') || 'https://app.YOURDOMAIN.com';

const b64url = (buf) =>
  Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const hex = (n) => randomBytes(n).toString('hex');
const b64 = (n) => randomBytes(n).toString('base64');

const jwtSecret = b64(30);
const iat = Math.floor(Date.now() / 1000);
const exp = iat + 5 * 365 * 24 * 3600;

const signJwt = (payload) => {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64url(JSON.stringify(payload));
  const sig = createHmac('sha256', jwtSecret).update(`${header}.${body}`).digest();
  return `${header}.${body}.${b64url(sig)}`;
};

const anonKey = signJwt({ role: 'anon', iss: 'supabase', iat, exp });
const serviceRoleKey = signJwt({ role: 'service_role', iss: 'supabase', iat, exp });

const values = {
  POSTGRES_PASSWORD: hex(24),
  JWT_SECRET: jwtSecret,
  ANON_KEY: anonKey,
  SERVICE_ROLE_KEY: serviceRoleKey,
  DASHBOARD_USERNAME: 'supabase',
  DASHBOARD_PASSWORD: hex(12),
  SECRET_KEY_BASE: b64(48),
  REALTIME_DB_ENC_KEY: hex(8),
  VAULT_ENC_KEY: hex(16),
  PG_META_CRYPTO_KEY: b64(24),
  LOGFLARE_PUBLIC_ACCESS_TOKEN: b64(24),
  LOGFLARE_PRIVATE_ACCESS_TOKEN: b64(24),
  S3_PROTOCOL_ACCESS_KEY_ID: hex(16),
  S3_PROTOCOL_ACCESS_KEY_SECRET: hex(32),
  MINIO_ROOT_PASSWORD: hex(16),
  POOLER_TENANT_ID: 'selected-tenant',
  SUPABASE_PUBLIC_URL: `https://${apiDomain}`,
  API_EXTERNAL_URL: `https://${apiDomain}/auth/v1`,
  SITE_URL: appUrl,
};

let out = example;
for (const [key, value] of Object.entries(values)) {
  out = out.replace(new RegExp(`^${key}=.*$`, 'm'), `${key}=${value}`);
}

writeFileSync(envPath, out);
console.log(`Wrote ${envPath}`);
console.log(`  API URL : https://${apiDomain}`);
console.log(`  App URL : ${appUrl}`);
console.log('Edit .env if you used placeholder domains.');
