/**
 * Global System Settings & Localization
 * 1. Localization (timezone, date format, language)
 * 2. Night Audit Automations
 * 3. Notification & Email Templates
 * 4. System (maintenance mode & session timeout)
 */

import React, { useState } from 'react';
import {
  Globe, Clock, Mail, Save, CheckCircle2, Settings, FileText, PenLine, X, ShieldAlert, AlertTriangle
} from 'lucide-react';
import { useERP } from '../../context/ERPContext';
import type { GlobalHotelSettings } from '../../types/erp';
import { PageHeader, SectionCard, Badge } from '../FrontOffice/ui';
import { button } from '../FrontOffice/brandTheme';
import { AdminSubTabBar } from './shared/AdminSubTabBar';

type SettingsTab = 'localization' | 'templates' | 'system';

const TAB_META: { id: SettingsTab; label: string; icon: React.ReactNode }[] = [
  { id: 'localization', label: 'Localization', icon: <Globe size={14} /> },
  { id: 'templates', label: 'Email Templates', icon: <Mail size={14} /> },
  { id: 'system', label: 'System', icon: <Settings size={14} /> },
];

const inputCls = 'w-full px-3.5 py-2.5 bg-slate-50 dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-xl text-sm text-gray-900 dark:text-white outline-none focus:ring-1 focus:ring-[var(--color-accent-operations)]';
const labelCls = 'text-xs font-medium text-gray-600 dark:text-gray-400 block mb-1.5';

export default function GlobalSystemSettings() {
  const [activeTab, setActiveTab] = useState<SettingsTab>('localization');

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="System Settings & Localization"
        subtitle="Configure regional preferences, email templates, session policies, and maintenance mode"
        icon={Settings}
      />

      <div>
        <AdminSubTabBar tabs={TAB_META} activeTab={activeTab} onChange={setActiveTab} />
      </div>

      {activeTab === 'localization' && <LocalizationModule />}
      {activeTab === 'templates' && <EmailTemplatesModule />}
      {activeTab === 'system' && <SystemModule />}
    </div>
  );
}

function LocalizationModule() {
  const { globalHotelSettings, submitGlobalSettingsChange } = useERP();
  const [locales, setLocales] = useState<{ code: string; name: string; nativeName?: string }[]>([]);
  const [form, setForm] = useState({
    timezone: globalHotelSettings.timezone || 'Africa/Addis_Ababa',
    dateFormat: globalHotelSettings.dateFormat || 'YYYY-MM-DD',
    language: globalHotelSettings.defaultLanguage || 'en',
    currency: globalHotelSettings.baseCurrency || 'USD',
  });
  const [saveStatus, setSaveStatus] = useState<'idle' | 'success'>('idle');

  React.useEffect(() => {
    fetch('/api/admin/control/runtime/locales', { credentials: 'include' })
      .then(r => r.ok ? r.json() : { locales: [] })
      .then(d => {
        const rows = Array.isArray(d?.locales) ? d.locales : [];
        setLocales(rows.map((l: any) => ({ code: l.code, name: l.name, nativeName: l.nativeName })));
      })
      .catch(() => {});
  }, []);

  React.useEffect(() => {
    setForm({
      timezone: globalHotelSettings.timezone || 'Africa/Addis_Ababa',
      dateFormat: globalHotelSettings.dateFormat || 'YYYY-MM-DD',
      language: globalHotelSettings.defaultLanguage || 'en',
      currency: globalHotelSettings.baseCurrency || 'USD',
    });
  }, [globalHotelSettings.timezone, globalHotelSettings.dateFormat, globalHotelSettings.defaultLanguage, globalHotelSettings.baseCurrency]);

  const languageOptions = locales.length > 0 ? locales : [{ code: 'en', name: 'English' }];

  const handleSave = () => {
    submitGlobalSettingsChange(
      'Localization Preferences',
      `Timezone: ${form.timezone}, Date Format: ${form.dateFormat}, Language: ${form.language}, Currency: ${form.currency}`,
      'global-setting',
      {
        timezone: form.timezone,
        dateFormat: form.dateFormat,
        defaultLanguage: form.language,
        baseCurrency: form.currency,
      }
    );
    setSaveStatus('success');
    setTimeout(() => setSaveStatus('idle'), 2500);
  };

  return (
    <div className="space-y-6">
      <SectionCard
        title="Regional Preferences"
        subtitle="Default timezone, date formatting, language, and base currency for this subdomain"
        icon={Globe}
        tone="accent"
        actions={
          <button onClick={handleSave} className={button.primary}>
            {saveStatus === 'success' ? <CheckCircle2 size={16} /> : <Save size={16} />}
            {saveStatus === 'success' ? 'Saved' : 'Save Localization'}
          </button>
        }
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <div>
            <label className={labelCls}>Time Zone</label>
            <select value={form.timezone} onChange={e => setForm(f => ({ ...f, timezone: e.target.value }))} className={inputCls}>
              <option value="Africa/Addis_Ababa">Africa/Addis Ababa (EAT, UTC+3)</option>
              <option value="UTC">UTC</option>
              <option value="Europe/London">Europe/London (GMT/BST)</option>
              <option value="America/New_York">America/New York (EST/EDT)</option>
              <option value="Asia/Dubai">Asia/Dubai (GST, UTC+4)</option>
            </select>
          </div>
          <div>
            <label className={labelCls}>Date Format</label>
            <select value={form.dateFormat} onChange={e => setForm(f => ({ ...f, dateFormat: e.target.value }))} className={inputCls}>
              <option value="YYYY-MM-DD">YYYY-MM-DD (ISO)</option>
              <option value="DD/MM/YYYY">DD/MM/YYYY</option>
              <option value="MM/DD/YYYY">MM/DD/YYYY</option>
              <option value="DD-MMM-YYYY">DD-MMM-YYYY</option>
            </select>
          </div>
          <div>
            <label className={labelCls}>Default Language</label>
            <select value={form.language} onChange={e => setForm(f => ({ ...f, language: e.target.value }))} className={inputCls}>
              {languageOptions.map(l => (
                <option key={l.code} value={l.code}>{l.name}{l.nativeName ? ` — ${l.nativeName}` : ''}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelCls}>Base Currency</label>
            <select value={form.currency} onChange={e => setForm(f => ({ ...f, currency: e.target.value }))} className={inputCls}>
              <option value="USD">USD — US Dollar</option>
              <option value="ETB">ETB — Ethiopian Birr</option>
              <option value="EUR">EUR — Euro</option>
              <option value="GBP">GBP — British Pound</option>
            </select>
          </div>
        </div>
      </SectionCard>
    </div>
  );
}

function NightAuditModule() {
  const { globalHotelSettings, submitGlobalSettingsChange } = useERP();
  const [form, setForm] = useState({
    autoNightAuditTime: globalHotelSettings.autoNightAuditTime || '02:00',
    enableAutoNightAudit: !!globalHotelSettings.autoNightAuditTime,
    postRoomCharges: globalHotelSettings.nightAuditPostRoomCharges ?? true,
    generateDailySummary: globalHotelSettings.nightAuditGenerateSummary ?? true,
    autoCheckinReminders: globalHotelSettings.nightAuditCheckinReminders ?? true,
  });
  const [saveStatus, setSaveStatus] = useState<'idle' | 'success'>('idle');

  React.useEffect(() => {
    setForm({
      autoNightAuditTime: globalHotelSettings.autoNightAuditTime || '02:00',
      enableAutoNightAudit: !!globalHotelSettings.autoNightAuditTime,
      postRoomCharges: globalHotelSettings.nightAuditPostRoomCharges ?? true,
      generateDailySummary: globalHotelSettings.nightAuditGenerateSummary ?? true,
      autoCheckinReminders: globalHotelSettings.nightAuditCheckinReminders ?? true,
    });
  }, [
    globalHotelSettings.autoNightAuditTime,
    globalHotelSettings.nightAuditPostRoomCharges,
    globalHotelSettings.nightAuditGenerateSummary,
    globalHotelSettings.nightAuditCheckinReminders,
  ]);

  const handleSave = () => {
    submitGlobalSettingsChange(
      'Night Audit Schedule',
      `Set automatic night audit time to ${form.autoNightAuditTime} (${form.enableAutoNightAudit ? 'enabled' : 'disabled'})`,
      'global-setting',
      {
        autoNightAuditTime: form.enableAutoNightAudit ? form.autoNightAuditTime : '',
        nightAuditPostRoomCharges: form.postRoomCharges,
        nightAuditGenerateSummary: form.generateDailySummary,
        nightAuditCheckinReminders: form.autoCheckinReminders,
      }
    );
    setSaveStatus('success');
    setTimeout(() => setSaveStatus('idle'), 2500);
  };

  return (
    <div className="space-y-6">
      <SectionCard
        title="Night Audit Automation"
        subtitle="Configure end-of-day posting, summary generation, and pre-arrival reminders"
        icon={Moon}
        tone="info"
        actions={
          <button onClick={handleSave} className={button.primary}>
            {saveStatus === 'success' ? <CheckCircle2 size={16} /> : <Save size={16} />}
            {saveStatus === 'success' ? 'Saved' : 'Save Night Audit Settings'}
          </button>
        }
      >
        <div className="space-y-4">
          <ToggleRow label="Enable automatic Night Audit" description="Run end-of-day posting, charge posting, and summary generation automatically."
            enabled={form.enableAutoNightAudit} onChange={v => setForm(f => ({ ...f, enableAutoNightAudit: v }))} />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <div>
              <label className={labelCls}>Scheduled Time</label>
              <input type="time" value={form.autoNightAuditTime} onChange={e => setForm(f => ({ ...f, autoNightAuditTime: e.target.value }))} className={inputCls} />
            </div>
          </div>
          <ToggleRow label="Auto-post room charges" description="Automatically post nightly room charges to all active folios."
            enabled={form.postRoomCharges} onChange={v => setForm(f => ({ ...f, postRoomCharges: v }))} />
          <ToggleRow label="Generate daily summary report" description="Create and email the daily revenue and occupancy summary."
            enabled={form.generateDailySummary} onChange={v => setForm(f => ({ ...f, generateDailySummary: v }))} />
          <ToggleRow label="Auto check-in reminders" description="Send automated reminders to guests ahead of their check-in time."
            enabled={form.autoCheckinReminders} onChange={v => setForm(f => ({ ...f, autoCheckinReminders: v }))} />
        </div>
      </SectionCard>
    </div>
  );
}

function SystemModule() {
  const { globalHotelSettings, submitGlobalSettingsChange } = useERP();
  const boundaries = globalHotelSettings.superAdminBoundaries;
  const [form, setForm] = useState({
    maintenanceMode: globalHotelSettings.maintenanceMode ?? false,
    maintenanceMessage:
      globalHotelSettings.maintenanceMessage ??
      'The system is undergoing scheduled maintenance. Some features may be temporarily unavailable.',
    sessionTimeout: globalHotelSettings.sessionTimeout ?? 30,
  });
  const [saveStatus, setSaveStatus] = useState<'idle' | 'success'>('idle');

  React.useEffect(() => {
    setForm({
      maintenanceMode: globalHotelSettings.maintenanceMode ?? false,
      maintenanceMessage:
        globalHotelSettings.maintenanceMessage ??
        'The system is undergoing scheduled maintenance. Some features may be temporarily unavailable.',
      sessionTimeout: globalHotelSettings.sessionTimeout ?? 30,
    });
  }, [globalHotelSettings.maintenanceMode, globalHotelSettings.maintenanceMessage, globalHotelSettings.sessionTimeout]);

  const handleSave = () => {
    submitGlobalSettingsChange(
      'System Settings Update',
      `Maintenance mode: ${form.maintenanceMode ? 'on' : 'off'}, Session timeout: ${form.sessionTimeout} min`,
      'global-setting',
      {
        maintenanceMode: form.maintenanceMode,
        maintenanceMessage: form.maintenanceMessage,
        sessionTimeout: Number(form.sessionTimeout) || 30,
      }
    );
    setSaveStatus('success');
    setTimeout(() => setSaveStatus('idle'), 2500);
  };

  return (
    <div className="space-y-6">
      {form.maintenanceMode && (
        <div className="bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-800 rounded-2xl px-5 py-3 flex items-center gap-2 text-sm text-rose-700 dark:text-rose-300 font-medium">
          <AlertTriangle size={16} /> Maintenance mode is currently <strong>active</strong>. A banner is shown to all users.
        </div>
      )}

      <SectionCard
        title="Maintenance Mode"
        subtitle="Show a maintenance notice banner across this subdomain"
        icon={ShieldAlert}
        tone="danger"
        actions={
          <button onClick={handleSave} className={button.primary}>
            {saveStatus === 'success' ? <CheckCircle2 size={16} /> : <Save size={16} />}
            {saveStatus === 'success' ? 'Saved' : 'Save System Settings'}
          </button>
        }
      >
        <ToggleRow
          label="Enable maintenance mode"
          description={boundaries?.platformMaintenanceMode ? 'Locked ON by Super Admin platform maintenance.' : 'Displays a banner to every signed-in user in this subdomain. Administrators retain full access.'}
          enabled={boundaries?.platformMaintenanceMode ? true : form.maintenanceMode}
          onChange={v => !boundaries?.platformMaintenanceMode && setForm(f => ({ ...f, maintenanceMode: v }))}
        />
        <div className="mt-3">
          <label className={labelCls}>Banner message</label>
          <textarea
            value={form.maintenanceMessage}
            onChange={e => setForm(f => ({ ...f, maintenanceMessage: e.target.value }))}
            rows={2}
            className={`${inputCls} resize-none`}
          />
        </div>
      </SectionCard>

      <SectionCard title="Session Policy" subtitle="Idle timeout enforcement for signed-in users" icon={Clock} tone="warning">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-bold text-gray-900 dark:text-white">Idle session timeout</p>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
              {boundaries?.maxSessionTimeout
                ? `Minutes of inactivity before sign-out (Super Admin cap: ${boundaries.maxSessionTimeout} min).`
                : 'Minutes of inactivity before users are signed out.'}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={5}
              max={boundaries?.maxSessionTimeout || 480}
              value={form.sessionTimeout}
              onChange={e => setForm(f => ({ ...f, sessionTimeout: Number(e.target.value) }))}
              className="w-24 px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-xl text-sm font-bold text-right text-gray-900 dark:text-white outline-none focus:ring-1 focus:ring-[var(--color-accent-operations)]"
            />
            <span className="text-xs font-bold text-gray-400 uppercase">min</span>
          </div>
        </div>
      </SectionCard>
    </div>
  );
}

type EmailTemplate = NonNullable<GlobalHotelSettings['emailTemplates']>[number];

function EmailTemplatesModule() {
  const { globalHotelSettings, submitGlobalSettingsChange } = useERP();
  const dbTemplates = globalHotelSettings.emailTemplates || [];
  const [templates, setTemplates] = useState<EmailTemplate[]>(dbTemplates);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'success'>('idle');
  const [creating, setCreating] = useState(false);
  const [newTemplate, setNewTemplate] = useState<Omit<EmailTemplate, 'id'>>({
    name: '', subject: '', body: '', enabled: true, variables: []
  });
  const [newVariable, setNewVariable] = useState('');

  React.useEffect(() => {
    setTemplates(dbTemplates);
  }, [globalHotelSettings.emailTemplates]);

  const updateField = (id: string, field: keyof EmailTemplate, value: string | boolean) => {
    setTemplates(prev => prev.map(t => t.id === id ? { ...t, [field]: value } : t));
  };

  const handleSave = () => {
    submitGlobalSettingsChange(
      'Email Templates',
      `Updated ${templates.length} transactional email templates`,
      'global-setting',
      { emailTemplates: templates }
    );
    setSaveStatus('success');
    setTimeout(() => setSaveStatus('idle'), 2500);
  };

  const addNewTemplate = () => {
    if (!newTemplate.name.trim() || !newTemplate.subject.trim()) return;
    const id = `custom_${Date.now()}`;
    const created: EmailTemplate = { ...newTemplate, id };
    setTemplates(prev => [...prev, created]);
    setNewTemplate({ name: '', subject: '', body: '', enabled: true, variables: [] });
    setCreating(false);
    setExpandedId(id);
  };

  const removeTemplate = (id: string) => {
    setTemplates(prev => prev.filter(t => t.id !== id));
    if (expandedId === id) setExpandedId(null);
  };

  const addVariableToNew = () => {
    const v = newVariable.trim().replace(/^{{|}}$/g, '');
    if (!v || newTemplate.variables.includes(v)) return;
    setNewTemplate(prev => ({ ...prev, variables: [...prev.variables, v] }));
    setNewVariable('');
  };

  const removeVariableFromNew = (v: string) => {
    setNewTemplate(prev => ({ ...prev, variables: prev.variables.filter(x => x !== v) }));
  };

  const addVariableToExisting = (id: string, raw: string) => {
    const v = raw.trim().replace(/^{{|}}$/g, '');
    if (!v) return;
    setTemplates(prev => prev.map(t => t.id === id && !t.variables.includes(v) ? { ...t, variables: [...t.variables, v] } : t));
  };

  const removeVariableFromExisting = (id: string, v: string) => {
    setTemplates(prev => prev.map(t => t.id === id ? { ...t, variables: t.variables.filter(x => x !== v) } : t));
  };

  return (
    <div className="space-y-6">
      <SectionCard
        title="Transactional Email Templates"
        subtitle={`${templates.length} configured template${templates.length !== 1 ? 's' : ''}`}
        icon={Mail}
        tone="accent"
        actions={
          <div className="flex items-center gap-2">
            <button onClick={() => setCreating(c => !c)} className={button.secondary}>
              {creating ? <X size={14} /> : <PenLine size={14} />}
              {creating ? 'Cancel' : 'New Template'}
            </button>
            <button onClick={handleSave} className={button.primary}>
              {saveStatus === 'success' ? <CheckCircle2 size={14} /> : <Save size={14} />}
              {saveStatus === 'success' ? 'Saved' : 'Save Templates'}
            </button>
          </div>
        }
      >
        {creating && (
          <div className="mb-4 border border-gray-200 dark:border-slate-700 rounded-xl p-4 bg-slate-50 dark:bg-slate-900/40 space-y-4">
            <h3 className="text-xs font-bold text-gray-900 dark:text-white">Create New Template</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className={labelCls}>Template Name</label>
                <input type="text" value={newTemplate.name} placeholder="e.g. Invoice Reminder"
                  onChange={e => setNewTemplate(p => ({ ...p, name: e.target.value }))} className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Subject Line</label>
                <input type="text" value={newTemplate.subject} placeholder="Email subject..."
                  onChange={e => setNewTemplate(p => ({ ...p, subject: e.target.value }))} className={inputCls} />
              </div>
            </div>
            <div>
              <label className={labelCls}>Body</label>
              <textarea value={newTemplate.body} placeholder="Email body..."
                onChange={e => setNewTemplate(p => ({ ...p, body: e.target.value }))}
                rows={6} className={`${inputCls} font-mono resize-y`} />
            </div>
            <div>
              <label className={labelCls}>Variables</label>
              <div className="flex items-center gap-2">
                <input type="text" value={newVariable} placeholder="guestName"
                  onChange={e => setNewVariable(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addVariableToNew(); } }}
                  className={inputCls} />
                <button onClick={addVariableToNew} className={button.secondary}>Add</button>
              </div>
              <div className="flex flex-wrap gap-2 mt-2">
                {newTemplate.variables.map(v => (
                  <span key={v} className="inline-flex items-center gap-1 text-[10px] font-mono bg-slate-100 dark:bg-slate-800 text-gray-700 dark:text-gray-300 px-2 py-1 rounded-md border border-gray-200 dark:border-slate-700">
                    {'{{' + v + '}}'}
                    <button onClick={() => removeVariableFromNew(v)} className="hover:text-rose-600"><X size={10} /></button>
                  </span>
                ))}
              </div>
            </div>
            <div className="flex justify-end">
              <button onClick={addNewTemplate}
                disabled={!newTemplate.name.trim() || !newTemplate.subject.trim()}
                className={button.primary}>
                <CheckCircle2 size={14} /> Create Template
              </button>
            </div>
          </div>
        )}

        <div className="space-y-3">
          {templates.map(t => {
            const isOpen = expandedId === t.id;
            return (
              <div key={t.id} className="border border-gray-200 dark:border-slate-700 rounded-xl overflow-hidden">
                <div
                  className={`flex items-center justify-between p-4 cursor-pointer transition-colors ${isOpen ? 'bg-slate-50 dark:bg-slate-900/50' : 'bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700/40'}`}
                  onClick={() => setExpandedId(isOpen ? null : t.id)}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="p-2 bg-slate-50 dark:bg-slate-900 rounded-xl border border-gray-200 dark:border-slate-700 text-gray-600 dark:text-gray-300 shrink-0">
                      <FileText size={16} />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-gray-900 dark:text-white">{t.name}</span>
                        <Badge tone={t.enabled ? 'success' : 'neutral'}>{t.enabled ? 'Active' : 'Disabled'}</Badge>
                      </div>
                      <span className="text-[11px] text-gray-500 dark:text-gray-400 truncate block">{t.subject}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <button
                      type="button"
                      onClick={e => { e.stopPropagation(); updateField(t.id, 'enabled', !t.enabled); }}
                      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${t.enabled ? 'bg-emerald-500' : 'bg-slate-300 dark:bg-slate-600'}`}
                    >
                      <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${t.enabled ? 'translate-x-5' : 'translate-x-0.5'}`} />
                    </button>
                    {isOpen ? <X size={16} className="text-gray-400" /> : <PenLine size={16} className="text-gray-400" />}
                  </div>
                </div>

                {isOpen && (
                  <div className="p-4 bg-white dark:bg-slate-800 border-t border-gray-200 dark:border-slate-700 space-y-4">
                    <div>
                      <label className={labelCls}>Subject Line</label>
                      <input type="text" value={t.subject} onChange={e => updateField(t.id, 'subject', e.target.value)} className={inputCls} placeholder="Email subject..." />
                    </div>

                    <div>
                      <label className={labelCls}>Body</label>
                      <textarea value={t.body} onChange={e => updateField(t.id, 'body', e.target.value)} rows={8} className={`${inputCls} font-mono resize-y`} placeholder="Email body..." />
                    </div>

                    <div>
                      <label className={labelCls}>Available Variables</label>
                      <div className="flex items-center gap-2">
                        <input
                          type="text"
                          placeholder="Add variable..."
                          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addVariableToExisting(t.id, (e.target as HTMLInputElement).value); (e.target as HTMLInputElement).value = ''; } }}
                          className={inputCls}
                        />
                        <button
                          onClick={e => {
                            const input = (e.currentTarget.previousElementSibling as HTMLInputElement);
                            addVariableToExisting(t.id, input.value);
                            input.value = '';
                          }}
                          className={button.secondary}
                        >
                          Add
                        </button>
                      </div>
                      <div className="flex flex-wrap gap-2 mt-2">
                        {t.variables.map(v => (
                          <span key={v} className="inline-flex items-center gap-1 text-[10px] font-mono bg-slate-100 dark:bg-slate-900 text-gray-700 dark:text-gray-300 px-2 py-1 rounded-md border border-gray-200 dark:border-slate-700">
                            {'{{' + v + '}}'}
                            <button onClick={() => removeVariableFromExisting(t.id, v)} className="hover:text-rose-600"><X size={10} /></button>
                          </span>
                        ))}
                        {t.variables.length === 0 && (
                          <span className="text-[10px] text-gray-400 italic">No variables defined</span>
                        )}
                      </div>
                    </div>

                    <div className="flex justify-end pt-2 border-t border-gray-100 dark:border-slate-700">
                      <button
                        onClick={() => removeTemplate(t.id)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/30 hover:bg-rose-100 dark:hover:bg-rose-900/40 border border-rose-200 dark:border-rose-800 transition"
                      >
                        <X size={12} /> Delete Template
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </SectionCard>
    </div>
  );
}

function ToggleRow({ label, description, enabled, onChange }: { label: string; description?: string; enabled: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2 border-b border-gray-100 dark:border-slate-700/60 last:border-0">
      <div className="min-w-0">
        <p className="text-sm font-bold text-gray-900 dark:text-white">{label}</p>
        {description && <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{description}</p>}
      </div>
      <button type="button" role="switch" aria-checked={enabled} onClick={() => onChange(!enabled)}
        className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${enabled ? 'bg-emerald-500' : 'bg-slate-300 dark:bg-slate-600'}`}>
        <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${enabled ? 'translate-x-5' : 'translate-x-0.5'}`} />
      </button>
    </div>
  );
}
