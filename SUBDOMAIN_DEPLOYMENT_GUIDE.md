# Multi-Tenant Subdomain Configuration

## Environment Variables

Add these to your `.env` file:

```env
# Base domain for multi-tenant subdomains
# For production: yourdomain.com
# For development: localhost (with subdomain simulation)
VITE_BASE_DOMAIN=hotel.com

# Admin subdomain (default: admin)
# ADMIN_SUBDOMAIN=admin

# Backend configuration
BASE_DOMAIN=hotel.com
NODE_ENV=production
```

## DNS Configuration

### 1. Wildcard DNS Record
Configure a wildcard DNS record for your domain:

```
*.hotel.com → Your server IP
hotel.com → Your server IP
admin.hotel.com → Your server IP (optional, covered by wildcard)
```

### 2. SSL Certificate
You need a wildcard SSL certificate for `*.hotel.com`:

**Option A: Let's Encrypt (Free)**
```bash
# Using certbot with DNS challenge
certbot certonly --manual --preferred-challenges dns -d *.hotel.com -d hotel.com
```

**Option B: Cloudflare (Recommended)**
- Enable Cloudflare proxy
- SSL/TLS → Full (strict)
- Page Rules for subdomain routing

### 3. Vercel/Netlify Configuration

**Vercel** (`vercel.json`):
```json
{
  "rewrites": [
    {
      "source": "/(.*)",
      "destination": "/index.html"
    }
  ],
  "headers": [
    {
      "source": "/(.*)",
      "headers": [
        {
          "key": "Access-Control-Allow-Origin",
          "value": "*"
        }
      ]
    }
  ]
}
```

## Development Setup

### Local Development with Subdomains

**Option 1: Subdomain Simulation**
Use query parameters or headers to simulate subdomains:

```bash
# Admin subdomain simulation
http://localhost:3000/?subdomain=admin

# Tenant subdomain simulation  
http://localhost:3000/?subdomain=tenant1
```

**Option 2: Local DNS (Advanced)**
Add to your hosts file (`/etc/hosts` or `C:\Windows\System32\drivers\etc\hosts`):

```
127.0.0.1 admin.localhost
127.0.0.1 tenant1.localhost
127.0.0.1 tenant2.localhost
```

Then access:
- `http://admin.localhost:3000` → Admin portal
- `http://tenant1.localhost:3000` → Tenant 1
- `http://tenant2.localhost:3000` → Tenant 2

## Production Deployment

### 1. Database Setup
Ensure tenants table has `code` column for subdomain mapping:

```sql
-- Add subdomain-friendly code to tenants
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS subdomain_code TEXT UNIQUE;

-- Update existing tenants
UPDATE tenants SET subdomain_code = LOWER(REPLACE(code, ' ', '-')) WHERE subdomain_code IS NULL;
```

### 2. User Assignment
Assign users to tenants with subdomain codes:

```sql
-- Create tenant with subdomain
INSERT INTO tenants (name, code, subdomain_code, status)
VALUES ('Hotel Chain A', 'HCA', 'hotel-a', 'Active');

-- Assign user to tenant
INSERT INTO tenant_user_assignments (user_id, tenant_id, is_default, is_super_admin)
VALUES ('user-uuid', 'tenant-uuid', true, false);
```

### 3. Session Management
Sessions are automatically scoped to subdomains via cookies:

- `admin.hotel.com` → Admin sessions
- `tenant1.hotel.com` → Tenant 1 sessions
- `hotel.com` → Main domain sessions

## Testing Subdomain Routing

### Test Cases

1. **Admin Subdomain**
   - Visit `admin.hotel.com`
   - Should see Super Admin Portal
   - Non-super-admins should be redirected

2. **Tenant Subdomain**
   - Visit `tenant1.hotel.com`
   - Should see tenant-specific interface
   - Users without access should be redirected

3. **Main Domain**
   - Visit `hotel.com`
   - Should show main interface
   - Super-admins can access `/admin` route

### API Testing

```bash
# Test admin subdomain
curl -H "Host: admin.hotel.com" http://localhost:3000/api/health

# Test tenant subdomain
curl -H "Host: tenant1.hotel.com" http://localhost:3000/api/health

# Test main domain
curl -H "Host: hotel.com" http://localhost:3000/api/health
```

## Troubleshooting

### Common Issues

1. **Subdomain not detected**
   - Check `BASE_DOMAIN` environment variable
   - Verify DNS wildcard record
   - Check SSL certificate covers wildcard

2. **API calls failing**
   - Ensure CORS is configured for subdomains
   - Check session cookies are domain-scoped correctly
   - Verify `credentials: 'include'` in fetch calls

3. **User access issues**
   - Verify `tenant_user_assignments` table
   - Check `is_super_admin` flag for admin access
   - Ensure tenant `subdomain_code` matches subdomain

## Security Considerations

1. **Subdomain Isolation**
   - Each subdomain has separate session cookies
   - Users can only access tenants they're assigned to
   - Admin subdomain requires super-admin privileges

2. **SSL/TLS**
   - Use wildcard SSL certificate
   - Enable HSTS headers
   - Consider certificate pinning for admin subdomain

3. **Rate Limiting**
   - Apply rate limits per subdomain
   - Monitor for abuse across tenants

## Monitoring

Track subdomain usage:

```sql
-- Monitor tenant access
SELECT 
  t.name,
  t.subdomain_code,
  COUNT(DISTINCT tua.user_id) as user_count,
  COUNT(DISTINCT us.id) as session_count
FROM tenants t
LEFT JOIN tenant_user_assignments tua ON t.id = tua.tenant_id
LEFT JOIN user_sessions us ON tua.user_id = us.user_id
GROUP BY t.id, t.name, t.subdomain_code;
```
