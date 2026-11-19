/**
 * DepartmentRoute — per-department route wrapper for `/erp/:department/:tab`.
 *
 * Phase 3 of the route-driven migration (see ROUTE_DRIVEN_MIGRATION_PLAN.md).
 *
 * Responsibilities:
 *   1. Read `:department` and `:tab` from `useParams`.
 *   2. Resolve the department via `DEPARTMENT_BY_SEGMENT`.
 *   3. Check `moduleToggles` — if the department is disabled, render the
 *      "Module Unavailable" screen (mirrors App.tsx `isModuleDisabled`).
 *   4. Check `hasModuleAccess(modId)` for the requested tab — if denied,
 *      redirect to the first accessible tab of the department.
 *   5. Render the portal component with `activeTab`/`activeModule` derived
 *      from the URL, and `onTabChange` wired to `navigate`.
 *
 * Replaces:
 *   - The giant conditional render block in App.tsx (lines ~1338-1429)
 *   - The access-control `useEffect` at App.tsx:647-672
 *   - The admin module-toggle `useEffect` at App.tsx:679-687
 */

import React from 'react';
import { useParams, useNavigate, Navigate } from 'react-router-dom';
import { Lock } from 'lucide-react';
import {
  DEPARTMENT_BY_SEGMENT,
  type DepartmentConfig,
} from '../../config/departments';
import { getTabsForDepartment, isTabEnabledByToggles, type TabConfig } from '../../config/departmentTabs';
import { getVisibleAdminModules, adminModuleAliases } from '../Admin/adminModules';import { canViewExecutivePortal } from '../../lib/permissions';
import type { User } from '../../types/erp';

// ── Props interface ───────────────────────────────────────────────────────

export interface DepartmentRouteProps {
  currentUser: User | null;
  moduleToggles: Record<string, boolean>;
  hasModuleAccess: (modId: string) => boolean;
}

// ── Portal prop-name map ──────────────────────────────────────────────────
// Some portals use `activeModule` instead of `activeTab`.
const ACTIVE_MODULE_DEPTS: ReadonlySet<string> = new Set(['finance', 'hr', 'admin', 'procurement', 'revenue']);

// Portals that need `currentUser` passed.
const NEEDS_CURRENT_USER: ReadonlySet<string> = new Set(['concierge', 'spa-wellness']);

// ── Helper: get visible tabs for a department (handles dynamic depts) ──────

function getVisibleTabs(
  dept: DepartmentConfig,
  moduleToggles: Record<string, boolean>,
): readonly TabConfig[] {
  if (dept.key === 'admin') {
    // Admin tabs come from CORE_ADMIN_MODULES, filtered by moduleToggles
    return getVisibleAdminModules(moduleToggles)
      .map((m) => ({ id: m.id, label: m.label, modId: m.id }));
  }
  const tabs = getTabsForDepartment(dept.key);
  // For executive/operations, the modId prefix depends on the dept key.
  // The DEPARTMENT_TABS registry already has the correct prefix for each.
  // Filter out tabs disabled web-app-wide via Platform Controls submodules.
  return tabs.filter((t) => isTabEnabledByToggles(dept.key, t.id, moduleToggles));
}

// ── Helper: resolve modId for a tab in the given department ───────────────

function resolveTabModId(tab: TabConfig): string {
  // The DEPARTMENT_TABS registry already has the correct modId for each dept.
  // For executive, modIds are `exec_*`; for operations, they're `ops_*`.
  return tab.modId;
}

// ── Component ─────────────────────────────────────────────────────────────

export function DepartmentRoute({ currentUser, moduleToggles, hasModuleAccess }: DepartmentRouteProps) {
  const params = useParams();
  const navigate = useNavigate();

  const deptSegment = params.department;
  const tabId = params.tab;

  // Resolve department — if unknown segment, redirect to frontoffice
  const dept = deptSegment ? DEPARTMENT_BY_SEGMENT[deptSegment] : undefined;
  if (!dept) {
    return <Navigate to="/erp/frontoffice" replace />;
  }

  const deptKey = dept.key;

  // Check if module is disabled (admin and settings bypass this check)
  const isModuleDisabled =
    deptKey !== 'admin' &&
    deptKey !== 'settings' &&
    moduleToggles[deptKey] === false;

  if (isModuleDisabled) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-center py-20">
        <div className="inline-flex p-4 bg-slate-100 dark:bg-slate-800 rounded-full mb-4">
          <Lock size={28} className="text-slate-400" />
        </div>
        <h3 className="text-lg font-sans font-black text-slate-900 dark:text-white tracking-tight">Module Unavailable</h3>
        <p className="text-sm text-slate-500 mt-2 max-w-sm">This department portal has been disabled by an administrator via Platform Controls. Please contact System Administration for access.</p>
      </div>
    );
  }

  // The Executive portal requires exec:view — the permissive moduleAccess
  // default is not sufficient to gate direct URL access.
  if (deptKey === 'executive' && !canViewExecutivePortal(currentUser)) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-center py-20">
        <div className="inline-flex p-4 bg-slate-100 dark:bg-slate-800 rounded-full mb-4">
          <Lock size={28} className="text-slate-400" />
        </div>
        <h3 className="text-lg font-sans font-black text-slate-900 dark:text-white tracking-tight">Access Restricted</h3>
        <p className="text-sm text-slate-500 mt-2 max-w-sm">The Executive portal requires executive-level access. Please contact System Administration if you believe this is an error.</p>
      </div>
    );
  }

  // Legacy admin module ids (old bookmarks) redirect to their canonical module
  if (deptKey === 'admin' && tabId && adminModuleAliases[tabId]) {
    return <Navigate to={`/erp/${dept.urlSegment}/${adminModuleAliases[tabId]}`} replace />;
  }

  // Resolve the active tab
  const visibleTabs = getVisibleTabs(dept, moduleToggles);
  const resolvedTabId = tabId || dept.defaultTab;

  // For departments with no tabs (settings, banquet-events), just render the portal
  if (visibleTabs.length === 0 && deptKey !== 'admin') {
    return renderPortal(dept, resolvedTabId, currentUser, navigate);
  }

  // Check if the requested tab is in the visible list
  const currentTab = visibleTabs.find((t) => t.id === resolvedTabId);

  if (currentTab) {
    // Check module access for this tab
    const modId = resolveTabModId(currentTab);
    if (modId && !hasModuleAccess(modId)) {
      // Redirect to first accessible tab
      const firstAccessible = visibleTabs.find((t) => {
        const mid = resolveTabModId(t);
        return !mid || hasModuleAccess(mid);
      });
      if (firstAccessible && firstAccessible.id !== resolvedTabId) {
        return <Navigate to={`/erp/${dept.urlSegment}/${firstAccessible.id}`} replace />;
      }
    }
  } else if (visibleTabs.length > 0) {
    // Tab not found in visible list — redirect to first visible tab
    // (handles admin module-toggle auto-switch + unknown tab ids)
    const firstAccessible = visibleTabs.find((t) => {
      const mid = resolveTabModId(t);
      return !mid || hasModuleAccess(mid);
    }) || visibleTabs[0];
    return <Navigate to={`/erp/${dept.urlSegment}/${firstAccessible.id}`} replace />;
  }

  return renderPortal(dept, resolvedTabId, currentUser, navigate);
}

// ── Portal renderer ───────────────────────────────────────────────────────

function renderPortal(
  dept: DepartmentConfig,
  tabId: string,
  currentUser: User | null,
  navigate: (path: string) => void,
): React.ReactNode {
  const Portal = dept.Portal;
  const onTabChange = (newTab: string) => navigate(`/erp/${dept.urlSegment}/${newTab}`);

  // Build props based on the department's portal API
  const props: Record<string, unknown> = {};

  if (ACTIVE_MODULE_DEPTS.has(dept.key)) {
    props.activeModule = tabId;
  } else if (dept.key !== 'settings') {
    props.activeTab = tabId;
  }

  // Most portals get onTabChange (they can ignore it if they don't use it)
  if (dept.key !== 'settings') {
    props.onTabChange = onTabChange;
  }

  // Concierge and Spa need currentUser
  if (NEEDS_CURRENT_USER.has(dept.key)) {
    props.currentUser = currentUser;
  }

  return (
    <React.Suspense fallback={<div className="flex-1 flex items-center justify-center p-12 text-sm text-slate-400">Loading…</div>}>
      <Portal {...props} />
    </React.Suspense>
  );
}

export default DepartmentRoute;
