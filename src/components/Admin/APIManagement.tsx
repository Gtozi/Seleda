import React, { useState, useEffect, useCallback } from 'react';
import {
  RefreshCw, Key, Plus, Copy, Check, CheckCircle2, Clock, ShieldCheck,
  Ban, AlertTriangle, Globe, Loader2,
} from 'lucide-react';
import StatCard from '../FrontOffice/StatCard';
import { PageHeader, SectionCard, Badge } from '../FrontOffice/ui';
import { button } from '../FrontOffice/brandTheme';
import { ModalSystem } from '../Shared/ModalSystem';
import { adminAuthHeaders } from './shared/ResourceManager';

interface ApiKey {
  id: string;
  key_prefix: string;
  name: string;
  scopes: string[];
  rate_limit: number;
  created_at: string;
  expires_at: string | null;
  last_used: string | null;
  disabled: boolean;
}

const AVAILABLE_SCOPES = [
  'reservations:read', 'reservations:write',
  'rooms:read', 'rooms:write',
  'guests:read', 'guests:write',
  'folios:read', 'folios:write',
  'reports:read',
  'inventory:read', 'inventory:write',
  'security:ingest',
  '*',
];

const APIManagement: React.FC = () => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newKey, setNewKey] = useState<{ name: string; scopes: string[]; rateLimit: number; expiresAt: string }>({ name: '', scopes: [], rateLimit: 100, expiresAt: '' });
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);

  const notify = (msg: string, type: 'success' | 'error' = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 4000);
  };

  const api = async (path: string, opts: RequestInit = {}) => {
    const res = await fetch(`/api/admin${path}`, { headers: adminAuthHeaders(), ...opts });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.error || `Request failed (${res.status})`);
    return data;
  };

  const loadData = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const data = await api('/api-keys').catch(() => ({ keys: [] }));
      setKeys(data.keys || []);
    } catch (err: any) { setError(err.message); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const handleCreate = async () => {
    setBusy('create');
    try {
      const data = await api('/api-keys', { method: 'POST', body: JSON.stringify(newKey) });
      if (data.rawKey) {
        setCreatedKey(data.rawKey);
        notify('API key generated');
        loadData();
      }
    } catch (err: any) { setError(err.message); }
    finally { setBusy(null); }
  };

  const handleToggleDisable = async (key: ApiKey) => {
    setBusy(`toggle-${key.id}`);
    try {
      await api(`/api-keys/${key.id}`, { method: 'PATCH', body: JSON.stringify({ disabled: !key.disabled }) });
      notify(key.disabled ? 'Key reactivated' : 'Key revoked');
      loadData();
    } catch (err: any) { setError(err.message); }
    finally { setBusy(null); }
  };

  const handleCopy = () => {
    if (createdKey) {
      navigator.clipboard.writeText(createdKey);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const toggleScope = (scope: string) => {
    setNewKey(prev => ({
      ...prev,
      scopes: prev.scopes.includes(scope)
        ? prev.scopes.filter(s => s !== scope)
        : [...prev.scopes, scope],
    }));
  };

  const now = Date.now();
  const expiringSoon = keys.filter(k => k.expires_at && !k.disabled && new Date(k.expires_at).getTime() - now < 30 * 24 * 60 * 60 * 1000);
  const neverUsed = keys.filter(k => !k.last_used && !k.disabled).length;

  const cards = [
    { title: 'Total Keys', value: keys.length, icon: Key, tone: 'accent' as const },
    { title: 'Active', value: keys.filter(k => !k.disabled).length, icon: ShieldCheck, tone: 'success' as const },
    { title: 'Revoked', value: keys.filter(k => k.disabled).length, icon: Ban, tone: 'danger' as const },
    { title: 'Expiring <30d', value: expiringSoon.length, icon: AlertTriangle, tone: 'warning' as const },
    { title: 'Never Used', value: neverUsed, icon: Clock, tone: 'info' as const },
  ];

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="API Gateway"
        subtitle="Issue, scope, and revoke API keys for external integrations"
        icon={Globe}
        actions={
          <>
            <button onClick={loadData} disabled={loading} className={button.secondary}>
              <RefreshCw size={16} className={loading ? 'animate-spin' : ''} /> Refresh
            </button>
            <button onClick={() => { setNewKey({ name: '', scopes: [], rateLimit: 100, expiresAt: '' }); setCreatedKey(null); setShowCreateModal(true); }} className={button.primary}>
              <Plus size={16} /> Issue Key
            </button>
          </>
        }
      />

      {error && (
        <div className="p-4 rounded-xl text-sm font-bold flex items-center gap-2 bg-rose-50 dark:bg-rose-500/10 text-rose-700 dark:text-rose-400 border border-rose-100 dark:border-rose-500/20">
          <AlertTriangle size={16} /> {error}
        </div>
      )}
      {toast && (
        <div className={`p-4 rounded-xl text-sm font-bold flex items-center gap-2 border ${
          toast.type === 'success'
            ? 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-100 dark:border-emerald-500/20'
            : 'bg-rose-50 dark:bg-rose-500/10 text-rose-700 dark:text-rose-400 border-rose-100 dark:border-rose-500/20'
        }`}>
          {toast.type === 'success' ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />} {toast.msg}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
        {cards.map(c => <StatCard key={c.title} title={c.title} value={c.value} icon={c.icon} tone={c.tone} />)}
      </div>

      <SectionCard title="API Keys" subtitle={`${keys.length} keys issued`} icon={Key} tone="info" pad="none">
        {keys.length === 0 ? (
          <div className="p-8 text-center text-sm text-gray-400">{loading ? 'Loading keys…' : 'No API keys issued yet.'}</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-slate-700">
                  <th className="px-5 py-3">Name</th>
                  <th className="px-5 py-3">Key</th>
                  <th className="px-5 py-3">Scopes</th>
                  <th className="px-5 py-3">Rate Limit</th>
                  <th className="px-5 py-3">Last Used</th>
                  <th className="px-5 py-3">Expires</th>
                  <th className="px-5 py-3">Status</th>
                  <th className="px-5 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-slate-700">
                {keys.map(k => {
                  const expired = k.expires_at && new Date(k.expires_at).getTime() < now;
                  const expiring = k.expires_at && !expired && new Date(k.expires_at).getTime() - now < 30 * 24 * 60 * 60 * 1000;
                  return (
                    <tr key={k.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/30">
                      <td className="px-5 py-3 text-sm font-bold text-gray-900 dark:text-white">{k.name}</td>
                      <td className="px-5 py-3"><code className="text-xs font-mono font-bold text-gray-500 dark:text-gray-400">{k.key_prefix}…</code></td>
                      <td className="px-5 py-3">
                        <div className="flex flex-wrap gap-1">
                          {k.scopes.length === 0 ? <span className="text-xs text-gray-400">No scopes</span> :
                            k.scopes.slice(0, 3).map(s => <Badge key={s} tone="info">{s}</Badge>)}
                          {k.scopes.length > 3 && <Badge tone="neutral">+{k.scopes.length - 3}</Badge>}
                        </div>
                      </td>
                      <td className="px-5 py-3 text-xs font-bold text-gray-600 dark:text-gray-300">{k.rate_limit}/min</td>
                      <td className="px-5 py-3 text-xs text-gray-500 dark:text-gray-400">{k.last_used ? new Date(k.last_used).toLocaleString() : 'Never'}</td>
                      <td className="px-5 py-3 text-xs">
                        {expired ? <Badge tone="danger">Expired</Badge>
                          : expiring ? <Badge tone="warning">{new Date(k.expires_at!).toLocaleDateString()}</Badge>
                          : <span className="text-gray-500 dark:text-gray-400">{k.expires_at ? new Date(k.expires_at).toLocaleDateString() : 'Never'}</span>}
                      </td>
                      <td className="px-5 py-3">
                        <Badge tone={k.disabled ? 'danger' : 'success'}>{k.disabled ? 'Revoked' : 'Active'}</Badge>
                      </td>
                      <td className="px-5 py-3 text-right">
                        <button onClick={() => handleToggleDisable(k)} disabled={busy === `toggle-${k.id}`}
                          className={`${button.ghost} disabled:opacity-40 ${k.disabled ? 'hover:text-emerald-600' : 'hover:text-rose-600'}`}>
                          {busy === `toggle-${k.id}` ? <Loader2 size={14} className="animate-spin" /> : k.disabled ? 'Reactivate' : 'Revoke'}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      {/* Create Key Modal */}
      <ModalSystem isOpen={showCreateModal} onClose={() => setShowCreateModal(false)} title={createdKey ? 'API Key Created' : 'Issue New API Key'} subtitle={createdKey ? 'Copy your key now — it won\'t be shown again' : 'Generate a scoped API key for external integrations'} variant="form" size="lg" showFooter={false}>
        {createdKey ? (
          <div className="p-6 space-y-4">
            <div className="p-4 bg-amber-50 dark:bg-amber-500/10 border border-amber-100 dark:border-amber-500/20 rounded-2xl flex items-start gap-3">
              <Key size={18} className="text-amber-600 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-xs font-black text-amber-600">Store this key securely</p>
                <p className="text-[10px] font-bold text-amber-500 mt-1">This is the only time the full key will be displayed. Copy it now.</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <input readOnly value={createdKey} className="flex-1 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-[10px] font-mono font-bold text-slate-700 outline-none" />
              <button onClick={handleCopy} className="px-4 py-2 bg-indigo-600 text-white rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-indigo-700 transition flex items-center gap-1">
                {copied ? <Check size={12} /> : <Copy size={12} />} {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
          </div>
        ) : (
          <div className="p-6 space-y-4">
            <div>
              <label className="text-[10px] uppercase font-black tracking-widest text-slate-400 block mb-2">Key Name</label>
              <input value={newKey.name} onChange={e => setNewKey({ ...newKey, name: e.target.value })} className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-xs font-bold outline-none focus:ring-2 focus:ring-indigo-500" placeholder="e.g., Channel Manager Integration" />
            </div>
            <div>
              <label className="text-[10px] uppercase font-black tracking-widest text-slate-400 block mb-2">Scopes</label>
              <div className="grid grid-cols-3 gap-2">
                {AVAILABLE_SCOPES.map(s => (
                  <button key={s} onClick={() => toggleScope(s)} className={`px-2 py-1.5 rounded-lg text-[9px] font-mono font-black border-2 transition ${newKey.scopes.includes(s) ? 'border-indigo-500 bg-indigo-50 text-indigo-600 dark:bg-indigo-500/10 dark:text-indigo-400' : 'border-slate-100 dark:border-slate-800 text-slate-400'}`}>
                    {s}
                  </button>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-[10px] uppercase font-bold tracking-widest text-slate-400 block mb-2">Rate Limit (req/min)</label>
                <input type="number" value={newKey.rateLimit} onChange={e => setNewKey({ ...newKey, rateLimit: Number(e.target.value) })} className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-xs font-bold outline-none focus:ring-2 focus:ring-indigo-500" />
              </div>
              <div>
                <label className="text-[10px] uppercase font-bold tracking-widest text-slate-400 block mb-2">Expires At (optional)</label>
                <input type="date" value={newKey.expiresAt} onChange={e => setNewKey({ ...newKey, expiresAt: e.target.value })} className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-xs font-bold outline-none focus:ring-2 focus:ring-indigo-500" />
              </div>
            </div>
          </div>
        )}
        <div className="p-6 border-t border-slate-100 dark:border-slate-800 flex justify-end gap-3 bg-slate-50 dark:bg-slate-950">
          <button onClick={() => setShowCreateModal(false)} className={button.secondary}>{createdKey ? 'Close' : 'Cancel'}</button>
          {!createdKey && (
            <button onClick={handleCreate} disabled={!newKey.name.trim() || busy === 'create'} className={button.primary}>
              {busy === 'create' ? <Loader2 size={14} className="animate-spin" /> : <Key size={14} />} Generate Key
            </button>
          )}
        </div>
      </ModalSystem>
    </div>
  );
};

function CheckCircle2Icon() {
  return <Check size={16} />;
}

export default APIManagement;
