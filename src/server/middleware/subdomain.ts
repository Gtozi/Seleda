/**
 * Subdomain Detection & Routing Middleware
 * Handles tenant-specific subdomains and admin subdomain
 */

import { Request, Response, NextFunction } from 'express';
import { ADMIN_SUBDOMAIN, parseSubdomainFromHost } from '../../lib/subdomainParser';

// Configuration
export const BASE_DOMAIN = process.env.BASE_DOMAIN || 'seledabet.com'; // e.g., 'seledabet.com'

/**
 * Extract subdomain from request
 * Supports: admin.seledabet.com, tenant1.seledabet.com, localhost:3000 (dev)
 */
export function getSubdomain(req: Request): string | null {
  const host = String(req.headers.host || req.hostname || '');
  const querySubdomain = typeof req.query.subdomain === 'string' ? req.query.subdomain : null;
  return parseSubdomainFromHost(host, BASE_DOMAIN, querySubdomain);
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
export function tenantSubdomainMiddleware(req: Request, _res: Response, next: NextFunction) {
  const subdomain = getSubdomain(req);
  const isAdmin = isAdminSubdomain(req);
  const tenantCode = getTenantCodeFromSubdomain(req);

  // Attach subdomain info to request
  (req as any).subdomain = subdomain;
  (req as any).isAdminSubdomain = isAdmin;
  (req as any).tenantCode = tenantCode;

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
