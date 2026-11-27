import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Plus, Pencil, Trash2, Search, X, Loader2, AlertTriangle, RefreshCw, Shield, Settings, Activity, Database, Layers, DollarSign } from 'lucide-react';
import StatCard from '../../FrontOffice/StatCard';
import { PageHeader, SectionCard, Badge } from '../../FrontOffice/ui';
import { button } from '../../FrontOffice/brandTheme';

export type FieldType = 'text' | 'number' | 'textarea' | 'select' | 'boolean' | 'list' | 'date' | 'json' | 'password';

export interface ResourceField {
  key: string;
  label: string;
  type?: FieldType;
  options?: { value: string; label: string }[];
  required?: boolean;
  placeholder?: string;
  help?: string;
  /** Show as a column in the table (default true). */
  table?: boolean;
  /** Fetch select options from this GET endpoint (response: {items}|{outlets}|array of {id,name}). */
  optionsUrl?: string;
  /** Render a boolean field as an inline toggle in the table. */
  toggle?: boolean;
  default?: any;
  /** Shown but not editable once the record exists. */
  readOnly?: boolean;
}

export interface ResourceManagerProps {
  title: string;
  description?: string;
  /** Resource name under /api/admin/control, e.g. 'departments'. */
  resource: string;
  fields: ResourceField[];
  itemLabel?: string;
  /** Override the API base (default /api/admin/control/:resource). */
  apiBase?: string;
  /** Response key holding the array (default 'items'). */
  listKey?: string;
  /** Disable the create button. */
  readOnlyCreate?: boolean;
  /** Hide the delete action. */
  noDelete?: boolean;
  /** Hide the edit action (read-only listing). */
  noEdit?: boolean;
  /** Send request bodies with snake_case keys. */
  snakeBody?: boolean;
  /** Computed stat chips shown above the table. */
  stats?: (items: any[]) => { label: string; value: string | number }[];
  /** Render without the page header/outer padding — for embedding inside a
   *  parent screen that provides its own header and tab bar. */
  embedded?: boolean;
  /** Custom editor body inside the create/edit modal. Receives the raw form
   *  state (same keys/types as `fields`) and a setter; replaces the default
   *  field grid. `fields` still drive the table columns and save payload. */
  renderForm?: React.ComponentType<{ form: Record<string, any>; setForm: React.Dispatch<React.SetStateAction<Record<string, any>>>; editing: any | 'new' }>;
}

export const adminAuthHeaders = (): Record<string, string> => {
  const token = localStorage.getItem('erp_token');
  return { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) };
};

const inputCls = 'w-full px-3 py-2 text-sm border border-gray-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-gray-900 dark:text-white outline-none focus:ring-1 focus:ring-[var(--color-accent-operations)]';
const labelCls = 'text-xs font-medium text-gray-700 dark:text-gray-300 block mb-1.5';

const toForm = (fields: ResourceField[], item?: any) => {
  const f: Record<string, any> = {};
  for (const fd of fields) {
    const v = item ? item[fd.key] : fd.default;
    if (fd.type === 'list') f[fd.key] = Array.isArray(v) ? v.join(', ') : '';
    else if (fd.type === 'json') f[fd.key] = v === undefined || v === null ? '[]' : JSON.stringify(v, null, 2);
    else if (fd.type === 'boolean') f[fd.key] = !!v;
    else f[fd.key] = v ?? (fd.type === 'select' && fd.options?.[0] ? fd.options[0].value : '');
  }
  return f;
};

const fromForm = (fields: ResourceField[], form: Record<string, any>) => {
  const body: Record<string, any> = {};
  for (const fd of fields) {
    const v = form[fd.key];
    if (fd.type === 'list') body[fd.key] = String(v).split(',').map(s => s.trim()).filter(Boolean);
    else if (fd.type === 'json') body[fd.key] = JSON.parse(v || 'null');
    else if (fd.type === 'number') body[fd.key] = v === '' ? null : Number(v);
    else if (fd.type === 'password' && !v) continue;
    else body[fd.key] = v;
  }
  return body;
};

const display = (fd: ResourceField, v: any): string => {
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'object' && Object.keys(v).length === 0) return '—';
  if (fd.type === 'list') return Array.isArray(v) && v.length ? v.join(', ') : '—';
  if (fd.type === 'json') {
    if (Array.isArray(v)) return `${v.length} item(s)`;
    if (typeof v === 'object') return JSON.stringify(v);
    return String(v);
  }
  if (fd.type === 'boolean') return v ? 'Yes' : 'No';
  if (fd.type === 'select') return fd.options?.find(o => o.value === v)?.label ?? String(v);
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
};

/**
 * Generic CRUD screen for an /api/admin/control/:resource endpoint.
 * Each admin module declares its fields and gets list/search/create/edit/delete.
 */
const camelKeys = (row: Record<string, any>) => Object.fromEntries(Object.entries(row).map(([k, v]) => [k.replace(/_([a-z])/g, (_, l) => l.toUpperCase()), v]));

export function ResourceManager({ title, description, resource, fields, itemLabel = 'record', stats, apiBase, listKey = 'items', readOnlyCreate, noDelete, noEdit, snakeBody, embedded, renderForm }: ResourceManagerProps) {
  const base = apiBase ?? `/api/admin/control/${resource}`;
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<any | 'new' | null>(null);
  const [form, setForm] = useState<Record<string, any>>({});
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [dynamicOptions, setDynamicOptions] = useState<Record<string, { value: string; label: string }[]>>({});

  const optionUrls = fields.filter(f => f.optionsUrl).map(f => `${f.key}:${f.optionsUrl}`).join('|');
  useEffect(() => {
    if (!optionUrls) return;
    for (const entry of optionUrls.split('|')) {
      const [key, url] = entry.split(':');
      fetch(url!, { headers: adminAuthHeaders() })
        .then(r => (r.ok ? r.json() : {}))
        .then(j => {
          const arr: any[] = j.items || j.outlets || j.data || (Array.isArray(j) ? j : []);
          setDynamicOptions(m => ({
            ...m,
            [key]: arr.map(r => ({ value: String(r.id ?? r.value ?? ''), label: String(r.name ?? r.label ?? r.code ?? r.id ?? '') })),
          }));
        })
        .catch(() => {});
    }
  }, [optionUrls]);

  const effFields = useMemo(
    () => fields.map(f => (f.optionsUrl && dynamicOptions[f.key] ? { ...f, options: [...(f.options || []), ...dynamicOptions[f.key]!] } : f)),
    [fields, dynamicOptions]
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(base, { headers: adminAuthHeaders() });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || `Request failed (${res.status})`);
      setItems((json[listKey] || []).map(camelKeys));
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [base, listKey]);

  useEffect(() => { load(); }, [load]);

  const columns = effFields.filter(f => f.table !== false).slice(0, 7);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter(it => effFields.some(f => String(display(f, it[f.key])).toLowerCase().includes(q)));
  }, [items, query, effFields]);

  const openEditor = (item: any | 'new') => {
    setFormError(null);
    setForm(toForm(effFields, item === 'new' ? undefined : item));
    setEditing(item);
  };

  const save = async () => {
    setSaving(true);
    setFormError(null);
    try {
      const raw = fromForm(effFields, form);
      const body = snakeBody ? Object.fromEntries(Object.entries(raw).map(([k, v]) => [k.replace(/[A-Z]/g, l => `_${l.toLowerCase()}`), v])) : raw;
      const isNew = editing === 'new';
      const res = await fetch(isNew ? base : `${base}/${editing.id}`, { method: isNew ? 'POST' : 'PATCH', headers: adminAuthHeaders(), body: JSON.stringify(body) });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || `Save failed (${res.status})`);
      setEditing(null);
      await load();
    } catch (e: any) {
      setFormError(e instanceof SyntaxError ? 'Invalid JSON in one of the fields' : e.message);
    } finally {
      setSaving(false);
    }
  };

  const remove = async (item: any) => {
    if (!window.confirm(`Delete this ${itemLabel}? This cannot be undone.`)) return;
    const res = await fetch(`${base}/${item.id}`, { method: 'DELETE', headers: adminAuthHeaders() });
    if (!res.ok) setError((await res.json().catch(() => ({}))).error || 'Delete failed');
    else await load();
  };

  const toggle = async (item: any, key: string) => {
    const res = await fetch(`${base}/${item.id}`, { method: 'PATCH', headers: adminAuthHeaders(), body: JSON.stringify({ [snakeBody ? key.replace(/[A-Z]/g, l => `_${l.toLowerCase()}`) : key]: !item[key] }) });
    if (!res.ok) setError((await res.json().catch(() => ({}))).error || 'Update failed');
    else await load();
  };

  const chips = stats ? stats(items) : [];

  return (
    <div className="space-y-6 animate-fade-in">
      {embedded ? (
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm text-gray-500 dark:text-gray-400 min-w-0 truncate">{description}</p>
          <div className="flex items-center gap-2 shrink-0">
            <button onClick={load} className={button.secondary} title="Refresh">
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            </button>
            {!readOnlyCreate && (
              <button onClick={() => openEditor('new')} className={button.primary}>
                <Plus size={14} /> Add {itemLabel}
              </button>
            )}
          </div>
        </div>
      ) : (
        <PageHeader
          title={title}
          subtitle={description}
          icon={resource === 'identity-providers' ? Shield : Settings}
          actions={
            <>
              <button onClick={load} className={button.secondary} title="Refresh">
                <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
              </button>
              {!readOnlyCreate && (
                <button onClick={() => openEditor('new')} className={button.primary}>
                  <Plus size={16} /> Add {itemLabel}
                </button>
              )}
            </>
          }
        />
      )}

      {chips.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {chips.map((c, i) => {
            const icons = [Activity, Database, Layers, DollarSign];
            const tones = ['accent', 'success', 'warning', 'info'] as const;
            return (
              <StatCard key={c.label} title={c.label} value={c.value} tone={tones[i % 4]} icon={icons[i % 4]} />
            );
          })}
        </div>
      )}

      {error && (
        <div className="flex items-center gap-2 p-3 rounded-xl bg-rose-50 dark:bg-rose-500/10 text-rose-700 dark:text-rose-400 text-sm border border-rose-100 dark:border-rose-500/20"><AlertTriangle size={16} /> {error}</div>
      )}

      <SectionCard
        title={`${itemLabel.charAt(0).toUpperCase() + itemLabel.slice(1)}s`}
        subtitle={`${filtered.length} of ${items.length}`}
        icon={resource === 'identity-providers' ? Shield : Settings}
        tone="accent"
        pad="none"
        actions={
          <div className="relative w-56 sm:w-64">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search…" className={`${inputCls} pl-9`} />
          </div>
        }
      >
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 dark:bg-slate-900/40 border-b border-gray-200 dark:border-slate-700 text-xs font-bold text-gray-500 uppercase tracking-wider">
                {columns.map(c => <th key={c.key} className="text-left px-4 py-3 whitespace-nowrap">{c.label}</th>)}
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-slate-700">
              {loading && items.length === 0 ? (
                <tr><td colSpan={columns.length + 1} className="px-4 py-10 text-center text-gray-500 dark:text-gray-400"><Loader2 className="inline animate-spin" size={18} /></td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={columns.length + 1} className="px-4 py-10 text-center text-gray-500 dark:text-gray-400">No {itemLabel}s found.</td></tr>
              ) : filtered.map(item => (
                <tr key={item.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/30 transition">
                  {columns.map(c => (
                    <td key={c.key} className="px-4 py-3 text-gray-700 dark:text-gray-200 max-w-[280px] truncate">
                      {c.toggle && c.type === 'boolean' ? (
                        <button onClick={() => toggle(item, c.key)} className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${item[c.key] ? 'bg-emerald-500' : 'bg-slate-300 dark:bg-slate-600'}`} aria-label={`Toggle ${c.label}`}>
                          <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${item[c.key] ? 'translate-x-4' : 'translate-x-0.5'}`} />
                        </button>
                      ) : display(c, item[c.key])}
                    </td>
                  ))}
                  <td className="px-4 py-3 whitespace-nowrap text-right">
                    {!noEdit && <button onClick={() => openEditor(item)} className="p-1.5 text-gray-400 hover:text-indigo-600 dark:hover:text-indigo-400" title="Edit"><Pencil size={15} /></button>}
                    {!noDelete && <button onClick={() => remove(item)} className="p-1.5 text-gray-400 hover:text-rose-600 dark:hover:text-rose-400" title="Delete"><Trash2 size={15} /></button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </SectionCard>

      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => !saving && setEditing(null)}>
          <div className={`w-full ${renderForm ? 'max-w-2xl' : 'max-w-xl'} max-h-[90vh] overflow-y-auto bg-white dark:bg-slate-900 rounded-2xl p-6 shadow-xl`} onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-black text-gray-900 dark:text-white">{editing === 'new' ? `Add ${itemLabel}` : `Edit ${itemLabel}`}</h3>
              <button onClick={() => setEditing(null)} className="text-gray-400 hover:text-gray-700 dark:hover:text-gray-300"><X size={18} /></button>
            </div>
            {renderForm ? React.createElement(renderForm, { form, setForm, editing }) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {effFields.map(fd => {
                const wide = fd.type === 'textarea' || fd.type === 'json';
                return (
                  <div key={fd.key} className={wide ? 'sm:col-span-2' : ''}>
                    {fd.type === 'boolean' ? (
                      <label className="flex items-center gap-2 text-sm font-semibold text-gray-700 dark:text-gray-200 mt-5">
                        <input type="checkbox" checked={!!form[fd.key]} onChange={e => setForm(f => ({ ...f, [fd.key]: e.target.checked }))} /> {fd.label}
                      </label>
                    ) : (
                      <>
                        <label className={labelCls}>{fd.label}{fd.required && ' *'}</label>
                        {fd.type === 'textarea' || fd.type === 'json' ? (
                          <textarea rows={fd.type === 'json' ? 6 : 4} value={form[fd.key]} onChange={e => setForm(f => ({ ...f, [fd.key]: e.target.value }))} placeholder={fd.placeholder} className={`${inputCls} ${fd.type === 'json' ? 'font-mono text-xs' : ''}`} />
                        ) : fd.type === 'select' ? (
                          <select value={form[fd.key]} onChange={e => setForm(f => ({ ...f, [fd.key]: e.target.value }))} className={inputCls}>
                            {fd.options?.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                          </select>
                        ) : (
                          <input disabled={fd.readOnly && editing !== 'new'} type={fd.type === 'number' ? 'number' : fd.type === 'date' ? 'date' : fd.type === 'password' ? 'password' : 'text'} value={form[fd.key]} onChange={e => setForm(f => ({ ...f, [fd.key]: e.target.value }))} placeholder={fd.type === 'list' ? 'comma, separated' : fd.placeholder} className={inputCls} />
                        )}
                      </>
                    )}
                    {fd.help && <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{fd.help}</p>}
                  </div>
                );
              })}
            </div>
            )}
            {formError && <div className="mt-4 p-3 rounded-xl bg-rose-50 dark:bg-rose-500/10 text-rose-700 dark:text-rose-400 text-sm border border-rose-100 dark:border-rose-500/20">{formError}</div>}
            <div className="mt-6 flex justify-end gap-2">
              <button onClick={() => setEditing(null)} disabled={saving} className={button.secondary}>Cancel</button>
              <button onClick={save} disabled={saving} className={button.primary}>{saving && <Loader2 size={14} className="animate-spin" />} Save</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default ResourceManager;
