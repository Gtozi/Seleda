/**
 * Tenant Switcher Component
 * Allows super-admins to switch between tenants
 */

import React, { useState } from 'react';
import { Building2, ChevronDown, Check } from 'lucide-react';
import { User, Tenant } from '../../types/erp';
import { switchTenant } from '../../lib/auth';

interface TenantSwitcherProps {
  currentUser: User;
  onTenantChange?: (tenantId: string) => void;
}

export const TenantSwitcher: React.FC<TenantSwitcherProps> = ({ currentUser, onTenantChange }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [switching, setSwitching] = useState(false);

  // Only show for users with multiple tenants or super-admin
  if (!currentUser.isSuperAdmin || !currentUser.availableTenants || currentUser.availableTenants.length <= 1) {
    return null;
  }

  const handleTenantSwitch = async (tenantId: string) => {
    if (tenantId === currentUser.activeTenantId || switching) return;

    setSwitching(true);
    try {
      const success = await switchTenant(tenantId);
      if (success) {
        onTenantChange?.(tenantId);
        setIsOpen(false);
        // Reload page to refresh all data with new tenant context
        window.location.reload();
      }
    } catch (error) {
      console.error('Failed to switch tenant:', error);
      alert('Failed to switch tenant. Please try again.');
    } finally {
      setSwitching(false);
    }
  };

  const currentTenant = currentUser.availableTenants.find(t => t.id === currentUser.activeTenantId);

  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        disabled={switching}
        className="flex items-center gap-2 px-3 py-1.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-[11px] font-sans font-semibold text-slate-700 dark:text-slate-200 hover:border-indigo-400 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <Building2 size={12} />
        <span className="hidden sm:inline">{currentTenant?.name || 'Select Tenant'}</span>
        <ChevronDown size={10} className={`transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 z-40"
            onClick={() => setIsOpen(false)}
          />

          {/* Dropdown */}
          <div className="absolute top-full right-0 mt-1 w-64 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg shadow-xl z-50 overflow-hidden">
            <div className="px-4 py-2 border-b border-slate-100 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/50">
              <span className="text-[10px] font-mono uppercase tracking-wider text-slate-500 dark:text-slate-400">
                Switch Tenant
              </span>
            </div>

            <div className="max-h-64 overflow-y-auto">
              {currentUser.availableTenants.map((tenant) => (
                <button
                  key={tenant.id}
                  onClick={() => handleTenantSwitch(tenant.id)}
                  disabled={switching || tenant.id === currentUser.activeTenantId}
                  className={`w-full flex items-center justify-between px-4 py-2.5 text-left text-sm hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                    tenant.id === currentUser.activeTenantId ? 'bg-indigo-50 dark:bg-indigo-950/30' : ''
                  }`}
                >
                  <div className="flex flex-col">
                    <span className="font-medium text-slate-900 dark:text-white">
                      {tenant.name}
                    </span>
                    <span className="text-xs text-slate-500 dark:text-slate-400">
                      {tenant.code}
                    </span>
                  </div>
                  {tenant.id === currentUser.activeTenantId && (
                    <Check size={14} className="text-indigo-600 dark:text-indigo-400" />
                  )}
                </button>
              ))}
            </div>

            {switching && (
              <div className="px-4 py-2 border-t border-slate-100 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/50">
                <span className="text-xs text-slate-500 dark:text-slate-400">
                  Switching tenant...
                </span>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
};
