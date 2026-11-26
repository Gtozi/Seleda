/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * Secure Authentication Library
 * Implements JWT-based authentication with httpOnly cookies
 */

import { User } from '../types/erp';
import { getApiBaseUrl, getSubdomainInfo } from './subdomain';

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

export interface AuthResponse {
  success: boolean;
  user?: User;
  error?: string;
  requiresMFA?: boolean;
  forcePasswordChange?: boolean;
}

/**
 * Login with email and password
 * Stores tokens in httpOnly cookies via server endpoint
 */
export const login = async (
  email: string, 
  password: string
): Promise<AuthResponse> => {
  try {
    const apiBase = getApiBaseUrl();
    const response = await fetch(`${apiBase}/api/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      credentials: 'include', // Important: sends cookies
      body: JSON.stringify({ email, password }),
    });

    const data = await response.json();

    if (!response.ok) {
      return {
        success: false,
        error: data.error || 'Authentication failed',
      };
    }

    // Tokens are stored in httpOnly cookies by the server
    // We only store non-sensitive user data in memory
    return {
      success: true,
      user: data.user,
      requiresMFA: data.requiresMFA,
      forcePasswordChange: data.forcePasswordChange,
    };
  } catch (error) {
    console.error('Login error:', error);
    return {
      success: false,
      error: 'Network error. Please try again.',
    };
  }
};

/**
 * Logout and clear session
 */
export const logout = async (): Promise<void> => {
  try {
    const apiBase = getApiBaseUrl();
    await fetch(`${apiBase}/api/auth/logout`, {
      method: 'POST',
      credentials: 'include',
    });
  } catch (error) {
    console.error('Logout error:', error);
  }
};

/**
 * Refresh access token using refresh token
 * Called automatically when access token expires
 */
export const refreshAccessToken = async (): Promise<boolean> => {
  try {
    const apiBase = getApiBaseUrl();
    const response = await fetch(`${apiBase}/api/auth/refresh`, {
      method: 'POST',
      credentials: 'include',
    });

    if (!response.ok) {
      return false;
    }

    // New access token is set in httpOnly cookie
    return true;
  } catch (error) {
    console.error('Token refresh error:', error);
    return false;
  }
};

/**
 * Verify current session is valid
 */
export const verifySession = async (): Promise<User | null> => {
  try {
    const apiBase = getApiBaseUrl();
    const response = await fetch(`${apiBase}/api/auth/verify`, {
      method: 'GET',
      credentials: 'include',
    });

    if (!response.ok) {
      return null;
    }

    const data = await response.json();
    return data.user;
  } catch (error) {
    console.error('Session verification error:', error);
    return null;
  }
};

/**
 * Verify MFA code
 */
export const verifyMFA = async (code: string): Promise<AuthResponse> => {
  try {
    const apiBase = getApiBaseUrl();
    const response = await fetch(`${apiBase}/api/auth/verify-mfa`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      credentials: 'include',
      body: JSON.stringify({ code }),
    });

    const data = await response.json();

    if (!response.ok) {
      return {
        success: false,
        error: data.error || 'MFA verification failed',
      };
    }

    return {
      success: true,
      user: data.user,
    };
  } catch (error) {
    console.error('MFA verification error:', error);
    return {
      success: false,
      error: 'Network error. Please try again.',
    };
  }
};

/**
 * Change password
 */
export const changePassword = async (
  currentPassword: string,
  newPassword: string
): Promise<{ success: boolean; error?: string }> => {
  try {
    const apiBase = getApiBaseUrl();
    const response = await fetch(`${apiBase}/api/auth/change-password`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      credentials: 'include',
      body: JSON.stringify({ currentPassword, newPassword }),
    });

    const data = await response.json();

    if (!response.ok) {
      return {
        success: false,
        error: data.error || 'Password change failed',
      };
    }

    return { success: true };
  } catch (error) {
    console.error('Password change error:', error);
    return {
      success: false,
      error: 'Network error. Please try again.',
    };
  }
};

/**
 * Switch active tenant (super-admin only)
 */
export const switchTenant = async (tenantId: string): Promise<boolean> => {
  try {
    const apiBase = getApiBaseUrl();
    const response = await fetch(`${apiBase}/api/auth/switch-tenant`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      credentials: 'include',
      body: JSON.stringify({ tenantId }),
    });

    if (!response.ok) {
      const data = await response.json();
      throw new Error(data.error || 'Failed to switch tenant');
    }

    return true;
  } catch (error) {
    console.error('Tenant switch error:', error);
    return false;
  }
};

/**
 * Request password reset
 */
export const requestPasswordReset = async (
  email: string
): Promise<{ success: boolean; error?: string }> => {
  try {
    const apiBase = getApiBaseUrl();
    const response = await fetch(`${apiBase}/api/auth/request-reset`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ email }),
    });

    const data = await response.json();

    if (!response.ok) {
      return {
        success: false,
        error: data.error || 'Reset request failed',
      };
    }

    return { success: true };
  } catch (error) {
    console.error('Password reset request error:', error);
    return {
      success: false,
      error: 'Network error. Please try again.',
    };
  }
};

/**
 * Staff forgot-password — notifies the tenant's admins, who issue a
 * temporary password from the Admin portal.
 */
export const forgotPassword = async (
  identifier: string
): Promise<{ success: boolean; error?: string; message?: string }> => {
  try {
    const apiBase = getApiBaseUrl();
    const response = await fetch(`${apiBase}/api/auth/forgot-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier }),
    });
    const data = await response.json();
    if (!response.ok) {
      return { success: false, error: data.error || 'Request failed' };
    }
    return { success: true, message: data.message };
  } catch (error) {
    console.error('Forgot password error:', error);
    return { success: false, error: 'Network error. Please try again.' };
  }
};

/**
 * Reset password with token
 */
export const resetPassword = async (
  token: string,
  newPassword: string
): Promise<{ success: boolean; error?: string }> => {
  try {
    const apiBase = getApiBaseUrl();
    const response = await fetch(`${apiBase}/api/auth/reset-password`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ token, newPassword }),
    });

    const data = await response.json();

    if (!response.ok) {
      return {
        success: false,
        error: data.error || 'Password reset failed',
      };
    }

    return { success: true };
  } catch (error) {
    console.error('Password reset error:', error);
    return {
      success: false,
      error: 'Network error. Please try again.',
    };
  }
};
