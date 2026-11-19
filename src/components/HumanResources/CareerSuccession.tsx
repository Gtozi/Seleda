/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * HR Career & Succession Planning — career paths, talent pool, succession
 * plans, and internal mobility.
 *
 * DB-integrated via /api/hr-portal/career/* routes. Uses tables from
 * migration 427.
 *
 * UI follows the F&B / Housekeeping portal pattern.
 */

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  TrendingUp,
  Users,
  Target,
  Briefcase,
  Plus,
  Search,
  Pencil,
  Trash2,
  Star,
  ChevronRight,
  Loader2,
  RefreshCw,
} from 'lucide-react';
import { useERP } from '../../context/ERPContext';
import StatCard from '../FrontOffice/StatCard';
import { PageHeader, SectionCard, Badge, Card } from '../FrontOffice/ui';
import { ModalSystem } from '../Shared/ModalSystem';
import { button, layout, statusTone } from '../FrontOffice/brandTheme';

type Tab = 'paths' | 'talent' | 'succession' | 'mobility';

interface CareerLevel {
  title: string;
  duration: string;
  skills: string[];
}

interface CareerPath {
  id: string;
  name: string;
  department: string | null;
  levels: CareerLevel[];
  active_employees: number;
  total_positions: number;
}

interface Talent {
  id: string;
  employee: string;
  current_position: string | null;
  department: string | null;
  potential: 'High' | 'Medium' | 'Low';
  readiness: string;
  target_position: string | null;
  career_path: string | null;
  performance_rating: number | null;
  last_review: string | null;
}

interface Successor {
  employee: string;
  readiness: string;
  status: 'Primary' | 'Backup';
}

interface SuccessionPlan {
  id: string;
  position: string;
  incumbent: string | null;
  department: string | null;
  successors: Successor[];
  risk_level: 'Low' | 'Medium' | 'High';
  last_updated: string | null;
}

interface Mobility {
  id: string;
  employee: string;
  from_position: string | null;
  to_position: string | null;
  department: string | null;
  status: 'In Progress' | 'Approved' | 'Completed' | 'Rejected';
  initiated_date: string | null;
  expected_completion: string | null;
}

interface Stats {
  careerPaths: number;
  talentPool: number;
  successionPlans: number;
  internalMobility: number;
  activeHighPotential: number;
  avgPerformance: number;
}

const TABS: { id: Tab; label: string; icon: any }[] = [
  { id: 'paths', label: 'Career Paths', icon: TrendingUp },
  { id: 'talent', label: 'Talent Pool', icon: Users },
  { id: 'succession', label: 'Succession', icon: Target },
  { id: 'mobility', label: 'Mobility', icon: Briefcase },
];

const POTENTIAL_TONE: Record<string, statusTone.StatusTone> = { High: 'success', Medium: 'warning', Low: 'neutral' };
const READINESS_TONE: Record<string, statusTone.StatusTone> = { 'Ready Now': 'success', 'Ready in 6-12 Months': 'warning', 'Ready in 1-2 Years': 'accent', 'Ready in 2-3 Years': 'neutral' };
const RISK_TONE: Record<string, statusTone.StatusTone> = { Low: 'success', Medium: 'warning', High: 'danger' };
const MOBILITY_TONE: Record<string, statusTone.StatusTone> = { Completed: 'success', Approved: 'accent', 'In Progress': 'warning', Rejected: 'danger' };

function authHeaders(json = false): Record<string, string> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('auth_token') : null;
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (json) headers['Content-Type'] = 'application/json';
  return headers;
}

const inputCls = 'w-full px-3 py-2 bg-slate-50 dark:bg-slate-850 border border-gray-200 dark:border-slate-700 rounded-xl text-sm outline-none focus:ring-1 focus:ring-indigo-500 font-sans';

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1.5">{label}</span>
      {children}
    </label>
  );
}

const CareerSuccession = () => {
  const { currentPropertyId, addNotification } = useERP();
  const [activeTab, setActiveTab] = useState<Tab>('paths');
  const [stats, setStats] = useState<Stats>({ careerPaths: 0, talentPool: 0, successionPlans: 0, internalMobility: 0, activeHighPotential: 0, avgPerformance: 0 });
  const [paths, setPaths] = useState<CareerPath[]>([]);
  const [talent, setTalent] = useState<Talent[]>([]);
  const [succession, setSuccession] = useState<SuccessionPlan[]>([]);
  const [mobility, setMobility] = useState<Mobility[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');

  const [showModal, setShowModal] = useState(false);
  const [modalType, setModalType] = useState<Tab>('paths');
  const [editingId, setEditingId] = useState<string | null>(null);

  const [pathForm, setPathForm] = useState({ name: '', department: '', activeEmployees: 0, totalPositions: 0, levelTitle: '', levelDuration: '', levelSkills: '' });
  const [talentForm, setTalentForm] = useState({ employee: '', currentPosition: '', department: '', potential: 'Medium', readiness: 'Ready in 2-3 Years', targetPosition: '', careerPath: '', performanceRating: '', lastReview: '' });
  const [successionForm, setSuccessionForm] = useState({ position: '', incumbent: '', department: '', riskLevel: 'Low', lastUpdated: '', successorName: '', successorReadiness: 'Ready Now', successorStatus: 'Primary' });
  const [mobilityForm, setMobilityForm] = useState({ employee: '', fromPosition: '', toPosition: '', department: '', status: 'In Progress', initiatedDate: '', expectedCompletion: '' });

  const fetchStats = useCallback(async () => {
    if (!currentPropertyId) return;
    try {
      const res = await fetch(`/api/hr-portal/career/statistics/${currentPropertyId}`, { headers: authHeaders() });
      if (res.ok) setStats(await res.json());
    } catch { /* non-fatal */ }
  }, [currentPropertyId]);

  const fetchPaths = useCallback(async () => {
    if (!currentPropertyId) return;
    try {
      const res = await fetch(`/api/hr-portal/career/paths/${currentPropertyId}`, { headers: authHeaders() });
      if (res.ok) setPaths(((await res.json()) as { paths: CareerPath[] }).paths || []);
    } catch { /* non-fatal */ }
  }, [currentPropertyId]);

  const fetchTalent = useCallback(async () => {
    if (!currentPropertyId) return;
    try {
      const res = await fetch(`/api/hr-portal/career/talent/${currentPropertyId}`, { headers: authHeaders() });
      if (res.ok) setTalent(((await res.json()) as { talent: Talent[] }).talent || []);
    } catch { /* non-fatal */ }
  }, [currentPropertyId]);

  const fetchSuccession = useCallback(async () => {
    if (!currentPropertyId) return;
    try {
      const res = await fetch(`/api/hr-portal/career/succession/${currentPropertyId}`, { headers: authHeaders() });
      if (res.ok) setSuccession(((await res.json()) as { plans: SuccessionPlan[] }).plans || []);
    } catch { /* non-fatal */ }
  }, [currentPropertyId]);

  const fetchMobility = useCallback(async () => {
    if (!currentPropertyId) return;
    try {
      const res = await fetch(`/api/hr-portal/career/mobility/${currentPropertyId}`, { headers: authHeaders() });
      if (res.ok) setMobility(((await res.json()) as { mobility: Mobility[] }).mobility || []);
    } catch { /* non-fatal */ }
  }, [currentPropertyId]);

  const refresh = useCallback(async () => {
    setLoading(true);
    await Promise.all([fetchStats(), fetchPaths(), fetchTalent(), fetchSuccession(), fetchMobility()]);
    setLoading(false);
  }, [fetchStats, fetchPaths, fetchTalent, fetchSuccession, fetchMobility]);

  useEffect(() => { if (currentPropertyId) refresh(); }, [currentPropertyId]);

  const filteredPaths = useMemo(() => {
    if (!search.trim()) return paths;
    const q = search.toLowerCase();
    return paths.filter((p) => p.name.toLowerCase().includes(q) || (p.department || '').toLowerCase().includes(q));
  }, [paths, search]);

  const filteredTalent = useMemo(() => {
    if (!search.trim()) return talent;
    const q = search.toLowerCase();
    return talent.filter((t) => t.employee.toLowerCase().includes(q) || (t.current_position || '').toLowerCase().includes(q) || (t.target_position || '').toLowerCase().includes(q));
  }, [talent, search]);

  const filteredSuccession = useMemo(() => {
    if (!search.trim()) return succession;
    const q = search.toLowerCase();
    return succession.filter((s) => s.position.toLowerCase().includes(q) || (s.incumbent || '').toLowerCase().includes(q) || (s.department || '').toLowerCase().includes(q));
  }, [succession, search]);

  const filteredMobility = useMemo(() => {
    if (!search.trim()) return mobility;
    const q = search.toLowerCase();
    return mobility.filter((m) => m.employee.toLowerCase().includes(q) || (m.from_position || '').toLowerCase().includes(q) || (m.to_position || '').toLowerCase().includes(q));
  }, [mobility, search]);

  const openCreate = (type: Tab) => {
    setModalType(type); setEditingId(null);
    if (type === 'paths') setPathForm({ name: '', department: '', activeEmployees: 0, totalPositions: 0, levelTitle: '', levelDuration: '', levelSkills: '' });
    if (type === 'talent') setTalentForm({ employee: '', currentPosition: '', department: '', potential: 'Medium', readiness: 'Ready in 2-3 Years', targetPosition: '', careerPath: '', performanceRating: '', lastReview: '' });
    if (type === 'succession') setSuccessionForm({ position: '', incumbent: '', department: '', riskLevel: 'Low', lastUpdated: '', successorName: '', successorReadiness: 'Ready Now', successorStatus: 'Primary' });
    if (type === 'mobility') setMobilityForm({ employee: '', fromPosition: '', toPosition: '', department: '', status: 'In Progress', initiatedDate: '', expectedCompletion: '' });
    setShowModal(true);
  };

  const handleSave = async () => {
    if (!currentPropertyId) return;
    setSaving(true);
    try {
      let endpoint = '';
      let method: 'POST' | 'PUT' = 'POST';
      let body: any = { propertyId: currentPropertyId };

      if (modalType === 'paths') {
        endpoint = editingId ? `/api/hr-portal/career/paths/${editingId}` : '/api/hr-portal/career/paths';
        method = editingId ? 'PUT' : 'POST';
        const levels: CareerLevel[] = editingId
          ? []
          : [{ title: pathForm.levelTitle, duration: pathForm.levelDuration, skills: pathForm.levelSkills.split(',').map((s) => s.trim()).filter(Boolean) }];
        body = { ...body, name: pathForm.name, department: pathForm.department, activeEmployees: pathForm.activeEmployees, totalPositions: pathForm.totalPositions, levels: levels.length ? levels : [] };
      } else if (modalType === 'talent') {
        endpoint = editingId ? `/api/hr-portal/career/talent/${editingId}` : '/api/hr-portal/career/talent';
        method = editingId ? 'PUT' : 'POST';
        body = { ...body, employee: talentForm.employee, currentPosition: talentForm.currentPosition, department: talentForm.department, potential: talentForm.potential, readiness: talentForm.readiness, targetPosition: talentForm.targetPosition, careerPath: talentForm.careerPath, performanceRating: talentForm.performanceRating, lastReview: talentForm.lastReview };
      } else if (modalType === 'succession') {
        endpoint = editingId ? `/api/hr-portal/career/succession/${editingId}` : '/api/hr-portal/career/succession';
        method = editingId ? 'PUT' : 'POST';
        const successors: Successor[] = editingId
          ? []
          : [{ employee: successionForm.successorName, readiness: successionForm.successorReadiness, status: successionForm.successorStatus }];
        body = { ...body, position: successionForm.position, incumbent: successionForm.incumbent, department: successionForm.department, successors, riskLevel: successionForm.riskLevel, lastUpdated: successionForm.lastUpdated };
      } else if (modalType === 'mobility') {
        endpoint = editingId ? `/api/hr-portal/career/mobility/${editingId}` : '/api/hr-portal/career/mobility';
        method = editingId ? 'PUT' : 'POST';
        body = { ...body, employee: mobilityForm.employee, fromPosition: mobilityForm.fromPosition, toPosition: mobilityForm.toPosition, department: mobilityForm.department, status: mobilityForm.status, initiatedDate: mobilityForm.initiatedDate, expectedCompletion: mobilityForm.expectedCompletion };
      }

      const res = await fetch(endpoint, { method, headers: authHeaders(true), body: JSON.stringify(body) });
      if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.error || `Failed (${res.status})`); }
      addNotification('Saved', 'success', 'HR');
      setShowModal(false); refresh();
    } catch (e: any) { addNotification(e?.message || 'Failed', 'danger', 'HR'); } finally { setSaving(false); }
  };

  const handleDelete = async (type: Tab, id: string) => {
    if (!confirm('Delete this record?')) return;
    setSaving(true);
    const endpoint = type === 'paths' ? `/api/hr-portal/career/paths/${id}` : type === 'talent' ? `/api/hr-portal/career/talent/${id}` : type === 'succession' ? `/api/hr-portal/career/succession/${id}` : `/api/hr-portal/career/mobility/${id}`;
    try {
      const res = await fetch(endpoint, { method: 'DELETE', headers: authHeaders() });
      if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.error || `Failed (${res.status})`); }
      addNotification('Deleted', 'success', 'HR');
      refresh();
    } catch (e: any) { addNotification(e?.message || 'Failed', 'danger', 'HR'); } finally { setSaving(false); }
  };

  const tabActionLabel = activeTab === 'paths' ? 'Add Path' : activeTab === 'talent' ? 'Add Talent' : activeTab === 'succession' ? 'Add Plan' : 'Initiate Transfer';

  if (!currentPropertyId) {
    return (
      <div className={layout.sectionStack}>
        <PageHeader title="Career & Succession Planning" subtitle="Manage career paths, talent pool, and succession planning" icon={TrendingUp} />
        <SectionCard>
          <div className="flex flex-col items-center justify-center py-16 text-slate-400">
            <TrendingUp className="w-10 h-10 mb-3 opacity-40" />
            <p className="text-sm">Select a property to view career data.</p>
          </div>
        </SectionCard>
      </div>
    );
  }

  return (
    <div className={layout.sectionStack}>
      <PageHeader
        title="Career & Succession Planning"
        subtitle="Manage career paths, talent pool, and succession planning"
        icon={TrendingUp}
        actions={
          <div className="flex items-center gap-2">
            <button onClick={refresh} className={button.ghost}><RefreshCw className="w-4 h-4" /> Refresh</button>
            <button onClick={() => openCreate(activeTab)} className={button.primary}><Plus className="w-4 h-4" /> {tabActionLabel}</button>
          </div>
        }
      />

      {/* KPIs */}
      <div className={layout.kpiGrid}>
        <StatCard title="Career Paths" value={String(stats.careerPaths)} caption="Defined paths" icon={TrendingUp} tone="accent" />
        <StatCard title="Talent Pool" value={String(stats.talentPool)} caption={`${stats.activeHighPotential} high potential`} icon={Users} tone="success" />
        <StatCard title="Succession Plans" value={String(stats.successionPlans)} caption="Critical roles" icon={Target} tone="info" />
        <StatCard title="Internal Mobility" value={String(stats.internalMobility)} caption={`Avg rating ${stats.avgPerformance}`} icon={Briefcase} tone="warning" />
      </div>

      {/* Tabs */}
      <div className="flex gap-2 bg-slate-100 dark:bg-slate-800 p-1 rounded-xl overflow-x-auto">
        {TABS.map((tab) => (
          <button key={tab.id} onClick={() => setActiveTab(tab.id)} className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition whitespace-nowrap ${activeTab === tab.id ? 'bg-white dark:bg-slate-700 text-indigo-600 shadow-sm' : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'}`}>
            <tab.icon size={14} /> {tab.label}
          </button>
        ))}
      </div>

      {/* Search */}
      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={14} />
        <input type="text" placeholder="Search..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9 pr-4 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-xs w-full focus:outline-none focus:ring-1 focus:ring-indigo-500 font-sans" />
      </div>

      {/* Career Paths */}
      {activeTab === 'paths' && (
        <div className="space-y-6">
          {loading ? <div className="flex items-center justify-center py-12 text-slate-400"><Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading…</div> : filteredPaths.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-slate-400">
              <TrendingUp className="w-8 h-8 mb-2 opacity-40" />
              <p className="text-sm">No career paths found.</p>
            </div>
          ) : filteredPaths.map((p) => (
            <SectionCard key={p.id}>
              <div className="flex items-center justify-between mb-6">
                <div>
                  <h3 className="text-base font-semibold text-slate-900 dark:text-white">{p.name}</h3>
                  <p className="text-xs font-medium text-slate-400">{p.department || '—'} · {p.active_employees}/{p.total_positions} Active</p>
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={() => handleDelete('paths', p.id)} className="p-1.5 hover:bg-rose-50 dark:hover:bg-rose-500/10 rounded-lg transition"><Trash2 size={14} className="text-rose-400" /></button>
                </div>
              </div>
              <div className="flex items-stretch justify-between overflow-x-auto">
                {(p.levels || []).map((level, index) => (
                  <div key={index} className="flex-1 min-w-[180px] flex items-stretch">
                    <div className="w-full">
                      <Card pad="md" className="h-full">
                        <div className="flex items-center gap-2 mb-2">
                          <div className="w-6 h-6 bg-indigo-100 text-indigo-600 rounded-full flex items-center justify-center text-xs font-medium">{index + 1}</div>
                          <h4 className="text-sm font-semibold text-slate-900 dark:text-white">{level.title}</h4>
                        </div>
                        <p className="text-xs font-medium text-slate-400 mb-2">{level.duration}</p>
                        <div className="flex flex-wrap gap-1">
                          {(level.skills || []).slice(0, 2).map((skill) => <Badge key={skill} tone="accent" size="sm">{skill}</Badge>)}
                          {(level.skills || []).length > 2 && <Badge tone="neutral" size="sm">+{(level.skills || []).length - 2}</Badge>}
                        </div>
                      </Card>
                      {index < (p.levels || []).length - 1 && (
                        <div className="flex justify-center my-2"><ChevronRight size={16} className="text-slate-300" /></div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </SectionCard>
          ))}
        </div>
      )}

      {/* Talent Pool */}
      {activeTab === 'talent' && (
        <SectionCard pad="none">
          <div className="p-6 border-b border-slate-50 dark:border-slate-800"><h3 className="text-base font-semibold text-slate-900 dark:text-white">Talent Pool</h3></div>
          {loading ? <div className="flex items-center justify-center py-12 text-slate-400"><Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading…</div> : filteredTalent.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-slate-400">
              <Users className="w-8 h-8 mb-2 opacity-40" />
              <p className="text-sm">No talent records found.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50/50 dark:bg-slate-950/20">
                    <th className="px-6 py-4 text-xs font-medium text-slate-500">Employee</th>
                    <th className="px-6 py-4 text-xs font-medium text-slate-500">Current Position</th>
                    <th className="px-6 py-4 text-xs font-medium text-slate-500 text-center">Potential</th>
                    <th className="px-6 py-4 text-xs font-medium text-slate-500 text-center">Readiness</th>
                    <th className="px-6 py-4 text-xs font-medium text-slate-500">Target Position</th>
                    <th className="px-6 py-4 text-xs font-medium text-slate-500 text-center">Performance</th>
                    <th className="px-6 py-4 text-xs font-medium text-slate-500 text-center">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50 dark:divide-slate-800">
                  {filteredTalent.map((t) => (
                    <tr key={t.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition-colors">
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 bg-indigo-50 dark:bg-indigo-500/20 rounded-lg flex items-center justify-center text-xs font-medium text-indigo-600 dark:text-indigo-400">
                            {t.employee.split(' ').map(n => n[0]).join('')}
                          </div>
                          <span className="text-sm font-semibold text-slate-900 dark:text-white">{t.employee}</span>
                        </div>
                      </td>
                      <td className="px-6 py-4"><div><span className="text-sm font-semibold text-slate-900 dark:text-white block">{t.current_position || '—'}</span><span className="text-xs font-medium text-slate-400">{t.department || '—'}</span></div></td>
                      <td className="px-6 py-4 text-center"><Badge tone={POTENTIAL_TONE[t.potential]}>{t.potential}</Badge></td>
                      <td className="px-6 py-4 text-center"><Badge tone={READINESS_TONE[t.readiness] ?? 'neutral'}>{t.readiness}</Badge></td>
                      <td className="px-6 py-4 text-xs font-bold text-slate-900 dark:text-white">{t.target_position || '—'}</td>
                      <td className="px-6 py-4 text-center">
                        <div className="flex items-center justify-center gap-1">
                          <Star className="text-amber-400" size={12} fill="currentColor" />
                          <span className="text-sm font-semibold text-slate-900 dark:text-white">{t.performance_rating ?? '—'}</span>
                        </div>
                      </td>
                      <td className="px-6 py-4"><div className="flex justify-center gap-2"><button onClick={() => handleDelete('talent', t.id)} className="p-1.5 hover:bg-rose-50 dark:hover:bg-rose-500/10 rounded-lg transition"><Trash2 size={14} className="text-rose-400" /></button></div></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </SectionCard>
      )}

      {/* Succession */}
      {activeTab === 'succession' && (
        <div className="space-y-6">
          {loading ? <div className="flex items-center justify-center py-12 text-slate-400"><Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading…</div> : filteredSuccession.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-slate-400">
              <Target className="w-8 h-8 mb-2 opacity-40" />
              <p className="text-sm">No succession plans found.</p>
            </div>
          ) : filteredSuccession.map((p) => (
            <SectionCard key={p.id}>
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 bg-indigo-100 dark:bg-indigo-500/20 rounded-xl flex items-center justify-center">
                    <Briefcase className="text-indigo-600 dark:text-indigo-400" size={24} />
                  </div>
                  <div>
                    <h3 className="text-base font-semibold text-slate-900 dark:text-white">{p.position}</h3>
                    <p className="text-xs font-medium text-slate-400">Incumbent: {p.incumbent || '—'} · {p.department || '—'}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge tone={RISK_TONE[p.risk_level]}>{p.risk_level} Risk</Badge>
                  <button onClick={() => handleDelete('succession', p.id)} className="p-1.5 hover:bg-rose-50 dark:hover:bg-rose-500/10 rounded-lg transition"><Trash2 size={14} className="text-rose-400" /></button>
                </div>
              </div>
              <h4 className="text-xs font-medium text-slate-500 mb-2">Successors</h4>
              <div className="grid md:grid-cols-2 gap-4">
                {(p.successors || []).map((successor, index) => (
                  <Card key={index} pad="sm" className={successor.status === 'Primary' ? 'bg-indigo-50/50 dark:bg-indigo-500/10 border-indigo-200 dark:border-indigo-500/30' : ''}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm font-semibold text-slate-900 dark:text-white">{successor.employee}</span>
                      <Badge tone={successor.status === 'Primary' ? 'accent' : 'neutral'}>{successor.status}</Badge>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-medium text-slate-400">{successor.readiness}</span>
                    </div>
                  </Card>
                ))}
              </div>
            </SectionCard>
          ))}
        </div>
      )}

      {/* Mobility */}
      {activeTab === 'mobility' && (
        <SectionCard pad="none">
          <div className="p-6 border-b border-slate-50 dark:border-slate-800"><h3 className="text-base font-semibold text-slate-900 dark:text-white">Internal Mobility</h3></div>
          {loading ? <div className="flex items-center justify-center py-12 text-slate-400"><Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading…</div> : filteredMobility.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-slate-400">
              <Briefcase className="w-8 h-8 mb-2 opacity-40" />
              <p className="text-sm">No mobility records found.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50/50 dark:bg-slate-950/20">
                    <th className="px-6 py-4 text-xs font-medium text-slate-500">Employee</th>
                    <th className="px-6 py-4 text-xs font-medium text-slate-500">From Position</th>
                    <th className="px-6 py-4 text-xs font-medium text-slate-500">To Position</th>
                    <th className="px-6 py-4 text-xs font-medium text-slate-500">Department</th>
                    <th className="px-6 py-4 text-xs font-medium text-slate-500">Initiated</th>
                    <th className="px-6 py-4 text-xs font-medium text-slate-500">Expected</th>
                    <th className="px-6 py-4 text-xs font-medium text-slate-500 text-center">Status</th>
                    <th className="px-6 py-4 text-xs font-medium text-slate-500 text-center">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50 dark:divide-slate-800">
                  {filteredMobility.map((m) => (
                    <tr key={m.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition-colors">
                      <td className="px-6 py-4 text-sm font-semibold text-slate-900 dark:text-white">{m.employee}</td>
                      <td className="px-6 py-4 text-sm font-medium text-slate-500">{m.from_position || '—'}</td>
                      <td className="px-6 py-4 text-xs font-bold text-indigo-600">{m.to_position || '—'}</td>
                      <td className="px-6 py-4 text-sm font-medium text-slate-500">{m.department || '—'}</td>
                      <td className="px-6 py-4 text-sm font-medium text-slate-500">{m.initiated_date || '—'}</td>
                      <td className="px-6 py-4 text-sm font-medium text-slate-500">{m.expected_completion || '—'}</td>
                      <td className="px-6 py-4 text-center"><Badge tone={MOBILITY_TONE[m.status]}>{m.status}</Badge></td>
                      <td className="px-6 py-4"><div className="flex justify-center gap-2"><button onClick={() => handleDelete('mobility', m.id)} className="p-1.5 hover:bg-rose-50 dark:hover:bg-rose-500/10 rounded-lg transition"><Trash2 size={14} className="text-rose-400" /></button></div></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </SectionCard>
      )}

      {/* Modal */}
      <ModalSystem
        isOpen={showModal}
        onClose={() => setShowModal(false)}
        onConfirm={handleSave}
        title={editingId ? 'Edit' : 'Add'} variant="form" size="lg" confirmLabel={saving ? 'Saving…' : 'Save'} confirmColor="indigo" loading={saving}
      >
        {modalType === 'paths' && (
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2"><Field label="Path Name"><input className={inputCls} value={pathForm.name} onChange={(e) => setPathForm(f => ({ ...f, name: e.target.value }))} /></Field></div>
            <Field label="Department"><input className={inputCls} value={pathForm.department} onChange={(e) => setPathForm(f => ({ ...f, department: e.target.value }))} /></Field>
            <Field label="Active Employees"><input type="number" className={inputCls} value={pathForm.activeEmployees} onChange={(e) => setPathForm(f => ({ ...f, activeEmployees: Number(e.target.value) }))} /></Field>
            <Field label="Total Positions"><input type="number" className={inputCls} value={pathForm.totalPositions} onChange={(e) => setPathForm(f => ({ ...f, totalPositions: Number(e.target.value) }))} /></Field>
            <div className="col-span-2"><p className="text-xs font-medium text-slate-400 mb-2">First level</p></div>
            <Field label="Level Title"><input className={inputCls} value={pathForm.levelTitle} onChange={(e) => setPathForm(f => ({ ...f, levelTitle: e.target.value }))} /></Field>
            <Field label="Duration"><input className={inputCls} value={pathForm.levelDuration} onChange={(e) => setPathForm(f => ({ ...f, levelDuration: e.target.value }))} /></Field>
            <div className="col-span-2"><Field label="Skills (comma separated)"><input className={inputCls} value={pathForm.levelSkills} onChange={(e) => setPathForm(f => ({ ...f, levelSkills: e.target.value }))} /></Field></div>
          </div>
        )}
        {modalType === 'talent' && (
          <div className="grid grid-cols-2 gap-4">
            <Field label="Employee"><input className={inputCls} value={talentForm.employee} onChange={(e) => setTalentForm(f => ({ ...f, employee: e.target.value }))} /></Field>
            <Field label="Current Position"><input className={inputCls} value={talentForm.currentPosition} onChange={(e) => setTalentForm(f => ({ ...f, currentPosition: e.target.value }))} /></Field>
            <Field label="Department"><input className={inputCls} value={talentForm.department} onChange={(e) => setTalentForm(f => ({ ...f, department: e.target.value }))} /></Field>
            <Field label="Target Position"><input className={inputCls} value={talentForm.targetPosition} onChange={(e) => setTalentForm(f => ({ ...f, targetPosition: e.target.value }))} /></Field>
            <Field label="Career Path"><input className={inputCls} value={talentForm.careerPath} onChange={(e) => setTalentForm(f => ({ ...f, careerPath: e.target.value }))} /></Field>
            <Field label="Performance Rating"><input className={inputCls} value={talentForm.performanceRating} onChange={(e) => setTalentForm(f => ({ ...f, performanceRating: e.target.value }))} /></Field>
            <Field label="Potential">
              <select className={inputCls} value={talentForm.potential} onChange={(e) => setTalentForm(f => ({ ...f, potential: e.target.value as any }))}>
                {['High', 'Medium', 'Low'].map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </Field>
            <Field label="Readiness">
              <select className={inputCls} value={talentForm.readiness} onChange={(e) => setTalentForm(f => ({ ...f, readiness: e.target.value }))}>
                {['Ready Now', 'Ready in 6-12 Months', 'Ready in 1-2 Years', 'Ready in 2-3 Years'].map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </Field>
            <Field label="Last Review"><input type="date" className={inputCls} value={talentForm.lastReview} onChange={(e) => setTalentForm(f => ({ ...f, lastReview: e.target.value }))} /></Field>
          </div>
        )}
        {modalType === 'succession' && (
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2"><Field label="Position"><input className={inputCls} value={successionForm.position} onChange={(e) => setSuccessionForm(f => ({ ...f, position: e.target.value }))} /></Field></div>
            <Field label="Incumbent"><input className={inputCls} value={successionForm.incumbent} onChange={(e) => setSuccessionForm(f => ({ ...f, incumbent: e.target.value }))} /></Field>
            <Field label="Department"><input className={inputCls} value={successionForm.department} onChange={(e) => setSuccessionForm(f => ({ ...f, department: e.target.value }))} /></Field>
            <Field label="Risk Level">
              <select className={inputCls} value={successionForm.riskLevel} onChange={(e) => setSuccessionForm(f => ({ ...f, riskLevel: e.target.value as any }))}>
                {['Low', 'Medium', 'High'].map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </Field>
            <Field label="Last Updated"><input type="date" className={inputCls} value={successionForm.lastUpdated} onChange={(e) => setSuccessionForm(f => ({ ...f, lastUpdated: e.target.value }))} /></Field>
            <div className="col-span-2"><p className="text-xs font-medium text-slate-400 mb-2">First successor</p></div>
            <Field label="Successor Name"><input className={inputCls} value={successionForm.successorName} onChange={(e) => setSuccessionForm(f => ({ ...f, successorName: e.target.value }))} /></Field>
            <Field label="Successor Status">
              <select className={inputCls} value={successionForm.successorStatus} onChange={(e) => setSuccessionForm(f => ({ ...f, successorStatus: e.target.value as any }))}>
                {['Primary', 'Backup'].map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </Field>
            <div className="col-span-2"><Field label="Successor Readiness">
              <select className={inputCls} value={successionForm.successorReadiness} onChange={(e) => setSuccessionForm(f => ({ ...f, successorReadiness: e.target.value }))}>
                {['Ready Now', 'Ready in 6-12 Months', 'Ready in 1-2 Years', 'Ready in 2-3 Years'].map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </Field></div>
          </div>
        )}
        {modalType === 'mobility' && (
          <div className="grid grid-cols-2 gap-4">
            <Field label="Employee"><input className={inputCls} value={mobilityForm.employee} onChange={(e) => setMobilityForm(f => ({ ...f, employee: e.target.value }))} /></Field>
            <Field label="Department"><input className={inputCls} value={mobilityForm.department} onChange={(e) => setMobilityForm(f => ({ ...f, department: e.target.value }))} /></Field>
            <Field label="From Position"><input className={inputCls} value={mobilityForm.fromPosition} onChange={(e) => setMobilityForm(f => ({ ...f, fromPosition: e.target.value }))} /></Field>
            <Field label="To Position"><input className={inputCls} value={mobilityForm.toPosition} onChange={(e) => setMobilityForm(f => ({ ...f, toPosition: e.target.value }))} /></Field>
            <Field label="Status">
              <select className={inputCls} value={mobilityForm.status} onChange={(e) => setMobilityForm(f => ({ ...f, status: e.target.value as any }))}>
                {['In Progress', 'Approved', 'Completed', 'Rejected'].map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </Field>
            <Field label="Initiated Date"><input type="date" className={inputCls} value={mobilityForm.initiatedDate} onChange={(e) => setMobilityForm(f => ({ ...f, initiatedDate: e.target.value }))} /></Field>
            <Field label="Expected Completion"><input type="date" className={inputCls} value={mobilityForm.expectedCompletion} onChange={(e) => setMobilityForm(f => ({ ...f, expectedCompletion: e.target.value }))} /></Field>
          </div>
        )}
      </ModalSystem>
    </div>
  );
};

export default CareerSuccession;
