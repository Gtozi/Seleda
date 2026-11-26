/**
 * Subdomain Detection Utility
 * Handles tenant-specific subdomains and admin subdomain in the browser
 */

import { ADMIN_SUBDOMAIN, isLocalDevHostname, parseSubdomainFromHost } from './subdomainParser';

export const BASE_DOMAIN = import.meta.env.VITE_BASE_DOMAIN || 'seledabet.com';
const IS_DEV = import.meta.env.DEV;

export interface SubdomainInfo {
  subdomain: string | null;
  isAdmin: boolean;
  tenantCode: string | null;
  isMainDomain: boolean;
}

/**
 * Get subdomain information from current URL
 */
export function getSubdomainInfo(): SubdomainInfo {
  const urlParams = new URLSearchParams(window.location.search);
  const subdomain = parseSubdomainFromHost(
    window.location.host,
    BASE_DOMAIN,
    urlParams.get('subdomain')
  );

  if (!subdomain) {
    return {
      subdomain: null,
      isAdmin: false,
      tenantCode: null,
      isMainDomain: true,
    };
  }

  const isAdmin = subdomain === ADMIN_SUBDOMAIN;
  return {
    subdomain,
    isAdmin,
    tenantCode: isAdmin ? null : subdomain,
    isMainDomain: false,
  };
}

/**
 * Check if current request is for admin subdomain
 */
export function isAdminSubdomain(): boolean {
  return getSubdomainInfo().isAdmin;
}

/**
 * Get tenant code from current subdomain
 */
export function getTenantCode(): string | null {
  return getSubdomainInfo().tenantCode;
}

/**
 * Get the appropriate base URL for API calls
 * This ensures API calls go to the correct subdomain
 */
export function getApiBaseUrl(): string {
  const info = getSubdomainInfo();

  // Development: use same origin (localhost:3000)
  if (IS_DEV || isLocalDevHostname(window.location.hostname)) {
    return window.location.origin;
  }

  if (info.isAdmin) {
    return `https://admin.${BASE_DOMAIN}`;
  }

  if (info.tenantCode) {
    return `https://${info.tenantCode}.${BASE_DOMAIN}`;
  }

  // Main domain
  return `https://${BASE_DOMAIN}`;
}

/**
 * Redirect to appropriate subdomain based on user type
 */
export function redirectToAppropriateSubdomain(user: { isSuperAdmin?: boolean; activeTenantId?: string; availableTenants?: Array<{ id: string; code: string }> }): void {
  const info = getSubdomainInfo();
  
  // If on admin subdomain but user is not super-admin, redirect to main
  if (info.isAdmin && !user.isSuperAdmin) {
    window.location.href = `https://${BASE_DOMAIN}`;
    return;
  }
  
  // If on tenant subdomain but user doesn't have access, redirect to main.
  // Super-admins bypass the membership check — the backend pins their data
  // scope to the subdomain tenant anyway.
  if (info.tenantCode && user.availableTenants) {
    const hasAccess = user.isSuperAdmin || user.availableTenants.some(t => t.code === info.tenantCode);
    if (!hasAccess) {
      window.location.href = `https://${BASE_DOMAIN}`;
      return;
    }
  }
  
  // Apex/www host holds no tenant data — send users to their tenant
  // subdomain (super-admins to the admin subdomain).
  if (info.isMainDomain) {
    if (user.isSuperAdmin) {
      window.location.href = `https://admin.${BASE_DOMAIN}`;
      return;
    }
    const tenants = user.availableTenants || [];
    const active = tenants.find(t => t.id === user.activeTenantId) || tenants[0];
    if (active?.code) {
      window.location.href = `https://${active.code}.${BASE_DOMAIN}`;
      return;
    }
  }
}
