/**
 * PropertyManager — Tenant & Property management (Admin portal).
 *
 * Live DB-integrated: organizations and properties tables with per-property
 * footprint across all portals (FO, HK, F&B, Spa, Engineering, Banquet, Finance, HR, Inventory).
 *
 * Reuses the shared UI system from Front Office (StatCard, PageHeader, SectionCard, Badge)
 * for consistency with F&B, HK, and Engineering portals.
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Plus, RefreshCw, Building2, Hotel, MapPin, Phone, Mail, Pencil, Power,
  CheckCircle2, XCircle, Layers, Globe, Star, Edit, Trash2, Search, Filter,
} from 'lucide-react';
import { ModalSystem } from '../Shared/ModalSystem';
import StatCard from '../FrontOffice/StatCard';
import { PageHeader, SectionCard, Badge } from '../FrontOffice/ui';
import { card, button } from '../FrontOffice/brandTheme';

interface Organization {
  id: string;
  org_name: string;
  org_code: string;
  description: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  billing_address: Record<string, string> | null;
  is_active: boolean;
}

interface Property {
  id: string;
  organization_id: string | null;
  property_name: string;
  property_code: string;
  property_type: string | null;
  star_rating: number | null;
  address: Record<string, string> | null;
  timezone: string | null;
  currency_code: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  is_active: boolean;
}

interface FootprintItem { portal: string; metric: string; table: string; count: number | null }

const emptyOrg = { name: '', code: '', description: '', email: '', phone: '', street: '', city: '', country: '', isActive: true };
const emptyProp = { organizationId: '', name: '', code: '', propertyType: 'hotel', starRating: 3, timezone: 'Africa/Addis_Ababa', currency: 'ETB', email: '', phone: '', street: '', city: '', country: '', isActive: true };
const PROPERTY_TYPES = ['hotel', 'resort', 'lodge', 'guesthouse', 'apartment'];

const fmtAddress = (a: Record<string, string> | null | undefined) =>
  a ? [a.street, a.city, a.country].filter(Boolean).join(', ') : '';

const inputCls = 'w-full bg-slate-50 dark:bg-slate-950 border border-gray-200 dark:border-slate-700 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[var(--color-accent-operations)]';
const labelCls = 'text-xs font-medium text-gray-600 dark:text-gray-400 block mb-1.5';

const Field: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div><label className={labelCls}>{label}</label>{children}</div>
);

const authHeaders = (): Record<string, string> => {
  const token = localStorage.getItem('erp_token');
  return { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) };
};

const PropertyManager: React.FC = () => {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [properties, setProperties] = useState<Property[]>([]);
  const [footprints, setFootprints] = useState<Record<string, FootprintItem[]>>({});
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [orgModal, setOrgModal] = useState<{ id: string | null } | null>(null);
  const [propModal, setPropModal] = useState<{ id: string | null } | null>(null);
  const [orgForm, setOrgForm] = useState(emptyOrg);
  const [propForm, setPropForm] = useState(emptyProp);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all');

  const loadData = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const res = await fetch('/api/admin/tenant-overview', { headers: authHeaders() });
      const ct = res.headers.get('content-type') || '';
      const body = ct.includes('json') ? await res.json() : null;
      if (!res.ok || !body) throw new Error(body?.error || `API not available (${res.status}) — is the server running the latest routes?`);
      setOrganizations(body.organizations || []);
      setProperties(body.properties || []);
      setFootprints(body.footprints || {});
    } catch (err: any) { setError(err.message || 'Failed to load data'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const save = async (url: string, method: string, body: unknown, close: () => void) => {
    setSaving(true); setError(null);
    try {
      const res = await fetch(url, { method, headers: authHeaders(), body: JSON.stringify(body) });
      const data = (res.headers.get('content-type') || '').includes('json') ? await res.json().catch(() => ({})) : {};
      if (!res.ok) throw new Error(data.error || `Save failed (${res.status})`);
      close();
      await loadData();
    } catch (err: any) { setError(err.message || 'Save failed'); }
    finally { setSaving(false); }
  };

  const openOrg = (o?: Organization) => {
    setOrgForm(o ? {
      name: o.org_name, code: o.org_code, description: o.description || '', email: o.contact_email || '', phone: o.contact_phone || '',
      street: o.billing_address?.street || '', city: o.billing_address?.city || '', country: o.billing_address?.country || '', isActive: o.is_active,
    } : emptyOrg);
    setOrgModal({ id: o?.id ?? null });
  };

  const openProp = (p?: Property) => {
    setPropForm(p ? {
      organizationId: p.organization_id || '', name: p.property_name, code: p.property_code, propertyType: p.property_type || 'hotel',
      starRating: p.star_rating ?? 3, timezone: p.timezone || 'Africa/Addis_Ababa', currency: p.currency_code || 'ETB',
      email: p.contact_email || '', phone: p.contact_phone || '', street: p.address?.street || '', city: p.address?.city || '',
      country: p.address?.country || '', isActive: p.is_active,
    } : { ...emptyProp, organizationId: organizations[0]?.id || '' });
    setPropModal({ id: p?.id ?? null });
  };

  const submitOrg = () => orgModal && save(
    orgModal.id ? `/api/admin/organizations/${orgModal.id}` : '/api/admin/organizations',
    orgModal.id ? 'PATCH' : 'POST',
    { name: orgForm.name, code: orgForm.code, description: orgForm.description, email: orgForm.email, phone: orgForm.phone, isActive: orgForm.isActive,
      billingAddress: { street: orgForm.street, city: orgForm.city, country: orgForm.country } },
    () => setOrgModal(null),
  );

  const submitProp = () => propModal && save(
    propModal.id ? `/api/admin/properties/${propModal.id}` : '/api/admin/properties',
    propModal.id ? 'PATCH' : 'POST',
    { organizationId: propForm.organizationId, name: propForm.name, code: propForm.code, propertyType: propForm.propertyType,
      starRating: Number(propForm.starRating), timezone: propForm.timezone, currency: propForm.currency, email: propForm.email,
      phone: propForm.phone, isActive: propForm.isActive, address: { street: propForm.street, city: propForm.city, country: propForm.country } },
    () => setPropModal(null),
  );

  const toggleProperty = (p: Property) => save(`/api/admin/properties/${p.id}`, 'PATCH', { isActive: !p.is_active }, () => {});
  const toggleOrg = (o: Organization) => save(`/api/admin/organizations/${o.id}`, 'PATCH', { isActive: !o.is_active }, () => {});

  const sumPortal = (id: string, portal: string) =>
    (footprints[id] || []).filter(f => f.portal === portal).reduce((s, f) => s + (f.count || 0), 0);

  const totals = useMemo(() => ({
    rooms: properties.reduce((s, p) => s + ((footprints[p.id] || []).find(f => f.table === 'rooms')?.count || 0), 0),
    active: properties.filter(p => p.is_active).length,
  }), [properties, footprints]);

  const selected = properties.find(p => p.id === selectedId) || null;
  const selectedFootprint = selected ? footprints[selected.id] || [] : [];
  const portalGroups = useMemo(() => {
    const g: Record<string, FootprintItem[]> = {};
    selectedFootprint.forEach(f => { (g[f.portal] ||= []).push(f); });
    return Object.entries(g);
  }, [selectedFootprint]);

  const orgName = (id: string | null) => organizations.find(o => o.id === id)?.org_name || '—';

  const filtered = useMemo(() => properties.filter(p => {
    const matchesSearch = p.property_name.toLowerCase().includes(search.toLowerCase()) ||
      p.property_code.toLowerCase().includes(search.toLowerCase()) ||
      orgName(p.organization_id).toLowerCase().includes(search.toLowerCase());
    const matchesStatus = statusFilter === 'all' ||
      (statusFilter === 'active' && p.is_active) ||
      (statusFilter === 'inactive' && !p.is_active);
    return matchesSearch && matchesStatus;
  }), [properties, search, statusFilter, organizations]);

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="Organization & Property Hierarchy"
        subtitle="Multi-property management with live footprint across Front Office, Housekeeping, F&B, Spa, Engineering, Finance and more"
        icon={Building2}
        actions={
          <>
            <button onClick={loadData} className={button.secondary}>
              <RefreshCw size={16} className={loading ? 'animate-spin' : ''} /> Refresh
            </button>
            <button onClick={() => openProp()} disabled={organizations.length === 0} className={button.primary}>
              <Plus size={16} /> Add Property
            </button>
            <button onClick={() => openOrg()} className={button.primary}>
              <Plus size={16} /> Add Organization
            </button>
          </>
        }
      />

      {error && (
        <div className="p-4 bg-red-50 dark:bg-red-500/10 border border-red-100 dark:border-red-500/20 rounded-2xl">
          <p className="text-sm font-medium text-red-600 dark:text-red-400">{error}</p>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard title="Organizations" value={organizations.length} icon={Building2} tone="accent" />
        <StatCard title="Properties" value={`${totals.active} active / ${properties.length}`} icon={Hotel} tone="info" />
        <StatCard title="Total Rooms" value={totals.rooms} icon={Layers} tone="neutral" />
        <StatCard title="Currencies" value={new Set(properties.map(p => p.currency_code).filter(Boolean)).size} icon={Globe} tone="neutral" />
      </div>

      <SectionCard title="Organizations" subtitle={`${organizations.length} organization${organizations.length !== 1 ? 's' : ''}`} icon={Building2} tone="accent">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {organizations.map(org => {
            const orgProperties = properties.filter(p => p.organization_id === org.id);
            return (
              <div key={org.id} className={[card.base, 'relative', !org.is_active ? 'opacity-60' : ''].join(' ')}>
                <div className="flex items-start justify-between mb-3">
                  <div className="p-2 rounded-xl bg-[var(--color-accent-operations)]/10 text-[var(--color-accent-operations)]"><Building2 size={18} /></div>
                  <div className="flex items-center gap-1">
                    <span className="text-xs text-gray-400 mr-1">{orgProperties.length} properties</span>
                    <button title="Edit" onClick={() => openOrg(org)} className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 text-gray-500"><Pencil size={16} /></button>
                    <button title={org.is_active ? 'Deactivate' : 'Activate'} onClick={() => toggleOrg(org)} className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 text-gray-500"><Power size={16} /></button>
                  </div>
                </div>
                <h4 className="text-base font-bold text-gray-900 dark:text-white">{org.org_name} <span className="text-xs font-mono text-gray-400">{org.org_code}</span></h4>
                {org.description && <p className="text-sm text-gray-600 dark:text-gray-400 mt-0.5">{org.description}</p>}
                <div className="mt-3 space-y-1">
                  {fmtAddress(org.billing_address) && <p className="text-xs text-gray-500 flex items-center gap-1"><MapPin size={12} /> {fmtAddress(org.billing_address)}</p>}
                  {org.contact_phone && <p className="text-xs text-gray-500 flex items-center gap-1"><Phone size={12} /> {org.contact_phone}</p>}
                  {org.contact_email && <p className="text-xs text-gray-500 flex items-center gap-1"><Mail size={12} /> {org.contact_email}</p>}
                </div>
                {orgProperties.length > 0 && (
                  <div className="mt-3 pt-3 border-t border-gray-100 dark:border-slate-700">
                    <p className="text-[10px] font-medium text-gray-400 uppercase tracking-wider mb-1">Properties</p>
                    {orgProperties.map(p => (
                      <button key={p.id} onClick={() => setSelectedId(p.id)} className="flex items-center gap-1.5 py-0.5 w-full text-left hover:text-[var(--color-accent-operations)]">
                        <Hotel size={12} className="text-[var(--color-accent-operations)]" />
                        <span className="text-sm font-medium text-gray-700 dark:text-gray-300">{p.property_name}</span>
                        <span className="text-xs font-mono text-gray-400">{p.property_code}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
          {!loading && organizations.length === 0 && <p className="text-sm text-gray-400 font-medium col-span-full text-center py-8">No organizations yet.</p>}
        </div>
      </SectionCard>

      <SectionCard title="Properties" subtitle={`${filtered.length} of ${properties.length} shown`} icon={Hotel} tone="info">
        <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
          <div className="flex items-center gap-2">
            <Filter className="w-4 h-4 text-slate-400" />
            <select value={statusFilter} onChange={e => setStatusFilter(e.target.value as 'all' | 'active' | 'inactive')} className="px-3 py-2 text-sm border border-gray-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-gray-900 dark:text-white outline-none cursor-pointer">
              <option value="all">All Status</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </div>
          <div className="relative w-full max-w-xs">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input placeholder="Search name, code, org..." value={search} onChange={e => setSearch(e.target.value)} className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-gray-900 dark:text-white outline-none focus:ring-1 focus:ring-[var(--color-accent-operations)]" />
          </div>
        </div>

        {filtered.length === 0 ? (
          <div className="bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 p-12 rounded-2xl text-center">
            <Hotel className="w-10 h-10 mx-auto mb-3 text-slate-300 dark:text-slate-600" />
            <p className="text-sm text-gray-500">No properties match the filters.</p>
          </div>
        ) : (
          <div className="bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-2xl card-shadow overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-50 dark:bg-slate-900/40 border-b border-gray-200 dark:border-slate-700 text-xs font-bold text-gray-500 uppercase tracking-wider">
                    <th className="text-left px-4 py-3">Property</th>
                    <th className="text-left px-4 py-3 hidden md:table-cell">Organization</th>
                    <th className="text-left px-4 py-3 hidden lg:table-cell">Type</th>
                    <th className="text-left px-4 py-3 text-center">Rooms</th>
                    <th className="text-left px-4 py-3 text-center hidden sm:table-cell">Currency</th>
                    <th className="text-left px-4 py-3 hidden lg:table-cell">Timezone</th>
                    <th className="text-left px-4 py-3 hidden md:table-cell">Address</th>
                    <th className="text-left px-4 py-3 text-center">Status</th>
                    <th className="text-left px-4 py-3 text-center w-20">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-slate-700">
                  {filtered.map(p => {
                    const roomCount = (footprints[p.id] || []).find(f => f.table === 'rooms')?.count ?? 0;
                    return (
                      <tr
                        key={p.id}
                        onClick={() => setSelectedId(p.id)}
                        className={`cursor-pointer smooth-transition ${
                          selected?.id === p.id ? 'bg-[var(--color-accent-operations)]/5' : 'hover:bg-slate-50 dark:hover:bg-slate-700/30'
                        }`}
                      >
                        <td className="px-4 py-3">
                          <div className="font-bold text-gray-900 dark:text-white">{p.property_name}</div>
                          <div className="text-xs text-gray-500 font-mono">{p.property_code}</div>
                        </td>
                        <td className="px-4 py-3 hidden md:table-cell text-gray-600 dark:text-gray-300">{orgName(p.organization_id)}</td>
                        <td className="px-4 py-3 hidden lg:table-cell">
                          <span className="text-gray-600 dark:text-gray-400 capitalize">{p.property_type || '—'}</span>
                          {p.star_rating && <span className="ml-1 text-amber-400 flex items-center gap-0.5"><Star size={12} />{p.star_rating}</span>}
                        </td>
                        <td className="px-4 py-3 text-center">
                          <span className="font-medium text-gray-900 dark:text-white">{roomCount}</span>
                        </td>
                        <td className="px-4 py-3 text-center hidden sm:table-cell">
                          <span className="font-medium text-[var(--color-accent-operations)]">{p.currency_code || '—'}</span>
                        </td>
                        <td className="px-4 py-3 hidden lg:table-cell text-gray-600 dark:text-gray-400">{p.timezone || '—'}</td>
                        <td className="px-4 py-3 hidden md:table-cell text-gray-600 dark:text-gray-400 truncate max-w-[160px]">{fmtAddress(p.address) || '—'}</td>
                        <td className="px-4 py-3 text-center">
                          {p.is_active ? <Badge tone="success">Active</Badge> : <Badge tone="neutral">Inactive</Badge>}
                        </td>
                        <td className="px-4 py-3 text-center">
                          <div className="flex justify-center gap-1">
                            <button title="Edit" onClick={e => { e.stopPropagation(); openProp(p); }} className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 text-gray-500"><Pencil size={16} /></button>
                            <button title={p.is_active ? 'Deactivate' : 'Activate'} onClick={e => { e.stopPropagation(); toggleProperty(p); }} className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 text-gray-500"><Power size={16} /></button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </SectionCard>

      {selected && (
        <SectionCard title={`${selected.property_name} — Portal Footprint`} subtitle="Live row counts scoped to this property across every portal" icon={Layers} tone="neutral" actions={
          <button onClick={() => setSelectedId(null)} className={button.ghost}>Close</button>
        }>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {portalGroups.map(([portal, items]) => (
              <div key={portal} className="bg-slate-50 dark:bg-slate-900/40 rounded-xl p-4 border border-gray-200 dark:border-slate-700">
                <div className="flex items-center justify-between mb-3">
                  <p className="text-xs font-medium uppercase tracking-wider text-[var(--color-accent-operations)]">{portal}</p>
                  <span className="text-sm font-bold text-gray-900 dark:text-white">{sumPortal(selected.id, portal)}</span>
                </div>
                <div className="space-y-1.5">
                  {items.map(i => (
                    <div key={i.table} className="flex justify-between py-0.5 border-b border-gray-100 dark:border-slate-700 last:border-0">
                      <span className="text-sm text-gray-600 dark:text-gray-400">{i.metric}</span>
                      <span className="text-sm font-medium text-gray-900 dark:text-white">{i.count ?? '—'}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </SectionCard>
      )}

      <ModalSystem isOpen={!!orgModal} onClose={() => setOrgModal(null)} title={orgModal?.id ? 'Edit Organization' : 'New Organization'} subtitle="Hotel group or chain entity" variant="form" size="md" showFooter={false}>
        <div className="p-6 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <Field label="Name"><input value={orgForm.name} onChange={e => setOrgForm({ ...orgForm, name: e.target.value })} className={inputCls} /></Field>
            <Field label="Code"><input value={orgForm.code} onChange={e => setOrgForm({ ...orgForm, code: e.target.value.toUpperCase() })} className={inputCls} /></Field>
          </div>
          <Field label="Description"><input value={orgForm.description} onChange={e => setOrgForm({ ...orgForm, description: e.target.value })} className={inputCls} /></Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Email"><input value={orgForm.email} onChange={e => setOrgForm({ ...orgForm, email: e.target.value })} className={inputCls} /></Field>
            <Field label="Phone"><input value={orgForm.phone} onChange={e => setOrgForm({ ...orgForm, phone: e.target.value })} className={inputCls} /></Field>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <Field label="Street"><input value={orgForm.street} onChange={e => setOrgForm({ ...orgForm, street: e.target.value })} className={inputCls} /></Field>
            <Field label="City"><input value={orgForm.city} onChange={e => setOrgForm({ ...orgForm, city: e.target.value })} className={inputCls} /></Field>
            <Field label="Country"><input value={orgForm.country} onChange={e => setOrgForm({ ...orgForm, country: e.target.value })} className={inputCls} /></Field>
          </div>
        </div>
        <div className="p-6 border-t border-gray-200 dark:border-slate-700 flex justify-end gap-3 bg-slate-50 dark:bg-slate-900">
          <button onClick={() => setOrgModal(null)} className={button.secondary}>Cancel</button>
          <button onClick={submitOrg} disabled={saving} className={button.primary}>{saving ? 'Saving…' : (orgModal?.id ? 'Save' : 'Create')}</button>
        </div>
      </ModalSystem>

      <ModalSystem isOpen={!!propModal} onClose={() => setPropModal(null)} title={propModal?.id ? 'Edit Property' : 'New Property'} subtitle="Hotel property under an organization" variant="form" size="lg" showFooter={false}>
        <div className="p-6 space-y-4">
          <Field label="Organization">
            <select value={propForm.organizationId} onChange={e => setPropForm({ ...propForm, organizationId: e.target.value })} className={inputCls}>
              <option value="">— Select Organization —</option>
              {organizations.map(o => <option key={o.id} value={o.id}>{o.org_name}</option>)}
            </select>
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Property Name"><input value={propForm.name} onChange={e => setPropForm({ ...propForm, name: e.target.value })} className={inputCls} /></Field>
            <Field label="Code"><input value={propForm.code} onChange={e => setPropForm({ ...propForm, code: e.target.value.toUpperCase() })} className={inputCls} maxLength={12} /></Field>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <Field label="Type">
              <select value={propForm.propertyType} onChange={e => setPropForm({ ...propForm, propertyType: e.target.value })} className={inputCls}>
                {PROPERTY_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </Field>
            <Field label="Star Rating">
              <select value={propForm.starRating} onChange={e => setPropForm({ ...propForm, starRating: Number(e.target.value) })} className={inputCls}>
                {[1, 2, 3, 4, 5].map(n => <option key={n} value={n}>{n}</option>)}
              </select>
            </Field>
            <Field label="Currency">
              <select value={propForm.currency} onChange={e => setPropForm({ ...propForm, currency: e.target.value })} className={inputCls}>
                <option>ETB</option><option>USD</option><option>EUR</option><option>GBP</option>
              </select>
            </Field>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <Field label="Timezone"><input value={propForm.timezone} onChange={e => setPropForm({ ...propForm, timezone: e.target.value })} className={inputCls} /></Field>
            <Field label="Email"><input value={propForm.email} onChange={e => setPropForm({ ...propForm, email: e.target.value })} className={inputCls} /></Field>
            <Field label="Phone"><input value={propForm.phone} onChange={e => setPropForm({ ...propForm, phone: e.target.value })} className={inputCls} /></Field>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <Field label="Street"><input value={propForm.street} onChange={e => setPropForm({ ...propForm, street: e.target.value })} className={inputCls} /></Field>
            <Field label="City"><input value={propForm.city} onChange={e => setPropForm({ ...propForm, city: e.target.value })} className={inputCls} /></Field>
            <Field label="Country"><input value={propForm.country} onChange={e => setPropForm({ ...propForm, country: e.target.value })} className={inputCls} /></Field>
          </div>
        </div>
        <div className="p-6 border-t border-gray-200 dark:border-slate-700 flex justify-end gap-3 bg-slate-50 dark:bg-slate-900">
          <button onClick={() => setPropModal(null)} className={button.secondary}>Cancel</button>
          <button onClick={submitProp} disabled={saving} className={button.primary}>{saving ? 'Saving…' : (propModal?.id ? 'Save' : 'Create Property')}</button>
        </div>
      </ModalSystem>
    </div>
  );
};

export default PropertyManager;
