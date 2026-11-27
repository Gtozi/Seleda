import React, { useEffect, useMemo, useState } from 'react';
import { Loader2, Save, CheckCircle2, AlertTriangle, Building2, Layers, Shield, ChevronDown, ChevronRight, Pencil, Trash2, Power } from 'lucide-react';
import { useERP } from '../../../context/ERPContext';
import { DEPARTMENTS } from '../../../config/departments';
import { getTabsForDepartment } from '../../../config/departmentTabs';
import { CORE_ADMIN_MODULES } from '../adminModules';
import { adminAuthHeaders } from '../shared/ResourceManager';
import { PUBLIC_PORTAL_MODULES, GUEST_PORTAL_MODULES } from '../../../config/portalModules';
import StatCard from '../../FrontOffice/StatCard';
import { PageHeader, SectionCard, Badge } from '../../FrontOffice/ui';
import { button } from '../../FrontOffice/brandTheme';

const PROTECTED = new Set(['admin', 'settings']);
const API = '/api/admin/modules';

interface RegistryModule {
  id: string;
  department: string;
  label: string;
  icon: string;
  description: string;
  is_active: boolean;
  sort_order: number;
}

interface ModuleRef {
  /** URL tab id — used for the moduleToggles key (<deptKey>_<tabId>) */
  tabId: string;
  /** modId used for registry lookup and permission checks */
  modId: string;
  label: string;
}

const inputCls = 'w-full px-3 py-2 text-sm border border-gray-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-gray-900 dark:text-white outline-none focus:ring-1 focus:ring-[var(--color-accent-operations)]';
const labelCls = 'text-xs font-medium text-gray-700 dark:text-gray-300 block mb-1.5';

/** Tabs shown under each department in this screen. Admin modules come from
 *  CORE_ADMIN_MODULES (DEPARTMENT_TABS has no admin entry); settings is a leaf. */
function modulesForDepartment(deptKey: string): ModuleRef[] {
  if (deptKey === 'admin') {
    return CORE_ADMIN_MODULES.map(m => ({ tabId: m.id, modId: m.id, label: m.label }));
  }
  // Public-facing portals aren't departments — their modules live in
  // config/portalModules.ts and toggle via moduleToggles['public_'|'guest_…'].
  if (deptKey === 'public') {
    return PUBLIC_PORTAL_MODULES.map(m => ({ tabId: m.id, modId: `public_${m.id}`, label: m.label }));
  }
  if (deptKey === 'guest') {
    return GUEST_PORTAL_MODULES.map(m => ({ tabId: m.id, modId: `guest_${m.id}`, label: m.label }));
  }
  return getTabsForDepartment(deptKey).map(t => ({ tabId: t.id, modId: t.modId, label: t.label }));
}

/**
 * Portal & Module Management — consolidated screen.
 *
 * Two layers per module row:
 *  1. Portal toggle — `moduleToggles[<deptKey>]` / `moduleToggles[<deptKey>_<tabId>]`
 *     written through the approval-aware settings channel (same as Platform Controls).
 *  2. Module registry actions — the `modules` table behind /api/admin/modules
 *     (formerly the standalone Module Management screen): register, activate /
 *     deactivate (`is_active`, which hides the module from role-permission
 *     assignment), edit label/icon/description/sort order, and delete.
 */
const PortalManagementLive: React.FC = () => {
  const { globalHotelSettings, submitGlobalSettingsChange, userProfile, pendingAdminChanges, approveAdminChange, declineAdminChange } = useERP();
  const pendingQueue = useMemo(() => (pendingAdminChanges || []).filter(c => c.status === 'Pending'), [pendingAdminChanges]);
  const isSuperAdmin = Boolean((userProfile as any)?.isSuperAdmin);
  const superAdminLocked = useMemo(() => ({ ...(globalHotelSettings.superAdminLockedToggles || {}) } as Record<string, boolean>), [globalHotelSettings.superAdminLockedToggles]);
  const saved = useMemo(() => ({ ...(globalHotelSettings.moduleToggles || {}) } as Record<string, boolean>), [globalHotelSettings]);
  const [draft, setDraft] = useState<Record<string, boolean>>(saved);
  useEffect(() => { setDraft(saved); }, [saved]);
  const [status, setStatus] = useState<'idle' | 'saving' | 'success' | 'error'>('idle');
  const [expandedDepartments, setExpandedDepartments] = useState<Set<string>>(new Set());
  // Real global_settings flags driven by portal toggles (one toggle, both
  // layers): Book Rooms module → public_booking_enabled, Guest Portal →
  // guest_portal_enabled. undefined = leave the flag untouched.
  const [flagOverrides, setFlagOverrides] = useState<{ publicBooking?: boolean; guestPortal?: boolean }>({});

  // ── Module registry state (/api/admin/modules) ──
  const [registry, setRegistry] = useState<RegistryModule[]>([]);
  const [registryLoading, setRegistryLoading] = useState(true);
  const [registryError, setRegistryError] = useState<string | null>(null);
  const [busyModule, setBusyModule] = useState<string | null>(null);
  const [editTarget, setEditTarget] = useState<RegistryModule | 'new' | null>(null);
  const [editForm, setEditForm] = useState({ id: '', department: '', label: '', icon: '', description: '', sortOrder: 0 });
  const [deleteTarget, setDeleteTarget] = useState<RegistryModule | null>(null);

  const loadRegistry = async () => {
    setRegistryLoading(true);
    setRegistryError(null);
    try {
      const res = await fetch(API, { headers: adminAuthHeaders() });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setRegistry(data.modules || []);
    } catch (e: any) {
      setRegistryError(e.message || 'Failed to load module registry');
    } finally {
      setRegistryLoading(false);
    }
  };

  useEffect(() => { loadRegistry(); }, []);

  const regById = useMemo(() => new Map(registry.map(m => [m.id, m])), [registry]);

  // Registry modules not referenced by any known tab (orphans / custom modules)
  const knownModIds = useMemo(() => {
    const ids = new Set<string>();
    [...DEPARTMENTS.map(d => d.key), 'public', 'guest'].forEach(k => modulesForDepartment(k).forEach(m => ids.add(m.modId)));
    return ids;
  }, []);
  const orphanModules = useMemo(() => registry.filter(m => !knownModIds.has(m.id)), [registry, knownModIds]);

  const enabled = (key: string) => !superAdminLocked[key] && draft[key] !== false;
  const isLockedBySuperAdmin = (key: string) => Boolean(superAdminLocked[key]);

  // Every manageable portal: ERP departments + the public & guest portals.
  const portalEntries = useMemo(() => [
    ...DEPARTMENTS.map(d => ({ key: d.key, label: d.label, url: `/erp/${d.urlSegment}`, modules: modulesForDepartment(d.key), locked: PROTECTED.has(d.key) })),
    { key: 'public', label: 'Public Portal', url: '/public-portal', modules: modulesForDepartment('public'), locked: false },
    { key: 'guest', label: 'Guest Portal', url: '/guest', modules: modulesForDepartment('guest'), locked: false },
  ], []);

  const dirty = portalEntries.some(e => !e.locked && enabled(e.key) !== (saved[e.key] !== false)) ||
    portalEntries.some(e => e.modules.some(m => {
      const moduleKey = `${e.key}_${m.tabId}`;
      return enabled(moduleKey) !== (saved[moduleKey] !== false);
    }));
  const off = portalEntries.filter(e => !e.locked && !enabled(e.key)).length;
  const inactiveRegistry = registry.filter(m => !m.is_active).length;
  const flagsDirty = flagOverrides.publicBooking !== undefined || flagOverrides.guestPortal !== undefined;
  const isDirty = dirty || flagsDirty;

  const save = async () => {
    setStatus('saving');
    let ok = false;
    try {
      ok = await submitGlobalSettingsChange('Portal Management Update', `Portals disabled: ${off}`, 'platform-control', {
        maintenanceMode: globalHotelSettings.maintenanceMode ?? false,
        maintenanceMessage: globalHotelSettings.maintenanceMessage,
        publicBookingEnabled: flagOverrides.publicBooking ?? globalHotelSettings.publicBookingEnabled ?? true,
        guestPortalEnabled: flagOverrides.guestPortal ?? globalHotelSettings.guestPortalEnabled ?? true,
        sessionTimeout: globalHotelSettings.sessionTimeout ?? 30,
        moduleToggles: draft,
      });
    } catch (e) {
      console.error('Failed to save portal toggles:', e);
    }
    if (ok) setFlagOverrides({});
    setStatus(ok ? 'success' : 'error');
    setTimeout(() => setStatus('idle'), ok ? 2500 : 4000);
  };

  const toggleDepartment = (deptKey: string) => {
    setExpandedDepartments(prev => {
      const next = new Set(prev);
      if (next.has(deptKey)) next.delete(deptKey);
      else next.add(deptKey);
      return next;
    });
  };

  const toggleModule = (deptKey: string, tabId: string) => {
    const key = `${deptKey}_${tabId}`;
    if (isLockedBySuperAdmin(deptKey) || isLockedBySuperAdmin(key)) return;
    const next = !enabled(key);
    setDraft(f => ({ ...f, [key]: next }));
    // Book Rooms also drives the server-enforced public_booking_enabled flag.
    if (key === 'public_booking') {
      setFlagOverrides(f => ({ ...f, publicBooking: next }));
    }
  };

  const togglePortal = (key: string, next: boolean) => {
    if (isLockedBySuperAdmin(key)) return;
    setDraft(f => ({ ...f, [key]: next }));
    // The Guest Portal card also drives guest_portal_enabled.
    if (key === 'guest') {
      setFlagOverrides(f => ({ ...f, guestPortal: next }));
    }
  };

  // ── Registry actions ──

  const toggleActive = async (mod: RegistryModule) => {
    setBusyModule(mod.id);
    try {
      const res = await fetch(`${API}/${mod.id}`, {
        method: 'PATCH',
        headers: adminAuthHeaders(),
        body: JSON.stringify({ isActive: !mod.is_active }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setRegistry(rs => rs.map(r => r.id === mod.id ? { ...r, is_active: data.module?.is_active ?? !mod.is_active } : r));
    } catch (e: any) {
      alert(e.message || 'Failed to update module');
    } finally {
      setBusyModule(null);
    }
  };

  const openEdit = (mod: RegistryModule) => {
    setEditForm({
      id: mod.id,
      department: mod.department,
      label: mod.label,
      icon: mod.icon || '',
      description: mod.description || '',
      sortOrder: mod.sort_order ?? 0,
    });
    setEditTarget(mod);
  };

  const openNew = (modId: string, label: string, deptKey: string) => {
    setEditForm({ id: modId, department: deptKey, label, icon: '📦', description: '', sortOrder: 0 });
    setEditTarget('new');
  };

  const submitEdit = async () => {
    if (!editTarget) return;
    setBusyModule(editForm.id);
    try {
      const isNew = editTarget === 'new';
      const res = await fetch(isNew ? API : `${API}/${editForm.id}`, {
        method: isNew ? 'POST' : 'PATCH',
        headers: adminAuthHeaders(),
        body: JSON.stringify({
          id: editForm.id,
          label: editForm.label,
          icon: editForm.icon,
          description: editForm.description,
          department: editForm.department,
          sortOrder: editForm.sortOrder,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setRegistry(rs => isNew ? [...rs, data.module] : rs.map(r => r.id === editForm.id ? data.module : r));
      setEditTarget(null);
    } catch (e: any) {
      alert(e.message || 'Failed to save module');
    } finally {
      setBusyModule(null);
    }
  };

  const submitDelete = async () => {
    if (!deleteTarget) return;
    setBusyModule(deleteTarget.id);
    try {
      const res = await fetch(`${API}/${deleteTarget.id}`, { method: 'DELETE', headers: adminAuthHeaders() });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setRegistry(rs => rs.filter(r => r.id !== deleteTarget.id));
      setDeleteTarget(null);
    } catch (e: any) {
      alert(e.message || 'Failed to delete module');
    } finally {
      setBusyModule(null);
    }
  };

  /** Registry status + action buttons rendered on every module row. */
  const renderRegistryActions = (modId: string, label: string, deptKey: string) => {
    const reg = regById.get(modId);
    if (!isSuperAdmin) {
      return reg ? (
        <div className="flex items-center gap-2 shrink-0">
          <Badge tone={reg.is_active ? 'success' : 'danger'}>{reg.is_active ? 'Active' : 'Inactive'}</Badge>
        </div>
      ) : null;
    }
    return (
      <div className="flex items-center gap-2 shrink-0">
        {reg ? (
          <>
            <Badge tone={reg.is_active ? 'success' : 'danger'}>{reg.is_active ? 'Active' : 'Inactive'}</Badge>
            <button
              onClick={() => toggleActive(reg)}
              disabled={busyModule === modId}
              className="p-1.5 rounded-lg text-gray-400 hover:text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-500/10 transition disabled:opacity-50"
              title={reg.is_active ? 'Deactivate (hide from role permissions)' : 'Activate'}
            >
              {busyModule === modId ? <Loader2 size={14} className="animate-spin" /> : <Power size={14} />}
            </button>
            <button
              onClick={() => openEdit(reg)}
              disabled={busyModule === modId}
              className="p-1.5 rounded-lg text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-500/10 transition disabled:opacity-50"
              title="Edit module registry entry"
            >
              <Pencil size={14} />
            </button>
            <button
              onClick={() => setDeleteTarget(reg)}
              disabled={busyModule === modId}
              className="p-1.5 rounded-lg text-gray-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-500/10 transition disabled:opacity-50"
              title="Delete module registry entry"
            >
              <Trash2 size={14} />
            </button>
          </>
        ) : (
          <button
            onClick={() => openNew(modId, label, deptKey)}
            disabled={registryLoading || busyModule === modId}
            className="text-[10px] font-bold px-2 py-1 rounded-lg border border-dashed border-gray-300 dark:border-slate-600 text-gray-500 dark:text-gray-400 hover:border-indigo-400 hover:text-indigo-600 transition disabled:opacity-50"
          >
            {registryLoading ? '…' : 'Register'}
          </button>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="Portal Management"
        subtitle="Enable or disable portals and modules within Super Admin boundaries."
        icon={Building2}
        actions={
          <button onClick={save} disabled={!isDirty || status === 'saving'} className={button.primary}>
            {status === 'saving' ? <Loader2 size={16} className="animate-spin" /> : status === 'success' ? <CheckCircle2 size={16} /> : status === 'error' ? <AlertTriangle size={16} /> : <Save size={16} />}
            {status === 'success' ? 'Saved' : status === 'error' ? 'Failed' : 'Save changes'}
          </button>
        }
      />

      {status === 'success' && (
        <div className="p-4 rounded-xl text-sm font-bold flex items-center gap-2 bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-100 dark:border-emerald-500/20">
          <CheckCircle2 size={16} /> Portal management settings saved successfully
        </div>
      )}
      {registryError && (
        <div className="p-4 rounded-xl text-sm font-bold flex items-center gap-2 bg-rose-50 dark:bg-rose-500/10 text-rose-700 dark:text-rose-400 border border-rose-100 dark:border-rose-500/20">
          <AlertTriangle size={16} /> Module registry: {registryError}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard title="Total Portals" value={portalEntries.length} icon={Building2} tone="accent" />
        <StatCard title="Enabled" value={portalEntries.length - off} icon={CheckCircle2} tone="success" />
        <StatCard title="Disabled" value={off} icon={AlertTriangle} tone="warning" />
        <StatCard title="Registry Modules" value={`${registry.length - inactiveRegistry}/${registry.length}`} icon={Layers} tone="info" />
      </div>

      {pendingQueue.length > 0 && (
        <SectionCard
          title="Pending Governance Changes"
          subtitle={`${pendingQueue.length} staged change${pendingQueue.length !== 1 ? 's' : ''} awaiting approval`}
          icon={Shield}
          tone="warning"
          pad="none"
        >
          <div className="divide-y divide-gray-100 dark:divide-slate-700">
            {pendingQueue.map(change => (
              <div key={change.id} className="flex items-center justify-between gap-4 p-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold text-gray-900 dark:text-white">{change.title}</span>
                    <Badge tone="warning">{change.changeType}</Badge>
                  </div>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{change.description}</p>
                  <p className="text-[11px] text-gray-400 mt-0.5">
                    Submitted by {change.submittedBy || 'Admin'} · {new Date(change.submittedAt).toLocaleString()}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button onClick={() => declineAdminChange(change.id)} className={button.secondary}>Decline</button>
                  <button onClick={() => approveAdminChange(change.id)} className={button.primary}>Approve</button>
                </div>
              </div>
            ))}
          </div>
        </SectionCard>
      )}

      <SectionCard title="Portals & Modules" subtitle={`${portalEntries.length - off} of ${portalEntries.length} portals enabled · registry actions on each module row`} icon={Layers} tone="accent" pad="none">
        <div className="divide-y divide-gray-100 dark:divide-slate-700">
          {portalEntries.map(e => {
            const saLocked = isLockedBySuperAdmin(e.key);
            const locked = e.locked || saLocked;
            const modules = e.modules;
            const on = e.locked || (!saLocked && enabled(e.key));
            const isExpanded = expandedDepartments.has(e.key);

            return (
              <div key={e.key} className="bg-white dark:bg-slate-800">
                <div className="flex items-center justify-between p-4 hover:bg-slate-50 dark:hover:bg-slate-700/30 transition">
                  <button
                    onClick={() => toggleDepartment(e.key)}
                    className="flex items-center gap-3 flex-1 text-left"
                  >
                    {isExpanded ? (
                      <ChevronDown size={16} className="text-gray-400" />
                    ) : (
                      <ChevronRight size={16} className="text-gray-400" />
                    )}
                    <Building2 size={18} className="text-gray-400 shrink-0" />
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-bold text-gray-900 dark:text-white">{e.label}</span>
                        {e.locked && <Badge tone="warning">Protected</Badge>}
                        {saLocked && <Badge tone="danger">Locked by Super Admin</Badge>}
                        {on && !locked && <Badge tone="success">Enabled</Badge>}
                        {!on && !locked && <Badge tone="danger">Disabled</Badge>}
                      </div>
                      <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 font-mono">
                        {e.url} · {modules.length} modules
                      </div>
                    </div>
                  </button>
                  <button
                    disabled={locked}
                    onClick={() => togglePortal(e.key, !on)}
                    className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${on ? 'bg-emerald-500' : 'bg-slate-300 dark:bg-slate-600'}`}
                    aria-label={`Toggle ${e.label}`}
                  >
                    <span className={`inline-block h-5 w-5 transform rounded-full bg-white transition-transform ${on ? 'translate-x-5' : 'translate-x-0.5'}`} />
                  </button>
                </div>

                {isExpanded && modules.length > 0 && (
                  <div className="px-4 pb-4 pl-12">
                    <div className="space-y-2">
                      {modules.map(m => {
                        const moduleKey = `${e.key}_${m.tabId}`;
                        const modSaLocked = saLocked || isLockedBySuperAdmin(moduleKey);
                        const moduleOn = !modSaLocked && enabled(moduleKey);
                        const moduleLocked = e.locked || modSaLocked;
                        return (
                          <div
                            key={m.tabId}
                            className="flex items-center justify-between gap-3 p-2.5 bg-slate-50 dark:bg-slate-900/40 rounded-lg border border-slate-100 dark:border-slate-700"
                          >
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="text-xs font-bold text-gray-900 dark:text-white truncate">{m.label}</span>
                                {modSaLocked && <Badge tone="danger">Super Admin Locked</Badge>}
                              </div>
                              <div className="text-[10px] text-gray-500 dark:text-gray-400 font-mono mt-0.5">
                                {m.modId}
                              </div>
                            </div>
                            {renderRegistryActions(m.modId, m.label, e.key)}
                            <button
                              disabled={moduleLocked}
                              onClick={() => toggleModule(e.key, m.tabId)}
                              className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${moduleOn ? 'bg-emerald-500' : 'bg-slate-300 dark:bg-slate-600'}`}
                              aria-label={`Toggle ${m.label}`}
                            >
                              <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${moduleOn ? 'translate-x-4' : 'translate-x-0.5'}`} />
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {isExpanded && modules.length === 0 && (
                  <div className="px-4 pb-4 pl-12">
                    <p className="text-xs text-gray-400 italic">No modules defined for this portal.</p>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </SectionCard>

      {orphanModules.length > 0 && (
        <SectionCard title="Unlinked Registry Modules" subtitle="Registry modules not mapped to any portal tab." icon={Shield} tone="warning" pad="none">
          <div className="divide-y divide-gray-100 dark:divide-slate-700">
            {orphanModules.map(m => (
              <div key={m.id} className="flex items-center justify-between gap-3 p-3 bg-white dark:bg-slate-800">
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-bold text-gray-900 dark:text-white truncate">{m.icon} {m.label}</div>
                  <div className="text-[10px] text-gray-500 dark:text-gray-400 font-mono mt-0.5">
                    {m.id} · {m.department}
                  </div>
                </div>
                {renderRegistryActions(m.id, m.label, m.department)}
              </div>
            ))}
          </div>
        </SectionCard>
      )}

      {/* Edit / register modal */}
      {editTarget && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4" onClick={() => setEditTarget(null)}>
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-4" onClick={e => e.stopPropagation()}>
            <h3 className="text-base font-black text-gray-900 dark:text-white">
              {editTarget === 'new' ? 'Register Module' : 'Edit Module'}
            </h3>
            <div>
              <label className={labelCls}>Module ID</label>
              <input className={inputCls} value={editForm.id} disabled={editTarget !== 'new'} onChange={e => setEditForm(f => ({ ...f, id: e.target.value }))} placeholder="fo_dashboard" />
            </div>
            <div>
              <label className={labelCls}>Label</label>
              <input className={inputCls} value={editForm.label} onChange={e => setEditForm(f => ({ ...f, label: e.target.value }))} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>Icon</label>
                <input className={inputCls} value={editForm.icon} onChange={e => setEditForm(f => ({ ...f, icon: e.target.value }))} />
              </div>
              <div>
                <label className={labelCls}>Sort order</label>
                <input className={inputCls} type="number" value={editForm.sortOrder} onChange={e => setEditForm(f => ({ ...f, sortOrder: Number(e.target.value) || 0 }))} />
              </div>
            </div>
            <div>
              <label className={labelCls}>Department</label>
              <input className={inputCls} value={editForm.department} onChange={e => setEditForm(f => ({ ...f, department: e.target.value }))} />
            </div>
            <div>
              <label className={labelCls}>Description</label>
              <textarea className={inputCls} rows={2} value={editForm.description} onChange={e => setEditForm(f => ({ ...f, description: e.target.value }))} />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button onClick={() => setEditTarget(null)} className={button.ghost}>Cancel</button>
              <button onClick={submitEdit} disabled={!editForm.id || !editForm.label || busyModule === editForm.id} className={button.primary}>
                {busyModule === editForm.id ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirm modal */}
      {deleteTarget && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4" onClick={() => setDeleteTarget(null)}>
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl w-full max-w-sm p-6 space-y-4" onClick={e => e.stopPropagation()}>
            <h3 className="text-base font-black text-gray-900 dark:text-white">Delete module?</h3>
            <p className="text-sm text-gray-600 dark:text-gray-300">
              <span className="font-mono font-bold">{deleteTarget.id}</span> will be removed from the registry and its role-permission assignments cleaned up. This cannot be undone.
            </p>
            <div className="flex justify-end gap-2 pt-2">
              <button onClick={() => setDeleteTarget(null)} className={button.ghost}>Cancel</button>
              <button onClick={submitDelete} disabled={busyModule === deleteTarget.id} className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl bg-rose-600 text-white hover:bg-rose-700 font-medium text-sm smooth-transition disabled:opacity-50 disabled:cursor-not-allowed">
                {busyModule === deleteTarget.id ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default PortalManagementLive;
