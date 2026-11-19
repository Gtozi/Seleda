/**
 * @license
 * SPDX-License-Identifier: Apache-2.5
 *
 * Pricing & Packages module — F&B Portal.
 * Owns Price Lists, Meal Plans, Packages, Promotions, and Special Offers.
 * Per spec §5 (Pricing & Packages), §16 (F&B Packages), §17 (Promotions).
 */

import React, { useEffect, useMemo, useState } from 'react';
import {
  DollarSign,
  Package,
  Tag,
  Sparkles,
  Plus,
  Pencil,
  Trash2,
  Search,
  Clock,
  Users,
  Utensils,
  CheckCircle2,
  X,
  ChevronDown,
  ChevronRight,
  Calculator,
  TrendingUp,
  AlertTriangle,
} from 'lucide-react';
import { useERP } from '../../context/ERPContext';
import StatCard from '../FrontOffice/StatCard';
import { PageHeader, SectionCard, Badge } from '../FrontOffice/ui';
import { button, layout } from '../FrontOffice/brandTheme';

type SubTab = 'price-lists' | 'meal-plans' | 'packages' | 'promotions' | 'special-offers';

interface PriceList {
  id: string;
  name: string;
  outlet_id: string | null;
  outlet_name: string | null;
  currency: string;
  effective_from: string;
  effective_to: string | null;
  status: 'Active' | 'Draft' | 'Expired';
  description: string | null;
  item_count: number;
  price_list_items?: Array<{
    id: string;
    menu_item_id: string | null;
    menu_item_name: string | null;
    price: number;
  }>;
}

interface MealPlanMenuItem {
  id: string;
  menu_item_id: string | null;
  menu_item_name: string;
  meal_period: string;
  sort_order: number;
}

interface MealPlan {
  id: string;
  name: string;
  type: 'Room Only' | 'Bed & Breakfast' | 'Half Board' | 'Full Board' | 'All Inclusive';
  adult_price: number;
  child_price: number;
  includes: string[];
  status: 'Active' | 'Inactive';
  description: string | null;
  menu_items?: MealPlanMenuItem[];
}

interface PackageMenuItem {
  id: string;
  menu_item_id: string | null;
  menu_item_name: string;
  component_type: string;
  sort_order: number;
}

interface Package {
  id: string;
  name: string;
  description: string | null;
  package_type: string;
  price_per_person: number;
  min_covers: number;
  status: 'Active' | 'Inactive';
  components?: Array<{
    id: string;
    component_name: string;
    component_type: string;
    sort_order: number;
  }>;
  outlets?: Array<{
    id: string;
    outlet_id: string | null;
    outlet_name: string | null;
  }>;
  menu_items?: PackageMenuItem[];
}

interface Promotion {
  id: string;
  name: string;
  type: string;
  discount_description: string;
  discount_value: number | null;
  discount_type: string | null;
  schedule: string | null;
  start_date: string | null;
  end_date: string | null;
  channels: string[];
  status: 'Active' | 'Scheduled' | 'Ended';
}

interface SpecialOfferMenuItem {
  id: string;
  menu_item_id: string | null;
  menu_item_name: string;
  course_type: string;
  sort_order: number;
}

interface SpecialOffer {
  id: string;
  name: string;
  description: string | null;
  outlet_id: string | null;
  outlet_name: string | null;
  valid_until: string;
  status: 'Active' | 'Expired';
  price: number;
  menu_items?: SpecialOfferMenuItem[];
}

interface Outlet {
  id: string;
  name: string;
  type: string;
}

interface MenuItemRef {
  id: string;
  name: string;
  item_code: string | null;
  selling_price: number;
}

interface CostAnalysisItem {
  menu_item_id: string | null;
  menu_item_name: string;
  meal_period?: string;
  component_type?: string;
  plate_cost: number;
  selling_price: number;
  has_recipe: boolean;
}

interface MealPlanCostAnalysis {
  id: string;
  name: string;
  type: string;
  status: string;
  adult_price: number;
  child_price: number;
  menu_item_count: number;
  total_cost: number;
  adult_margin: number;
  adult_margin_pct: number;
  child_margin: number;
  child_margin_pct: number;
  items: CostAnalysisItem[];
}

interface PackageCostAnalysis {
  id: string;
  name: string;
  package_type: string;
  status: string;
  price_per_person: number;
  min_covers: number;
  menu_item_count: number;
  total_cost: number;
  margin: number;
  margin_pct: number;
  items: CostAnalysisItem[];
}

interface SpecialOfferCostAnalysis {
  id: string;
  name: string;
  outlet_name: string | null;
  valid_until: string;
  status: string;
  price: number;
  menu_item_count: number;
  total_cost: number;
  margin: number;
  margin_pct: number;
  items: CostAnalysisItem[];
}

const marginTone = (pct: number): 'success' | 'warning' | 'danger' =>
  pct >= 40 ? 'success' : pct >= 25 ? 'warning' : 'danger';

const marginColor = (pct: number): string =>
  pct >= 40 ? 'text-green-600 dark:text-green-400' : pct >= 25 ? 'text-amber-600 dark:text-amber-400' : 'text-red-600 dark:text-red-400';

const SUB_TABS: { id: SubTab; label: string; icon: typeof DollarSign }[] = [
  { id: 'price-lists', label: 'Price Lists', icon: DollarSign },
  { id: 'meal-plans', label: 'Meal Plans', icon: Utensils },
  { id: 'packages', label: 'Packages', icon: Package },
  { id: 'promotions', label: 'Promotions', icon: Tag },
  { id: 'special-offers', label: 'Special Offers', icon: Sparkles },
];

const STATUS_TONE: Record<string, 'success' | 'neutral' | 'warning' | 'info' | 'danger'> = {
  Active: 'success',
  Inactive: 'neutral',
  Draft: 'warning',
  Expired: 'danger',
  Scheduled: 'info',
  Ended: 'neutral',
};

export default function PricingPackages() {
  const { addNotification, formatAmount } = useERP();
  const [subTab, setSubTab] = useState<SubTab>('price-lists');
  const [search, setSearch] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const [priceLists, setPriceLists] = useState<PriceList[]>([]);
  const [mealPlans, setMealPlans] = useState<MealPlan[]>([]);
  const [packages, setPackages] = useState<Package[]>([]);
  const [promotions, setPromotions] = useState<Promotion[]>([]);
  const [specialOffers, setSpecialOffers] = useState<SpecialOffer[]>([]);
  const [outlets, setOutlets] = useState<Outlet[]>([]);
  const [menuItems, setMenuItems] = useState<MenuItemRef[]>([]);
  const [loading, setLoading] = useState(false);

  // Cost analysis state
  const [showCostAnalysis, setShowCostAnalysis] = useState(false);
  const [mealPlanCosts, setMealPlanCosts] = useState<MealPlanCostAnalysis[]>([]);
  const [packageCosts, setPackageCosts] = useState<PackageCostAnalysis[]>([]);
  const [specialOfferCosts, setSpecialOfferCosts] = useState<SpecialOfferCostAnalysis[]>([]);
  const [costLoading, setCostLoading] = useState(false);
  const [expandedCostId, setExpandedCostId] = useState<string | null>(null);

  // Form state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [formData, setFormData] = useState<Record<string, any>>({});

  const fetchData = async () => {
    setLoading(true);
    try {
      const [plRes, mpRes, pkgRes, promoRes, soRes, olRes, miRes] = await Promise.all([
        fetch('/api/fb/price-lists'),
        fetch('/api/fb/meal-plans'),
        fetch('/api/fb/packages'),
        fetch('/api/fb/promotions'),
        fetch('/api/fb/special-offers'),
        fetch('/api/fb/outlets'),
        fetch('/api/fb/menu-items'),
      ]);
      if (plRes.ok) setPriceLists(await plRes.json());
      if (mpRes.ok) setMealPlans(await mpRes.json());
      if (pkgRes.ok) setPackages(await pkgRes.json());
      if (promoRes.ok) setPromotions(await promoRes.json());
      if (soRes.ok) setSpecialOffers(await soRes.json());
      if (olRes.ok) setOutlets(await olRes.json());
      if (miRes.ok) setMenuItems(await miRes.json());
    } catch (err) {
      console.error('Failed to fetch pricing data:', err);
      addNotification('Failed to load pricing data', 'warning', 'F&B');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, []);

  const fetchCostAnalysis = async () => {
    setCostLoading(true);
    try {
      const [mpcRes, pcRes, soRes] = await Promise.all([
        fetch('/api/fb/meal-plans/cost-analysis'),
        fetch('/api/fb/packages/cost-analysis'),
        fetch('/api/fb/special-offers/cost-analysis'),
      ]);
      if (mpcRes.ok) setMealPlanCosts(await mpcRes.json());
      if (pcRes.ok) setPackageCosts(await pcRes.json());
      if (soRes.ok) setSpecialOfferCosts(await soRes.json());
    } catch (err) {
      console.error('Failed to fetch cost analysis:', err);
      addNotification('Failed to load cost analysis', 'warning', 'F&B');
    } finally {
      setCostLoading(false);
    }
  };

  const toggleCostAnalysis = () => {
    const next = !showCostAnalysis;
    setShowCostAnalysis(next);
    if (next && mealPlanCosts.length === 0 && packageCosts.length === 0 && specialOfferCosts.length === 0) {
      fetchCostAnalysis();
    }
  };

  const counts = useMemo(() => ({
    priceLists: priceLists.filter(p => p.status === 'Active').length,
    mealPlans: mealPlans.filter(m => m.status === 'Active').length,
    packages: packages.filter(p => p.status === 'Active').length,
    promotions: promotions.filter(p => p.status === 'Active').length,
  }), [priceLists, mealPlans, packages, promotions]);

  const filteredPriceLists = priceLists.filter(p =>
    p.name.toLowerCase().includes(search.toLowerCase()) || p.outlet_name?.toLowerCase().includes(search.toLowerCase())
  );
  const filteredMealPlans = mealPlans.filter(m => m.name.toLowerCase().includes(search.toLowerCase()));
  const filteredPackages = packages.filter(p => p.name.toLowerCase().includes(search.toLowerCase()));
  const filteredPromotions = promotions.filter(p => p.name.toLowerCase().includes(search.toLowerCase()));
  const filteredOffers = specialOffers.filter(o => o.name.toLowerCase().includes(search.toLowerCase()));

  const endpointFor = (type: SubTab) =>
    type === 'price-lists' ? 'price-lists' : type === 'meal-plans' ? 'meal-plans' : type === 'packages' ? 'packages' : type === 'promotions' ? 'promotions' : 'special-offers';

  const defaultFormFor = (type: SubTab): Record<string, any> => {
    switch (type) {
      case 'price-lists':
        return { name: '', outletId: '', outletName: '', currency: 'USD', effectiveFrom: new Date().toISOString().split('T')[0], effectiveTo: '', status: 'Draft', description: '', items: [] };
      case 'meal-plans':
        return { name: '', type: 'Bed & Breakfast', adultPrice: 0, childPrice: 0, includes: [], status: 'Active', description: '', menuItems: [] };
      case 'packages':
        return { name: '', description: '', packageType: 'custom', pricePerPerson: 0, minCovers: 1, status: 'Active', components: [], outlets: [], menuItems: [] };
      case 'promotions':
        return { name: '', type: 'Happy Hour', discountDescription: '', discountValue: null, discountType: 'percentage', schedule: '', startDate: new Date().toISOString().split('T')[0], endDate: '', channels: [], status: 'Active' };
      case 'special-offers':
        return { name: '', description: '', outletId: '', outletName: '', validUntil: new Date().toISOString().split('T')[0], status: 'Active', price: 0, menuItems: [] };
    }
  };

  const handleAdd = () => {
    setEditingId(null);
    setFormData(defaultFormFor(subTab));
    setShowModal(true);
  };

  const handleEdit = (item: any, type: SubTab) => {
    setEditingId(item.id);
    switch (type) {
      case 'price-lists':
        setFormData({
          name: item.name, outletId: item.outlet_id || '', outletName: item.outlet_name || '',
          currency: item.currency, effectiveFrom: item.effective_from, effectiveTo: item.effective_to || '',
          status: item.status, description: item.description || '',
          items: (item.price_list_items || []).map((i: any) => ({ menuItemId: i.menu_item_id || '', menuItemName: i.menu_item_name || '', price: i.price })),
        });
        break;
      case 'meal-plans':
        setFormData({
          name: item.name, type: item.type, adultPrice: item.adult_price, childPrice: item.child_price,
          includes: item.includes || [], status: item.status, description: item.description || '',
          menuItems: (item.menu_items || []).map((mi: any) => ({ menuItemId: mi.menu_item_id || '', menuItemName: mi.menu_item_name || '', mealPeriod: mi.meal_period, sortOrder: mi.sort_order })),
        });
        break;
      case 'packages':
        setFormData({
          name: item.name, description: item.description || '', packageType: item.package_type,
          pricePerPerson: item.price_per_person, minCovers: item.min_covers, status: item.status,
          components: (item.components || []).map((c: any) => ({ componentName: c.component_name, componentType: c.component_type, sortOrder: c.sort_order })),
          outlets: (item.outlets || []).map((o: any) => ({ outletId: o.outlet_id || '', outletName: o.outlet_name || '' })),
          menuItems: (item.menu_items || []).map((mi: any) => ({ menuItemId: mi.menu_item_id || '', menuItemName: mi.menu_item_name || '', componentType: mi.component_type, sortOrder: mi.sort_order })),
        });
        break;
      case 'promotions':
        setFormData({
          name: item.name, type: item.type, discountDescription: item.discount_description,
          discountValue: item.discount_value, discountType: item.discount_type || 'percentage',
          schedule: item.schedule || '', startDate: item.start_date || '', endDate: item.end_date || '',
          channels: item.channels || [], status: item.status,
        });
        break;
      case 'special-offers':
        setFormData({
          name: item.name, description: item.description || '', outletId: item.outlet_id || '',
          outletName: item.outlet_name || '', validUntil: item.valid_until, status: item.status,
          price: item.price || 0,
          menuItems: (item.menu_items || []).map((mi: any) => ({ menuItemId: mi.menu_item_id || '', menuItemName: mi.menu_item_name || '', courseType: mi.course_type, sortOrder: mi.sort_order })),
        });
        break;
    }
    setShowModal(true);
  };

  const handleSave = async () => {
    if (!formData.name?.trim()) {
      addNotification('Name is required', 'warning', 'F&B');
      return;
    }
    setSaving(true);
    try {
      const ep = endpointFor(subTab);
      const url = editingId ? `/api/fb/${ep}/${editingId}` : `/api/fb/${ep}`;
      const method = editingId ? 'PATCH' : 'POST';
      const res = await fetch(url, {
        method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(formData),
      });
      if (!res.ok) throw new Error('Failed to save');
      addNotification(editingId ? 'Updated successfully' : 'Created successfully', 'success', 'F&B');
      setShowModal(false);
      setEditingId(null);
      setFormData({});
      fetchData();
    } catch (err) {
      console.error('Save error:', err);
      addNotification('Failed to save', 'warning', 'F&B');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string, type: SubTab) => {
    if (!confirm('Are you sure you want to delete this item?')) return;
    try {
      const res = await fetch(`/api/fb/${endpointFor(type)}/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to delete');
      addNotification('Deleted successfully', 'success', 'F&B');
      fetchData();
    } catch (err) {
      console.error('Delete error:', err);
      addNotification('Failed to delete', 'warning', 'F&B');
    }
  };

  const handleToggleExpand = (id: string) => {
    setExpandedId(expandedId === id ? null : id);
  };

  return (
    <div className={['accent-fb', layout.sectionStack].join(' ')}>
      <PageHeader
        title="Pricing & Packages"
        subtitle="Price lists, meal plans, F&B packages, promotions, and special offers"
        icon={DollarSign}
        actions={
          <>
            <button onClick={() => { fetchData(); addNotification('Pricing data refreshed', 'info', 'F&B'); }} className={button.secondary}>
              <Clock className="w-4 h-4" /> Refresh
            </button>
            <button onClick={handleAdd} className={button.primary}>
              <Plus className="w-4 h-4" /> New
            </button>
          </>
        }
      />

      {/* KPI Cards */}
      <div className={layout.kpiGrid}>
        <StatCard title="Active Price Lists" value={counts.priceLists} icon={DollarSign} tone="accent" />
        <StatCard title="Meal Plans" value={counts.mealPlans} icon={Utensils} tone="info" />
        <StatCard title="F&B Packages" value={counts.packages} icon={Package} tone="success" />
        <StatCard title="Active Promotions" value={counts.promotions} icon={Tag} tone="warning" />
      </div>

      {/* Sub-tabs */}
      <div className="flex bg-slate-100 dark:bg-slate-900/40 p-1 rounded-2xl border border-gray-200 dark:border-slate-700 overflow-x-auto">
        {SUB_TABS.map(t => (
          <button
            key={t.id}
            onClick={() => { setSubTab(t.id); setSearch(''); }}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl transition-all whitespace-nowrap ${
              subTab === t.id
                ? 'bg-white dark:bg-slate-800 text-[var(--color-accent-operations)] shadow-sm font-medium'
                : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-slate-50 dark:hover:bg-slate-700'
            }`}
          >
            <t.icon className="w-4 h-4" />
            <span className="text-sm font-medium">{t.label}</span>
          </button>
        ))}
      </div>

      {/* Search + Cost Analysis toggle */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 max-w-md min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search..."
            className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-gray-900 dark:text-white"
          />
        </div>
        {(subTab === 'meal-plans' || subTab === 'packages' || subTab === 'special-offers') && (
          <button
            onClick={toggleCostAnalysis}
            className={`flex items-center gap-2 px-3 py-2 text-sm rounded-xl border transition-all whitespace-nowrap ${
              showCostAnalysis
                ? 'bg-[var(--color-accent-operations)] text-white border-[var(--color-accent-operations)]'
                : 'bg-white dark:bg-slate-800 text-gray-700 dark:text-gray-300 border-gray-300 dark:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-700'
            }`}
          >
            <Calculator className="w-4 h-4" />
            {showCostAnalysis ? 'Hide Cost Analysis' : 'Cost Analysis'}
          </button>
        )}
      </div>

      {/* Cost Analysis View */}
      {showCostAnalysis && (subTab === 'meal-plans' || subTab === 'packages' || subTab === 'special-offers') && (
        <SectionCard>
          <div className="mb-4 flex items-center gap-2">
            <TrendingUp className="w-5 h-5 text-[var(--color-accent-operations)]" />
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
              {subTab === 'meal-plans' ? 'Meal Plan' : subTab === 'packages' ? 'Package' : 'Special Offer'} Cost Analysis
            </h3>
            <span className="text-xs text-slate-500 ml-2">
              (Plate costs computed from recipe ingredients)
            </span>
          </div>

          {costLoading ? (
            <div className="py-8 text-center text-slate-500">Computing cost analysis...</div>
          ) : subTab === 'meal-plans' ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 dark:bg-slate-900/40 text-left text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-4 py-3 font-medium">Meal Plan</th>
                    <th className="px-4 py-3 font-medium">Type</th>
                    <th className="px-4 py-3 font-medium text-right">Items</th>
                    <th className="px-4 py-3 font-medium text-right">Total Cost</th>
                    <th className="px-4 py-3 font-medium text-right">Adult Price</th>
                    <th className="px-4 py-3 font-medium text-right">Adult Margin</th>
                    <th className="px-4 py-3 font-medium text-right">Child Price</th>
                    <th className="px-4 py-3 font-medium text-right">Child Margin</th>
                    <th className="px-4 py-3 font-medium text-center">Food Cost %</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 dark:divide-slate-700">
                  {mealPlanCosts.length === 0 ? (
                    <tr><td colSpan={9} className="px-4 py-4 text-center text-slate-500">No cost data available</td></tr>
                  ) : mealPlanCosts.map(mp => {
                    const foodCostPct = mp.adult_price > 0 ? (mp.total_cost / mp.adult_price) * 100 : 0;
                    return (
                      <React.Fragment key={mp.id}>
                        <tr className="hover:bg-slate-50 dark:hover:bg-slate-700/40 cursor-pointer" onClick={() => setExpandedCostId(expandedCostId === mp.id ? null : mp.id)}>
                          <td className="px-4 py-3 font-medium text-gray-900 dark:text-white flex items-center gap-2">
                            <button className="p-1 text-slate-400 hover:text-slate-600">
                              {expandedCostId === mp.id ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                            </button>
                            {mp.name}
                          </td>
                          <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{mp.type}</td>
                          <td className="px-4 py-3 text-right text-slate-600 dark:text-slate-400">{mp.menu_item_count}</td>
                          <td className="px-4 py-3 text-right font-medium text-slate-900 dark:text-white">{formatAmount(mp.total_cost)}</td>
                          <td className="px-4 py-3 text-right text-slate-600 dark:text-slate-400">{formatAmount(mp.adult_price)}</td>
                          <td className={`px-4 py-3 text-right font-medium ${marginColor(mp.adult_margin_pct)}`}>
                            {formatAmount(mp.adult_margin)} ({mp.adult_margin_pct.toFixed(1)}%)
                          </td>
                          <td className="px-4 py-3 text-right text-slate-600 dark:text-slate-400">{formatAmount(mp.child_price)}</td>
                          <td className={`px-4 py-3 text-right font-medium ${marginColor(mp.child_margin_pct)}`}>
                            {formatAmount(mp.child_margin)} ({mp.child_margin_pct.toFixed(1)}%)
                          </td>
                          <td className="px-4 py-3 text-center"><Badge tone={marginTone(100 - foodCostPct)}>{foodCostPct.toFixed(1)}%</Badge></td>
                        </tr>
                        {expandedCostId === mp.id && (
                          <tr>
                            <td colSpan={9} className="px-6 py-4 bg-slate-50 dark:bg-slate-900/20">
                              <div className="text-xs font-medium text-slate-600 dark:text-slate-400 mb-2">Itemized Plate Cost Breakdown:</div>
                              <table className="w-full text-xs">
                                <thead>
                                  <tr className="border-b border-slate-200 dark:border-slate-600">
                                    <th className="text-left py-1.5 px-2 text-slate-500">Menu Item</th>
                                    <th className="text-left py-1.5 px-2 text-slate-500">Meal Period</th>
                                    <th className="text-right py-1.5 px-2 text-slate-500">Plate Cost</th>
                                    <th className="text-right py-1.5 px-2 text-slate-500">Sell Price</th>
                                    <th className="text-center py-1.5 px-2 text-slate-500">Recipe</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {mp.items.map((it, idx) => (
                                    <tr key={idx} className="border-b border-slate-100 dark:border-slate-700/50">
                                      <td className="py-1.5 px-2 text-slate-900 dark:text-white">{it.menu_item_name}</td>
                                      <td className="py-1.5 px-2 text-slate-600 dark:text-slate-400 capitalize">{it.meal_period || '—'}</td>
                                      <td className="py-1.5 px-2 text-right text-slate-600 dark:text-slate-400">{it.has_recipe ? formatAmount(it.plate_cost) : '—'}</td>
                                      <td className="py-1.5 px-2 text-right text-slate-600 dark:text-slate-400">{formatAmount(it.selling_price)}</td>
                                      <td className="py-1.5 px-2 text-center">
                                        {it.has_recipe ? <CheckCircle2 className="w-3 h-3 text-green-600 dark:text-green-400 inline" /> : <AlertTriangle className="w-3 h-3 text-amber-500 inline" />}
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                                <tfoot>
                                  <tr className="border-t-2 border-slate-300 dark:border-slate-600 font-medium">
                                    <td className="py-2 px-2 text-slate-900 dark:text-white" colSpan={2}>Total Plate Cost</td>
                                    <td className="py-2 px-2 text-right text-slate-900 dark:text-white">{formatAmount(mp.total_cost)}</td>
                                    <td colSpan={2}></td>
                                  </tr>
                                </tfoot>
                              </table>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : subTab === 'packages' ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 dark:bg-slate-900/40 text-left text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-4 py-3 font-medium">Package</th>
                    <th className="px-4 py-3 font-medium">Type</th>
                    <th className="px-4 py-3 font-medium text-right">Items</th>
                    <th className="px-4 py-3 font-medium text-right">Total Cost</th>
                    <th className="px-4 py-3 font-medium text-right">Price / Person</th>
                    <th className="px-4 py-3 font-medium text-right">Margin</th>
                    <th className="px-4 py-3 font-medium text-center">Food Cost %</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 dark:divide-slate-700">
                  {packageCosts.length === 0 ? (
                    <tr><td colSpan={7} className="px-4 py-4 text-center text-slate-500">No cost data available</td></tr>
                  ) : packageCosts.map(p => {
                    const foodCostPct = p.price_per_person > 0 ? (p.total_cost / p.price_per_person) * 100 : 0;
                    return (
                      <React.Fragment key={p.id}>
                        <tr className="hover:bg-slate-50 dark:hover:bg-slate-700/40 cursor-pointer" onClick={() => setExpandedCostId(expandedCostId === p.id ? null : p.id)}>
                          <td className="px-4 py-3 font-medium text-gray-900 dark:text-white flex items-center gap-2">
                            <button className="p-1 text-slate-400 hover:text-slate-600">
                              {expandedCostId === p.id ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                            </button>
                            {p.name}
                          </td>
                          <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{p.package_type}</td>
                          <td className="px-4 py-3 text-right text-slate-600 dark:text-slate-400">{p.menu_item_count}</td>
                          <td className="px-4 py-3 text-right font-medium text-slate-900 dark:text-white">{formatAmount(p.total_cost)}</td>
                          <td className="px-4 py-3 text-right text-slate-600 dark:text-slate-400">{formatAmount(p.price_per_person)}</td>
                          <td className={`px-4 py-3 text-right font-medium ${marginColor(p.margin_pct)}`}>
                            {formatAmount(p.margin)} ({p.margin_pct.toFixed(1)}%)
                          </td>
                          <td className="px-4 py-3 text-center"><Badge tone={marginTone(100 - foodCostPct)}>{foodCostPct.toFixed(1)}%</Badge></td>
                        </tr>
                        {expandedCostId === p.id && (
                          <tr>
                            <td colSpan={7} className="px-6 py-4 bg-slate-50 dark:bg-slate-900/20">
                              <div className="text-xs font-medium text-slate-600 dark:text-slate-400 mb-2">Itemized Plate Cost Breakdown:</div>
                              <table className="w-full text-xs">
                                <thead>
                                  <tr className="border-b border-slate-200 dark:border-slate-600">
                                    <th className="text-left py-1.5 px-2 text-slate-500">Menu Item</th>
                                    <th className="text-left py-1.5 px-2 text-slate-500">Component</th>
                                    <th className="text-right py-1.5 px-2 text-slate-500">Plate Cost</th>
                                    <th className="text-right py-1.5 px-2 text-slate-500">Sell Price</th>
                                    <th className="text-center py-1.5 px-2 text-slate-500">Recipe</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {p.items.map((it, idx) => (
                                    <tr key={idx} className="border-b border-slate-100 dark:border-slate-700/50">
                                      <td className="py-1.5 px-2 text-slate-900 dark:text-white">{it.menu_item_name}</td>
                                      <td className="py-1.5 px-2 text-slate-600 dark:text-slate-400 capitalize">{it.component_type || '—'}</td>
                                      <td className="py-1.5 px-2 text-right text-slate-600 dark:text-slate-400">{it.has_recipe ? formatAmount(it.plate_cost) : '—'}</td>
                                      <td className="py-1.5 px-2 text-right text-slate-600 dark:text-slate-400">{formatAmount(it.selling_price)}</td>
                                      <td className="py-1.5 px-2 text-center">
                                        {it.has_recipe ? <CheckCircle2 className="w-3 h-3 text-green-600 dark:text-green-400 inline" /> : <AlertTriangle className="w-3 h-3 text-amber-500 inline" />}
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                                <tfoot>
                                  <tr className="border-t-2 border-slate-300 dark:border-slate-600 font-medium">
                                    <td className="py-2 px-2 text-slate-900 dark:text-white" colSpan={2}>Total Plate Cost</td>
                                    <td className="py-2 px-2 text-right text-slate-900 dark:text-white">{formatAmount(p.total_cost)}</td>
                                    <td colSpan={2}></td>
                                  </tr>
                                </tfoot>
                              </table>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 dark:bg-slate-900/40 text-left text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-4 py-3 font-medium">Offer</th>
                    <th className="px-4 py-3 font-medium">Outlet</th>
                    <th className="px-4 py-3 font-medium text-right">Items</th>
                    <th className="px-4 py-3 font-medium text-right">Total Cost</th>
                    <th className="px-4 py-3 font-medium text-right">Price</th>
                    <th className="px-4 py-3 font-medium text-right">Margin</th>
                    <th className="px-4 py-3 font-medium text-center">Food Cost %</th>
                    <th className="px-4 py-3 font-medium">Valid Until</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 dark:divide-slate-700">
                  {specialOfferCosts.length === 0 ? (
                    <tr><td colSpan={9} className="px-4 py-4 text-center text-slate-500">No cost data available</td></tr>
                  ) : specialOfferCosts.map(o => {
                    const foodCostPct = o.price > 0 ? (o.total_cost / o.price) * 100 : 0;
                    return (
                      <React.Fragment key={o.id}>
                        <tr className="hover:bg-slate-50 dark:hover:bg-slate-700/40 cursor-pointer" onClick={() => setExpandedCostId(expandedCostId === o.id ? null : o.id)}>
                          <td className="px-4 py-3 font-medium text-gray-900 dark:text-white flex items-center gap-2">
                            <button className="p-1 text-slate-400 hover:text-slate-600">
                              {expandedCostId === o.id ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                            </button>
                            {o.name}
                          </td>
                          <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{o.outlet_name || '—'}</td>
                          <td className="px-4 py-3 text-right text-slate-600 dark:text-slate-400">{o.menu_item_count}</td>
                          <td className="px-4 py-3 text-right font-medium text-slate-900 dark:text-white">{formatAmount(o.total_cost)}</td>
                          <td className="px-4 py-3 text-right text-slate-600 dark:text-slate-400">{formatAmount(o.price)}</td>
                          <td className={`px-4 py-3 text-right font-medium ${marginColor(o.margin_pct)}`}>
                            {formatAmount(o.margin)} ({o.margin_pct.toFixed(1)}%)
                          </td>
                          <td className="px-4 py-3 text-center"><Badge tone={marginTone(100 - foodCostPct)}>{foodCostPct.toFixed(1)}%</Badge></td>
                          <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{o.valid_until}</td>
                          <td className="px-4 py-3"><Badge tone={STATUS_TONE[o.status]}>{o.status}</Badge></td>
                        </tr>
                        {expandedCostId === o.id && (
                          <tr>
                            <td colSpan={9} className="px-6 py-4 bg-slate-50 dark:bg-slate-900/20">
                              <div className="text-xs font-medium text-slate-600 dark:text-slate-400 mb-2">Itemized Plate Cost Breakdown:</div>
                              <table className="w-full text-xs">
                                <thead>
                                  <tr className="border-b border-slate-200 dark:border-slate-600">
                                    <th className="text-left py-1.5 px-2 text-slate-500">Menu Item</th>
                                    <th className="text-left py-1.5 px-2 text-slate-500">Course</th>
                                    <th className="text-right py-1.5 px-2 text-slate-500">Plate Cost</th>
                                    <th className="text-right py-1.5 px-2 text-slate-500">Sell Price</th>
                                    <th className="text-center py-1.5 px-2 text-slate-500">Recipe</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {o.items.map((it, idx) => (
                                    <tr key={idx} className="border-b border-slate-100 dark:border-slate-700/50">
                                      <td className="py-1.5 px-2 text-slate-900 dark:text-white">{it.menu_item_name}</td>
                                      <td className="py-1.5 px-2 text-slate-600 dark:text-slate-400 capitalize">{it.course_type || '—'}</td>
                                      <td className="py-1.5 px-2 text-right text-slate-600 dark:text-slate-400">{it.has_recipe ? formatAmount(it.plate_cost) : '—'}</td>
                                      <td className="py-1.5 px-2 text-right text-slate-600 dark:text-slate-400">{formatAmount(it.selling_price)}</td>
                                      <td className="py-1.5 px-2 text-center">
                                        {it.has_recipe ? <CheckCircle2 className="w-3 h-3 text-green-600 dark:text-green-400 inline" /> : <AlertTriangle className="w-3 h-3 text-amber-500 inline" />}
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                                <tfoot>
                                  <tr className="border-t-2 border-slate-300 dark:border-slate-600 font-medium">
                                    <td className="py-2 px-2 text-slate-900 dark:text-white" colSpan={2}>Total Plate Cost</td>
                                    <td className="py-2 px-2 text-right text-slate-900 dark:text-white">{formatAmount(o.total_cost)}</td>
                                    <td colSpan={2}></td>
                                  </tr>
                                </tfoot>
                              </table>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </SectionCard>
      )}

      {/* Content */}
      <SectionCard>
        <div className="overflow-x-auto">
          {subTab === 'price-lists' && (
            <table className="w-full text-sm">
              <thead className="bg-slate-50 dark:bg-slate-900/40 text-left text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-6 py-3 font-medium">Price List</th>
                  <th className="px-6 py-3 font-medium">Outlet</th>
                  <th className="px-6 py-3 font-medium">Currency</th>
                  <th className="px-6 py-3 font-medium">Effective</th>
                  <th className="px-6 py-3 font-medium">Items</th>
                  <th className="px-6 py-3 font-medium">Status</th>
                  <th className="px-6 py-3 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-slate-700">
                {loading ? (
                  <tr><td colSpan={7} className="px-6 py-4 text-center text-slate-500">Loading...</td></tr>
                ) : filteredPriceLists.length === 0 ? (
                  <tr><td colSpan={7} className="px-6 py-4 text-center text-slate-500">No price lists found</td></tr>
                ) : filteredPriceLists.map(p => (
                  <tr key={p.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/40">
                    <td className="px-6 py-3 font-medium text-gray-900 dark:text-white flex items-center gap-2">
                      <button onClick={() => handleToggleExpand(p.id)} className="p-1 text-slate-400 hover:text-slate-600">
                        {expandedId === p.id ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                      </button>
                      {p.name}
                    </td>
                    <td className="px-6 py-3 text-slate-600 dark:text-slate-400">{p.outlet_name || '—'}</td>
                    <td className="px-6 py-3 text-slate-600 dark:text-slate-400">{p.currency}</td>
                    <td className="px-6 py-3 text-slate-600 dark:text-slate-400">{p.effective_from}</td>
                    <td className="px-6 py-3 text-slate-600 dark:text-slate-400">{p.item_count || 0}</td>
                    <td className="px-6 py-3"><Badge tone={STATUS_TONE[p.status]}>{p.status}</Badge></td>
                    <td className="px-6 py-3 text-right">
                      <div className="inline-flex gap-2">
                        <button onClick={() => handleEdit(p, 'price-lists')} className="p-1 text-slate-400 hover:text-[var(--color-accent-operations)]"><Pencil className="w-4 h-4" /></button>
                        <button onClick={() => handleDelete(p.id, 'price-lists')} className="p-1 text-slate-400 hover:text-[var(--color-danger)]"><Trash2 className="w-4 h-4" /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
              {expandedId && filteredPriceLists.find(p => p.id === expandedId) && (
                <tbody>
                  <tr>
                    <td colSpan={7} className="px-6 py-4 bg-slate-50 dark:bg-slate-900/20">
                      <div className="text-xs font-medium text-slate-600 dark:text-slate-400 mb-2">Price List Items:</div>
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="border-b border-slate-200 dark:border-slate-600">
                            <th className="text-left py-1.5 px-2 text-slate-500">Menu Item</th>
                            <th className="text-right py-1.5 px-2 text-slate-500">Price</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(filteredPriceLists.find(p => p.id === expandedId)?.price_list_items || []).map((item) => (
                            <tr key={item.id} className="border-b border-slate-100 dark:border-slate-700/50">
                              <td className="py-1.5 px-2 text-slate-900 dark:text-white">{item.menu_item_name || '—'}</td>
                              <td className="py-1.5 px-2 text-right text-slate-600 dark:text-slate-400">{formatAmount(item.price)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </td>
                  </tr>
                </tbody>
              )}
            </table>
          )}

          {subTab === 'meal-plans' && !showCostAnalysis && (
            <table className="w-full text-sm">
              <thead className="bg-slate-50 dark:bg-slate-900/40 text-left text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-6 py-3 font-medium">Meal Plan</th>
                  <th className="px-6 py-3 font-medium">Type</th>
                  <th className="px-6 py-3 font-medium">Adult</th>
                  <th className="px-6 py-3 font-medium">Child</th>
                  <th className="px-6 py-3 font-medium">Includes</th>
                  <th className="px-6 py-3 font-medium">Menu Items</th>
                  <th className="px-6 py-3 font-medium">Status</th>
                  <th className="px-6 py-3 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-slate-700">
                {loading ? (
                  <tr><td colSpan={8} className="px-6 py-4 text-center text-slate-500">Loading...</td></tr>
                ) : filteredMealPlans.length === 0 ? (
                  <tr><td colSpan={8} className="px-6 py-4 text-center text-slate-500">No meal plans found</td></tr>
                ) : filteredMealPlans.map(m => (
                  <React.Fragment key={m.id}>
                    <tr className="hover:bg-slate-50 dark:hover:bg-slate-700/40">
                      <td className="px-6 py-3 font-medium text-gray-900 dark:text-white flex items-center gap-2">
                        <button onClick={() => handleToggleExpand(m.id)} className="p-1 text-slate-400 hover:text-slate-600">
                          {expandedId === m.id ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                        </button>
                        {m.name}
                      </td>
                      <td className="px-6 py-3 text-slate-600 dark:text-slate-400">{m.type}</td>
                      <td className="px-6 py-3 text-slate-600 dark:text-slate-400">{formatAmount(m.adult_price)}</td>
                      <td className="px-6 py-3 text-slate-600 dark:text-slate-400">{formatAmount(m.child_price)}</td>
                      <td className="px-6 py-3 text-slate-600 dark:text-slate-400">{m.includes.join(', ') || '—'}</td>
                      <td className="px-6 py-3 text-slate-600 dark:text-slate-400">{m.menu_items?.length || 0}</td>
                      <td className="px-6 py-3"><Badge tone={STATUS_TONE[m.status]}>{m.status}</Badge></td>
                      <td className="px-6 py-3 text-right">
                        <div className="inline-flex gap-2">
                          <button onClick={() => handleEdit(m, 'meal-plans')} className="p-1 text-slate-400 hover:text-[var(--color-accent-operations)]"><Pencil className="w-4 h-4" /></button>
                          <button onClick={() => handleDelete(m.id, 'meal-plans')} className="p-1 text-slate-400 hover:text-[var(--color-danger)]"><Trash2 className="w-4 h-4" /></button>
                        </div>
                      </td>
                    </tr>
                    {expandedId === m.id && (
                      <tr>
                        <td colSpan={8} className="px-6 py-4 bg-slate-50 dark:bg-slate-900/20">
                          <div className="text-xs font-medium text-slate-600 dark:text-slate-400 mb-3">Menu Items by Meal Period:</div>
                          {(m.menu_items || []).length === 0 ? (
                            <p className="text-xs text-slate-500">No menu items linked to this meal plan.</p>
                          ) : (
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                              {['breakfast', 'lunch', 'dinner', 'snack', 'beverage'].map(period => {
                                const periodItems = (m.menu_items || []).filter(mi => mi.meal_period === period);
                                if (periodItems.length === 0) return null;
                                return (
                                  <div key={period} className="bg-white dark:bg-slate-800 rounded-lg p-3 border border-gray-200 dark:border-slate-700">
                                    <div className="text-xs font-semibold text-[var(--color-accent-operations)] capitalize mb-2 flex items-center gap-1">
                                      <Utensils className="w-3 h-3" /> {period}
                                    </div>
                                    <ul className="text-xs text-slate-700 dark:text-slate-300 space-y-1">
                                      {periodItems.sort((a, b) => a.sort_order - b.sort_order).map(mi => (
                                        <li key={mi.id} className="flex items-center gap-2">
                                          <CheckCircle2 className="w-3 h-3 text-green-600 dark:text-green-400" />
                                          {mi.menu_item_name}
                                        </li>
                                      ))}
                                    </ul>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          )}

          {subTab === 'packages' && !showCostAnalysis && (
            <table className="w-full text-sm">
              <thead className="bg-slate-50 dark:bg-slate-900/40 text-left text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-6 py-3 font-medium">Package</th>
                  <th className="px-6 py-3 font-medium">Type</th>
                  <th className="px-6 py-3 font-medium">Price / Person</th>
                  <th className="px-6 py-3 font-medium">Min Covers</th>
                  <th className="px-6 py-3 font-medium">Outlets</th>
                  <th className="px-6 py-3 font-medium">Menu Items</th>
                  <th className="px-6 py-3 font-medium">Status</th>
                  <th className="px-6 py-3 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-slate-700">
                {loading ? (
                  <tr><td colSpan={8} className="px-6 py-4 text-center text-slate-500">Loading...</td></tr>
                ) : filteredPackages.length === 0 ? (
                  <tr><td colSpan={8} className="px-6 py-4 text-center text-slate-500">No packages found</td></tr>
                ) : filteredPackages.map(p => (
                  <React.Fragment key={p.id}>
                    <tr className="hover:bg-slate-50 dark:hover:bg-slate-700/40">
                      <td className="px-6 py-3 font-medium text-gray-900 dark:text-white flex items-center gap-2">
                        <button onClick={() => handleToggleExpand(p.id)} className="p-1 text-slate-400 hover:text-slate-600">
                          {expandedId === p.id ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                        </button>
                        {p.name}
                      </td>
                      <td className="px-6 py-3"><Badge tone="info">{p.package_type}</Badge></td>
                      <td className="px-6 py-3 text-slate-600 dark:text-slate-400">{formatAmount(p.price_per_person)}</td>
                      <td className="px-6 py-3 text-slate-600 dark:text-slate-400">{p.min_covers}</td>
                      <td className="px-6 py-3 text-slate-600 dark:text-slate-400">{p.outlets?.map(o => o.outlet_name).join(', ') || '—'}</td>
                      <td className="px-6 py-3 text-slate-600 dark:text-slate-400">{p.menu_items?.length || 0}</td>
                      <td className="px-6 py-3"><Badge tone={STATUS_TONE[p.status]}>{p.status}</Badge></td>
                      <td className="px-6 py-3 text-right">
                        <div className="inline-flex gap-2">
                          <button onClick={() => handleEdit(p, 'packages')} className="p-1 text-slate-400 hover:text-[var(--color-accent-operations)]"><Pencil className="w-4 h-4" /></button>
                          <button onClick={() => handleDelete(p.id, 'packages')} className="p-1 text-slate-400 hover:text-[var(--color-danger)]"><Trash2 className="w-4 h-4" /></button>
                        </div>
                      </td>
                    </tr>
                    {expandedId === p.id && (
                      <tr>
                        <td colSpan={8} className="px-6 py-4 bg-slate-50 dark:bg-slate-900/20">
                          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                            <div>
                              <div className="text-xs font-medium text-slate-600 dark:text-slate-400 mb-2">Components:</div>
                              {(p.components || []).length === 0 ? (
                                <p className="text-xs text-slate-500">No components.</p>
                              ) : (
                                <ul className="text-xs text-slate-600 dark:text-slate-400 space-y-1">
                                  {p.components.map((c) => (
                                    <li key={c.id} className="flex items-center gap-2">
                                      <CheckCircle2 className="w-3 h-3 text-green-600 dark:text-green-400" />
                                      {c.component_name} <span className="text-slate-400">({c.component_type})</span>
                                    </li>
                                  ))}
                                </ul>
                              )}
                            </div>
                            <div className="lg:col-span-2">
                              <div className="text-xs font-medium text-slate-600 dark:text-slate-400 mb-2">Menu Items by Component Type:</div>
                              {(p.menu_items || []).length === 0 ? (
                                <p className="text-xs text-slate-500">No menu items linked to this package.</p>
                              ) : (
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                  {['meal', 'beverage', 'snack', 'dessert', 'service', 'item'].map(ct => {
                                    const ctItems = (p.menu_items || []).filter(mi => mi.component_type === ct);
                                    if (ctItems.length === 0) return null;
                                    return (
                                      <div key={ct} className="bg-white dark:bg-slate-800 rounded-lg p-3 border border-gray-200 dark:border-slate-700">
                                        <div className="text-xs font-semibold text-[var(--color-accent-operations)] capitalize mb-2 flex items-center gap-1">
                                          <Utensils className="w-3 h-3" /> {ct}
                                        </div>
                                        <ul className="text-xs text-slate-700 dark:text-slate-300 space-y-1">
                                          {ctItems.sort((a, b) => a.sort_order - b.sort_order).map(mi => (
                                            <li key={mi.id} className="flex items-center gap-2">
                                              <CheckCircle2 className="w-3 h-3 text-green-600 dark:text-green-400" />
                                              {mi.menu_item_name}
                                            </li>
                                          ))}
                                        </ul>
                                      </div>
                                    );
                                  })}
                                </div>
                              )}
                              <div className="mt-3">
                                <div className="text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">Description:</div>
                                <p className="text-xs text-slate-600 dark:text-slate-400">{p.description || '—'}</p>
                              </div>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          )}

          {subTab === 'promotions' && (
            <table className="w-full text-sm">
              <thead className="bg-slate-50 dark:bg-slate-900/40 text-left text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-6 py-3 font-medium">Promotion</th>
                  <th className="px-6 py-3 font-medium">Type</th>
                  <th className="px-6 py-3 font-medium">Discount</th>
                  <th className="px-6 py-3 font-medium">Schedule</th>
                  <th className="px-6 py-3 font-medium">Channels</th>
                  <th className="px-6 py-3 font-medium">Status</th>
                  <th className="px-6 py-3 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-slate-700">
                {loading ? (
                  <tr><td colSpan={7} className="px-6 py-4 text-center text-slate-500">Loading...</td></tr>
                ) : filteredPromotions.length === 0 ? (
                  <tr><td colSpan={7} className="px-6 py-4 text-center text-slate-500">No promotions found</td></tr>
                ) : filteredPromotions.map(p => (
                  <tr key={p.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/40">
                    <td className="px-6 py-3 font-medium text-gray-900 dark:text-white">{p.name}</td>
                    <td className="px-6 py-3"><Badge tone="info">{p.type}</Badge></td>
                    <td className="px-6 py-3 text-slate-600 dark:text-slate-400">{p.discount_description}</td>
                    <td className="px-6 py-3 text-slate-600 dark:text-slate-400">{p.schedule || '—'}</td>
                    <td className="px-6 py-3 text-slate-600 dark:text-slate-400">{p.channels.join(', ') || '—'}</td>
                    <td className="px-6 py-3"><Badge tone={STATUS_TONE[p.status]}>{p.status}</Badge></td>
                    <td className="px-6 py-3 text-right">
                      <div className="inline-flex gap-2">
                        <button onClick={() => handleEdit(p, 'promotions')} className="p-1 text-slate-400 hover:text-[var(--color-accent-operations)]"><Pencil className="w-4 h-4" /></button>
                        <button onClick={() => handleDelete(p.id, 'promotions')} className="p-1 text-slate-400 hover:text-[var(--color-danger)]"><Trash2 className="w-4 h-4" /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {subTab === 'special-offers' && !showCostAnalysis && (
            <table className="w-full text-sm">
              <thead className="bg-slate-50 dark:bg-slate-900/40 text-left text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-6 py-3 font-medium">Offer</th>
                  <th className="px-6 py-3 font-medium">Outlet</th>
                  <th className="px-6 py-3 font-medium text-right">Price</th>
                  <th className="px-6 py-3 font-medium text-right">Menu Items</th>
                  <th className="px-6 py-3 font-medium">Valid Until</th>
                  <th className="px-6 py-3 font-medium">Status</th>
                  <th className="px-6 py-3 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-slate-700">
                {loading ? (
                  <tr><td colSpan={7} className="px-6 py-4 text-center text-slate-500">Loading...</td></tr>
                ) : filteredOffers.length === 0 ? (
                  <tr><td colSpan={7} className="px-6 py-4 text-center text-slate-500">No special offers found</td></tr>
                ) : filteredOffers.map(o => (
                  <React.Fragment key={o.id}>
                    <tr className="hover:bg-slate-50 dark:hover:bg-slate-700/40">
                      <td className="px-6 py-3 font-medium text-gray-900 dark:text-white flex items-center gap-2">
                        <button onClick={() => handleToggleExpand(o.id)} className="p-1 text-slate-400 hover:text-slate-600">
                          {expandedId === o.id ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                        </button>
                        {o.name}
                      </td>
                      <td className="px-6 py-3 text-slate-600 dark:text-slate-400">{o.outlet_name || '—'}</td>
                      <td className="px-6 py-3 text-right text-slate-600 dark:text-slate-400">{formatAmount(o.price || 0)}</td>
                      <td className="px-6 py-3 text-right text-slate-600 dark:text-slate-400">{o.menu_items?.length || 0}</td>
                      <td className="px-6 py-3 text-slate-600 dark:text-slate-400">{o.valid_until}</td>
                      <td className="px-6 py-3"><Badge tone={STATUS_TONE[o.status]}>{o.status}</Badge></td>
                      <td className="px-6 py-3 text-right">
                        <div className="inline-flex gap-2">
                          <button onClick={() => handleEdit(o, 'special-offers')} className="p-1 text-slate-400 hover:text-[var(--color-accent-operations)]"><Pencil className="w-4 h-4" /></button>
                          <button onClick={() => handleDelete(o.id, 'special-offers')} className="p-1 text-slate-400 hover:text-[var(--color-danger)]"><Trash2 className="w-4 h-4" /></button>
                        </div>
                      </td>
                    </tr>
                    {expandedId === o.id && (
                      <tr>
                        <td colSpan={7} className="px-6 py-4 bg-slate-50 dark:bg-slate-900/20">
                          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                            <div className="lg:col-span-2">
                              <div className="text-xs font-medium text-slate-600 dark:text-slate-400 mb-2">Menu Items by Course:</div>
                              {(o.menu_items || []).length === 0 ? (
                                <p className="text-xs text-slate-500">No menu items linked to this offer.</p>
                              ) : (
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                  {['appetizer', 'main', 'dessert', 'beverage', 'snack'].map(ct => {
                                    const ctItems = (o.menu_items || []).filter(mi => mi.course_type === ct);
                                    if (ctItems.length === 0) return null;
                                    return (
                                      <div key={ct} className="bg-white dark:bg-slate-800 rounded-lg p-3 border border-gray-200 dark:border-slate-700">
                                        <div className="text-xs font-semibold text-[var(--color-accent-operations)] capitalize mb-2 flex items-center gap-1">
                                          <Utensils className="w-3 h-3" /> {ct}
                                        </div>
                                        <ul className="text-xs text-slate-700 dark:text-slate-300 space-y-1">
                                          {ctItems.sort((a, b) => a.sort_order - b.sort_order).map(mi => (
                                            <li key={mi.id} className="flex items-center gap-2">
                                              <CheckCircle2 className="w-3 h-3 text-green-600 dark:text-green-400" />
                                              {mi.menu_item_name}
                                            </li>
                                          ))}
                                        </ul>
                                      </div>
                                    );
                                  })}
                                </div>
                              )}
                            </div>
                            <div>
                              <div className="text-xs font-medium text-slate-600 dark:text-slate-400 mb-2">Description:</div>
                              <p className="text-xs text-slate-600 dark:text-slate-400 mb-3">{o.description || '—'}</p>
                              <div className="text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">Price:</div>
                              <p className="text-sm font-semibold text-gray-900 dark:text-white">{formatAmount(o.price || 0)}</p>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </SectionCard>

      {/* Distribution channels info panel */}
      <div className="bg-[var(--color-accent-operations)]/5 dark:bg-[var(--color-accent-operations)]/10 rounded-xl p-6 border border-[var(--color-accent-operations)]/20">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
          <Users className="w-5 h-5 text-[var(--color-accent-operations)]" />
          Promotion Distribution Channels
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
          {['POS', 'Guest Portal', 'Public Booking', 'CRM', 'Mobile App'].map(c => (
            <div key={c} className="bg-white dark:bg-slate-800 rounded-lg p-3 border border-gray-200 dark:border-slate-700 flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-[var(--color-success)]" />
              <span className="text-sm font-medium text-gray-900 dark:text-white">{c}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Create / Edit Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 overflow-y-auto">
          <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto my-8 border border-gray-200 dark:border-slate-700 card-shadow">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold text-gray-900 dark:text-white">
                {editingId ? 'Edit' : 'New'} {subTab.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}
              </h2>
              <button onClick={() => setShowModal(false)} className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"><X className="w-5 h-5" /></button>
            </div>

            <div className="space-y-4">
              {/* ── Price List Form ── */}
              {subTab === 'price-lists' && (
                <>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Name *</label>
                    <input value={formData.name || ''} onChange={e => setFormData({ ...formData, name: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white" placeholder="e.g. Summer Menu Pricing" />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Outlet</label>
                      <select value={formData.outletId || ''} onChange={e => {
                        const ol = outlets.find(o => o.id === e.target.value);
                        setFormData({ ...formData, outletId: e.target.value, outletName: ol?.name || '' });
                      }} className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white text-sm">
                        <option value="">— None —</option>
                        {outlets.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Currency</label>
                      <input value={formData.currency || 'USD'} onChange={e => setFormData({ ...formData, currency: e.target.value })}
                        className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white" />
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Effective From</label>
                      <input type="date" value={formData.effectiveFrom || ''} onChange={e => setFormData({ ...formData, effectiveFrom: e.target.value })}
                        className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white" />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Effective To</label>
                      <input type="date" value={formData.effectiveTo || ''} onChange={e => setFormData({ ...formData, effectiveTo: e.target.value })}
                        className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white" />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Status</label>
                      <select value={formData.status || 'Draft'} onChange={e => setFormData({ ...formData, status: e.target.value })}
                        className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white text-sm">
                        <option value="Active">Active</option>
                        <option value="Draft">Draft</option>
                        <option value="Expired">Expired</option>
                      </select>
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Description</label>
                    <input value={formData.description || ''} onChange={e => setFormData({ ...formData, description: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white" placeholder="Optional description" />
                  </div>
                  {/* Price list items */}
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Price List Items</label>
                      <button onClick={() => setFormData({ ...formData, items: [...(formData.items || []), { menuItemId: '', menuItemName: '', price: 0 }] })}
                        className="text-xs text-[var(--color-accent-operations)] hover:opacity-80 flex items-center gap-1">
                        <Plus className="w-3 h-3" /> Add Item
                      </button>
                    </div>
                    <div className="space-y-2">
                      {(formData.items || []).map((item: any, idx: number) => (
                        <div key={idx} className="flex items-center gap-2">
                          <select value={item.menuItemId || ''} onChange={e => {
                            const mi = menuItems.find(m => m.id === e.target.value);
                            const next = [...formData.items]; next[idx] = { ...item, menuItemId: e.target.value, menuItemName: mi?.name || '', price: mi?.selling_price || item.price };
                            setFormData({ ...formData, items: next });
                          }} className="flex-1 px-2 py-1.5 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white text-sm">
                            <option value="">Select menu item...</option>
                            {menuItems.map(mi => <option key={mi.id} value={mi.id}>{mi.name}</option>)}
                          </select>
                          <input type="number" step="0.01" value={item.price} onChange={e => {
                            const next = [...formData.items]; next[idx] = { ...item, price: parseFloat(e.target.value) || 0 };
                            setFormData({ ...formData, items: next });
                          }} className="w-24 px-2 py-1.5 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white text-sm" placeholder="Price" />
                          <button onClick={() => setFormData({ ...formData, items: formData.items.filter((_: any, i: number) => i !== idx) })}
                            className="p-1 text-slate-400 hover:text-[var(--color-danger)]"><Trash2 className="w-4 h-4" /></button>
                        </div>
                      ))}
                    </div>
                  </div>
                </>
              )}

              {/* ── Meal Plan Form ── */}
              {subTab === 'meal-plans' && (
                <>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Name *</label>
                    <input value={formData.name || ''} onChange={e => setFormData({ ...formData, name: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white" placeholder="e.g. Half Board Standard" />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Type</label>
                      <select value={formData.type || 'Bed & Breakfast'} onChange={e => setFormData({ ...formData, type: e.target.value })}
                        className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white text-sm">
                        <option value="Room Only">Room Only</option>
                        <option value="Bed & Breakfast">Bed & Breakfast</option>
                        <option value="Half Board">Half Board</option>
                        <option value="Full Board">Full Board</option>
                        <option value="All Inclusive">All Inclusive</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Status</label>
                      <select value={formData.status || 'Active'} onChange={e => setFormData({ ...formData, status: e.target.value })}
                        className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white text-sm">
                        <option value="Active">Active</option>
                        <option value="Inactive">Inactive</option>
                      </select>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Adult Price</label>
                      <input type="number" step="0.01" value={formData.adultPrice ?? 0} onChange={e => setFormData({ ...formData, adultPrice: parseFloat(e.target.value) || 0 })}
                        className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white" />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Child Price</label>
                      <input type="number" step="0.01" value={formData.childPrice ?? 0} onChange={e => setFormData({ ...formData, childPrice: parseFloat(e.target.value) || 0 })}
                        className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white" />
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Includes (comma-separated)</label>
                    <input value={(formData.includes || []).join(', ')} onChange={e => setFormData({ ...formData, includes: e.target.value.split(',').map((s: string) => s.trim()).filter(Boolean) })}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white" placeholder="e.g. Breakfast, Dinner" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Description</label>
                    <input value={formData.description || ''} onChange={e => setFormData({ ...formData, description: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white" placeholder="Optional description" />
                  </div>
                  {/* Menu items by meal period */}
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Menu Items by Meal Period</label>
                      <button onClick={() => setFormData({ ...formData, menuItems: [...(formData.menuItems || []), { menuItemId: '', menuItemName: '', mealPeriod: 'breakfast', sortOrder: (formData.menuItems || []).length }] })}
                        className="text-xs text-[var(--color-accent-operations)] hover:opacity-80 flex items-center gap-1">
                        <Plus className="w-3 h-3" /> Add Menu Item
                      </button>
                    </div>
                    <div className="space-y-2">
                      {(formData.menuItems || []).map((mi: any, idx: number) => (
                        <div key={idx} className="flex items-center gap-2">
                          <select value={mi.mealPeriod || 'breakfast'} onChange={e => { const next = [...formData.menuItems]; next[idx] = { ...mi, mealPeriod: e.target.value }; setFormData({ ...formData, menuItems: next }); }}
                            className="w-28 px-2 py-1.5 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white text-xs">
                            <option value="breakfast">Breakfast</option>
                            <option value="lunch">Lunch</option>
                            <option value="dinner">Dinner</option>
                            <option value="snack">Snack</option>
                            <option value="beverage">Beverage</option>
                          </select>
                          <select value={mi.menuItemId || ''} onChange={e => {
                            const item = menuItems.find(m => m.id === e.target.value);
                            const next = [...formData.menuItems]; next[idx] = { ...mi, menuItemId: e.target.value, menuItemName: item?.name || '' };
                            setFormData({ ...formData, menuItems: next });
                          }} className="flex-1 px-2 py-1.5 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white text-sm">
                            <option value="">Select menu item...</option>
                            {menuItems.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                          </select>
                          <button onClick={() => setFormData({ ...formData, menuItems: formData.menuItems.filter((_: any, i: number) => i !== idx) })}
                            className="p-1 text-slate-400 hover:text-[var(--color-danger)]"><Trash2 className="w-4 h-4" /></button>
                        </div>
                      ))}
                    </div>
                  </div>
                </>
              )}

              {/* ── Package Form ── */}
              {subTab === 'packages' && (
                <>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Name *</label>
                    <input value={formData.name || ''} onChange={e => setFormData({ ...formData, name: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white" placeholder="e.g. Conference Package" />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Package Type</label>
                      <select value={formData.packageType || 'custom'} onChange={e => setFormData({ ...formData, packageType: e.target.value })}
                        className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white text-sm">
                        <option value="conference">Conference</option>
                        <option value="wedding">Wedding</option>
                        <option value="cocktail">Cocktail</option>
                        <option value="beverage">Beverage</option>
                        <option value="breakfast">Breakfast</option>
                        <option value="custom">Custom</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Status</label>
                      <select value={formData.status || 'Active'} onChange={e => setFormData({ ...formData, status: e.target.value })}
                        className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white text-sm">
                        <option value="Active">Active</option>
                        <option value="Inactive">Inactive</option>
                      </select>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Price / Person</label>
                      <input type="number" step="0.01" value={formData.pricePerPerson ?? 0} onChange={e => setFormData({ ...formData, pricePerPerson: parseFloat(e.target.value) || 0 })}
                        className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white" />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Min Covers</label>
                      <input type="number" min="1" value={formData.minCovers ?? 1} onChange={e => setFormData({ ...formData, minCovers: parseInt(e.target.value) || 1 })}
                        className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white" />
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Description</label>
                    <input value={formData.description || ''} onChange={e => setFormData({ ...formData, description: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white" placeholder="Optional description" />
                  </div>
                  {/* Outlets */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Outlets</label>
                    <div className="flex flex-wrap gap-2">
                      {outlets.map(o => {
                        const selected = (formData.outlets || []).some((x: any) => x.outletId === o.id);
                        return (
                          <button key={o.id} type="button" onClick={() => {
                            const next = selected
                              ? formData.outlets.filter((x: any) => x.outletId !== o.id)
                              : [...(formData.outlets || []), { outletId: o.id, outletName: o.name }];
                            setFormData({ ...formData, outlets: next });
                          }} className={`px-3 py-1.5 rounded-lg text-sm border ${selected ? 'bg-[var(--color-accent-operations)] text-white border-[var(--color-accent-operations)]' : 'bg-white dark:bg-slate-800 text-gray-700 dark:text-gray-300 border-gray-300 dark:border-slate-600'}`}>
                            {o.name}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  {/* Components */}
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Components</label>
                      <button onClick={() => setFormData({ ...formData, components: [...(formData.components || []), { componentName: '', componentType: 'meal', sortOrder: (formData.components || []).length }] })}
                        className="text-xs text-[var(--color-accent-operations)] hover:opacity-80 flex items-center gap-1">
                        <Plus className="w-3 h-3" /> Add Component
                      </button>
                    </div>
                    <div className="space-y-2">
                      {(formData.components || []).map((c: any, idx: number) => (
                        <div key={idx} className="flex items-center gap-2">
                          <input value={c.componentName} onChange={e => { const next = [...formData.components]; next[idx] = { ...c, componentName: e.target.value }; setFormData({ ...formData, components: next }); }}
                            className="flex-1 px-2 py-1.5 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white text-sm" placeholder="Component name" />
                          <select value={c.componentType} onChange={e => { const next = [...formData.components]; next[idx] = { ...c, componentType: e.target.value }; setFormData({ ...formData, components: next }); }}
                            className="w-28 px-2 py-1.5 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white text-xs">
                            <option value="meal">Meal</option>
                            <option value="beverage">Beverage</option>
                            <option value="snack">Snack</option>
                            <option value="item">Item</option>
                            <option value="service">Service</option>
                          </select>
                          <button onClick={() => setFormData({ ...formData, components: formData.components.filter((_: any, i: number) => i !== idx) })}
                            className="p-1 text-slate-400 hover:text-[var(--color-danger)]"><Trash2 className="w-4 h-4" /></button>
                        </div>
                      ))}
                    </div>
                  </div>
                  {/* Menu Items */}
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Menu Items</label>
                      <button onClick={() => setFormData({ ...formData, menuItems: [...(formData.menuItems || []), { menuItemId: '', menuItemName: '', componentType: 'meal', sortOrder: (formData.menuItems || []).length }] })}
                        className="text-xs text-[var(--color-accent-operations)] hover:opacity-80 flex items-center gap-1">
                        <Plus className="w-3 h-3" /> Add Menu Item
                      </button>
                    </div>
                    <div className="space-y-2">
                      {(formData.menuItems || []).map((mi: any, idx: number) => (
                        <div key={idx} className="flex items-center gap-2">
                          <select value={mi.componentType || 'meal'} onChange={e => { const next = [...formData.menuItems]; next[idx] = { ...mi, componentType: e.target.value }; setFormData({ ...formData, menuItems: next }); }}
                            className="w-28 px-2 py-1.5 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white text-xs">
                            <option value="meal">Meal</option>
                            <option value="beverage">Beverage</option>
                            <option value="snack">Snack</option>
                            <option value="dessert">Dessert</option>
                            <option value="service">Service</option>
                            <option value="item">Item</option>
                          </select>
                          <select value={mi.menuItemId || ''} onChange={e => {
                            const item = menuItems.find(m => m.id === e.target.value);
                            const next = [...formData.menuItems]; next[idx] = { ...mi, menuItemId: e.target.value, menuItemName: item?.name || '' };
                            setFormData({ ...formData, menuItems: next });
                          }} className="flex-1 px-2 py-1.5 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white text-sm">
                            <option value="">Select menu item...</option>
                            {menuItems.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                          </select>
                          <button onClick={() => setFormData({ ...formData, menuItems: formData.menuItems.filter((_: any, i: number) => i !== idx) })}
                            className="p-1 text-slate-400 hover:text-[var(--color-danger)]"><Trash2 className="w-4 h-4" /></button>
                        </div>
                      ))}
                    </div>
                  </div>
                </>
              )}

              {/* ── Promotion Form ── */}
              {subTab === 'promotions' && (
                <>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Name *</label>
                    <input value={formData.name || ''} onChange={e => setFormData({ ...formData, name: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white" placeholder="e.g. Sunset Happy Hour" />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Type</label>
                      <input value={formData.type || ''} onChange={e => setFormData({ ...formData, type: e.target.value })}
                        className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white" placeholder="e.g. Happy Hour, BOGO" />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Status</label>
                      <select value={formData.status || 'Active'} onChange={e => setFormData({ ...formData, status: e.target.value })}
                        className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white text-sm">
                        <option value="Active">Active</option>
                        <option value="Scheduled">Scheduled</option>
                        <option value="Ended">Ended</option>
                      </select>
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Discount Description</label>
                    <input value={formData.discountDescription || ''} onChange={e => setFormData({ ...formData, discountDescription: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white" placeholder="e.g. 50% off all cocktails" />
                  </div>
                  <div className="grid grid-cols-3 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Discount Value</label>
                      <input type="number" step="0.01" value={formData.discountValue ?? ''} onChange={e => setFormData({ ...formData, discountValue: e.target.value ? parseFloat(e.target.value) : null })}
                        className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white" placeholder="e.g. 50" />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Discount Type</label>
                      <select value={formData.discountType || 'percentage'} onChange={e => setFormData({ ...formData, discountType: e.target.value })}
                        className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white text-sm">
                        <option value="percentage">Percentage</option>
                        <option value="fixed">Fixed Amount</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Schedule</label>
                      <input value={formData.schedule || ''} onChange={e => setFormData({ ...formData, schedule: e.target.value })}
                        className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white" placeholder="e.g. 17:00-19:00" />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Start Date</label>
                      <input type="date" value={formData.startDate || ''} onChange={e => setFormData({ ...formData, startDate: e.target.value })}
                        className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white" />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">End Date</label>
                      <input type="date" value={formData.endDate || ''} onChange={e => setFormData({ ...formData, endDate: e.target.value })}
                        className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white" />
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Channels (comma-separated)</label>
                    <input value={(formData.channels || []).join(', ')} onChange={e => setFormData({ ...formData, channels: e.target.value.split(',').map((s: string) => s.trim()).filter(Boolean) })}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white" placeholder="e.g. POS, Guest Portal, CRM" />
                  </div>
                </>
              )}

              {/* ── Special Offer Form ── */}
              {subTab === 'special-offers' && (
                <>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Name *</label>
                    <input value={formData.name || ''} onChange={e => setFormData({ ...formData, name: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white" placeholder="e.g. Valentine's Dinner for Two" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Description</label>
                    <input value={formData.description || ''} onChange={e => setFormData({ ...formData, description: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white" placeholder="Optional description" />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Outlet</label>
                      <select value={formData.outletId || ''} onChange={e => {
                        const ol = outlets.find(o => o.id === e.target.value);
                        setFormData({ ...formData, outletId: e.target.value, outletName: ol?.name || '' });
                      }} className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white text-sm">
                        <option value="">— None —</option>
                        {outlets.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Price</label>
                      <input type="number" step="0.01" value={formData.price ?? 0} onChange={e => setFormData({ ...formData, price: parseFloat(e.target.value) || 0 })}
                        className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white" placeholder="0.00" />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Valid Until</label>
                      <input type="date" value={formData.validUntil || ''} onChange={e => setFormData({ ...formData, validUntil: e.target.value })}
                        className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white" />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Status</label>
                      <select value={formData.status || 'Active'} onChange={e => setFormData({ ...formData, status: e.target.value })}
                        className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white text-sm">
                        <option value="Active">Active</option>
                        <option value="Expired">Expired</option>
                      </select>
                    </div>
                  </div>
                  {/* Menu Items */}
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Menu Items</label>
                      <button onClick={() => setFormData({ ...formData, menuItems: [...(formData.menuItems || []), { menuItemId: '', menuItemName: '', courseType: 'main', sortOrder: (formData.menuItems || []).length }] })}
                        className="text-xs text-[var(--color-accent-operations)] hover:opacity-80 flex items-center gap-1">
                        <Plus className="w-3 h-3" /> Add Menu Item
                      </button>
                    </div>
                    <div className="space-y-2">
                      {(formData.menuItems || []).map((mi: any, idx: number) => (
                        <div key={idx} className="flex items-center gap-2">
                          <select value={mi.courseType || 'main'} onChange={e => { const next = [...formData.menuItems]; next[idx] = { ...mi, courseType: e.target.value }; setFormData({ ...formData, menuItems: next }); }}
                            className="w-28 px-2 py-1.5 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white text-xs">
                            <option value="appetizer">Appetizer</option>
                            <option value="main">Main</option>
                            <option value="dessert">Dessert</option>
                            <option value="beverage">Beverage</option>
                            <option value="snack">Snack</option>
                          </select>
                          <select value={mi.menuItemId || ''} onChange={e => {
                            const item = menuItems.find(m => m.id === e.target.value);
                            const next = [...formData.menuItems]; next[idx] = { ...mi, menuItemId: e.target.value, menuItemName: item?.name || '' };
                            setFormData({ ...formData, menuItems: next });
                          }} className="flex-1 px-2 py-1.5 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white text-sm">
                            <option value="">Select menu item...</option>
                            {menuItems.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                          </select>
                          <button onClick={() => setFormData({ ...formData, menuItems: formData.menuItems.filter((_: any, i: number) => i !== idx) })}
                            className="p-1 text-slate-400 hover:text-[var(--color-danger)]"><Trash2 className="w-4 h-4" /></button>
                        </div>
                      ))}
                    </div>
                  </div>
                </>
              )}

              {/* Actions */}
              <div className="flex gap-3 pt-4">
                <button onClick={handleSave} disabled={saving} className={`${button.primary} flex-1`}>
                  {saving ? 'Saving...' : editingId ? 'Update' : 'Create'}
                </button>
                <button onClick={() => setShowModal(false)} className={button.secondary}>Cancel</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
