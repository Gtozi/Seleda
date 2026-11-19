import React, { useState, useEffect } from 'react';
import { ResourceManager, type ResourceField, adminAuthHeaders } from '../shared/ResourceManager';
import { RuleTester, WorkflowInstancesModule } from './CentralRulesUI';
import { DEPARTMENTS, getDeptAccentColorVar } from '../../../config/departments';
import { Plus, AlertCircle, Trash2, ChevronUp, ChevronDown } from 'lucide-react';
import { SectionCard } from '../../FrontOffice/ui';
import { button } from '../../FrontOffice/brandTheme';

const yesNo = (key: string, label: string, def = true): ResourceField => ({ key, label, type: 'boolean', toggle: true, default: def });
const count = (items: any[], pred: (i: any) => boolean) => items.filter(pred).length;

// ── Role picker ──────────────────────────────────────────────────────────────
// Workflow steps and approval rules match against system_users.role, which holds
// role names like 'fin_manager' / 'ops_manager' / 'front office manager'. Options
// come live from /api/admin/roles, merged with known legacy aliases.

const FALLBACK_ROLES = [
  'admin', 'executive', 'general_manager', 'gm', 'owner', 'director',
  'frontoffice', 'front office manager', 'fo_manager',
  'hk_manager', 'housekeeping', 'fb_manager', 'f&b',
  'fin_manager', 'finance', 'hr', 'hr_manager',
  'inventory', 'inv_manager', 'procurement', 'proc_manager',
  'ops_manager', 'operations', 'sales', 'sales_manager', 'revenue',
  'maintenance', 'eng_manager', 'concierge', 'concierge_manager',
  'guest_services_manager', 'spa', 'spa_manager', 'banquet',
  'transportation', 'security_manager', 'pos', 'member',
];

const humanizeRole = (s: string) =>
  s.replace(/[_-]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

interface RoleOption { value: string; label: string }

const useRoleOptions = (): RoleOption[] => {
  const [opts, setOpts] = useState<RoleOption[]>(() =>
    FALLBACK_ROLES.map(v => ({ value: v, label: humanizeRole(v) }))
  );
  useEffect(() => {
    let alive = true;
    fetch('/api/admin/roles', { headers: adminAuthHeaders(), credentials: 'include' })
      .then(r => (r.ok ? r.json() : null))
      .then(j => {
        if (!alive || !j) return;
        const map = new Map<string, string>();
        for (const r of j.roles || []) {
          const v = String(r.name || '').trim();
          if (!v) continue;
          const key = v.toLowerCase();
          const lbl = r.display_name && r.display_name !== r.name ? String(r.display_name) : humanizeRole(v);
          if (!map.has(key)) map.set(key, lbl);
        }
        for (const v of FALLBACK_ROLES) if (!map.has(v)) map.set(v, humanizeRole(v));
        setOpts([...map.entries()].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label)));
      })
      .catch(() => {});
    return () => { alive = false; };
  }, []);
  return opts;
};

const wfInput = 'w-full px-3 py-2 text-sm border border-gray-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-gray-900 dark:text-white outline-none focus:ring-1 focus:ring-[var(--color-accent-operations)]';
const wfLabel = 'text-xs font-medium text-gray-700 dark:text-gray-300 block mb-1.5';

const RolePicker: React.FC<{ selected: string[]; onChange: (v: string[]) => void; roles: RoleOption[] }> = ({ selected, onChange, roles }) => {
  const sel = new Set(selected.map(s => s.toLowerCase()));
  const known = new Set(roles.map(r => r.value.toLowerCase()));
  const extras = selected.filter(s => !known.has(s.toLowerCase()));
  const options = [...roles, ...extras.map(v => ({ value: v, label: humanizeRole(v) }))];
  const toggle = (v: string) => {
    const lv = v.toLowerCase();
    onChange(sel.has(lv) ? selected.filter(s => s.toLowerCase() !== lv) : [...selected, v]);
  };
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map(o => {
        const active = sel.has(o.value.toLowerCase());
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => toggle(o.value)}
            className={`px-2.5 py-1 rounded-lg text-xs font-semibold border transition ${active ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white dark:bg-slate-800 text-gray-600 dark:text-gray-300 border-gray-200 dark:border-slate-700 hover:border-indigo-300'}`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
};

const RoleSelect: React.FC<{ value: string; onChange: (v: string) => void; roles: RoleOption[]; placeholder?: string }> = ({ value, onChange, roles, placeholder = 'Select role…' }) => {
  const known = new Set(roles.map(r => r.value.toLowerCase()));
  const extra = value && !known.has(value.toLowerCase()) ? [{ value, label: humanizeRole(value) }] : [];
  return (
    <select value={value} onChange={e => onChange(e.target.value)} className={wfInput}>
      <option value="">{placeholder}</option>
      {[...roles, ...extra].map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
};

// ── Approval matrix editor ───────────────────────────────────────────────────

const ApprovalMatrixForm: React.FC<{ form: Record<string, any>; setForm: React.Dispatch<React.SetStateAction<Record<string, any>>> }> = ({ form, setForm }) => {
  const roles = useRoleOptions();
  const set = (k: string, v: any) => setForm(f => ({ ...f, [k]: v }));
  const selectedRoles = String(form.approverRoles || '').split(',').map(s => s.trim()).filter(Boolean);
  const deptSuggestions = [...new Set([...DEPARTMENTS.map(d => d.label), ...DEPARTMENTS.map(d => d.key), 'Procurement', 'Finance', 'Operations'])];
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
      <div>
        <label className={wfLabel}>Rule name *</label>
        <input value={form.name || ''} onChange={e => set('name', e.target.value)} placeholder="e.g. Large purchase orders" className={wfInput} />
      </div>
      <div>
        <label className={wfLabel}>Document type *</label>
        <input value={form.entityType || ''} onChange={e => set('entityType', e.target.value)} placeholder="purchase_order" list="amt-entity-types" className={wfInput} />
        <datalist id="amt-entity-types">
          <option value="purchase_order" /><option value="expense_claim" /><option value="payment_run" /><option value="journal_entry" /><option value="reservation" />
        </datalist>
      </div>
      <div>
        <label className={wfLabel}>Department (optional)</label>
        <input value={form.department || ''} onChange={e => set('department', e.target.value)} placeholder="Any department" list="amt-departments" className={wfInput} />
        <datalist id="amt-departments">{deptSuggestions.map(d => <option key={d} value={d} />)}</datalist>
      </div>
      <div>
        <label className={wfLabel}>Currency</label>
        <select value={form.currency || 'USD'} onChange={e => set('currency', e.target.value)} className={wfInput}>
          {['USD', 'ETB', 'EUR', 'GBP', 'AED', 'SAR'].map(c => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>
      <div>
        <label className={wfLabel}>Minimum amount</label>
        <input type="number" min="0" value={form.minAmount ?? 0} onChange={e => set('minAmount', e.target.value)} className={wfInput} />
      </div>
      <div>
        <label className={wfLabel}>Maximum amount</label>
        <input type="number" min="0" value={form.maxAmount ?? ''} onChange={e => set('maxAmount', e.target.value)} placeholder="No limit" className={wfInput} />
      </div>
      <div>
        <label className={wfLabel}>Approval steps</label>
        <input type="number" min="1" value={form.steps ?? 1} onChange={e => set('steps', e.target.value)} className={wfInput} />
      </div>
      <div>
        <label className={wfLabel}>Escalate after (hours)</label>
        <input type="number" min="0" value={form.escalationHours ?? ''} onChange={e => set('escalationHours', e.target.value)} placeholder="Never" className={wfInput} />
      </div>
      <div className="sm:col-span-2">
        <label className={wfLabel}>Who can approve? *</label>
        <RolePicker selected={selectedRoles} onChange={v => set('approverRoles', v)} roles={roles} />
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1.5">Executive and system admin roles can always approve. Pick every role allowed to approve documents matching this rule.</p>
      </div>
      <div className="sm:col-span-2">
        <label className="flex items-center gap-2 text-sm font-semibold text-gray-700 dark:text-gray-200">
          <input type="checkbox" checked={!!form.active} onChange={e => set('active', e.target.checked)} /> Rule is active
        </label>
      </div>
    </div>
  );
};

// ── Workflow steps builder ───────────────────────────────────────────────────

type StepDraft = { name?: string; type?: string; role?: string; condition?: string; message?: string };

const parseSteps = (raw: any): StepDraft[] | null => {
  try {
    const v = typeof raw === 'string' ? JSON.parse(raw || '[]') : raw;
    return Array.isArray(v) ? v : null;
  } catch { return null; }
};

const WorkflowForm: React.FC<{ form: Record<string, any>; setForm: React.Dispatch<React.SetStateAction<Record<string, any>>> }> = ({ form, setForm }) => {
  const roles = useRoleOptions();
  const set = (k: string, v: any) => setForm(f => ({ ...f, [k]: v }));
  const steps = parseSteps(form.steps);
  const stepsJsonInvalid = steps === null;
  const list = steps || [];
  const setSteps = (arr: StepDraft[]) => set('steps', JSON.stringify(arr, null, 2));
  const patchStep = (i: number, patch: Partial<StepDraft>) => setSteps(list.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  const moveStep = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= list.length) return;
    const next = [...list];
    [next[i], next[j]] = [next[j], next[i]];
    setSteps(next);
  };
  const removeStep = (i: number) => setSteps(list.filter((_, j) => j !== i));
  const addStep = () => setSteps([...list, { name: '', type: 'approval', role: '' }]);
  const typeBadge = (t?: string) => t === 'notify' ? 'bg-sky-100 text-sky-700 dark:bg-sky-500/10 dark:text-sky-400' : t === 'task' ? 'bg-amber-100 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400' : 'bg-indigo-100 text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-400';

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
      <div>
        <label className={wfLabel}>Name *</label>
        <input value={form.name || ''} onChange={e => set('name', e.target.value)} placeholder="e.g. Purchase order approval" className={wfInput} />
      </div>
      <div>
        <label className={wfLabel}>Entity type *</label>
        <input value={form.entityType || ''} onChange={e => set('entityType', e.target.value)} placeholder="purchase_order" list="wf-entity-types" className={wfInput} />
        <datalist id="wf-entity-types"><option value="purchase_order" /><option value="reservation" /><option value="expense_claim" /></datalist>
      </div>
      <div>
        <label className={wfLabel}>Trigger event *</label>
        <input value={form.triggerEvent || ''} onChange={e => set('triggerEvent', e.target.value)} placeholder="purchase_order.submitted" list="wf-triggers" className={wfInput} />
        <datalist id="wf-triggers"><option value="purchase_order.submitted" /><option value="reservation.created" /></datalist>
      </div>
      <div>
        <label className={wfLabel}>Status</label>
        <select value={form.status || 'draft'} onChange={e => set('status', e.target.value)} className={wfInput}>
          {['draft', 'active', 'archived'].map(v => <option key={v} value={v}>{v}</option>)}
        </select>
      </div>
      <div>
        <label className={wfLabel}>Version</label>
        <input type="number" min="1" value={form.version ?? 1} onChange={e => set('version', e.target.value)} className={wfInput} />
      </div>
      <div className="sm:col-span-2">
        <label className={wfLabel}>Description</label>
        <textarea rows={2} value={form.description || ''} onChange={e => set('description', e.target.value)} className={wfInput} />
      </div>

      <div className="sm:col-span-2">
        <div className="flex items-center justify-between mb-2">
          <label className={wfLabel + ' !mb-0'}>Steps</label>
          {!stepsJsonInvalid && (
            <button type="button" onClick={addStep} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold bg-indigo-600 text-white hover:bg-indigo-700">
              <Plus size={12} /> Add step
            </button>
          )}
        </div>
        {stepsJsonInvalid ? (
          <>
            <p className="text-xs text-rose-600 dark:text-rose-400 mb-1.5">Steps JSON is invalid — fix it below or start over.</p>
            <textarea rows={6} value={form.steps || ''} onChange={e => set('steps', e.target.value)} className={`${wfInput} font-mono text-xs`} />
            <button type="button" onClick={() => set('steps', '[]')} className="mt-1.5 text-xs text-indigo-600 dark:text-indigo-400 font-semibold hover:underline">Reset to empty list</button>
          </>
        ) : list.length === 0 ? (
          <p className="text-sm text-gray-500 dark:text-gray-400 border border-dashed border-gray-300 dark:border-slate-700 rounded-xl p-4 text-center">No steps yet — the workflow will complete immediately when triggered. Add an approval, task or notification step.</p>
        ) : (
          <div className="space-y-2">
            {list.map((s, i) => (
              <div key={i} className="border border-gray-200 dark:border-slate-700 rounded-xl p-3 bg-slate-50/60 dark:bg-slate-800/40">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-xs font-black text-gray-400 w-5">{i + 1}</span>
                  <span className={`px-2 py-0.5 rounded-md text-[10px] font-black uppercase tracking-wider ${typeBadge(s.type)}`}>{s.type || 'approval'}</span>
                  <div className="flex-1" />
                  <button type="button" onClick={() => moveStep(i, -1)} disabled={i === 0} className="p-1 text-gray-400 hover:text-gray-700 disabled:opacity-30" title="Move up"><ChevronUp size={14} /></button>
                  <button type="button" onClick={() => moveStep(i, 1)} disabled={i === list.length - 1} className="p-1 text-gray-400 hover:text-gray-700 disabled:opacity-30" title="Move down"><ChevronDown size={14} /></button>
                  <button type="button" onClick={() => removeStep(i)} className="p-1 text-gray-400 hover:text-rose-600" title="Delete step"><Trash2 size={14} /></button>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <input value={s.name || ''} onChange={e => patchStep(i, { name: e.target.value })} placeholder="Step name *" className={wfInput} />
                  <select value={s.type || 'approval'} onChange={e => patchStep(i, { type: e.target.value })} className={wfInput}>
                    <option value="approval">Approval — waits for a role to approve/reject</option>
                    <option value="task">Task — waits for a role to complete</option>
                    <option value="notify">Notify — send a staff notification, then continue</option>
                  </select>
                  {(s.type || 'approval') !== 'notify' && (
                    <RoleSelect value={s.role || ''} onChange={v => patchStep(i, { role: v })} roles={roles} />
                  )}
                  <input value={s.condition || ''} onChange={e => patchStep(i, { condition: e.target.value })} placeholder='Condition (optional), e.g. amount > 500' className={wfInput} />
                  {(s.type || 'approval') === 'notify' && (
                    <input value={s.message || ''} onChange={e => patchStep(i, { message: e.target.value })} placeholder="Notification message, e.g. PO {{entityId}} needs review" className={`${wfInput} sm:col-span-2`} />
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1.5">Approval/task steps pause the workflow until someone with the chosen role acts. Conditions use the rule syntax (e.g. <code>amount &gt; 500</code>); notify messages support {'{{entityId}}'} placeholders.</p>
      </div>
    </div>
  );
};

export const DepartmentsModule: React.FC = () => {
  const [syncedDepartments, setSyncedDepartures] = useState<Set<string>>(new Set());
  const [, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);

  useEffect(() => {
    const loadExisting = async () => {
      try {
        const res = await fetch('/api/admin/control/departments', { headers: adminAuthHeaders() });
        const json = await res.json();
        if (res.ok && json.items) {
          const codes = new Set<string>(json.items.map((d: any) => d.code));
          setSyncedDepartures(codes);
        }
      } catch (e) {
        console.error('Failed to load departments:', e);
      } finally {
        setLoading(false);
      }
    };
    loadExisting();
  }, []);

  const missingDepartments = DEPARTMENTS.filter(d => !syncedDepartments.has(d.key));

  const importDepartment = async (dept: any) => {
    setImporting(true);
    try {
      await fetch('/api/admin/control/departments', {
        method: 'POST',
        headers: adminAuthHeaders(),
        body: JSON.stringify({
          code: dept.key,
          name: dept.label,
          description: `${dept.label} - Operational department`,
          status: 'active',
        }),
      });
      setSyncedDepartures(prev => new Set([...prev, dept.key]));
    } catch (e) {
      console.error('Failed to import department:', e);
    } finally {
      setImporting(false);
    }
  };

  const importAll = async () => {
    for (const dept of missingDepartments) {
      await importDepartment(dept);
    }
  };

  return (
    <div className="space-y-6">
      {missingDepartments.length > 0 && (
        <SectionCard title="System Departments Not Imported" subtitle={`${missingDepartments.length} department${missingDepartments.length !== 1 ? 's' : ''} from the operational registry`} icon={AlertCircle} tone="warning" pad="md">
          <div className="space-y-3">
            <p className="text-sm text-gray-600 dark:text-gray-400">
              The following departments exist in the system but are not yet in the admin departments table. Import them to enable cost centre and approval configuration.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {missingDepartments.map(dept => (
                <div key={dept.key} className="flex items-center justify-between p-3 bg-slate-50 dark:bg-slate-900/40 rounded-xl border border-slate-200 dark:border-slate-700">
                  <div className="flex items-center gap-2">
                    <span
                      className="flex h-8 w-8 items-center justify-center rounded-lg text-xs font-black"
                      style={{ backgroundColor: `color-mix(in srgb, ${getDeptAccentColorVar(dept.key)} 15%, transparent)`, color: getDeptAccentColorVar(dept.key) }}
                    >
                      {dept.label.charAt(0)}
                    </span>
                    <div>
                      <div className="text-sm font-bold text-gray-900 dark:text-white">{dept.label}</div>
                      <div className="text-xs text-gray-500 dark:text-gray-400 font-mono">{dept.key}</div>
                    </div>
                  </div>
                  <button
                    onClick={() => importDepartment(dept)}
                    disabled={importing}
                    className={button.secondary}
                  >
                    <Plus size={14} />
                  </button>
                </div>
              ))}
            </div>
            <div className="flex justify-end pt-2">
              <button onClick={importAll} disabled={importing} className={button.primary}>
                {importing ? 'Importing...' : <><Plus size={16} /> Import All</>}
              </button>
            </div>
          </div>
        </SectionCard>
      )}

      <ResourceManager
        title="Department Management"
        description="Define the organisational departments used for cost centres, approvals and reporting."
        resource="departments"
        itemLabel="department"
        fields={[
          { key: 'code', label: 'Code', required: true, placeholder: 'FO' },
          { key: 'name', label: 'Name', required: true },
          { key: 'headName', label: 'Department head' },
          { key: 'costCenter', label: 'Cost centre' },
          { key: 'parentId', label: 'Parent department ID', table: false, help: 'ID of the parent department, if any' },
          { key: 'status', label: 'Status', type: 'select', default: 'active', options: [{ value: 'active', label: 'Active' }, { value: 'inactive', label: 'Inactive' }] },
          { key: 'description', label: 'Description', type: 'textarea', table: false },
        ]}
        stats={items => [{ label: 'Departments', value: items.length }, { label: 'Active', value: count(items, i => i.status === 'active') }]}
      />
    </div>
  );
};

export const FeatureFlagsModule: React.FC = () => (
  <ResourceManager
    title="Feature Flags"
    description="Switch features on or off per environment and roll them out gradually."
    resource="feature-flags"
    itemLabel="flag"
    fields={[
      { key: 'flagKey', label: 'Key', required: true, placeholder: 'new_checkout_flow' },
      { key: 'name', label: 'Name', required: true },
      { key: 'environment', label: 'Environment', type: 'select', default: 'production', options: ['production', 'staging', 'development'].map(v => ({ value: v, label: v })) },
      { key: 'rolloutPct', label: 'Rollout %', type: 'number', default: 100 },
      yesNo('enabled', 'Enabled', false),
      { key: 'description', label: 'Description', type: 'textarea', table: false },
    ]}
    stats={items => [{ label: 'Flags', value: items.length }, { label: 'Enabled', value: count(items, i => i.enabled) }]}
  />
);

export const ApprovalMatrixModule: React.FC<{ embedded?: boolean }> = ({ embedded }) => (
  <ResourceManager
    embedded={embedded}
    renderForm={ApprovalMatrixForm}
    title="Approval Matrix"
    description="Who must approve what, by document type, amount band and department."
    resource="approval-rules"
    itemLabel="rule"
    fields={[
      { key: 'name', label: 'Rule name', required: true },
      { key: 'entityType', label: 'Document type', required: true, placeholder: 'purchase_order' },
      { key: 'department', label: 'Department' },
      { key: 'minAmount', label: 'Min amount', type: 'number', default: 0 },
      { key: 'maxAmount', label: 'Max amount', type: 'number', help: 'Leave empty for no upper limit' },
      { key: 'currency', label: 'Currency', default: 'USD' },
      { key: 'approverRoles', label: 'Approver roles', type: 'list', placeholder: 'finance_manager, gm' },
      { key: 'steps', label: 'Approval steps', type: 'number', default: 1 },
      { key: 'escalationHours', label: 'Escalate after (hours)', type: 'number', table: false },
      yesNo('active', 'Active'),
    ]}
    stats={items => [{ label: 'Rules', value: items.length }, { label: 'Active', value: count(items, i => i.active) }]}
  />
);

export const WorkflowModule: React.FC<{ embedded?: boolean }> = ({ embedded }) => (
  <ResourceManager
    embedded={embedded}
    renderForm={WorkflowForm}
    title="Workflow Engine"
    description="Multi-step workflows started by system events. Live triggers: purchase_order.submitted (a PO moves to Pending Approval) and reservation.created (public website booking). Steps JSON: [{&quot;name&quot;:&quot;Manager review&quot;,&quot;type&quot;:&quot;approval&quot;,&quot;role&quot;:&quot;manager&quot;,&quot;condition&quot;:&quot;amount > 500&quot;}]. Types: approval, task (pause until the role completes it) and notify (staff notification, then continue)."
    resource="workflows"
    itemLabel="workflow"
    fields={[
      { key: 'name', label: 'Name', required: true },
      { key: 'entityType', label: 'Entity type', required: true, placeholder: 'reservation' },
      { key: 'triggerEvent', label: 'Trigger event', required: true, placeholder: 'reservation.created' },
      { key: 'status', label: 'Status', type: 'select', default: 'draft', options: ['draft', 'active', 'archived'].map(v => ({ value: v, label: v })) },
      { key: 'version', label: 'Version', type: 'number', default: 1 },
      { key: 'steps', label: 'Steps', type: 'json', default: [] },
      { key: 'description', label: 'Description', type: 'textarea', table: false },
    ]}
    stats={items => [{ label: 'Workflows', value: items.length }, { label: 'Active', value: count(items, i => i.status === 'active') }]}
  />
);

/** Workflows hub — definitions, running instances, and the approval matrix
 *  under one admin tab (same pattern as TemplatesModule). */
export const WorkflowCenterModule: React.FC = () => {
  const [tab, setTab] = useState<'workflows' | 'instances' | 'approvals'>('workflows');
  return (
    <div className="h-full flex flex-col p-4 sm:p-6 gap-4 overflow-y-auto">
      <div className="flex items-center gap-1 p-1 rounded-xl bg-slate-100 dark:bg-slate-800 w-fit">
        {([['workflows', 'Workflows'], ['instances', 'Instances'], ['approvals', 'Approval Matrix']] as const).map(([id, label]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`px-4 py-2 text-sm font-semibold rounded-lg transition ${tab === id ? 'bg-white dark:bg-slate-700 text-gray-900 dark:text-white shadow-sm' : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'}`}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === 'workflows' && <WorkflowModule embedded />}
      {tab === 'instances' && <WorkflowInstancesModule embedded />}
      {tab === 'approvals' && <ApprovalMatrixModule embedded />}
    </div>
  );
};

export const BusinessRulesModule: React.FC = () => (
  <div className="h-full overflow-y-auto">
    <div className="p-4 sm:p-6 pb-0"><RuleTester /></div>
    <div className="min-h-[520px]"><ResourceManager
    title="Business Rules"
    description="Central rules evaluated by the system by category and priority (lower runs first). Live categories: booking (public website bookings can be blocked) and procurement (purchase orders can be blocked or require a specific approver role). Conditions and actions are validated on save."
    resource="business-rules"
    itemLabel="rule"
    fields={[
      { key: 'name', label: 'Name', required: true },
      { key: 'category', label: 'Category', type: 'select', default: 'booking', options: [
        { value: 'booking', label: 'Booking (public website)' },
        { value: 'procurement', label: 'Procurement (purchase orders)' },
        { value: 'general', label: 'General (all categories)' },
      ]},
      { key: 'priority', label: 'Priority', type: 'number', default: 100, help: 'Lower numbers run first' },
      { key: 'conditionExpr', label: 'Condition', type: 'textarea', required: true, placeholder: 'booking.nights >= 7', help: 'Use paths like booking.nights, booking.total, po.total, amount, user.role' },
      { key: 'actionExpr', label: 'Action', type: 'textarea', required: true, placeholder: 'apply_discount(10); notify("long_stay")', help: 'Separate multiple actions with ;. Available: block, require_approval, apply_discount, add_charge, set, notify, flag' },
      yesNo('active', 'Active'),
      { key: 'description', label: 'Description', type: 'textarea', table: false },
    ]}
    stats={items => [
      { label: 'Rules', value: items.length },
      { label: 'Active', value: count(items, i => i.active) },
      { label: 'Booking', value: count(items, i => i.category === 'booking') },
      { label: 'Procurement', value: count(items, i => i.category === 'procurement') },
    ]}
  /></div>
  </div>
);

const notificationTemplateFields: ResourceField[] = [
  { key: 'code', label: 'Code', required: true, placeholder: 'booking_confirmed' },
  { key: 'name', label: 'Name', required: true },
  { key: 'channel', label: 'Channel', type: 'select', default: 'email', options: ['email', 'sms', 'push', 'in_app'].map(v => ({ value: v, label: v })) },
  { key: 'triggerEvent', label: 'Trigger event' },
  { key: 'subject', label: 'Subject', table: false },
  { key: 'recipientRoles', label: 'Recipient roles', type: 'list', table: false },
  yesNo('active', 'Active'),
  { key: 'body', label: 'Body', type: 'textarea', required: true },
];

const documentTemplateFields: ResourceField[] = [
  { key: 'code', label: 'Code', required: true, placeholder: 'folio_invoice' },
  { key: 'name', label: 'Name', required: true },
  { key: 'docType', label: 'Document type', default: 'general', placeholder: 'invoice, contract, letter…' },
  { key: 'version', label: 'Version', type: 'number', default: 1 },
  yesNo('active', 'Active'),
  { key: 'body', label: 'Body', type: 'textarea' },
];

export const TemplatesModule: React.FC = () => {
  const [tab, setTab] = useState<'notifications' | 'documents'>('notifications');
  return (
    <div className="h-full flex flex-col p-4 sm:p-6 gap-4 overflow-y-auto">
      <div className="flex items-center gap-1 p-1 rounded-xl bg-slate-100 dark:bg-slate-800 w-fit">
        {([['notifications', 'Notifications'], ['documents', 'Documents']] as const).map(([id, label]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`px-4 py-2 text-sm font-semibold rounded-lg transition ${tab === id ? 'bg-white dark:bg-slate-700 text-gray-900 dark:text-white shadow-sm' : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'}`}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === 'notifications' ? (
        <ResourceManager
          embedded
          title="Notification Center"
          description="Templates for email, SMS, push and in-app notifications. Use {{placeholders}} in the body."
          resource="notification-templates"
          itemLabel="template"
          fields={notificationTemplateFields}
          stats={items => [{ label: 'Templates', value: items.length }, { label: 'Active', value: count(items, i => i.active) }]}
        />
      ) : (
        <ResourceManager
          embedded
          title="Document Templates"
          description="Reusable document bodies for folios, confirmations, contracts and letters."
          resource="document-templates"
          itemLabel="template"
          fields={documentTemplateFields}
        />
      )}
    </div>
  );
};

export const PaymentGatewayModule: React.FC = () => (
  <ResourceManager
    title="Payment Gateway Configuration"
    description="Gateway connections. Store only a reference to the secret (an environment variable or vault name), never the secret itself."
    resource="payment-gateways"
    itemLabel="gateway"
    fields={[
      { key: 'name', label: 'Name', required: true },
      { key: 'provider', label: 'Provider', required: true, placeholder: 'stripe, chapa, telebirr…' },
      { key: 'mode', label: 'Mode', type: 'select', default: 'sandbox', options: [{ value: 'sandbox', label: 'Sandbox' }, { value: 'live', label: 'Live' }] },
      { key: 'currencies', label: 'Currencies', type: 'list', placeholder: 'USD, ETB' },
      { key: 'feePercent', label: 'Fee %', type: 'number', default: 0 },
      yesNo('enabled', 'Enabled', false),
      { key: 'publicKey', label: 'Public key', table: false },
      { key: 'secretRef', label: 'Secret reference', table: false, placeholder: 'STRIPE_SECRET_KEY' },
      { key: 'webhookUrl', label: 'Webhook URL', table: false },
    ]}
    stats={items => [{ label: 'Gateways', value: items.length }, { label: 'Enabled', value: count(items, i => i.enabled) }, { label: 'Live', value: count(items, i => i.mode === 'live') }]}
  />
);

const deviceFields: ResourceField[] = [
  { key: 'name', label: 'Name', required: true },
  { key: 'deviceType', label: 'Type', default: 'terminal', placeholder: 'terminal, printer, kiosk…' },
  { key: 'location', label: 'Location' },
  { key: 'ipAddress', label: 'IP address' },
  { key: 'serialNumber', label: 'Serial number', table: false },
  { key: 'firmware', label: 'Firmware', table: false },
  { key: 'status', label: 'Status', type: 'select', default: 'offline', options: ['online', 'offline', 'maintenance', 'retired'].map(v => ({ value: v, label: v })) },
];

const posTerminalFields: ResourceField[] = [
  { key: 'outletId', label: 'Outlet', type: 'select', required: true, optionsUrl: '/api/pos/outlets', options: [], help: 'POS outlet this terminal belongs to.' },
  { key: 'deviceId', label: 'Device ID', required: true, placeholder: 'e.g. SN-2024-0017', help: 'Hardware serial or system-assigned unique ID.' },
  { key: 'terminalName', label: 'Terminal name', required: true, placeholder: 'Bar Terminal 1' },
  { key: 'terminalType', label: 'Type', type: 'select', default: 'standard', options: ['standard', 'kitchen_display', 'mobile', 'kiosk', 'self_service'].map(v => ({ value: v, label: v.replace(/_/g, ' ') })) },
  { key: 'hardwareModel', label: 'Hardware model', table: false },
  { key: 'ipAddress', label: 'IP address' },
  { key: 'printerStation', label: 'Printer station', table: false },
  { key: 'isActive', label: 'Active', type: 'boolean', toggle: true, default: true },
  { key: 'settings', label: 'Settings (JSON)', type: 'json', table: false },
];

export const DeviceModule: React.FC = () => {
  const [tab, setTab] = useState<'devices' | 'pos-terminals'>('devices');
  return (
    <div className="h-full flex flex-col p-4 sm:p-6 gap-4 overflow-y-auto">
      <div className="flex items-center gap-1 p-1 rounded-xl bg-slate-100 dark:bg-slate-800 w-fit">
        {([['devices', 'Devices'], ['pos-terminals', 'POS Terminals']] as const).map(([id, label]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`px-4 py-2 text-sm font-semibold rounded-lg transition ${tab === id ? 'bg-white dark:bg-slate-700 text-gray-900 dark:text-white shadow-sm' : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'}`}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === 'devices' ? (
        <ResourceManager
          embedded
          title="Device Management"
          description="Registry of terminals, printers, key encoders, kiosks and other hardware."
          resource="devices"
          itemLabel="device"
          fields={deviceFields}
          stats={items => [{ label: 'Devices', value: items.length }, { label: 'Online', value: count(items, i => i.status === 'online') }]}
        />
      ) : (
        <ResourceManager
          embedded
          title="POS Terminals"
          description="Registered POS terminals per outlet. Transactions and shifts reference these devices; deleting a terminal keeps historical records."
          resource="pos-terminals"
          itemLabel="terminal"
          fields={posTerminalFields}
          stats={items => [{ label: 'Terminals', value: items.length }, { label: 'Active', value: count(items, i => i.isActive) }]}
        />
      )}
    </div>
  );
};

export const RateTaxModule: React.FC = () => (
  <ResourceManager
    title="Rate & Tax Configuration"
    description="The single source of truth for VAT, service charge and additional taxes. Rules apply to: rooms (public and front-office bookings), f&b (POS and online ordering), procurement (purchase-order lines) or all. A rule for a specific outlet beats a property rule, which beats an 'all' rule; a property-specific rule beats a global one. Use rate 0 for an exemption. 'Calc base' only applies to non-VAT/service-charge taxes on POS bills. Where no rule is defined, each module keeps its previous default."
    resource="tax-rules"
    itemLabel="tax rule"
    fields={[
      { key: 'code', label: 'Code', required: true, placeholder: 'VAT15' },
      { key: 'name', label: 'Name', required: true },
      { key: 'taxType', label: 'Type', type: 'select', default: 'vat', options: ['vat', 'service_charge', 'city_tax', 'tourism', 'other'].map(v => ({ value: v, label: v })) },
      { key: 'rate', label: 'Rate % (0 = exempt)', type: 'number', required: true },
      { key: 'appliesTo', label: 'Applies to', default: 'all', placeholder: 'all, rooms, f&b, procurement' },
      { key: 'outletId', label: 'Outlet', type: 'select', table: false, optionsUrl: '/api/pos/outlets', options: [{ value: '', label: '— All outlets —' }], help: 'Optional. Restricts this rule to one POS outlet (highest precedence).' },
      { key: 'calcBase', label: 'Additional-tax base', type: 'select', default: 'subtotal', table: false, options: [{ value: 'subtotal', label: 'Subtotal (after discount)' }, { value: 'total', label: 'Total (incl. VAT)' }], help: 'Only used for city tax / tourism / other taxes on POS bills.' },
      yesNo('inclusive', 'Tax-inclusive pricing', false),
      { key: 'effectiveFrom', label: 'Effective from', type: 'date', table: false },
      { key: 'effectiveTo', label: 'Effective to', type: 'date', table: false },
      yesNo('active', 'Active'),
    ]}
    stats={items => [{ label: 'Rules', value: items.length }, { label: 'Active', value: count(items, i => i.active) }]}
  />
);

export const LicensingModule: React.FC = () => (
  <ResourceManager
    title="Licensing"
    description="Licence keys, plans, seat counts and licensed modules."
    resource="licenses"
    itemLabel="licence"
    fields={[
      { key: 'licenseKey', label: 'Licence key', required: true },
      { key: 'holder', label: 'Holder', required: true },
      { key: 'plan', label: 'Plan', default: 'standard' },
      { key: 'seats', label: 'Seats', type: 'number', default: 1 },
      { key: 'validFrom', label: 'Valid from', type: 'date' },
      { key: 'validTo', label: 'Valid to', type: 'date' },
      { key: 'status', label: 'Status', type: 'select', default: 'active', options: ['active', 'expired', 'suspended'].map(v => ({ value: v, label: v })) },
      { key: 'modules', label: 'Licensed modules', type: 'list', table: false },
    ]}
    stats={items => [{ label: 'Licences', value: items.length }, { label: 'Active', value: count(items, i => i.status === 'active') }, { label: 'Seats', value: items.reduce((a, i) => a + (i.seats || 0), 0) }]}
  />
);

export const IdentityProvidersModule: React.FC = () => (
  <ResourceManager
    title="Identity & Authentication"
    description="External identity providers (SSO) and MFA requirements per provider. Store only a reference to the client secret."
    resource="identity-providers"
    itemLabel="provider"
    fields={[
      { key: 'name', label: 'Name', required: true },
      { key: 'providerType', label: 'Type', type: 'select', default: 'oidc', options: ['oidc', 'saml', 'ldap', 'oauth2'].map(v => ({ value: v, label: v })) },
      { key: 'issuerUrl', label: 'Issuer URL' },
      { key: 'clientId', label: 'Client ID', table: false },
      { key: 'secretRef', label: 'Client secret reference', table: false },
      { key: 'emailDomains', label: 'Email domains', type: 'list', placeholder: 'hotel.com' },
      yesNo('mfaRequired', 'Require MFA', false),
      yesNo('enabled', 'Enabled', false),
    ]}
    stats={items => [{ label: 'Providers', value: items.length }, { label: 'Enabled', value: count(items, i => i.enabled) }]}
  />
);

export const ChannelManagerModule: React.FC = () => (
  <ResourceManager
    title="Channel Manager Configuration"
    description="Distribution channel connections (OTA, GDS, bed banks). New channels are created in test mode by default - they use the simulated sync adapter until real credentials are configured."
    resource="channels"
    apiBase="/api/channels"
    listKey="channels"
    snakeBody
    noDelete
    itemLabel="channel"
    fields={[
      { key: 'channelName', label: 'Channel name', required: true, placeholder: 'Booking.com', readOnly: true },
      { key: 'channelCode', label: 'Code', required: true, placeholder: 'BOOKINGCOM', help: 'Unique short code, e.g. BOOKINGCOM. Stored uppercase; cannot be changed later.', readOnly: true },
      { key: 'channelType', label: 'Type', type: 'select', default: 'ota', readOnly: true, options: ['ota', 'gds', 'bed_bank', 'direct', 'other'].map(v => ({ value: v, label: v.replace(/_/g, ' ') })) },
      { key: 'apiEndpoint', label: 'API endpoint', placeholder: 'https://', readOnly: true },
      { key: 'apiVersion', label: 'API version', table: false, readOnly: true },
      { key: 'credentials', label: 'Credentials (JSON)', type: 'json', table: false, readOnly: true, help: 'JSON object of API credentials. Set at creation; rotate via the Revenue portal.' },
      { key: 'syncIntervalMinutes', label: 'Sync every (min)', type: 'number' },
      { key: 'lastSyncStatus', label: 'Last sync', readOnly: true, table: true },
      yesNo('active', 'Active'),
      yesNo('testMode', 'Test mode', true),
      yesNo('rateParityEnabled', 'Rate parity', true),
      { key: 'rateParityThreshold', label: 'Parity threshold %', type: 'number', table: false },
      yesNo('inventorySyncEnabled', 'Inventory sync', true),
      yesNo('bookingSyncEnabled', 'Booking sync', true),
      { key: 'webhookUrl', label: 'Webhook URL', table: false },
    ]}
    stats={items => [{ label: 'Channels', value: items.length }, { label: 'Active', value: count(items, i => i.active) }]}
  />
);
