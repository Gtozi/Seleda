import React, { useCallback, useEffect, useState } from 'react';
import { Play, Check, X, Loader2, AlertTriangle, FlaskConical, HelpCircle } from 'lucide-react';
import { ResourceManager, adminAuthHeaders } from '../shared/ResourceManager';
import { SectionCard, Badge } from '../../FrontOffice/ui';
import { button } from '../../FrontOffice/brandTheme';

const box = 'bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl p-4';
const input = 'w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500';
const label = 'text-[10px] font-bold text-slate-400 uppercase tracking-widest block mb-1.5';

/** Try a condition/action against a sample context without saving anything. */
export const RuleTester: React.FC = () => {
  const [condition, setCondition] = useState("booking.nights >= 7 and booking.channel == 'public'");
  const [action, setAction] = useState('flag("long_stay"); notify("long_stay")');
  const [context, setContext] = useState('{\n  "booking": { "nights": 8, "channel": "public", "total": 1200 }\n}');
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showHelp, setShowHelp] = useState(false);

  const run = async () => {
    setBusy(true); setError(null); setResult(null);
    try {
      const res = await fetch('/api/admin/control/rules/evaluate', { method: 'POST', headers: adminAuthHeaders(), body: JSON.stringify({ condition, action, context: JSON.parse(context || '{}') }) });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || `Request failed (${res.status})`);
      setResult(json);
    } catch (e: any) {
      setError(e instanceof SyntaxError ? 'Sample context is not valid JSON' : e.message);
    } finally { setBusy(false); }
  };

  return (
    <SectionCard title="Rule Tester" subtitle="Test conditions and actions against sample data" icon={FlaskConical} tone="accent" pad="md">
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <p className="text-xs text-gray-600 dark:text-gray-400">
            Test rule conditions and actions before saving. Use sample JSON context to simulate real scenarios.
          </p>
          <button 
            onClick={() => setShowHelp(!showHelp)} 
            className="p-1.5 text-gray-400 hover:text-indigo-600 transition"
            title="Show syntax help"
          >
            <HelpCircle size={16} />
          </button>
        </div>

        {showHelp && (
          <div className="p-4 bg-slate-50 dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700">
            <div className="space-y-3 text-xs">
              <div>
                <div className="font-bold text-slate-700 dark:text-slate-300 mb-1">Condition Syntax:</div>
                <code className="text-[10px] bg-white dark:bg-slate-900 px-2 py-1 rounded">==  !=  &gt;  &gt;=  &lt;  &lt;=  in [..]  contains  and  or  not</code>
              </div>
              <div>
                <div className="font-bold text-slate-700 dark:text-slate-300 mb-1">Available Actions:</div>
                <div className="space-y-1 text-[10px]">
                  <div><code>block("msg")</code> - Block the operation</div>
                  <div><code>require_approval("role")</code> - Require specific role approval</div>
                  <div><code>set("field", value)</code> - Set field value</div>
                  <div><code>notify("template")</code> - Send notification</div>
                  <div><code>flag("reason")</code> - Flag for review</div>
                </div>
              </div>
              <div>
                <div className="font-bold text-slate-700 dark:text-slate-300 mb-1">Categories:</div>
                <div className="space-y-1 text-[10px]">
                  <div><Badge tone="info">booking</Badge> - booking.nights, booking.total, booking.rooms, booking.channel</div>
                  <div><Badge tone="warning">procurement</Badge> - po.total, amount, user.role</div>
                </div>
              </div>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div>
            <label className={label}>Condition</label>
            <textarea 
              rows={3} 
              value={condition} 
              onChange={e => setCondition(e.target.value)} 
              className={input} 
              placeholder="e.g. booking.nights >= 7"
            />
          </div>
          <div>
            <label className={label}>Action</label>
            <textarea 
              rows={3} 
              value={action} 
              onChange={e => setAction(e.target.value)} 
              className={input} 
              placeholder='e.g. block("Long stay requires review")'
            />
          </div>
          <div>
            <label className={label}>Sample Context (JSON)</label>
            <textarea 
              rows={3} 
              value={context} 
              onChange={e => setContext(e.target.value)} 
              className={input} 
              placeholder='{"booking": {"nights": 8}}'
            />
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button onClick={run} disabled={busy} className={button.primary}>
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />} Test Rule
          </button>
          {result && (
            <Badge tone={result.matched ? 'success' : 'neutral'}>
              {result.matched ? <Check size={12} /> : <X size={12} />} {result.matched ? 'Condition matches' : 'Condition does not match'}
            </Badge>
          )}
          {error && (
            <Badge tone="danger">
              <AlertTriangle size={12} /> {error}
            </Badge>
          )}
        </div>

        {result?.effects?.length > 0 && (
          <div className="p-3 bg-slate-50 dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700">
            <div className="text-xs font-bold text-slate-700 dark:text-slate-300 mb-2">Effects:</div>
            <pre className="text-xs font-mono overflow-x-auto">{JSON.stringify(result.effects, null, 2)}</pre>
          </div>
        )}
      </div>
    </SectionCard>
  );
};

/** Pending workflow steps assigned to the signed-in user's role, with approve/reject. */
const MyQueue: React.FC<{ onChanged: () => void; version: number }> = ({ onChanged, version }) => {
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/control/workflow-instances/mine', { headers: adminAuthHeaders() });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || `Request failed (${res.status})`);
      setItems(json.items || []);
      setError(null);
    } catch (e: any) { setError(e.message); } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load, version]);

  const decide = async (id: string, decision: 'approve' | 'reject') => {
    const comment = decision === 'reject' ? window.prompt('Reason for rejection (optional)') ?? undefined : undefined;
    const res = await fetch(`/api/admin/control/workflow-instances/${id}/advance`, { method: 'POST', headers: adminAuthHeaders(), body: JSON.stringify({ decision, comment }) });
    if (!res.ok) setError((await res.json().catch(() => ({}))).error || 'Action failed');
    else { setError(null); await load(); onChanged(); }
  };

  return (
    <div className={`${box} space-y-2`}>
      <div className="text-sm font-black text-slate-900 dark:text-white">Awaiting my action {loading ? '' : `(${items.length})`}</div>
      {error && <div className="text-sm text-red-600 flex items-center gap-1"><AlertTriangle size={14} /> {error}</div>}
      {!loading && items.length === 0 && <div className="text-sm text-slate-400">Nothing is waiting for your role.</div>}
      {items.map(i => {
        const step = i.steps?.[i.currentStep];
        return (
          <div key={i.id} className="flex flex-wrap items-center justify-between gap-2 p-3 rounded-xl bg-slate-50 dark:bg-slate-800">
            <div className="min-w-0">
              <div className="text-sm font-bold text-slate-900 dark:text-white truncate">{i.workflowName}: {step?.name || `Step ${i.currentStep + 1}`}</div>
              <div className="text-[11px] text-slate-500 truncate">{i.entityType} · {i.entityId}{i.context?.poNumber ? ` · ${i.context.poNumber}` : ''}{i.context?.amount ? ` · ${i.context.amount}` : ''}</div>
            </div>
            <div className="flex gap-2">
              <button onClick={() => decide(i.id, 'approve')} className="px-3 py-1.5 text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg">Approve</button>
              <button onClick={() => decide(i.id, 'reject')} className="px-3 py-1.5 text-xs font-bold bg-red-600 hover:bg-red-700 text-white rounded-lg">Reject</button>
            </div>
          </div>
        );
      })}
    </div>
  );
};

export const WorkflowInstancesModule: React.FC<{ embedded?: boolean }> = ({ embedded }) => {
  const [version, setVersion] = useState(0);
  return (
    <div className={embedded ? 'h-full flex flex-col gap-4 overflow-y-auto' : 'h-full overflow-y-auto'}>
      <div className={embedded ? 'space-y-4' : 'p-4 sm:p-6 pb-0 space-y-4'}>
        {!embedded && (
          <div>
            <h2 className="text-xl font-black text-slate-900 dark:text-white tracking-tight">Workflow Instances</h2>
            <p className="text-sm text-slate-500 mt-1 max-w-2xl">Running and finished executions of the workflows defined in Workflow Engine. Purchase orders cannot be approved while a workflow on them is pending or rejected.</p>
          </div>
        )}
        <MyQueue version={version} onChanged={() => setVersion(v => v + 1)} />
      </div>
      <div key={version} className="min-h-[520px] flex-1">
        <ResourceManager
          embedded={embedded}
          title="All instances"
          resource="workflow-instances"
          itemLabel="instance"
          readOnlyCreate
          noDelete
          noEdit
          fields={[
            { key: 'workflowName', label: 'Workflow' },
            { key: 'entityType', label: 'Entity' },
            { key: 'entityId', label: 'Entity ID' },
            { key: 'status', label: 'Status' },
            { key: 'assignedRole', label: 'Waiting for' },
            { key: 'currentStep', label: 'Step', type: 'number' },
            { key: 'createdAt', label: 'Started' },
          ]}
          stats={items => [{ label: 'Pending', value: items.filter(i => i.status === 'pending').length }, { label: 'Completed', value: items.filter(i => i.status === 'completed').length }, { label: 'Rejected', value: items.filter(i => i.status === 'rejected').length }]}
        />
      </div>
    </div>
  );
};
