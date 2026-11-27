/**
 * OrganizationHierarchyManager — Organization structure overview (Admin portal).
 *
 * Live DB-integrated: reads organizations and properties to show the org → property tree.
 * Editing redirects to the Tenant & Property tab for consistency.
 * Uses the shared UI system from Front Office for consistency with F&B, HK, and Engineering.
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Building2, MapPin, ChevronRight, Search, RefreshCw,
  Star, Layers, Globe,
} from 'lucide-react';
import StatCard from '../FrontOffice/StatCard';
import { PageHeader, SectionCard, Badge } from '../FrontOffice/ui';
import { card, button } from '../FrontOffice/brandTheme';
import { adminAuthHeaders } from './shared/ResourceManager';

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

const fmtAddress = (a: Record<string, string> | null | undefined) =>
  a ? [a.street, a.city, a.country].filter(Boolean).join(', ') : '';

const OrganizationHierarchyManager: React.FC<{ embedded?: boolean }> = ({ embedded }) => {
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [properties, setProperties] = useState<Property[]>([]);
  const [footprints, setFootprints] = useState<Record<string, FootprintItem[]>>({});
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [expandedOrgs, setExpandedOrgs] = useState<Set<string>>(new Set());

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/tenant-overview', { headers: adminAuthHeaders() });
      const ct = res.headers.get('content-type') || '';
      const body = ct.includes('json') ? await res.json() : null;
      if (!res.ok || !body) throw new Error(body?.error || 'Failed to load data');
      setOrganizations(body.organizations || []);
      setProperties(body.properties || []);
      setFootprints(body.footprints || {});
    } catch (e: any) {
      console.error('Failed to load hierarchy:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const toggleExpand = (orgId: string) => {
    setExpandedOrgs(prev => {
      const next = new Set(prev);
      if (next.has(orgId)) next.delete(orgId);
      else next.add(orgId);
      return next;
    });
  };

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return organizations.filter(org =>
      org.org_name.toLowerCase().includes(q) ||
      org.org_code.toLowerCase().includes(q) ||
      properties.some(p => p.organization_id === org.id && p.property_name.toLowerCase().includes(q))
    );
  }, [organizations, properties, search]);

  const orgProperties = (orgId: string) => properties.filter(p => p.organization_id === orgId);
  const orgRoomCount = (orgId: string) =>
    orgProperties(orgId).reduce((sum, p) => sum + ((footprints[p.id] || []).find(f => f.table === 'rooms')?.count || 0), 0);

  const totals = useMemo(() => ({
    rooms: properties.reduce((s, p) => s + ((footprints[p.id] || []).find(f => f.table === 'rooms')?.count || 0), 0),
    activeOrgs: organizations.filter(o => o.is_active).length,
    activeProps: properties.filter(p => p.is_active).length,
  }), [organizations, properties, footprints]);

  return (
    <div className="space-y-6 animate-fade-in">
      {embedded ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-gray-500 dark:text-gray-400">Tree view of organizations and their properties — edit details in Tenant & Property</p>
          <button onClick={loadData} className={button.secondary}>
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} /> Refresh
          </button>
        </div>
      ) : (
        <PageHeader
          title="Organization Structure"
          subtitle="Tree view of organizations and their properties — edit details in Tenant & Property"
          icon={Building2}
          actions={
            <button onClick={loadData} className={button.secondary}>
              <RefreshCw size={16} className={loading ? 'animate-spin' : ''} /> Refresh
            </button>
          }
        />
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard title="Organizations" value={`${totals.activeOrgs} active / ${organizations.length}`} icon={Building2} tone="accent" />
        <StatCard title="Properties" value={`${totals.activeProps} active / ${properties.length}`} icon={MapPin} tone="info" />
        <StatCard title="Total Rooms" value={totals.rooms} icon={Layers} tone="neutral" />
        <StatCard title="Currencies" value={new Set(properties.map(p => p.currency_code).filter(Boolean)).size} icon={Globe} tone="neutral" />
      </div>

      <SectionCard
        title="Organization Tree"
        subtitle={`${filtered.length} organization${filtered.length !== 1 ? 's' : ''}`}
        icon={Building2}
        tone="accent"
        pad="md"
        actions={
          <div className="relative w-full max-w-xs">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              placeholder="Search org or property..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-gray-900 dark:text-white outline-none focus:ring-1 focus:ring-[var(--color-accent-operations)]"
            />
          </div>
        }
      >
        {loading ? (
          <div className="text-center text-sm text-gray-500 py-8">Loading structure…</div>
        ) : filtered.length === 0 ? (
          <div className="text-center text-sm text-gray-500 py-8">No organizations match the search.</div>
        ) : (
          <div className="space-y-3">
            {filtered.map(org => {
              const props = orgProperties(org.id);
              const isExpanded = expandedOrgs.has(org.id);
              return (
                <div key={org.id} className="border border-gray-200 dark:border-slate-700 rounded-xl overflow-hidden">
                  <button
                    onClick={() => toggleExpand(org.id)}
                    className="w-full flex items-center justify-between px-4 py-3 bg-slate-50 dark:bg-slate-900/40 hover:bg-slate-100 dark:hover:bg-slate-800 transition text-left"
                  >
                    <div className="flex items-center gap-3">
                      <ChevronRight size={16} className={`transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
                      <div className={`p-1.5 rounded-lg ${org.is_active ? 'bg-[var(--color-accent-operations)]/10 text-[var(--color-accent-operations)]' : 'bg-slate-200 text-slate-500'}`}>
                        <Building2 size={16} />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-gray-900 dark:text-white">{org.org_name}</span>
                          <span className="text-xs font-mono text-gray-400">{org.org_code}</span>
                          {!org.is_active && <Badge tone="neutral">Inactive</Badge>}
                        </div>
                        <div className="text-xs text-gray-500 mt-0.5">
                          {props.length} propert{props.length !== 1 ? 'ies' : 'y'} · {orgRoomCount(org.id)} rooms
                        </div>
                      </div>
                    </div>
                    <a
                      href="/erp/admin/tenant_property"
                      className="text-xs text-[var(--color-accent-operations)] hover:underline"
                      onClick={e => e.stopPropagation()}
                    >
                      Edit in Tenant & Property
                    </a>
                  </button>

                  {isExpanded && props.length > 0 && (
                    <div className="divide-y divide-gray-100 dark:divide-slate-700 bg-white dark:bg-slate-800">
                      {props.map(p => {
                        const roomCount = (footprints[p.id] || []).find(f => f.table === 'rooms')?.count ?? 0;
                        return (
                          <div key={p.id} className="px-4 py-3 pl-12 flex items-center justify-between hover:bg-slate-50 dark:hover:bg-slate-700/30 transition">
                            <div className="flex items-center gap-3">
                              <div className={`p-1.5 rounded-lg ${p.is_active ? 'bg-emerald-100 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400' : 'bg-slate-100 text-slate-500'}`}>
                                <MapPin size={14} />
                              </div>
                              <div>
                                <div className="flex items-center gap-2">
                                  <span className="font-medium text-gray-900 dark:text-white">{p.property_name}</span>
                                  <span className="text-xs font-mono text-gray-400">{p.property_code}</span>
                                  {p.star_rating && <span className="text-amber-400 flex items-center gap-0.5"><Star size={12} fill="currentColor" />{p.star_rating}</span>}
                                  {!p.is_active && <Badge tone="neutral">Inactive</Badge>}
                                </div>
                                <div className="text-xs text-gray-500 mt-0.5">
                                  {p.property_type || 'hotel'} · {p.currency_code || '—'} · {roomCount} rooms
                                </div>
                              </div>
                            </div>
                            <a
                              href="/erp/admin/tenant_property"
                              className="text-xs text-gray-500 hover:text-[var(--color-accent-operations)]"
                            >
                              Edit
                            </a>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {isExpanded && props.length === 0 && (
                    <div className="px-4 py-6 pl-12 text-center text-sm text-gray-500 bg-white dark:bg-slate-800">
                      No properties assigned to this organization.
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </SectionCard>
    </div>
  );
};

export default OrganizationHierarchyManager;
