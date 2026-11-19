/**
 * @license
 * SPDX-License-Identifier: Apache-2.5
 */

import { useState, useEffect, useCallback } from 'react';
import {
  Printer,
  CreditCard,
  DollarSign,
  Plus,
  Trash2,
  Save,
  ToggleLeft,
  ToggleRight,
  Sliders,
  HardDrive,
  Palette,
  Info,
  Smartphone,
  Building,
  Percent
} from 'lucide-react';
import { useERP } from '../../context/ERPContext';

interface POSSettingsProps {
  outletId?: string;
  outletName?: string;
}

interface Printer {
  id: string;
  name: string;
  type: 'kitchen' | 'receipt' | 'bar';
  station?: string;
  ip_address?: string;
  is_active: boolean;
}

interface PaymentTerminal {
  id: string;
  type: string;
  model: string;
  serial_number?: string;
  is_active: boolean;
}

interface EffectiveTaxRates {
  vat: number | null;
  serviceCharge: number | null;
  additional: { code: string; name: string; taxType: string; rate: number; calcBase?: string }[];
}

export default function POSSettings({ outletId, outletName }: POSSettingsProps) {
  const { addNotification } = useERP();
  const [activeTab, setActiveTab] = useState<'general' | 'hardware' | 'payment' | 'tax' | 'display'>('general');
  const [saving, setSaving] = useState(false);

  // General Settings
  const [generalSettings, setGeneralSettings] = useState({
    outletName: outletName || 'Main Restaurant',
    currency: 'ETB',
    language: 'en',
    autoPrintReceipt: true,
    requireManagerForVoid: true,
    requireManagerForDiscount: true,
    allowSplitPayments: true,
    enableTips: true,
    defaultTipPercent: 10,
    serviceChargePercent: 10,
    operatingHours: {
      open: '06:00',
      close: '23:00'
    }
  });

  // Hardware Settings
  const [printers, setPrinters] = useState<Printer[]>([]);
  const [paymentTerminals, setPaymentTerminals] = useState<PaymentTerminal[]>([]);
  const [effectiveTax, setEffectiveTax] = useState<EffectiveTaxRates | null>(null);
  const [showPrinterForm, setShowPrinterForm] = useState(false);
  const [newPrinter, setNewPrinter] = useState({ name: '', type: 'receipt' as Printer['type'], station: '', ipAddress: '' });
  const [showTerminalForm, setShowTerminalForm] = useState(false);
  const [newTerminal, setNewTerminal] = useState({ type: 'card', model: '', serialNumber: '' });

  // Payment Settings
  const [enabledPaymentMethods, setEnabledPaymentMethods] = useState({
    cash: true,
    card: true,
    mobile: true,
    roomCharge: true
  });

  // Display Settings
  const [displaySettings, setDisplaySettings] = useState({
    showImages: true,
    gridColumns: 4,
    fontSize: 'medium' as 'small' | 'medium' | 'large',
    theme: 'light' as 'light' | 'dark',
    showQuickActions: true
  });

  // Fetch registered hardware + tax profiles from the backend
  const fetchConfig = useCallback(async () => {
    try {
      const opts = { credentials: 'include' as const };
      const [printersRes, terminalsRes, taxRes] = await Promise.all([
        fetch('/api/pos/hardware/printers', opts),
        fetch('/api/pos/hardware/payment-terminals', opts),
        fetch('/api/admin/control/runtime/tax-rates?appliesTo=f%26b', opts),
      ]);
      if (printersRes.ok) setPrinters(await printersRes.json());
      if (terminalsRes.ok) setPaymentTerminals(await terminalsRes.json());
      if (taxRes.ok) setEffectiveTax(await taxRes.json());

      // Load the outlet record — general fields + persisted settings jsonb
      if (outletId) {
        const outletRes = await fetch(`/api/pos/outlets/${outletId}`, opts);
        if (outletRes.ok) {
          const outlet = await outletRes.json();
          setGeneralSettings(prev => ({
            ...prev,
            outletName: outlet.name || prev.outletName,
            serviceChargePercent: outlet.default_service_charge ?? prev.serviceChargePercent,
            operatingHours: {
              open: outlet.operating_hours?.open || prev.operatingHours.open,
              close: outlet.operating_hours?.close || prev.operatingHours.close,
            },
            ...(outlet.settings?.general || {}),
          }));
          if (outlet.settings?.display) setDisplaySettings(prev => ({ ...prev, ...outlet.settings.display }));
          if (outlet.settings?.paymentMethods) setEnabledPaymentMethods(prev => ({ ...prev, ...outlet.settings.paymentMethods }));
        }
      }
    } catch (error) {
      console.error('Failed to load POS settings:', error);
    }
  }, [outletId]);

  useEffect(() => {
    fetchConfig();
    // Restore locally persisted UI preferences
    try {
      const g = localStorage.getItem('pos_general_settings');
      if (g) setGeneralSettings(prev => ({ ...prev, ...JSON.parse(g) }));
      const d = localStorage.getItem('pos_display_settings');
      if (d) setDisplaySettings(prev => ({ ...prev, ...JSON.parse(d) }));
      const p = localStorage.getItem('pos_payment_methods');
      if (p) setEnabledPaymentMethods(prev => ({ ...prev, ...JSON.parse(p) }));
    } catch { /* ignore corrupt stored prefs */ }
  }, [fetchConfig]);

  const apiPost = async (url: string, body: any) => {
    const res = await fetch(url, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `Request failed (${res.status})`);
    }
    return res.json();
  };

  const handleAddPrinter = async () => {
    if (!newPrinter.name.trim()) return;
    try {
      await apiPost('/api/pos/hardware/printers', {
        name: newPrinter.name.trim(),
        type: newPrinter.type,
        station: newPrinter.station || undefined,
        ipAddress: newPrinter.ipAddress || undefined,
      });
      setNewPrinter({ name: '', type: 'receipt', station: '', ipAddress: '' });
      setShowPrinterForm(false);
      addNotification('Printer registered', 'success', 'F&B');
      fetchConfig();
    } catch (error: any) {
      addNotification(error.message || 'Failed to register printer', 'warning', 'F&B');
    }
  };

  const handleAddTerminal = async () => {
    if (!newTerminal.model.trim()) return;
    try {
      await apiPost('/api/pos/hardware/payment-terminals', {
        type: newTerminal.type,
        model: newTerminal.model.trim(),
        serialNumber: newTerminal.serialNumber || undefined,
      });
      setNewTerminal({ type: 'card', model: '', serialNumber: '' });
      setShowTerminalForm(false);
      addNotification('Payment terminal registered', 'success', 'F&B');
      fetchConfig();
    } catch (error: any) {
      addNotification(error.message || 'Failed to register terminal', 'warning', 'F&B');
    }
  };

  const handleSaveSettings = async () => {
    setSaving(true);
    try {
      // Persist outlet-level config + freeform settings jsonb to the database
      if (outletId) {
        const res = await fetch(`/api/pos/outlets/${outletId}`, {
          method: 'PATCH',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: generalSettings.outletName,
            default_service_charge: generalSettings.serviceChargePercent,
            operating_hours: generalSettings.operatingHours,
            settings: {
              general: {
                currency: generalSettings.currency,
                language: generalSettings.language,
                autoPrintReceipt: generalSettings.autoPrintReceipt,
                requireManagerForVoid: generalSettings.requireManagerForVoid,
                requireManagerForDiscount: generalSettings.requireManagerForDiscount,
                allowSplitPayments: generalSettings.allowSplitPayments,
                enableTips: generalSettings.enableTips,
                defaultTipPercent: generalSettings.defaultTipPercent,
              },
              display: displaySettings,
              paymentMethods: enabledPaymentMethods,
            },
          }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || `Save failed (${res.status})`);
        }
      }

      // Also persist locally so preferences survive without outlet access
      localStorage.setItem('pos_general_settings', JSON.stringify(generalSettings));
      localStorage.setItem('pos_display_settings', JSON.stringify(displaySettings));
      localStorage.setItem('pos_payment_methods', JSON.stringify(enabledPaymentMethods));
      addNotification('Settings saved successfully', 'success', 'F&B');
    } catch (error: any) {
      console.error('Failed to save settings:', error);
      addNotification(error.message || 'Failed to save settings', 'warning', 'F&B');
    } finally {
      setSaving(false);
    }
  };

  const handleDeletePrinter = async (id: string) => {
    try {
      const res = await fetch(`/api/pos/hardware/printers/${id}`, { method: 'DELETE', credentials: 'include' });
      if (!res.ok) throw new Error(`Delete failed (${res.status})`);
      setPrinters(printers.filter(p => p.id !== id));
      addNotification('Printer removed', 'success', 'F&B');
    } catch (error: any) {
      addNotification(error.message || 'Failed to remove printer', 'warning', 'F&B');
    }
  };

  const handleDeleteTerminal = async (id: string) => {
    try {
      const res = await fetch(`/api/pos/hardware/payment-terminals/${id}`, { method: 'DELETE', credentials: 'include' });
      if (!res.ok) throw new Error(`Delete failed (${res.status})`);
      setPaymentTerminals(paymentTerminals.filter(t => t.id !== id));
      addNotification('Payment terminal removed', 'success', 'F&B');
    } catch (error: any) {
      addNotification(error.message || 'Failed to remove terminal', 'warning', 'F&B');
    }
  };

  const tabs = [
    { id: 'general' as const, label: 'General', icon: Sliders },
    { id: 'hardware' as const, label: 'Hardware', icon: HardDrive },
    { id: 'payment' as const, label: 'Payment', icon: CreditCard },
    { id: 'tax' as const, label: 'Tax & Fees', icon: DollarSign },
    { id: 'display' as const, label: 'Display', icon: Palette }
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 dark:text-white">
            POS Settings
          </h2>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            {outletName || 'All Outlets'} • Configuration
          </p>
        </div>
        <button
          onClick={handleSaveSettings}
          disabled={saving}
          className="flex items-center gap-2 px-6 py-3 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 text-white rounded-xl text-sm font-bold transition-all"
        >
          {saving ? (
            <>
              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
              Saving...
            </>
          ) : (
            <>
              <Save size={16} />
              Save Changes
            </>
          )}
        </button>
      </div>

      {/* Tabs */}
      <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl p-2">
        <div className="flex gap-2">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2 px-4 py-3 rounded-xl text-sm font-bold transition-all ${
                  activeTab === tab.id
                    ? 'bg-indigo-600 text-white shadow-md'
                    : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700'
                }`}
              >
                <Icon size={16} />
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Tab Content */}
      <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl p-6">
        {activeTab === 'general' && (
          <div className="space-y-6">
            <h3 className="text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <Sliders size={20} className="text-indigo-600" />
              General Settings
            </h3>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">
                  Outlet Name
                </label>
                <input
                  type="text"
                  value={generalSettings.outletName}
                  onChange={(e) => setGeneralSettings({ ...generalSettings, outletName: e.target.value })}
                  className="w-full px-4 py-3 bg-slate-50 dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 text-slate-900 dark:text-white"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">
                  Currency
                </label>
                <select
                  value={generalSettings.currency}
                  onChange={(e) => setGeneralSettings({ ...generalSettings, currency: e.target.value })}
                  className="w-full px-4 py-3 bg-slate-50 dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 text-slate-900 dark:text-white"
                >
                  <option value="ETB">ETB - Ethiopian Birr</option>
                  <option value="USD">USD - US Dollar</option>
                  <option value="EUR">EUR - Euro</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">
                  Language
                </label>
                <select
                  value={generalSettings.language}
                  onChange={(e) => setGeneralSettings({ ...generalSettings, language: e.target.value })}
                  className="w-full px-4 py-3 bg-slate-50 dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 text-slate-900 dark:text-white"
                >
                  <option value="en">English</option>
                  <option value="am">Amharic</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">
                  Default Tip Percentage
                </label>
                <input
                  type="number"
                  value={generalSettings.defaultTipPercent}
                  onChange={(e) => setGeneralSettings({ ...generalSettings, defaultTipPercent: Number(e.target.value) })}
                  className="w-full px-4 py-3 bg-slate-50 dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 text-slate-900 dark:text-white"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">
                  Service Charge Percentage
                </label>
                <input
                  type="number"
                  value={generalSettings.serviceChargePercent}
                  onChange={(e) => setGeneralSettings({ ...generalSettings, serviceChargePercent: Number(e.target.value) })}
                  className="w-full px-4 py-3 bg-slate-50 dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 text-slate-900 dark:text-white"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">
                  Operating Hours
                </label>
                <div className="flex gap-2">
                  <input
                    type="time"
                    value={generalSettings.operatingHours.open}
                    onChange={(e) => setGeneralSettings({ ...generalSettings, operatingHours: { ...generalSettings.operatingHours, open: e.target.value } })}
                    className="flex-1 px-4 py-3 bg-slate-50 dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 text-slate-900 dark:text-white"
                  />
                  <input
                    type="time"
                    value={generalSettings.operatingHours.close}
                    onChange={(e) => setGeneralSettings({ ...generalSettings, operatingHours: { ...generalSettings.operatingHours, close: e.target.value } })}
                    className="flex-1 px-4 py-3 bg-slate-50 dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 text-slate-900 dark:text-white"
                  />
                </div>
              </div>
            </div>

            <div className="space-y-4 pt-4 border-t border-slate-200 dark:border-slate-700">
              <h4 className="text-sm font-bold text-slate-900 dark:text-white">Toggle Settings</h4>
              
              <div className="space-y-3">
                {[
                  { key: 'autoPrintReceipt', label: 'Auto-print receipts after payment' },
                  { key: 'requireManagerForVoid', label: 'Require manager approval for void' },
                  { key: 'requireManagerForDiscount', label: 'Require manager approval for discounts' },
                  { key: 'allowSplitPayments', label: 'Allow split payments' },
                  { key: 'enableTips', label: 'Enable tips' }
                ].map((setting) => (
                  <div key={setting.key} className="flex items-center justify-between p-3 bg-slate-50 dark:bg-slate-700/50 rounded-xl">
                    <span className="text-sm text-slate-900 dark:text-white">{setting.label}</span>
                    <button
                      onClick={() => setGeneralSettings({ ...generalSettings, [setting.key]: !generalSettings[setting.key as keyof typeof generalSettings] })}
                      className={`p-1 rounded-lg transition-all ${
                        generalSettings[setting.key as keyof typeof generalSettings]
                          ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600'
                          : 'bg-slate-200 dark:bg-slate-600 text-slate-400'
                      }`}
                    >
                      {generalSettings[setting.key as keyof typeof generalSettings] ? <ToggleRight size={20} /> : <ToggleLeft size={20} />}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {activeTab === 'hardware' && (
          <div className="space-y-6">
            <h3 className="text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <HardDrive size={20} className="text-indigo-600" />
              Hardware Configuration
            </h3>

            {/* Printers */}
            <div>
              <div className="flex items-center justify-between mb-4">
                <h4 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                  <Printer size={16} />
                  Printers
                </h4>
                <button
                  onClick={() => setShowPrinterForm(!showPrinterForm)}
                  className="flex items-center gap-2 px-3 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-bold transition-all"
                >
                  <Plus size={14} />
                  Add Printer
                </button>
              </div>

              {showPrinterForm && (
                <div className="mb-4 p-4 bg-indigo-50 dark:bg-indigo-900/20 rounded-xl space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <input
                      type="text"
                      placeholder="Printer name"
                      value={newPrinter.name}
                      onChange={(e) => setNewPrinter({ ...newPrinter, name: e.target.value })}
                      className="px-3 py-2 bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-lg text-sm text-slate-900 dark:text-white"
                    />
                    <select
                      value={newPrinter.type}
                      onChange={(e) => setNewPrinter({ ...newPrinter, type: e.target.value as Printer['type'] })}
                      className="px-3 py-2 bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-lg text-sm text-slate-900 dark:text-white"
                    >
                      <option value="receipt">Receipt</option>
                      <option value="kitchen">Kitchen</option>
                      <option value="bar">Bar</option>
                    </select>
                    <input
                      type="text"
                      placeholder="Station (optional)"
                      value={newPrinter.station}
                      onChange={(e) => setNewPrinter({ ...newPrinter, station: e.target.value })}
                      className="px-3 py-2 bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-lg text-sm text-slate-900 dark:text-white"
                    />
                    <input
                      type="text"
                      placeholder="IP address (optional)"
                      value={newPrinter.ipAddress}
                      onChange={(e) => setNewPrinter({ ...newPrinter, ipAddress: e.target.value })}
                      className="px-3 py-2 bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-lg text-sm text-slate-900 dark:text-white"
                    />
                  </div>
                  <div className="flex gap-2">
                    <button onClick={handleAddPrinter} className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-bold">
                      Register Printer
                    </button>
                    <button onClick={() => setShowPrinterForm(false)} className="px-4 py-2 bg-slate-200 dark:bg-slate-600 text-slate-700 dark:text-slate-300 rounded-lg text-xs font-bold">
                      Cancel
                    </button>
                  </div>
                </div>
              )}

              <div className="space-y-3">
                {printers.map((printer) => (
                  <div key={printer.id} className="flex items-center justify-between p-4 bg-slate-50 dark:bg-slate-700/50 rounded-xl">
                    <div className="flex items-center gap-3">
                      <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                        printer.type === 'kitchen' ? 'bg-orange-100 dark:bg-orange-900/30 text-orange-600' :
                        printer.type === 'bar' ? 'bg-purple-100 dark:bg-purple-900/30 text-purple-600' :
                        'bg-blue-100 dark:bg-blue-900/30 text-blue-600'
                      }`}>
                        <Printer size={18} />
                      </div>
                      <div>
                        <h5 className="text-sm font-bold text-slate-900 dark:text-white">{printer.name}</h5>
                        <p className="text-xs text-slate-500">{printer.type}{printer.station ? ` • ${printer.station}` : ''}{printer.ip_address ? ` • ${printer.ip_address}` : ''}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`text-[10px] px-2 py-1 rounded-full font-bold ${
                        printer.is_active ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600' : 'bg-slate-200 dark:bg-slate-600 text-slate-500'
                      }`}>
                        {printer.is_active ? 'Active' : 'Inactive'}
                      </span>
                      <button
                        onClick={() => handleDeletePrinter(printer.id)}
                        className="p-2 hover:bg-rose-100 dark:hover:bg-rose-900/30 rounded-lg text-rose-600 transition-all"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </div>
                ))}

                {printers.length === 0 && (
                  <div className="text-center py-8 text-slate-500 dark:text-slate-400">
                    <Printer className="w-12 h-12 mx-auto mb-2 opacity-50" />
                    <p className="text-sm">No printers configured</p>
                  </div>
                )}
              </div>
            </div>

            {/* Payment Terminals */}
            <div className="pt-6 border-t border-slate-200 dark:border-slate-700">
              <div className="flex items-center justify-between mb-4">
                <h4 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                  <CreditCard size={16} />
                  Payment Terminals
                </h4>
                <button
                  onClick={() => setShowTerminalForm(!showTerminalForm)}
                  className="flex items-center gap-2 px-3 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-bold transition-all"
                >
                  <Plus size={14} />
                  Add Terminal
                </button>
              </div>

              {showTerminalForm && (
                <div className="mb-4 p-4 bg-indigo-50 dark:bg-indigo-900/20 rounded-xl space-y-3">
                  <div className="grid grid-cols-3 gap-3">
                    <select
                      value={newTerminal.type}
                      onChange={(e) => setNewTerminal({ ...newTerminal, type: e.target.value })}
                      className="px-3 py-2 bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-lg text-sm text-slate-900 dark:text-white"
                    >
                      <option value="card">Card</option>
                      <option value="mobile">Mobile</option>
                      <option value="contactless">Contactless</option>
                    </select>
                    <input
                      type="text"
                      placeholder="Model (e.g. PAX A920)"
                      value={newTerminal.model}
                      onChange={(e) => setNewTerminal({ ...newTerminal, model: e.target.value })}
                      className="px-3 py-2 bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-lg text-sm text-slate-900 dark:text-white"
                    />
                    <input
                      type="text"
                      placeholder="Serial number (optional)"
                      value={newTerminal.serialNumber}
                      onChange={(e) => setNewTerminal({ ...newTerminal, serialNumber: e.target.value })}
                      className="px-3 py-2 bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-lg text-sm text-slate-900 dark:text-white"
                    />
                  </div>
                  <div className="flex gap-2">
                    <button onClick={handleAddTerminal} className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-bold">
                      Register Terminal
                    </button>
                    <button onClick={() => setShowTerminalForm(false)} className="px-4 py-2 bg-slate-200 dark:bg-slate-600 text-slate-700 dark:text-slate-300 rounded-lg text-xs font-bold">
                      Cancel
                    </button>
                  </div>
                </div>
              )}

              <div className="space-y-3">
                {paymentTerminals.map((terminal) => (
                  <div key={terminal.id} className="flex items-center justify-between p-4 bg-slate-50 dark:bg-slate-700/50 rounded-xl">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-green-100 dark:bg-green-900/30 rounded-lg flex items-center justify-center text-green-600">
                        <CreditCard size={18} />
                      </div>
                      <div>
                        <h5 className="text-sm font-bold text-slate-900 dark:text-white">{terminal.model}</h5>
                        <p className="text-xs text-slate-500">{terminal.type}{terminal.serial_number ? ` • ${terminal.serial_number}` : ''}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`text-[10px] px-2 py-1 rounded-full font-bold ${
                        terminal.is_active ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600' : 'bg-slate-200 dark:bg-slate-600 text-slate-500'
                      }`}>
                        {terminal.is_active ? 'Active' : 'Inactive'}
                      </span>
                      <button
                        onClick={() => handleDeleteTerminal(terminal.id)}
                        className="p-2 hover:bg-rose-100 dark:hover:bg-rose-900/30 rounded-lg text-rose-600 transition-all"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </div>
                ))}

                {paymentTerminals.length === 0 && (
                  <div className="text-center py-8 text-slate-500 dark:text-slate-400">
                    <CreditCard className="w-12 h-12 mx-auto mb-2 opacity-50" />
                    <p className="text-sm">No payment terminals configured</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {activeTab === 'payment' && (
          <div className="space-y-6">
            <h3 className="text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <CreditCard size={20} className="text-indigo-600" />
              Payment Methods
            </h3>

            <div className="space-y-3">
              {[
                { key: 'cash', label: 'Cash', icon: DollarSign },
                { key: 'card', label: 'Card', icon: CreditCard },
                { key: 'mobile', label: 'Mobile Money', icon: Smartphone },
                { key: 'roomCharge', label: 'Room Charge', icon: Building }
              ].map((method) => {
                const Icon = method.icon;
                return (
                  <div key={method.key} className="flex items-center justify-between p-4 bg-slate-50 dark:bg-slate-700/50 rounded-xl">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-indigo-100 dark:bg-indigo-900/30 rounded-lg flex items-center justify-center text-indigo-600">
                        <Icon size={18} />
                      </div>
                      <span className="text-sm font-bold text-slate-900 dark:text-white">{method.label}</span>
                    </div>
                    <button
                      onClick={() => setEnabledPaymentMethods({ ...enabledPaymentMethods, [method.key]: !enabledPaymentMethods[method.key as keyof typeof enabledPaymentMethods] })}
                      className={`p-1 rounded-lg transition-all ${
                        enabledPaymentMethods[method.key as keyof typeof enabledPaymentMethods]
                          ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600'
                          : 'bg-slate-200 dark:bg-slate-600 text-slate-400'
                      }`}
                    >
                      {enabledPaymentMethods[method.key as keyof typeof enabledPaymentMethods] ? <ToggleRight size={20} /> : <ToggleLeft size={20} />}
                    </button>
                  </div>
                );
              })}
            </div>

            <div className="p-4 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl">
              <div className="flex items-start gap-3">
                <Info size={18} className="text-amber-600 dark:text-amber-400 mt-0.5" />
                <div>
                  <h5 className="text-sm font-bold text-amber-900 dark:text-amber-100 mb-1">Payment Configuration</h5>
                  <p className="text-xs text-amber-700 dark:text-amber-300">
                    Ensure payment terminals are properly configured before enabling card payments. Contact your administrator for setup assistance.
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'tax' && (
          <div className="space-y-6">
            <h3 className="text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <DollarSign size={20} className="text-indigo-600" />
              Tax & Fees
            </h3>

            <div className="p-4 bg-indigo-50 dark:bg-indigo-900/20 rounded-xl border border-indigo-100 dark:border-indigo-900/40">
              <p className="text-xs text-indigo-700 dark:text-indigo-300">
                Tax rates are managed centrally in Admin → Rate & Tax. The rates below are the effective
                values applied to this outlet&apos;s POS transactions (outlet-scoped rules take precedence).
              </p>
            </div>

            {!effectiveTax ? (
              <div className="text-center py-8 text-slate-500 dark:text-slate-400">
                <Percent className="w-12 h-12 mx-auto mb-2 opacity-50" />
                <p className="text-sm">Loading effective tax rates…</p>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex items-center justify-between p-4 bg-slate-50 dark:bg-slate-700/50 rounded-xl">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-green-100 dark:bg-green-900/30 rounded-lg flex items-center justify-center text-green-600">
                      <Percent size={18} />
                    </div>
                    <div>
                      <h5 className="text-sm font-bold text-slate-900 dark:text-white">VAT</h5>
                      <p className="text-xs text-slate-500">Value-added tax on subtotal after discount</p>
                    </div>
                  </div>
                  <span className="text-lg font-black text-slate-900 dark:text-white">
                    {effectiveTax.vat === null ? '—' : `${effectiveTax.vat}%`}
                  </span>
                </div>

                <div className="flex items-center justify-between p-4 bg-slate-50 dark:bg-slate-700/50 rounded-xl">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-blue-100 dark:bg-blue-900/30 rounded-lg flex items-center justify-center text-blue-600">
                      <Percent size={18} />
                    </div>
                    <div>
                      <h5 className="text-sm font-bold text-slate-900 dark:text-white">Service Charge</h5>
                      <p className="text-xs text-slate-500">Hospitality service charge</p>
                    </div>
                  </div>
                  <span className="text-lg font-black text-slate-900 dark:text-white">
                    {effectiveTax.serviceCharge === null ? '—' : `${effectiveTax.serviceCharge}%`}
                  </span>
                </div>

                {(effectiveTax.additional || []).map((tax) => (
                  <div key={tax.code} className="flex items-center justify-between p-4 bg-slate-50 dark:bg-slate-700/50 rounded-xl">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-amber-100 dark:bg-amber-900/30 rounded-lg flex items-center justify-center text-amber-600">
                        <Percent size={18} />
                      </div>
                      <div>
                        <h5 className="text-sm font-bold text-slate-900 dark:text-white">{tax.name}</h5>
                        <p className="text-xs text-slate-500">
                          {tax.taxType}{tax.calcBase === 'total' ? ' • on total incl. VAT' : ' • on subtotal'}
                        </p>
                      </div>
                    </div>
                    <span className="text-lg font-black text-slate-900 dark:text-white">{tax.rate}%</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === 'display' && (
          <div className="space-y-6">
            <h3 className="text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <Palette size={20} className="text-indigo-600" />
              Display Settings
            </h3>

            <div className="space-y-4">
              <div className="flex items-center justify-between p-4 bg-slate-50 dark:bg-slate-700/50 rounded-xl">
                <div>
                  <h5 className="text-sm font-bold text-slate-900 dark:text-white">Show Product Images</h5>
                  <p className="text-xs text-slate-500">Display images in product grid</p>
                </div>
                <button
                  onClick={() => setDisplaySettings({ ...displaySettings, showImages: !displaySettings.showImages })}
                  className={`p-1 rounded-lg transition-all ${
                    displaySettings.showImages
                      ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600'
                      : 'bg-slate-200 dark:bg-slate-600 text-slate-400'
                  }`}
                >
                  {displaySettings.showImages ? <ToggleRight size={20} /> : <ToggleLeft size={20} />}
                </button>
              </div>

              <div className="flex items-center justify-between p-4 bg-slate-50 dark:bg-slate-700/50 rounded-xl">
                <div>
                  <h5 className="text-sm font-bold text-slate-900 dark:text-white">Show Quick Actions</h5>
                  <p className="text-xs text-slate-500">Display quick action buttons</p>
                </div>
                <button
                  onClick={() => setDisplaySettings({ ...displaySettings, showQuickActions: !displaySettings.showQuickActions })}
                  className={`p-1 rounded-lg transition-all ${
                    displaySettings.showQuickActions
                      ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600'
                      : 'bg-slate-200 dark:bg-slate-600 text-slate-400'
                  }`}
                >
                  {displaySettings.showQuickActions ? <ToggleRight size={20} /> : <ToggleLeft size={20} />}
                </button>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">
                  Grid Columns
                </label>
                <div className="flex gap-2">
                  {[3, 4, 5, 6].map((cols) => (
                    <button
                      key={cols}
                      onClick={() => setDisplaySettings({ ...displaySettings, gridColumns: cols })}
                      className={`flex-1 py-3 rounded-xl text-sm font-bold transition-all ${
                        displaySettings.gridColumns === cols
                          ? 'bg-indigo-600 text-white'
                          : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-600'
                      }`}
                    >
                      {cols} Columns
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">
                  Font Size
                </label>
                <div className="flex gap-2">
                  {(['small', 'medium', 'large'] as const).map((size) => (
                    <button
                      key={size}
                      onClick={() => setDisplaySettings({ ...displaySettings, fontSize: size })}
                      className={`flex-1 py-3 rounded-xl text-sm font-bold transition-all capitalize ${
                        displaySettings.fontSize === size
                          ? 'bg-indigo-600 text-white'
                          : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-600'
                      }`}
                    >
                      {size}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">
                  Theme
                </label>
                <div className="flex gap-2">
                  {(['light', 'dark'] as const).map((theme) => (
                    <button
                      key={theme}
                      onClick={() => setDisplaySettings({ ...displaySettings, theme })}
                      className={`flex-1 py-3 rounded-xl text-sm font-bold transition-all capitalize ${
                        displaySettings.theme === theme
                          ? 'bg-indigo-600 text-white'
                          : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-600'
                      }`}
                    >
                      {theme}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
