import React, { useCallback, useEffect, useState } from 'react';
import { Loader2, KeyRound, CheckCircle2, XCircle, Copy, Send, AlertTriangle, Clock } from 'lucide-react';
import { PageHeader, SectionCard, Badge } from '../FrontOffice/ui';
import { button } from '../FrontOffice/brandTheme';
import StatCard from '../FrontOffice/StatCard';
import { adminAuthHeaders } from './shared/ResourceManager';

interface ResetRequest {
  id: string;
  status: 'pending' | 'fulfilled' | 'cancelled' | 'expired';
  requested_identifier: string;
  requested_at: string;
  resolved_at: string | null;
  delivery_method: string | null;
  delivery_result: any;
  user: {
    id: string;
    name?: string;
    email?: string;
    username?: string;
    role?: string;
  } | null;
  resolvedBy: { id: string; name?: string } | null;
}

type DeliveryMethod = 'email' | 'sms' | 'both' | 'manual';

const METHOD_OPTIONS: { value: DeliveryMethod; label: string; hint: string }[] = [
  { value: 'both', label: 'Email + SMS', hint: 'Send via configured providers and show the password once' },
  { value: 'email', label: 'Email only', hint: 'Send via configured email provider' },
  { value: 'sms', label: 'SMS / WhatsApp', hint: 'Send via configured SMS provider' },
  { value: 'manual', label: 'Manual', hint: 'Show the password once — you send it yourself' },
];

const statusTone = (s: string) =>
  s === 'pending' ? 'warning' : s === 'fulfilled' ? 'success' : 'danger';

/**
 * Password Resets — approval queue for staff self-service password recovery.
 * Staff submit requests from the login screen ("Forgot password?"); approving
 * one issues a temporary password with force_password_change so the user must
 * set a real password at first sign-in.
 */
export default function PasswordResetRequests({ apiPath = '/api/admin/password-reset-requests' }: { apiPath?: string } = {}) {
  const [requests, setRequests] = useState<ResetRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [methodById, setMethodById] = useState<Record<string, DeliveryMethod>>({});
  const [issued, setIssued] = useState<{ requestId: string; userName: string; tempPassword: string; delivery: any } | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(apiPath, { headers: adminAuthHeaders() });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setRequests(data.requests || []);
    } catch (e: any) {
      setError(e.message || 'Failed to load reset requests');
    } finally {
      setLoading(false);
    }
  }, [apiPath]);

  useEffect(() => { load(); }, [load]);

  const approve = async (req: ResetRequest) => {
    const method = methodById[req.id] || 'both';
    setBusyId(req.id);
    try {
      const res = await fetch(`${apiPath}/${req.id}/approve`, {
        method: 'POST',
        headers: adminAuthHeaders(),
        body: JSON.stringify({ method }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setIssued({
        requestId: req.id,
        userName: req.user?.name || req.requested_identifier,
        tempPassword: data.tempPassword,
        delivery: data.delivery,
      });
      setCopied(false);
      await load();
    } catch (e: any) {
      alert(e.message || 'Failed to approve request');
    } finally {
      setBusyId(null);
    }
  };

  const cancel = async (req: ResetRequest) => {
    if (!window.confirm(`Cancel the password reset request from ${req.user?.name || req.requested_identifier}?`)) return;
    setBusyId(req.id);
    try {
      const res = await fetch(`${apiPath}/${req.id}/cancel`, {
        method: 'POST',
        headers: adminAuthHeaders(),
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      await load();
    } catch (e: any) {
      alert(e.message || 'Failed to cancel request');
    } finally {
      setBusyId(null);
    }
  };

  const copyPassword = async () => {
    if (!issued) return;
    try {
      await navigator.clipboard.writeText(issued.tempPassword);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard unavailable — the password is still visible for manual copy
    }
  };

  const pending = requests.filter(r => r.status === 'pending');
  const resolved = requests.filter(r => r.status !== 'pending');

  const deliverySummary = (d: any) => {
    if (!d) return '—';
    const parts: string[] = [];
    if (d.email?.provider && d.email.provider !== 'none') parts.push(`email: ${d.email.provider} (${d.email.delivered ?? 0} sent)`);
    if (d.sms?.provider && d.sms.provider !== 'none') parts.push(`sms: ${d.sms.provider} (${d.sms.delivered ?? 0} sent)`);
    if (parts.length === 0) return d.method === 'manual' ? 'manual hand-off' : 'no delivery';
    return parts.join(' · ');
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="Password Resets"
        subtitle="Approve staff password recovery requests and issue temporary credentials."
        icon={KeyRound}
      />

      {error && (
        <div className="p-4 rounded-xl text-sm font-bold flex items-center gap-2 bg-rose-50 dark:bg-rose-500/10 text-rose-700 dark:text-rose-400 border border-rose-100 dark:border-rose-500/20">
          <AlertTriangle size={16} /> {error}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard title="Pending Requests" value={pending.length} icon={Clock} tone="warning" />
        <StatCard title="Fulfilled" value={requests.filter(r => r.status === 'fulfilled').length} icon={CheckCircle2} tone="success" />
        <StatCard title="Cancelled" value={requests.filter(r => r.status === 'cancelled').length} icon={XCircle} tone="danger" />
      </div>

      <SectionCard title="Pending Requests" subtitle={`${pending.length} awaiting review`} icon={KeyRound} tone="warning" pad="none">
        {loading ? (
          <div className="p-8 text-center text-slate-500 flex items-center justify-center gap-2">
            <Loader2 size={16} className="animate-spin" /> Loading…
          </div>
        ) : pending.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-500">No pending password reset requests.</div>
        ) : (
          <div className="divide-y divide-gray-100 dark:divide-slate-700">
            {pending.map(req => (
              <div key={req.id} className="p-4 space-y-3">
                <div className="flex items-start justify-between gap-4 flex-wrap">
                  <div>
                    <div className="text-sm font-bold text-gray-900 dark:text-white">
                      {req.user?.name || 'Unknown user'}
                      {req.user?.role && <span className="ml-2 text-[10px] font-normal text-gray-400 uppercase">{req.user.role}</span>}
                    </div>
                    <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                      Requested as <span className="font-mono">{req.requested_identifier}</span>
                      {req.user?.email && <> · {req.user.email}</>}
                      {req.user?.username && <> · @{req.user.username}</>}
                    </div>
                    <div className="text-[10px] text-gray-400 mt-0.5">
                      {new Date(req.requested_at).toLocaleString()}
                    </div>
                  </div>
                  <Badge tone="warning">Pending</Badge>
                </div>

                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wide">Deliver via:</span>
                  <div className="flex bg-slate-100 dark:bg-slate-900/50 p-0.5 rounded-lg">
                    {METHOD_OPTIONS.map(m => (
                      <button
                        key={m.value}
                        onClick={() => setMethodById(prev => ({ ...prev, [req.id]: m.value }))}
                        title={m.hint}
                        className={`px-2.5 py-1 text-[10px] font-bold rounded-md transition ${(methodById[req.id] || 'both') === m.value ? 'bg-indigo-600 text-white' : 'text-slate-600 dark:text-slate-300 hover:text-slate-900'}`}
                      >
                        {m.label}
                      </button>
                    ))}
                  </div>
                  <button
                    onClick={() => approve(req)}
                    disabled={busyId === req.id}
                    className={button.primary}
                    title="Issue temporary password (user must change it at first login)"
                  >
                    {busyId === req.id ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                    Approve &amp; send
                  </button>
                  <button
                    onClick={() => cancel(req)}
                    disabled={busyId === req.id}
                    className="px-3 py-2 text-xs font-bold rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition disabled:opacity-50"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </SectionCard>

      <SectionCard title="History" subtitle="Resolved requests" icon={Clock} tone="info" pad="none">
        {resolved.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-500">No resolved requests yet.</div>
        ) : (
          <div className="divide-y divide-gray-100 dark:divide-slate-700">
            {resolved.map(req => (
              <div key={req.id} className="px-4 py-3 flex items-center justify-between gap-4 flex-wrap">
                <div>
                  <div className="text-sm font-bold text-gray-900 dark:text-white">{req.user?.name || req.requested_identifier}</div>
                  <div className="text-xs text-gray-500 dark:text-gray-400">
                    {req.status === 'fulfilled' ? `via ${req.delivery_method || 'provider'}` : 'cancelled'}
                    {req.resolvedBy?.name ? ` · by ${req.resolvedBy.name}` : ''}
                    {req.resolved_at ? ` · ${new Date(req.resolved_at).toLocaleString()}` : ''}
                  </div>
                  {req.status === 'fulfilled' && (
                    <div className="text-[10px] text-gray-400 mt-0.5">{deliverySummary(req.delivery_result)}</div>
                  )}
                </div>
                <Badge tone={statusTone(req.status)}>{req.status}</Badge>
              </div>
            ))}
          </div>
        )}
      </SectionCard>

      {/* One-time temporary password reveal */}
      {issued && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setIssued(null)}>
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-2xl max-w-md w-full p-6 space-y-4" onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-2">
              <KeyRound size={18} className="text-emerald-600" />
              <h3 className="text-base font-bold text-slate-900 dark:text-white">Temporary password issued</h3>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              For <span className="font-bold text-slate-700 dark:text-slate-200">{issued.userName}</span>. This is the only time the password is shown — send it via your chosen channel if it wasn't delivered automatically.
            </p>
            <div className="flex items-center gap-2">
              <code className="flex-1 px-3 py-2.5 bg-slate-100 dark:bg-slate-800 rounded-lg text-sm font-mono text-slate-900 dark:text-white select-all">{issued.tempPassword}</code>
              <button onClick={copyPassword} className="p-2.5 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition" title="Copy">
                <Copy size={16} />
              </button>
            </div>
            {copied && <p className="text-xs text-emerald-600 font-bold">Copied to clipboard</p>}
            <p className="text-[10px] text-slate-400">
              The user will be required to set a new password at first sign-in. Delivery: {deliverySummary(issued.delivery)}
            </p>
            <button onClick={() => setIssued(null)} className={button.primary + ' w-full justify-center'}>
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
