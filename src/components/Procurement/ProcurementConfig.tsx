/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Procurement Configuration — Supply Chain & Procurement Portal (/erp/procurement/config).
 * Aligns with unified_supply_chain_procurement_portal.md section 68 (Master Data).
 *
 * Master Data (spec section 68):
 *   Procurement Categories, Subcategories, Units of Measure, Purchase Types,
 *   Supplier Types, Supplier Statuses, Payment Terms, Delivery Terms, Currency,
 *   Tax Codes, Approval Thresholds, Procurement Policies, Contract Types
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
  Settings, RefreshCw, Loader2, Save, Plus, AlertCircle,
  Tag, FileSignature, DollarSign, ShieldCheck, FileText, Trash2,
} from 'lucide-react';
import { PageHeader, SectionCard, Badge } from '../FrontOffice/ui';
import { button, layout } from '../FrontOffice/brandTheme';
import { useERP } from '../../context/ERPContext';
import {
  fetchConfig, updateConfig, fetchCategories, createCategory, deleteCategory, type Config,
} from '../../services/procurementService';

// Spec section 68: Master data types
const MASTER_DATA = [
  { key: 'categories', label: 'Procurement Categories', icon: Tag, items: ['Food', 'Beverage', 'Cleaning Supplies', 'Linen', 'Amenities', 'Equipment', 'Maintenance', 'Office Supplies', 'IT Equipment', 'Furniture', 'Utilities', 'Services', 'Other'] },
  { key: 'subcategories', label: 'Subcategories', icon: Tag, items: ['Fresh Produce', 'Frozen', 'Dairy', 'Meat', 'Seafood', 'Bakery', 'Hot Beverages', 'Cold Beverages', 'Alcoholic Beverages'] },
  { key: 'uom', label: 'Units of Measure', icon: Tag, items: ['KG', 'G', 'L', 'ML', 'PCS', 'BOX', 'CASE', 'PACK', 'DOZEN', 'ROLL', 'BOTTLE', 'CARTON'] },
  { key: 'purchaseTypes', label: 'Purchase Types', icon: Tag, items: ['Standard', 'Emergency', 'Direct', 'Tender', 'RFQ', 'Contract', 'Consignment'] },
  { key: 'supplierTypes', label: 'Supplier Types', icon: Tag, items: ['Manufacturer', 'Distributor', 'Wholesaler', 'Retailer', 'Service Provider', 'Contractor', 'Consultant'] },
  { key: 'supplierStatuses', label: 'Supplier Statuses', icon: Tag, items: ['Application', 'Under Review', 'Pending Approval', 'Active', 'Preferred', 'Restricted', 'Suspended', 'Disqualified', 'Inactive'] },
  { key: 'paymentTerms', label: 'Payment Terms', icon: DollarSign, items: ['Net 15', 'Net 30', 'Net 45', 'Net 60', 'Cash on Delivery', 'Prepaid', '2/10 Net 30'] },
  { key: 'deliveryTerms', label: 'Delivery Terms', icon: Tag, items: ['EXW', 'FCA', 'FOB', 'CFR', 'CIF', 'DAP', 'DDP'] },
  { key: 'currency', label: 'Currency', icon: DollarSign, items: ['ETB', 'USD', 'EUR', 'GBP', 'SAR', 'AED'] },
  { key: 'taxCodes', label: 'Tax Codes', icon: DollarSign, items: ['VAT-15%', 'VAT-Exempt', 'Zero-Rated', 'Withholding-2%', 'Service-10%'] },
  { key: 'contractTypes', label: 'Contract Types', icon: FileSignature, items: ['Supplier Contract', 'Framework Agreement', 'Rate Agreement', 'Service Agreement', 'Volume Agreement', 'Long-Term Agreement', 'Exclusive Agreement'] },
];

const inputClass = 'w-full px-3 py-2 text-sm border border-gray-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-gray-900 dark:text-white outline-none focus:ring-1 focus:ring-[var(--color-accent-operations)]';

const ProcurementConfig: React.FC = () => {
  const { addNotification } = useERP();
  const [config, setConfig] = useState<Config>({});
  const [categories, setCategories] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState<'settings' | 'master-data'>('settings');

  const [approvalThresholds, setApprovalThresholds] = useState({ requisition: 5000, po: 10000, contract: 50000 });
  const [alertSettings, setAlertSettings] = useState({ contract_expiry_days: 90, qualification_expiry_days: 60 });
  const [defaultPaymentTerms, setDefaultPaymentTerms] = useState(30);
  const [defaultLeadTime, setDefaultLeadTime] = useState(7);
  const [newCategory, setNewCategory] = useState({ name: '', category_type: 'Food & Beverage', parent_id: '' });

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [configData, categoriesData] = await Promise.all([fetchConfig(), fetchCategories()]);
      setConfig(configData.config);
      setCategories(categoriesData.categories);
      if (configData.config.approval_thresholds) setApprovalThresholds(configData.config.approval_thresholds);
      if (configData.config.alert_settings) setAlertSettings(configData.config.alert_settings);
      if (configData.config.default_payment_terms) setDefaultPaymentTerms(configData.config.default_payment_terms);
      if (configData.config.default_lead_time) setDefaultLeadTime(configData.config.default_lead_time);
    } catch (e: any) {
      setError(e?.message || 'Failed to load configuration');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const saveConfig = async (key: string, value: any) => {
    setSaving(true);
    try {
      await updateConfig(key, { value });
      setConfig((prev: any) => ({ ...prev, [key]: value }));
      addNotification?.({ type: 'success', message: 'Configuration saved' });
    } catch (e: any) {
      addNotification?.({ type: 'error', message: e?.message || 'Failed to save configuration' });
    } finally {
      setSaving(false);
    }
  };

  const addCategory = async () => {
    if (!newCategory.name) {
      addNotification?.({ type: 'warning', message: 'Category name is required' });
      return;
    }
    setSaving(true);
    try {
      await createCategory({
        name: newCategory.name,
        categoryType: newCategory.category_type,
        parentId: newCategory.parent_id || undefined,
      });
      addNotification?.({ type: 'success', message: 'Category created' });
      setNewCategory({ name: '', category_type: 'Food & Beverage', parent_id: '' });
      await load();
    } catch (e: any) {
      addNotification?.({ type: 'error', message: e?.message || 'Failed to create category' });
    } finally {
      setSaving(false);
    }
  };

  const removeCategory = async (id: string, name: string) => {
    if (!window.confirm(`Delete category "${name}"? This cannot be undone.`)) return;
    setSaving(true);
    try {
      await deleteCategory(id);
      addNotification?.({ type: 'success', message: 'Category deleted' });
      await load();
    } catch (e: any) {
      addNotification?.({ type: 'error', message: e?.message || 'Failed to delete category' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={layout.sectionStack}>
      <PageHeader
        title="Procurement Configuration"
        subtitle="Master data management and settings per specification section 68."
        icon={Settings}
        actions={
          <button onClick={load} disabled={loading} className={button.secondary}>
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
          </button>
        }
      />

      {error && (
        <SectionCard tone="danger" pad="md">
          <div className="flex items-center gap-2 text-sm text-red-600 dark:text-red-400">
            <AlertCircle className="w-4 h-4" /> {error}
          </div>
        </SectionCard>
      )}

      {/* Tab switcher */}
      <div className="flex gap-2">
        <button onClick={() => setActiveTab('settings')} className={`px-4 py-2 text-sm rounded-xl font-medium transition ${activeTab === 'settings' ? 'bg-indigo-600 text-white' : 'bg-white dark:bg-slate-800 text-gray-600 dark:text-gray-400 border border-gray-200 dark:border-slate-700'}`}>
          <Settings className="w-4 h-4 inline mr-1" /> Settings
        </button>
        <button onClick={() => setActiveTab('master-data')} className={`px-4 py-2 text-sm rounded-xl font-medium transition ${activeTab === 'master-data' ? 'bg-indigo-600 text-white' : 'bg-white dark:bg-slate-800 text-gray-600 dark:text-gray-400 border border-gray-200 dark:border-slate-700'}`}>
          <Tag className="w-4 h-4 inline mr-1" /> Master Data
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center p-12"><Loader2 className="w-8 h-8 animate-spin text-indigo-600" /></div>
      ) : activeTab === 'settings' ? (
        <>
          {/* Approval Thresholds */}
          <SectionCard title="Approval Thresholds" subtitle="Per specification section 68" icon={ShieldCheck} pad="md">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-bold text-gray-500 mb-1">Requisition Threshold</label>
                <input type="number" className={inputClass} value={approvalThresholds.requisition} onChange={(e) => setApprovalThresholds({ ...approvalThresholds, requisition: parseInt(e.target.value) || 0 })} />
                <p className="text-xs text-gray-400 mt-1">Amount requiring approval</p>
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-500 mb-1">PO Threshold</label>
                <input type="number" className={inputClass} value={approvalThresholds.po} onChange={(e) => setApprovalThresholds({ ...approvalThresholds, po: parseInt(e.target.value) || 0 })} />
                <p className="text-xs text-gray-400 mt-1">Amount requiring approval</p>
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-500 mb-1">Contract Threshold</label>
                <input type="number" className={inputClass} value={approvalThresholds.contract} onChange={(e) => setApprovalThresholds({ ...approvalThresholds, contract: parseInt(e.target.value) || 0 })} />
                <p className="text-xs text-gray-400 mt-1">Amount requiring approval</p>
              </div>
            </div>
            <div className="mt-4 flex justify-end">
              <button onClick={() => saveConfig('approval_thresholds', approvalThresholds)} disabled={saving} className={button.primary + ' disabled:opacity-50'}>
                <Save className="w-4 h-4" /> Save Thresholds
              </button>
            </div>
          </SectionCard>

          {/* Alert Settings */}
          <SectionCard title="Alert Settings" subtitle="Per specification section 33 — configurable alert periods" icon={AlertCircle} pad="md">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-bold text-gray-500 mb-1">Contract Expiry Alert (days)</label>
                <input type="number" className={inputClass} value={alertSettings.contract_expiry_days} onChange={(e) => setAlertSettings({ ...alertSettings, contract_expiry_days: parseInt(e.target.value) || 0 })} />
                <p className="text-xs text-gray-400 mt-1">Days before expiry to alert</p>
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-500 mb-1">Qualification Expiry Alert (days)</label>
                <input type="number" className={inputClass} value={alertSettings.qualification_expiry_days} onChange={(e) => setAlertSettings({ ...alertSettings, qualification_expiry_days: parseInt(e.target.value) || 0 })} />
                <p className="text-xs text-gray-400 mt-1">Days before expiry to alert</p>
              </div>
            </div>
            <div className="mt-4 flex justify-end">
              <button onClick={() => saveConfig('alert_settings', alertSettings)} disabled={saving} className={button.primary + ' disabled:opacity-50'}>
                <Save className="w-4 h-4" /> Save Alert Settings
              </button>
            </div>
          </SectionCard>

          {/* Default Settings */}
          <SectionCard title="Default Settings" icon={Settings} pad="md">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-bold text-gray-500 mb-1">Default Payment Terms (days)</label>
                <input type="number" className={inputClass} value={defaultPaymentTerms} onChange={(e) => setDefaultPaymentTerms(parseInt(e.target.value) || 0)} />
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-500 mb-1">Default Lead Time (days)</label>
                <input type="number" className={inputClass} value={defaultLeadTime} onChange={(e) => setDefaultLeadTime(parseInt(e.target.value) || 0)} />
              </div>
            </div>
            <div className="mt-4 flex justify-end">
              <button onClick={() => { saveConfig('default_payment_terms', defaultPaymentTerms); saveConfig('default_lead_time', defaultLeadTime); }} disabled={saving} className={button.primary + ' disabled:opacity-50'}>
                <Save className="w-4 h-4" /> Save Defaults
              </button>
            </div>
          </SectionCard>

          {/* Procurement Categories */}
          <SectionCard title="Procurement Categories" subtitle="Per specification section 68" icon={Tag} pad="md">
            <div className="mb-4 p-4 bg-gray-50 dark:bg-slate-800 rounded-xl space-y-3">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <input className={inputClass} placeholder="Category name" value={newCategory.name} onChange={(e) => setNewCategory({ ...newCategory, name: e.target.value })} />
                <select className={inputClass} value={newCategory.category_type} onChange={(e) => setNewCategory({ ...newCategory, category_type: e.target.value })}>
                  <option value="Food & Beverage">Food & Beverage</option>
                  <option value="Housekeeping">Housekeeping</option>
                  <option value="Engineering">Engineering</option>
                  <option value="Administration">Administration</option>
                </select>
                <button onClick={addCategory} disabled={saving} className={button.primary + ' disabled:opacity-50'}>
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} Add Category
                </button>
              </div>
            </div>
            <div className="space-y-2">
              {categories.map((cat) => (
                <div key={cat.id} className="p-3 border border-gray-200 dark:border-slate-700 rounded-xl flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-gray-900 dark:text-white">{cat.name}</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">{cat.category_type}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge tone="info">{cat.category_type}</Badge>
                    <button
                      onClick={() => removeCategory(cat.id, cat.name)}
                      disabled={saving}
                      className="p-1.5 rounded-lg text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-50"
                      title="Delete category"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
              {categories.length === 0 && <p className="text-sm text-gray-500">No categories found</p>}
            </div>
          </SectionCard>
        </>
      ) : (
        <>
          {/* Spec section 68: Master Data Reference */}
          <SectionCard title="Master Data Reference" subtitle="Per specification section 68 — managed centrally" icon={FileText} pad="md">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {MASTER_DATA.map((md) => {
                const Icon = md.icon;
                return (
                  <div key={md.key} className="p-4 rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800">
                    <div className="flex items-center gap-2 mb-2">
                      <Icon className="w-4 h-4 text-indigo-600" />
                      <p className="text-sm font-bold text-gray-900 dark:text-white">{md.label}</p>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {md.items.map((item) => (
                        <span key={item} className="px-2 py-1 text-xs rounded-lg bg-gray-100 dark:bg-slate-700 text-gray-600 dark:text-gray-400">{item}</span>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </SectionCard>

          {/* Procurement Policies (spec section 68) */}
          <SectionCard title="Procurement Policies" subtitle="Per specification section 68" icon={ShieldCheck} pad="md">
            <div className="space-y-2">
              <div className="p-3 rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800">
                <p className="text-sm font-medium text-gray-900 dark:text-white">Competitive Bidding Policy</p>
                <p className="text-xs text-gray-500 dark:text-gray-400">All purchases above {approvalThresholds.po} ETB require at least 3 quotations.</p>
              </div>
              <div className="p-3 rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800">
                <p className="text-sm font-medium text-gray-900 dark:text-white">Supplier Qualification Policy</p>
                <p className="text-xs text-gray-500 dark:text-gray-400">All active suppliers must pass qualification criteria before PO issuance.</p>
              </div>
              <div className="p-3 rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800">
                <p className="text-sm font-medium text-gray-900 dark:text-white">Contract Review Policy</p>
                <p className="text-xs text-gray-500 dark:text-gray-400">Contracts expiring within {alertSettings.contract_expiry_days} days trigger renewal review.</p>
              </div>
              <div className="p-3 rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800">
                <p className="text-sm font-medium text-gray-900 dark:text-white">Emergency Purchase Policy</p>
                <p className="text-xs text-gray-500 dark:text-gray-400">Emergency purchases require post-purchase review within 48 hours.</p>
              </div>
            </div>
          </SectionCard>
        </>
      )}
    </div>
  );
};

export default ProcurementConfig;
