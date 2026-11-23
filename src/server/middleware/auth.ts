/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * Authentication and Authorization Middleware
 * Centralized authentication logic to eliminate duplication across API endpoints
 */

import { Request, Response, NextFunction } from 'express';
import type { User } from '../../types/erp';
import { userCan, PermissionContext, setAuditContext, setSessionContext, clearAuditContext } from '../authHelpers';
import { getRequestUser, parseCookies, hashToken, SESSION_COOKIE } from '../services/sessionService';

// Extend Express Request type to include user
declare global {
  namespace Express {
    interface Request {
      user?: User;
    }
  }
}

/**
 * Authentication middleware - validates session and attaches user to request
 * Use this for any endpoint that requires authentication
 */
/**
 * When the request arrived on a tenant subdomain (<code>.seledabet.com), the
 * subdomain is the tenant context: verify the user belongs to that tenant
 * (super-admins bypass) and pin activeTenantId for this request so settings,
 * toggles, and tenant-scoped queries resolve consistently.
 */
const applyTenantSubdomainContext = (req: Request, res: Response): boolean => {
  const tenant = req.tenant;
  if (!tenant || !req.user) return true;

  const hasAccess = req.user.isSuperAdmin ||
    (req.user.availableTenants || []).some(t => t.id === tenant.id || t.code === tenant.code);
  if (!hasAccess) {
    res.status(403).json({ error: 'No access to this tenant' });
    return false;
  }

  req.user.activeTenantId = tenant.id;
  return true;
};

export const authenticate = async (req: Request, res: Response, next: NextFunction) => {
  try {
    // Skip the session lookup when an upstream middleware already resolved
    // the user (e.g. router-level authenticate on portal routers).
    if (req.user) {
      if (!applyTenantSubdomainContext(req, res)) return;
      // Set session context for RLS even if user was already set
      const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
      if (token) {
        await setSessionContext(hashToken(token));
      }
      return next();
    }
    const user = await getRequestUser(req);
    if (!user) {
      await clearAuditContext();
      return res.status(401).json({ error: 'Not authenticated' });
    }
    req.user = user;
    if (!applyTenantSubdomainContext(req, res)) return;
    // Set audit context for DB triggers (Step 3.3)
    await setAuditContext(user.id);
    // Set session context for RLS policies
    const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
    if (token) {
      await setSessionContext(hashToken(token));
    }
    next();
  } catch (error) {
    console.error('Authentication middleware error:', error);
    await clearAuditContext();
    return res.status(401).json({ error: 'Not authenticated' });
  }
};

/**
 * Permission-based authorization middleware
 * Use this for endpoints that require specific permissions
 * @param action - The permission action to check (e.g., 'reservation:check_in')
 * @param context - Optional context for granular RBAC (module, department, record-owner, field)
 */
export const requirePermission = (action: string, context?: PermissionContext) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.user) {
        return res.status(401).json({ error: 'Not authenticated' });
      }

      const allowed = await userCan(req.user, action, context);
      if (!allowed) {
        return res.status(403).json({ 
          error: 'Insufficient privileges',
          required: action 
        });
      }

      next();
    } catch (error) {
      console.error('Authorization middleware error:', error);
      return res.status(500).json({ error: 'Authorization error' });
    }
  };
};

/**
 * Role-based authorization middleware
 * Use this for endpoints restricted to specific roles
 * @param roles - Array of allowed roles
 */
export const requireRole = (...roles: string[]) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.user) {
        return res.status(401).json({ error: 'Not authenticated' });
      }

      if (!roles.includes(req.user.role)) {
        return res.status(403).json({ 
          error: 'Insufficient privileges',
          required: roles,
          current: req.user.role
        });
      }

      next();
    } catch (error) {
      console.error('Role authorization middleware error:', error);
      return res.status(500).json({ error: 'Authorization error' });
    }
  };
};

/**
 * Active account status middleware
 * Ensures user account is active and not locked/pending
 */
export const requireActiveAccount = async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const inactiveStatuses = ['Inactive', 'Pending', 'Suspended', 'Locked'];
    if (inactiveStatuses.includes(req.user.status)) {
      return res.status(403).json({ 
        error: `Account is ${req.user.status}`,
        status: req.user.status
      });
    }

    next();
  } catch (error) {
    console.error('Account status middleware error:', error);
    return res.status(500).json({ error: 'Authorization error' });
  }
};

/**
 * Combined authentication and authorization middleware
 * Convenience function that chains authenticate + requirePermission
 */
export const authenticateWithPermission = (action: string) => {
  return [authenticate, requirePermission(action)];
};

/**
 * Combined authentication and role check middleware
 * Convenience function that chains authenticate + requireRole
 */
export const authenticateWithRole = (...roles: string[]) => {
  return [authenticate, requireRole(...roles)];
};
