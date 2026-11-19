import { useCallback, useEffect, useMemo, useState } from 'react';
import { useERP } from '../../context/ERPContext';
import { AlertTriangle, Bell, CheckCircle2, Database, DollarSign, Info, Loader2, RefreshCw, Save, ServerCrash, Settings, Shield, TrendingUp, Users, XCircle, type LucideIcon } from 'lucide-react';
import { PageHeader, SectionCard } from '../FrontOffice/ui';
import { button } from '../FrontOffice/brandTheme';
import { rmsGet, rmsPut } from '../../services/rmsService';

const API = '/api/rms-portal/configuration';

type Section = 'general' | 'pricing' | 'forecast' | 'competitor' | 'alerts' | 'preferences';
type Setting = { id: string; setting_key: string; section: Section; name: string; description: string | null; value: any; value_type: 'boolean' | 'number' | 'select'; options: string[] | null; display_order: number; updated_at: string };
type SysStatus = { id: string; component: string; status: 'operational' | 'warning' | 'error'; last_update: string };

const configSections: { id: Section; name: string; icon: LucideIcon }[] = [
  { id: 'general', name: 'General Settings', icon: Settings },
  { id: 'pricing', name: 'Pricing Rules', icon: DollarSign },
  { id: 'forecast', name: 'Forecast Settings', icon: TrendingUp },
  { id: 'competitor', name: 'Competitor Settings', icon: Users },
  { id: 'alerts', name: 'Alert Thresholds', icon: Bell },
  { id: 'preferences', name: 'User Preferences', icon: Shield },
];

const statusStyle: Record<string, string> = {
  operational: 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300',
  warning: 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300',
  error: 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300',
};
const statusIcon: Record<string, React.ElementType> = { operational: CheckCircle2, warning: AlertTriangle, error: XCircle };

const timeAgo = (iso: string) => {
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  return hrs < 24 ? `${hrs} hr ago` : `${Math.floor(hrs / 24)} d ago`;
};

export default function Configuration() {
  const { currentPropertyId } = useERP();
  const [settings, setSettings] = useState<Setting[]>([]);
  const [systemStatus, setSystemStatus] = useState<SysStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [selectedSection, setSelectedSection] = useState<Section>('general');
  const [draft, setDraft] = useState<Record<string, any>>({});

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const json = await rmsGet(API, { propertyId: currentPropertyId });
      setSettings(json.settings || []); setSystemStatus(json.systemStatus || []); setDraft({}); setSaved(false);
    } catch (e: any) { setError(e.message || 'Failed to load configuration'); }
    finally { setLoading(false); }
  }, [currentPropertyId]);
  useEffect(() => { load(); }, [load]);

  const setValue = (key: string, value: any) => { setDraft(p => ({ ...p, [key]: value })); setSaved(false); };
  const hasChanges = Object.keys(draft).length > 0;
  const effectiveValue = (s: Setting) => draft[s.setting_key] !== undefined ? draft[s.setting_key] : s.value;

  const handleSave = async () => {
    setSaving(true); setError(null);
    try {
      await rmsPut(API, { settings: draft }, { propertyId: currentPropertyId });
      setDraft({}); setSaved(true); await load();
    } catch (e: any) { setError(e.message); }
    finally { setSaving(false); }
  };
  const handleReset = () => { setDraft({}); setSaved(false); };

  const sectionSettings = useMemo(() => settings.filter(s => s.section === selectedSection).sort((a, b) => a.display_order - b.display_order), [settings, selectedSection]);
  const lastSynced = useMemo(() => settings.reduce((m, s) => s.updated_at > m ? s.updated_at : m, ''), [settings]);

  if (loading && !settings.length) return <div className="p-6 flex justify-center py-20 text-slate-400"><Loader2 className="w-6 h-6 animate-spin mr-2"/>Loading configuration…</div>;
  if (error && !settings.length) return <div className="p-6 flex flex-col items-center py-20 text-rose-600"><ServerCrash className="w-10 h-10 mb-3"/><p>{error}</p><button onClick={load} className="mt-4 text-blue-600">Retry</button></div>;

  return <div className="p-6 space-y-6">
    <PageHeader title="Configuration" subtitle="Manage RMS settings and preferences" actions={<div className="flex items-center gap-3">
      {saved && !hasChanges && <span className="text-sm text-green-600 flex items-center gap-1"><CheckCircle2 className="w-4 h-4"/>Saved</span>}
      {hasChanges && <><button onClick={handleReset} className={button.secondary}><RefreshCw className="w-4 h-4"/>Reset</button><button onClick={handleSave} disabled={saving} className={button.primary}>{saving ? <Loader2 className="w-4 h-4 animate-spin"/> : <Save className="w-4 h-4"/>}Save Changes</button></>}
    </div>} />
    {error && <div className="px-4 py-2 rounded-lg border border-rose-200 bg-rose-50 text-sm text-rose-600">{error}</div>}

    <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 p-4">
      <div className="flex gap-2 overflow-x-auto">
        {configSections.map(s => { const Icon = s.icon; return <button key={s.id} onClick={() => setSelectedSection(s.id)} className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors whitespace-nowrap ${selectedSection === s.id ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300' : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700'}`}><Icon className="w-4 h-4"/>{s.name}</button>; })}
      </div>
    </div>

    <SectionCard title={configSections.find(s => s.id === selectedSection)?.name || 'Settings'} icon={configSections.find(s => s.id === selectedSection)?.icon || Settings} pad="md" actions={<div className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400"><Database className="w-4 h-4"/><span>Last synced: {lastSynced ? timeAgo(lastSynced) : '—'}</span></div>}>
      <div className="space-y-4">
        {sectionSettings.map(s => <div key={s.id} className={`flex items-center justify-between p-4 rounded-lg border transition-colors ${draft[s.setting_key] !== undefined ? 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800' : 'bg-slate-50 dark:bg-slate-700/50 border-slate-200 dark:border-slate-600'}`}>
          <div className="flex-1"><h4 className="font-medium text-slate-900 dark:text-white">{s.name}</h4><p className="text-sm text-slate-600 dark:text-slate-400">{s.description}</p></div>
          <div className="ml-4">
            {s.value_type === 'boolean' && <button onClick={() => setValue(s.setting_key, !effectiveValue(s))} className={`relative w-12 h-6 rounded-full transition-colors ${effectiveValue(s) ? 'bg-blue-600' : 'bg-slate-300 dark:bg-slate-600'}`}><span className={`absolute top-1 left-1 w-4 h-4 bg-white rounded-full transition-transform ${effectiveValue(s) ? 'translate-x-6' : ''}`}/></button>}
            {s.value_type === 'number' && <input type="number" value={effectiveValue(s)} onChange={e => setValue(s.setting_key, Number(e.target.value))} className="w-24 px-3 py-2 bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-lg text-sm"/>}
            {s.value_type === 'select' && <select value={effectiveValue(s)} onChange={e => setValue(s.setting_key, e.target.value)} className="w-32 px-3 py-2 bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-lg text-sm">{(s.options || []).map(o => <option key={o} value={o}>{o}</option>)}</select>}
          </div>
        </div>)}
        {!sectionSettings.length && <p className="text-center py-8 text-slate-500">No settings in this section</p>}
      </div>
    </SectionCard>

    <SectionCard title="System Status" icon={Database} pad="md">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {systemStatus.map(st => { const Icon = statusIcon[st.status] || CheckCircle2; return <div key={st.id} className="p-4 bg-slate-50 dark:bg-slate-700/50 rounded-lg border border-slate-200 dark:border-slate-600">
          <div className="flex items-center justify-between mb-2"><h4 className="font-medium text-slate-900 dark:text-white">{st.component}</h4><Icon className={`w-5 h-5 ${st.status === 'operational' ? 'text-green-500' : st.status === 'warning' ? 'text-amber-500' : 'text-red-500'}`}/></div>
          <div className="flex items-center justify-between"><span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusStyle[st.status]}`}>{st.status}</span><span className="text-xs text-slate-600 dark:text-slate-400">{timeAgo(st.last_update)}</span></div>
        </div>; })}
      </div>
    </SectionCard>

    <div className="bg-blue-50 dark:bg-blue-900/20 rounded-xl border border-blue-200 dark:border-blue-800 p-6">
      <div className="flex items-start gap-3"><Info className="w-5 h-5 text-blue-600 dark:text-blue-400 mt-0.5"/><div><h4 className="font-medium text-slate-900 dark:text-white mb-2">Configuration Tips</h4><ul className="text-sm text-slate-600 dark:text-slate-400 space-y-1"><li>• Set appropriate rate change limits to prevent drastic price fluctuations</li><li>• Enable competitor monitoring to stay competitive in the market</li><li>• Configure alert thresholds to receive timely notifications</li><li>• Review forecast settings regularly to improve accuracy</li></ul></div></div>
    </div>
  </div>;
}
