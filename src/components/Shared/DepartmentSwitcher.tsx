/**
 * DepartmentSwitcher — UI to change the active ERP department.
 *
 * Phase 4 of the route-driven migration (see ROUTE_DRIVEN_MIGRATION_PLAN.md).
 *
 * Renders a dropdown in the global header that lists departments the current
 * user has access to. On select, calls `navigate('/erp/:urlSegment')`.
 *
 * This fills a pre-existing UX gap: before the route-driven migration, there
 * was NO in-app UI to change departments — users were locked into the
 * department chosen at login.
 */

import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronDown, Building2 } from 'lucide-react';
import { DEPARTMENTS, type DepartmentConfig, type DepartmentKey, getDeptAccentColorVar } from '../../config/departments';
import { getTabsForDepartment } from '../../config/departmentTabs';
import { getVisibleAdminModules } from '../Admin/adminModules';
import { canViewExecutivePortal } from '../../lib/permissions';
import type { User } from '../../types/erp';

export interface DepartmentSwitcherProps {
  currentUser: User | null;
  /** Current department url segment (highlights the active option). */
  activeSegment?: string;
  /** moduleToggles map from App.tsx (keyed by department toggle key). */
  moduleToggles?: Record<string, boolean>;
  /** hasModuleAccess(modId) — the same predicate used by `subNavItems`. */
  hasModuleAccess?: (modId: string) => boolean;
}

/**
 * Compute the list of departments a user can switch to.
 * Mirrors the filtering logic from `subNavItems` in App.tsx.
 */
export function getSwitchableDepartments(
  currentUser: User | null,
  moduleToggles: Record<string, boolean>,
  hasModuleAccess: (modId: string) => boolean,
): DepartmentConfig[] {
  return DEPARTMENTS.filter((d) => {
    // Settings is not a switchable department — it's accessed via the gear icon
    if (d.key === 'settings') return false;

    // admin bypasses the module-toggle check (mirrors App.tsx isModuleDisabled)
    if (d.key !== 'admin') {
      if (moduleToggles[d.key] === false) return false;
    }

    // User must have access to at least one tab in the department
    if (!currentUser) return false;

    // The Executive portal is gated by exec:view — moduleAccess alone is not a
    // reliable signal (an empty moduleAccess map means "unrestricted" for
    // legacy reasons, which would expose the dept to every role).
    if (d.key === 'executive' && !canViewExecutivePortal(currentUser)) return false;

    // For admin: at least one module must be toggle-visible AND accessible
    // to this user (moduleAccess), otherwise the dept would render tabs the
    // user cannot actually open.
    if (d.key === 'admin') {
      return getVisibleAdminModules(moduleToggles).some((m) => hasModuleAccess(m.id));
    }

    // For other departments: check if any tab's modId is accessible
    const tabs = getTabsForDepartment(d.key);
    if (tabs.length === 0) return true; // No tabs = always accessible (e.g. banquet-events)
    return tabs.some(t => !t.modId || hasModuleAccess(t.modId));
  });
}

export function DepartmentSwitcher({
  currentUser,
  activeSegment,
  moduleToggles = {},
  hasModuleAccess = () => true,
}: DepartmentSwitcherProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  // Close dropdown when clicking outside
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const switchable = getSwitchableDepartments(currentUser, moduleToggles, hasModuleAccess);
  const activeDept = switchable.find(d => d.urlSegment === activeSegment);
  const activeLabel = activeDept?.label ?? 'Departments';
  const activeColorVar = activeDept ? getDeptAccentColorVar(activeDept.key as DepartmentKey) : 'var(--color-accent-operations)';

  const handleSelect = (dept: DepartmentConfig) => {
    navigate(`/erp/${dept.urlSegment}`);
    setOpen(false);
  };

  if (switchable.length <= 1) return null;

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 px-2.5 py-1.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-[11px] font-sans font-semibold text-slate-700 dark:text-slate-200 cursor-pointer hover:border-slate-400 transition-colors focus:outline-none focus:ring-2 focus:ring-slate-400/30"
        title="Switch department"
        style={activeDept ? { borderColor: activeColorVar } : undefined}
      >
        <span
          className="w-2.5 h-2.5 rounded-full shrink-0"
          style={{ backgroundColor: activeColorVar }}
          aria-hidden
        />
        <span className="max-w-[100px] truncate">{activeLabel}</span>
        <ChevronDown size={12} className={`text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 min-w-[200px] max-h-[300px] overflow-y-auto bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-xl z-[60] py-1">
          {switchable.map((dept) => {
            const isActive = dept.urlSegment === activeSegment;
            const colorVar = getDeptAccentColorVar(dept.key as DepartmentKey);
            return (
              <button
                key={dept.key}
                onClick={() => handleSelect(dept)}
                className={`w-full text-left px-3 py-2 text-[11px] font-sans font-medium transition-colors flex items-center gap-2 ${
                  isActive
                    ? 'text-slate-900 dark:text-white'
                    : 'text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700/50'
                }`}
                style={isActive ? { backgroundColor: `color-mix(in srgb, ${colorVar} 12%, transparent)` } : undefined}
              >
                <span
                  className="w-2.5 h-2.5 rounded-full shrink-0"
                  style={{ backgroundColor: colorVar }}
                  aria-hidden
                />
                <span className="truncate flex-1">{dept.label}</span>
                {isActive && (
                  <span
                    className="w-1.5 h-1.5 rounded-full shrink-0"
                    style={{ backgroundColor: colorVar }}
                    aria-hidden
                  />
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default DepartmentSwitcher;
