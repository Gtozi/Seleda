import React, { useState, useEffect, useCallback } from 'react';
import {
  Settings, Users, Tag, Percent, Crown,
  Mail, MessageSquare, Bell, Save, RefreshCw,
} from 'lucide-react';
import { PageHeader, SectionCard } from '../FrontOffice/ui';
import { button, layout } from '../FrontOffice/brandTheme';
import { useERP } from '../../context/ERPContext';
import { fetchSalesSettings, saveSalesSettingsBulk, type SalesSetting } from '../../services/salesService';

const CONFIG_SECTIONS = [
  { id: 'general', label: 'General Settings', icon: Settings },
  { id: 'sales-team', label: 'Sales Team', icon: Users },
  { id: 'commission', label: 'Commission Structure', icon: Percent },
  { id: 'loyalty-tiers', label: 'Loyalty Tiers', icon: Crown },
  { id: 'promo-rules', label: 'Promotion Rules', icon: Tag },
  { id: 'notifications', label: 'Notification Settings', icon: Bell },
];

interface Config {
  defaultCurrency: string;
  leadScoringThreshold: number;
  autoAssignLeads: boolean;
  proposalValidDays: number;
  contractPrefix: string;
  proposalPrefix: string;
  corporateDiscountDefault: number;
  travelAgentCommissionDefault: number;
  loyaltyBronzeThreshold: number;
  loyaltySilverThreshold: number;
  loyaltyGoldThreshold: number;
  loyaltyPlatinumThreshold: number;
  emailNotifications: boolean;
  smsNotifications: boolean;
  pushNotifications: boolean;
  leadAssignedAlert: boolean;
  proposalStatusAlert: boolean;
  contractExpiryAlert: boolean;
  campaignCompletionAlert: boolean;
}

const DEFAULT_CONFIG: Config = {
  defaultCurrency: 'USD',
  leadScoringThreshold: 50,
  autoAssignLeads: true,
  proposalValidDays: 30,
  contractPrefix: 'CTR-',
  proposalPrefix: 'PROP-',
  corporateDiscountDefault: 10,
  travelAgentCommissionDefault: 12,
  loyaltyBronzeThreshold: 0,
  loyaltySilverThreshold: 5000,
  loyaltyGoldThreshold: 15000,
  loyaltyPlatinumThreshold: 30000,
  emailNotifications: true,
  smsNotifications: true,
  pushNotifications: false,
  leadAssignedAlert: true,
  proposalStatusAlert: true,
  contractExpiryAlert: true,
  campaignCompletionAlert: true,
};

const SETTING_LABELS: Record<keyof Config, string> = {
  defaultCurrency: 'Default Currency',
  leadScoringThreshold: 'Lead Scoring Threshold',
  autoAssignLeads: 'Auto-assign new leads to sales reps (round-robin)',
  proposalValidDays: 'Proposal Validity (days)',
  contractPrefix: 'Contract Prefix',
  proposalPrefix: 'Proposal Prefix',
  corporateDiscountDefault: 'Corporate Discount Default (%)',
  travelAgentCommissionDefault: 'Travel Agent Commission Default (%)',
  loyaltyBronzeThreshold: 'Bronze (points)',
  loyaltySilverThreshold: 'Silver (points)',
  loyaltyGoldThreshold: 'Gold (points)',
  loyaltyPlatinumThreshold: 'Platinum (points)',
  emailNotifications: 'Email Notifications',
  smsNotifications: 'SMS Notifications',
  pushNotifications: 'Push Notifications',
  leadAssignedAlert: 'Lead Assigned Alert',
  proposalStatusAlert: 'Proposal Status Change Alert',
  contractExpiryAlert: 'Contract Expiry Alert',
  campaignCompletionAlert: 'Campaign Completion Alert',
};

const SETTING_CATEGORIES: Record<keyof Config, string> = {
  defaultCurrency: 'General Settings',
  leadScoringThreshold: 'General Settings',
  autoAssignLeads: 'General Settings',
  proposalValidDays: 'General Settings',
  contractPrefix: 'General Settings',
  proposalPrefix: 'General Settings',
  corporateDiscountDefault: 'Commission Structure',
  travelAgentCommissionDefault: 'Commission Structure',
  loyaltyBronzeThreshold: 'Loyalty Tiers',
  loyaltySilverThreshold: 'Loyalty Tiers',
  loyaltyGoldThreshold: 'Loyalty Tiers',
  loyaltyPlatinumThreshold: 'Loyalty Tiers',
  emailNotifications: 'Notification Settings',
  smsNotifications: 'Notification Settings',
  pushNotifications: 'Notification Settings',
  leadAssignedAlert: 'Notification Settings',
  proposalStatusAlert: 'Notification Settings',
  contractExpiryAlert: 'Notification Settings',
  campaignCompletionAlert: 'Notification Settings',
};

const SETTING_TYPES: Record<keyof Config, 'string' | 'number' | 'boolean'> = {
  defaultCurrency: 'string',
  leadScoringThreshold: 'number',
  autoAssignLeads: 'boolean',
  proposalValidDays: 'number',
  contractPrefix: 'string',
  proposalPrefix: 'string',
  corporateDiscountDefault: 'number',
  travelAgentCommissionDefault: 'number',
  loyaltyBronzeThreshold: 'number',
  loyaltySilverThreshold: 'number',
  loyaltyGoldThreshold: 'number',
  loyaltyPlatinumThreshold: 'number',
  emailNotifications: 'boolean',
  smsNotifications: 'boolean',
  pushNotifications: 'boolean',
  leadAssignedAlert: 'boolean',
  proposalStatusAlert: 'boolean',
  contractExpiryAlert: 'boolean',
  campaignCompletionAlert: 'boolean',
};

function parseSetting(type: string, value: string | null): any {
  if (value === null || value === undefined) return '';
  if (type === 'boolean') return value === 'true';
  if (type === 'number') return Number(value);
  return value;
}

function settingsToConfig(settings: SalesSetting[]): Config {
  const config = { ...DEFAULT_CONFIG };
  settings.forEach((s) => {
    const key = s.setting_key as keyof Config;
    if (key in DEFAULT_CONFIG) {
      (config as any)[key] = parseSetting(s.setting_type || 'string', s.setting_value);
    }
  });
  return config;
}

function configToSettings(config: Config): any[] {
  return (Object.keys(config) as (keyof Config)[]).map((key) => ({
    settingKey: key,
    settingValue: String(config[key]),
    settingType: SETTING_TYPES[key],
    label: SETTING_LABELS[key],
    category: SETTING_CATEGORIES[key],
  }));
}

const SalesConfiguration: React.FC = () => {
  const { addNotification } = useERP();

  const [activeSection, setActiveSection] = useState('general');
  const [config, setConfig] = useState<Config>(DEFAULT_CONFIG);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const settings = await fetchSalesSettings();
      setConfig(settingsToConfig(settings));
    } catch (err: any) {
      setError(err.message || 'Failed to load settings');
      addNotification('Failed to load settings', 'error', 'Sales');
    } finally {
      setLoading(false);
    }
  }, [addNotification]);

  useEffect(() => { loadData(); }, [loadData]);

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      await saveSalesSettingsBulk(configToSettings(config));
      addNotification('Configuration saved', 'success', 'Sales');
    } catch (err: any) {
      setError(err.message || 'Failed to save settings');
      addNotification('Failed to save settings', 'error', 'Sales');
    } finally {
      setSaving(false);
    }
  };

  const updateConfig = (key: keyof Config, value: any) => {
    setConfig((prev) => ({ ...prev, [key]: value }));
  };

  return (
    <div className={layout.sectionStack}>
      <PageHeader
        title="Configuration"
        subtitle="Portal settings, sales team, commission structures, loyalty tiers, and notification preferences · DB-synced"
        icon={Settings}
        actions={
          <>
            <button onClick={loadData} disabled={loading} className={button.secondary}>
              <RefreshCw size={16} className={loading ? 'animate-spin' : ''} /> Refresh
            </button>
            <button onClick={handleSave} disabled={saving} className={button.primary}>
              <Save size={16} /> {saving ? 'Saving...' : 'Save Configuration'}
            </button>
          </>
        }
      />

      {error && (
        <div className="p-4 bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800 rounded-2xl flex items-center justify-between">
          <p className="text-sm font-semibold text-rose-700 dark:text-rose-400">{error}</p>
          <button onClick={loadData} disabled={loading} className={[button.secondary, 'flex items-center gap-2'].join(' ')}>
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Retry
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        <div className="lg:col-span-1">
          <SectionCard title="Sections" subtitle="">
            <div className="p-2 space-y-1">
              {CONFIG_SECTIONS.map((section) => {
                const Icon = section.icon;
                return (
                  <button
                    key={section.id}
                    onClick={() => setActiveSection(section.id)}
                    className={`w-full flex items-center gap-2 px-3 py-2.5 rounded-xl text-xs font-bold transition ${
                      activeSection === section.id
                        ? 'bg-[var(--color-accent-operations)] text-white'
                        : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                    }`}
                  >
                    <Icon size={14} />
                    {section.label}
                  </button>
                );
              })}
            </div>
          </SectionCard>
        </div>

        <div className="lg:col-span-3">
          <SectionCard title={CONFIG_SECTIONS.find((s) => s.id === activeSection)?.label || 'Settings'} subtitle="">
            <div className="p-6">
              {activeSection === 'general' && (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="text-[10px] uppercase font-black tracking-widest text-slate-400 block mb-2">Default Currency</label>
                      <select value={config.defaultCurrency} onChange={(e) => updateConfig('defaultCurrency', e.target.value)} className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-sm font-medium outline-none focus:ring-1 focus:ring-[var(--color-accent-operations)]">
                        <option>USD</option><option>ETB</option><option>EUR</option><option>GBP</option>
                      </select>
                    </div>
                    <div>
                      <label className="text-[10px] uppercase font-black tracking-widest text-slate-400 block mb-2">Lead Scoring Threshold</label>
                      <input type="number" value={config.leadScoringThreshold} onChange={(e) => updateConfig('leadScoringThreshold', Number(e.target.value))} className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-sm font-medium outline-none focus:ring-1 focus:ring-[var(--color-accent-operations)]" />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="text-[10px] uppercase font-black tracking-widest text-slate-400 block mb-2">Proposal Prefix</label>
                      <input value={config.proposalPrefix} onChange={(e) => updateConfig('proposalPrefix', e.target.value)} className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-sm font-mono font-medium outline-none focus:ring-1 focus:ring-[var(--color-accent-operations)]" />
                    </div>
                    <div>
                      <label className="text-[10px] uppercase font-black tracking-widest text-slate-400 block mb-2">Contract Prefix</label>
                      <input value={config.contractPrefix} onChange={(e) => updateConfig('contractPrefix', e.target.value)} className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-sm font-mono font-medium outline-none focus:ring-1 focus:ring-[var(--color-accent-operations)]" />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="text-[10px] uppercase font-black tracking-widest text-slate-400 block mb-2">Proposal Validity (days)</label>
                      <input type="number" value={config.proposalValidDays} onChange={(e) => updateConfig('proposalValidDays', Number(e.target.value))} className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-sm font-medium outline-none focus:ring-1 focus:ring-[var(--color-accent-operations)]" />
                    </div>
                  </div>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={config.autoAssignLeads} onChange={(e) => updateConfig('autoAssignLeads', e.target.checked)} className="w-4 h-4 rounded accent-[var(--color-accent-operations)]" />
                    <span className="text-xs font-bold text-slate-600 dark:text-slate-300">Auto-assign new leads to sales reps (round-robin)</span>
                  </label>
                </div>
              )}

              {activeSection === 'sales-team' && (
                <div className="space-y-4">
                  <p className="text-xs font-bold text-slate-400">Manage sales team members, territories, and targets. Configure in Admin → User Security.</p>
                  <div className="p-4 bg-slate-50 dark:bg-slate-950 rounded-2xl border border-slate-100 dark:border-slate-800">
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Active Sales Representatives</p>
                    <p className="text-xs font-bold text-slate-600 dark:text-slate-400">Configure sales team members and their access levels through the Admin portal&apos;s User Security module.</p>
                  </div>
                </div>
              )}

              {activeSection === 'commission' && (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="text-[10px] uppercase font-black tracking-widest text-slate-400 block mb-2">Corporate Discount Default (%)</label>
                      <input type="number" value={config.corporateDiscountDefault} onChange={(e) => updateConfig('corporateDiscountDefault', Number(e.target.value))} className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-sm font-medium outline-none focus:ring-1 focus:ring-[var(--color-accent-operations)]" />
                    </div>
                    <div>
                      <label className="text-[10px] uppercase font-black tracking-widest text-slate-400 block mb-2">Travel Agent Commission Default (%)</label>
                      <input type="number" value={config.travelAgentCommissionDefault} onChange={(e) => updateConfig('travelAgentCommissionDefault', Number(e.target.value))} className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-sm font-medium outline-none focus:ring-1 focus:ring-[var(--color-accent-operations)]" />
                    </div>
                  </div>
                </div>
              )}

              {activeSection === 'loyalty-tiers' && (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="text-[10px] uppercase font-black tracking-widest text-slate-400 block mb-2">Bronze (points)</label>
                      <input type="number" value={config.loyaltyBronzeThreshold} onChange={(e) => updateConfig('loyaltyBronzeThreshold', Number(e.target.value))} className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-sm font-medium outline-none focus:ring-1 focus:ring-[var(--color-accent-operations)]" />
                    </div>
                    <div>
                      <label className="text-[10px] uppercase font-black tracking-widest text-slate-400 block mb-2">Silver (points)</label>
                      <input type="number" value={config.loyaltySilverThreshold} onChange={(e) => updateConfig('loyaltySilverThreshold', Number(e.target.value))} className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-sm font-medium outline-none focus:ring-1 focus:ring-[var(--color-accent-operations)]" />
                    </div>
                    <div>
                      <label className="text-[10px] uppercase font-black tracking-widest text-slate-400 block mb-2">Gold (points)</label>
                      <input type="number" value={config.loyaltyGoldThreshold} onChange={(e) => updateConfig('loyaltyGoldThreshold', Number(e.target.value))} className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-sm font-medium outline-none focus:ring-1 focus:ring-[var(--color-accent-operations)]" />
                    </div>
                    <div>
                      <label className="text-[10px] uppercase font-black tracking-widest text-slate-400 block mb-2">Platinum (points)</label>
                      <input type="number" value={config.loyaltyPlatinumThreshold} onChange={(e) => updateConfig('loyaltyPlatinumThreshold', Number(e.target.value))} className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-sm font-medium outline-none focus:ring-1 focus:ring-[var(--color-accent-operations)]" />
                    </div>
                  </div>
                </div>
              )}

              {activeSection === 'promo-rules' && (
                <div className="space-y-4">
                  <p className="text-xs font-bold text-slate-400">Configure global rules for promotions, promo codes, and discount limits.</p>
                  <div className="p-4 bg-slate-50 dark:bg-slate-950 rounded-2xl border border-slate-100 dark:border-slate-800">
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Active Rules</p>
                    <ul className="space-y-1 text-[10px] font-bold text-slate-600 dark:text-slate-400">
                      <li>- Maximum discount: 30%</li>
                      <li>- Promo code expiry: 90 days default</li>
                      <li>- Stackable promotions: Disabled</li>
                      <li>- Minimum stay for promotions: 1 night</li>
                    </ul>
                  </div>
                </div>
              )}

              {activeSection === 'notifications' && (
                <div className="space-y-3">
                  {[
                    { key: 'emailNotifications', label: 'Email Notifications', icon: Mail },
                    { key: 'smsNotifications', label: 'SMS Notifications', icon: MessageSquare },
                    { key: 'pushNotifications', label: 'Push Notifications', icon: Bell },
                    { key: 'leadAssignedAlert', label: 'Lead Assigned Alert', icon: Users },
                    { key: 'proposalStatusAlert', label: 'Proposal Status Change Alert', icon: Tag },
                    { key: 'contractExpiryAlert', label: 'Contract Expiry Alert', icon: Settings },
                    { key: 'campaignCompletionAlert', label: 'Campaign Completion Alert', icon: Bell },
                  ].map((item) => {
                    const Icon = item.icon;
                    return (
                      <label key={item.key} className="flex items-center justify-between p-3 bg-slate-50 dark:bg-slate-950 rounded-xl border border-slate-100 dark:border-slate-800 cursor-pointer">
                        <div className="flex items-center gap-2">
                          <Icon size={14} className="text-slate-400" />
                          <span className="text-xs font-bold text-slate-600 dark:text-slate-300">{item.label}</span>
                        </div>
                        <input type="checkbox" checked={config[item.key as keyof Config] as boolean} onChange={(e) => updateConfig(item.key as keyof Config, e.target.checked)} className="w-4 h-4 rounded accent-[var(--color-accent-operations)]" />
                      </label>
                    );
                  })}
                </div>
              )}

              <div className="mt-6 pt-4 border-t border-slate-100 dark:border-slate-800 flex justify-end">
                <button onClick={handleSave} disabled={saving} className={button.primary}>
                  <Save size={14} /> {saving ? 'Saving...' : 'Save Configuration'}
                </button>
              </div>
            </div>
          </SectionCard>
        </div>
      </div>
    </div>
  );
};

export default SalesConfiguration;
