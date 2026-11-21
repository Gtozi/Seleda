/**
 * Subdomain Detection & Routing Middleware
 * Handles tenant-specific subdomains and admin subdomain
 */

import { Request, Response, NextFunction } from 'express';

// Configuration
const BASE_DOMAIN = process.env.BASE_DOMAIN || 'hotel.com'; // e.g., 'hotel.com'
const ADMIN_SUBDOMAIN = 'admin';
const WWW_SUBDOMAIN = 'www';

/**
 * Extract subdomain from request
 * Supports: admin.hotel.com, tenant1.hotel.com, localhost:3000 (dev)
 */
export function getSubdomain(req: Request): string | null {
  const host = req.headers.host || req.hostname || '';
  
  // For localhost development, check for subdomain in host header
  if (host.includes('localhost') || host.includes('127.0.0.1')) {
    // In dev, you can use ?subdomain=tenant1 or headers
    const subdomainParam = req.query.subdomain as string;
    if (subdomainParam) return subdomainParam;
    
    // Or check for subdomain in host like tenant1.localhost:3000
    const parts = host.split('.');
    if (parts.length > 1 && parts[0] !== 'localhost') {
      return parts[0];
    }
    return null;
  }
  
  // Production: extract subdomain from hostname
  const hostname = host.split(':')[0]; // Remove port
  const parts = hostname.split('.');
  
  // Check if it's a subdomain of our base domain
  if (parts.length >= 3 && parts[parts.length - 2] === BASE_DOMAIN.split('.')[0]) {
    const subdomain = parts[0];
    
    // Ignore www subdomain
    if (subdomain === WWW_SUBDOMAIN) return null;
    
    return subdomain;
  }
  
  return null;
}

/**
 * Check if request is for admin subdomain
 */
export function isAdminSubdomain(req: Request): boolean {
  const subdomain = getSubdomain(req);
  return subdomain === ADMIN_SUBDOMAIN;
}

/**
 * Get tenant code from subdomain
 * e.g., tenant1.hotel.com -> 'tenant1'
 */
export function getTenantCodeFromSubdomain(req: Request): string | null {
  const subdomain = getSubdomain(req);
  if (!subdomain || subdomain === ADMIN_SUBDOMAIN) return null;
  return subdomain;
}

/**
 * Middleware to set tenant context based on subdomain
 */
export function tenantSubdomainMiddleware(req: Request, res: Response, next: NextFunction) {
  const subdomain = getSubdomain(req);
  const isAdmin = isAdminSubdomain(req);
  const tenantCode = getTenantCodeFromSubdomain(req);
  
  // Attach subdomain info to request
  (req as any).subdomain = subdomain;
  (req as any).isAdminSubdomain = isAdmin;
  (req as any).tenantCode = tenantCode;
  
  // For admin subdomain, ensure user has super-admin access
  if (isAdmin && req.user && !req.user.isSuperAdmin) {
    return res.status(403).json({ error: 'Admin access requires super-admin privileges' });
  }
  
  next();
}

/**
 * Middleware to validate tenant access based on subdomain
 */
export function validateTenantAccess(req: Request, res: Response, next: NextFunction) {
  const tenantCode = getTenantCodeFromSubdomain(req);
  
  if (!tenantCode) {
    // No tenant subdomain - allow access to main app
    return next();
  }
  
  // TODO: Validate that the tenant exists and user has access
  // This would require a database lookup to verify tenant_code exists
  
  next();
}
