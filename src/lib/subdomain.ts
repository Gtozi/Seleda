/**
 * Subdomain Detection Utility
 * Handles tenant-specific subdomains and admin subdomain in the browser
 */

const BASE_DOMAIN = import.meta.env.VITE_BASE_DOMAIN || 'hotel.com';
const ADMIN_SUBDOMAIN = 'admin';
const WWW_SUBDOMAIN = 'www';

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
  const hostname = window.location.hostname;
  const host = window.location.host;
  
  // For localhost development
  if (hostname.includes('localhost') || hostname.includes('127.0.0.1')) {
    // Check for subdomain in URL params or path
    const urlParams = new URLSearchParams(window.location.search);
    const subdomainParam = urlParams.get('subdomain');
    
    if (subdomainParam) {
      return {
        subdomain: subdomainParam,
        isAdmin: subdomainParam === ADMIN_SUBDOMAIN,
        tenantCode: subdomainParam === ADMIN_SUBDOMAIN ? null : subdomainParam,
        isMainDomain: false,
      };
    }
    
    // Check for subdomain in host like tenant1.localhost:3000
    const parts = host.split('.');
    if (parts.length > 1 && parts[0] !== 'localhost') {
      const subdomain = parts[0];
      return {
        subdomain,
        isAdmin: subdomain === ADMIN_SUBDOMAIN,
        tenantCode: subdomain === ADMIN_SUBDOMAIN ? null : subdomain,
        isMainDomain: false,
      };
    }
    
    return {
      subdomain: null,
      isAdmin: false,
      tenantCode: null,
      isMainDomain: true,
    };
  }
  
  // Production: extract subdomain from hostname
  const parts = hostname.split('.');
  
  // Check if it's a subdomain of our base domain
  if (parts.length >= 3 && parts[parts.length - 2] === BASE_DOMAIN.split('.')[0]) {
    const subdomain = parts[0];
    
    // Ignore www subdomain
    if (subdomain === WWW_SUBDOMAIN) {
      return {
        subdomain: null,
        isAdmin: false,
        tenantCode: null,
        isMainDomain: true,
      };
    }
    
    return {
      subdomain,
      isAdmin: subdomain === ADMIN_SUBDOMAIN,
      tenantCode: subdomain === ADMIN_SUBDOMAIN ? null : subdomain,
      isMainDomain: false,
    };
  }
  
  // Main domain or unknown domain
  return {
    subdomain: null,
    isAdmin: false,
    tenantCode: null,
    isMainDomain: true,
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
  
  // If on tenant subdomain but user doesn't have access, redirect to main
  if (info.tenantCode && user.availableTenants) {
    const hasAccess = user.availableTenants.some(t => t.code === info.tenantCode);
    if (!hasAccess) {
      window.location.href = `https://${BASE_DOMAIN}`;
      return;
    }
  }
  
  // If on main domain and user is super-admin, optionally redirect to admin
  // (This is optional - super-admins can choose to stay on main domain)
  if (info.isMainDomain && user.isSuperAdmin) {
    // Don't auto-redirect - let user choose
    // window.location.href = `https://admin.${BASE_DOMAIN}`;
  }
}
