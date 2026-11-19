/**
 * @license
 * SPDX-License-Identifier: Apache-2.5
 *
 * F&B Configuration module — F&B Portal.
 * Central configuration hub for Outlets, Menus, Categories, Menu Items, Modifiers,
 * Recipes, Sub-Recipes, Production Stations, Price Lists, Meal Plans, Packages,
 * Promotions, Service Charges, Tax Mapping, Dietary Labels, Allergen Definitions,
 * and Service Standards.
 * Per spec §30 (F&B Configuration).
 */

import { useMemo, useState } from 'react';
import {
  Settings,
  Store,
  BookOpen,
  Tags,
  ChefHat,
  Flame,
  DollarSign,
  Utensils,
  Package,
  Tag,
  Percent,
  Receipt,
  Leaf,
  AlertTriangle,
  ShieldCheck,
  Plus,
  Pencil,
  Trash2,
  Search,
  Clock,
  X,
} from 'lucide-react';
import { useERP } from '../../context/ERPContext';
import StatCard from '../FrontOffice/StatCard';
import { PageHeader, SectionCard, Badge } from '../FrontOffice/ui';
import { button, layout } from '../FrontOffice/brandTheme';

type ConfigArea =
  | 'outlets' | 'menus' | 'categories' | 'menu-items' | 'modifiers'
  | 'recipes' | 'sub-recipes' | 'stations' | 'price-lists' | 'meal-plans'
  | 'packages' | 'promotions' | 'service-charges' | 'tax-mapping'
  | 'dietary-labels' | 'allergens' | 'service-standards';

interface ConfigRow {
  id: string;
  name: string;
  detail: string;
  status: 'Active' | 'Inactive';
  meta?: string;
}

const AREAS: { id: ConfigArea; label: string; icon: typeof Settings; group: string }[] = [
  { id: 'outlets', label: 'Outlets', icon: Store, group: 'Operations' },
  { id: 'menus', label: 'Menus', icon: BookOpen, group: 'Operations' },
  { id: 'categories', label: 'Menu Categories', icon: Tags, group: 'Operations' },
  { id: 'menu-items', label: 'Menu Items', icon: Utensils, group: 'Operations' },
  { id: 'modifiers', label: 'Modifiers', icon: Plus, group: 'Operations' },
  { id: 'recipes', label: 'Recipes', icon: ChefHat, group: 'Kitchen' },
  { id: 'sub-recipes', label: 'Sub-Recipes', icon: ChefHat, group: 'Kitchen' },
  { id: 'stations', label: 'Production Stations', icon: Flame, group: 'Kitchen' },
  { id: 'price-lists', label: 'Price Lists', icon: DollarSign, group: 'Commercial' },
  { id: 'meal-plans', label: 'Meal Plans', icon: Utensils, group: 'Commercial' },
  { id: 'packages', label: 'Packages', icon: Package, group: 'Commercial' },
  { id: 'promotions', label: 'Promotions', icon: Tag, group: 'Commercial' },
  { id: 'service-charges', label: 'Service Charges', icon: Percent, group: 'Commercial' },
  { id: 'tax-mapping', label: 'Tax Mapping', icon: Receipt, group: 'Commercial' },
  { id: 'dietary-labels', label: 'Dietary Labels', icon: Leaf, group: 'Compliance' },
  { id: 'allergens', label: 'Allergen Definitions', icon: AlertTriangle, group: 'Compliance' },
  { id: 'service-standards', label: 'Service Standards', icon: ShieldCheck, group: 'Compliance' },
];

const DATA: Record<ConfigArea, ConfigRow[]> = {
  outlets: [
    { id: 'OUT-01', name: 'The Garden Restaurant', detail: 'All-Day Dining • 80 seats', status: 'Active', meta: 'RC-100' },
    { id: 'OUT-02', name: 'La Maison', detail: 'Fine Dining • 40 seats', status: 'Active', meta: 'RC-101' },
    { id: 'OUT-03', name: 'Sky Lounge', detail: 'Bar • 60 seats', status: 'Active', meta: 'RC-102' },
    { id: 'OUT-04', name: 'Pool Bar', detail: 'Pool Bar • 30 seats', status: 'Inactive', meta: 'RC-103' },
    { id: 'OUT-05', name: 'Room Service', detail: 'Room Service • 24h', status: 'Active', meta: 'RC-104' },
  ],
  menus: [
    { id: 'MEN-01', name: 'All-Day Dining Menu', detail: 'The Garden Restaurant • v3', status: 'Active', meta: '84 items' },
    { id: 'MEN-02', name: 'Fine Dining À La Carte', detail: 'La Maison • v5', status: 'Active', meta: '56 items' },
    { id: 'MEN-03', name: 'Bar Menu', detail: 'Sky Lounge • v2', status: 'Active', meta: '42 items' },
    { id: 'MEN-04', name: 'Room Service Menu', detail: 'Room Service • v4', status: 'Active', meta: '28 items' },
    { id: 'MEN-05', name: 'Breakfast Buffet', detail: 'The Garden Restaurant • v6', status: 'Active', meta: '60 items' },
  ],
  categories: [
    { id: 'CAT-01', name: 'Starters', detail: 'Appetizers & antipasti', status: 'Active' },
    { id: 'CAT-02', name: 'Mains', detail: 'Main courses', status: 'Active' },
    { id: 'CAT-03', name: 'Desserts', detail: 'Sweet courses', status: 'Active' },
    { id: 'CAT-04', name: 'Beverages', detail: 'Soft & hot drinks', status: 'Active' },
    { id: 'CAT-05', name: 'Cocktails', detail: 'Signature & classic cocktails', status: 'Active' },
    { id: 'CAT-06', name: 'Wine', detail: 'Red, white, rosé, sparkling', status: 'Active' },
  ],
  'menu-items': [
    { id: 'MI-001', name: 'Margherita Pizza', detail: 'Mains • $18', status: 'Active', meta: 'Recipe RC-201' },
    { id: 'MI-002', name: 'Caesar Salad', detail: 'Starters • $12', status: 'Active', meta: 'Recipe RC-180' },
    { id: 'MI-003', name: 'Grilled Salmon', detail: 'Mains • $28', status: 'Active', meta: 'Recipe RC-310' },
    { id: 'MI-004', name: 'Tiramisu', detail: 'Desserts • $9', status: 'Active', meta: 'Recipe RC-420' },
    { id: 'MI-005', name: 'Old Fashioned', detail: 'Cocktails • $14', status: 'Active', meta: 'Recipe RC-501' },
  ],
  modifiers: [
    { id: 'MOD-01', name: 'Cooking Temperature', detail: 'Rare / Medium / Well-done', status: 'Active' },
    { id: 'MOD-02', name: 'Extra Cheese', detail: '+$2.00', status: 'Active' },
    { id: 'MOD-03', name: 'Spice Level', detail: 'Mild / Medium / Hot', status: 'Active' },
    { id: 'MOD-04', name: 'Side Options', detail: 'Fries / Salad / Veg', status: 'Active' },
    { id: 'MOD-05', name: 'Gluten-Free Bread', detail: '+$3.00', status: 'Active' },
  ],
  recipes: [
    { id: 'RC-201', name: 'Margherita Pizza Recipe', detail: 'Yield: 1 pizza • Cost $4.20', status: 'Active' },
    { id: 'RC-180', name: 'Caesar Salad Recipe', detail: 'Yield: 1 portion • Cost $3.10', status: 'Active' },
    { id: 'RC-310', name: 'Grilled Salmon Recipe', detail: 'Yield: 1 portion • Cost $9.80', status: 'Active' },
    { id: 'RC-420', name: 'Tiramisu Recipe', detail: 'Yield: 8 portions • Cost $11.20', status: 'Active' },
    { id: 'RC-501', name: 'Old Fashioned Recipe', detail: 'Yield: 1 drink • Cost $3.50', status: 'Active' },
  ],
  'sub-recipes': [
    { id: 'SUB-01', name: 'Tomato Sauce', detail: 'Used by: Pizza, Pasta, Lasagna', status: 'Active' },
    { id: 'SUB-02', name: 'Pizza Dough', detail: 'Used by: Pizza, Calzone', status: 'Active' },
    { id: 'SUB-03', name: 'Caesar Dressing', detail: 'Used by: Caesar Salad', status: 'Active' },
    { id: 'SUB-04', name: 'Beef Stock', detail: 'Used by: Soups, Sauces', status: 'Active' },
    { id: 'SUB-05', name: 'Caramelized Onion', detail: 'Used by: French Onion Soup, Burger', status: 'Active' },
  ],
  stations: [
    { id: 'STN-01', name: 'Grill', detail: 'The Garden Restaurant', status: 'Active' },
    { id: 'STN-02', name: 'Fry', detail: 'The Garden Restaurant', status: 'Active' },
    { id: 'STN-03', name: 'Cold', detail: 'The Garden Restaurant', status: 'Active' },
    { id: 'STN-04', name: 'Pizza', detail: 'La Maison', status: 'Active' },
    { id: 'STN-05', name: 'Pastry', detail: 'La Maison', status: 'Active' },
    { id: 'STN-06', name: 'Expo', detail: 'All outlets', status: 'Active' },
  ],
  'price-lists': [
    { id: 'PL-001', name: 'All-Day Dining Standard', detail: 'USD • 84 items', status: 'Active' },
    { id: 'PL-002', name: 'Fine Dining À La Carte', detail: 'USD • 56 items', status: 'Active' },
    { id: 'PL-003', name: 'Bar Menu', detail: 'USD • 42 items', status: 'Active' },
    { id: 'PL-004', name: 'Room Service Overnight', detail: 'USD • 28 items', status: 'Inactive' },
  ],
  'meal-plans': [
    { id: 'MP-001', name: 'Bed & Breakfast', detail: 'Adult $35 / Child $18', status: 'Active' },
    { id: 'MP-002', name: 'Half Board Standard', detail: 'Adult $78 / Child $39', status: 'Active' },
    { id: 'MP-003', name: 'Full Board Premium', detail: 'Adult $120 / Child $60', status: 'Active' },
    { id: 'MP-004', name: 'All Inclusive', detail: 'Adult $185 / Child $92', status: 'Active' },
  ],
  packages: [
    { id: 'PK-001', name: 'Conference Package', detail: '$65 / person • min 20', status: 'Active' },
    { id: 'PK-002', name: 'Wedding Package Gold', detail: '$145 / person • min 50', status: 'Active' },
    { id: 'PK-003', name: 'Cocktail Package', detail: '$48 / person • min 10', status: 'Active' },
    { id: 'PK-004', name: 'Beverage Package Premium', detail: '$55 / person • min 2', status: 'Inactive' },
  ],
  promotions: [
    { id: 'PR-001', name: 'Sunset Happy Hour', detail: '50% off cocktails • 17:00–19:00', status: 'Active' },
    { id: 'PR-002', name: 'Business Lunch BOGO', detail: 'Buy 1 Get 1 Free • weekdays', status: 'Active' },
    { id: 'PR-003', name: 'Chef\'s Tasting Night', detail: '7-course $85 • Fridays', status: 'Active' },
  ],
  'service-charges': [
    { id: 'SC-01', name: 'Standard Service Charge', detail: '10% on food & beverage', status: 'Active' },
    { id: 'SC-02', name: 'Banquet Service Charge', detail: '15% on events', status: 'Active' },
    { id: 'SC-03', name: 'Room Service Delivery', detail: '$5 flat fee', status: 'Active' },
  ],
  'tax-mapping': [
    { id: 'TX-01', name: 'Food VAT', detail: '12% on food items', status: 'Active' },
    { id: 'TX-02', name: 'Beverage VAT', detail: '15% on beverages', status: 'Active' },
    { id: 'TX-03', name: 'Alcohol Excise', detail: '8% on alcoholic beverages', status: 'Active' },
    { id: 'TX-04', name: 'Service Tax', detail: '5% on service charge', status: 'Active' },
  ],
  'dietary-labels': [
    { id: 'DL-01', name: 'Vegetarian', detail: 'No meat or fish', status: 'Active' },
    { id: 'DL-02', name: 'Vegan', detail: 'No animal products', status: 'Active' },
    { id: 'DL-03', name: 'Halal', detail: 'Halal-certified', status: 'Active' },
    { id: 'DL-04', name: 'Kosher', detail: 'Kosher-certified', status: 'Active' },
    { id: 'DL-05', name: 'Gluten-Free', detail: 'No gluten', status: 'Active' },
    { id: 'DL-06', name: 'Keto', detail: 'Low-carb, high-fat', status: 'Active' },
  ],
  allergens: [
    { id: 'AL-01', name: 'Gluten', detail: 'Wheat, barley, rye', status: 'Active' },
    { id: 'AL-02', name: 'Crustaceans', detail: 'Shrimp, crab, lobster', status: 'Active' },
    { id: 'AL-03', name: 'Eggs', detail: 'Egg and egg products', status: 'Active' },
    { id: 'AL-04', name: 'Fish', detail: 'All fish species', status: 'Active' },
    { id: 'AL-05', name: 'Peanuts', detail: 'Peanuts and peanut products', status: 'Active' },
    { id: 'AL-06', name: 'Soy', detail: 'Soy and soy products', status: 'Active' },
    { id: 'AL-07', name: 'Milk', detail: 'Dairy and lactose', status: 'Active' },
    { id: 'AL-08', name: 'Tree Nuts', detail: 'Almonds, cashews, walnuts', status: 'Active' },
  ],
  'service-standards': [
    { id: 'SS-01', name: 'Greeting Time', detail: 'Target: < 30 sec', status: 'Active' },
    { id: 'SS-02', name: 'Order Taken Within', detail: 'Target: < 5 min', status: 'Active' },
    { id: 'SS-03', name: 'First Course Served', detail: 'Target: < 15 min', status: 'Active' },
    { id: 'SS-04', name: 'Table Turnover', detail: 'Target: < 90 min', status: 'Active' },
    { id: 'SS-05', name: 'Bill Delivery', detail: 'Target: < 5 min', status: 'Active' },
  ],
};

export default function Configuration() {
  const { addNotification } = useERP();
  const [area, setArea] = useState<ConfigArea>('outlets');
  const [search, setSearch] = useState('');
  const [showModal, setShowModal] = useState(false);

  const stats = useMemo(() => ({
    outlets: DATA.outlets.filter(o => o.status === 'Active').length,
    menus: DATA.menus.length,
    recipes: DATA.recipes.length,
    allergens: DATA.allergens.length,
  }), []);

  const groupedAreas = useMemo(() => {
    const groups: Record<string, typeof AREAS> = {};
    AREAS.forEach(a => { (groups[a.group] = groups[a.group] || []).push(a); });
    return groups;
  }, []);

  const rows = DATA[area];
  const filtered = rows.filter(r => r.name.toLowerCase().includes(search.toLowerCase()) || r.detail.toLowerCase().includes(search.toLowerCase()));
  const currentArea = AREAS.find(a => a.id === area)!;

  return (
    <div className={['accent-fb', layout.sectionStack].join(' ')}>
      <PageHeader
        title="F&B Configuration"
        subtitle="Central configuration for all F&B master data and operational settings"
        icon={Settings}
        actions={
          <>
            <button onClick={() => addNotification('Configuration refreshed', 'info', 'F&B')} className={button.secondary}>
              <Clock className="w-4 h-4" /> Refresh
            </button>
            <button onClick={() => setShowModal(true)} className={button.primary}>
              <Plus className="w-4 h-4" /> New {currentArea.label.replace(/s$/, '')}
            </button>
          </>
        }
      />

      <div className={layout.kpiGrid}>
        <StatCard title="Active Outlets" value={stats.outlets} icon={Store} tone="accent" />
        <StatCard title="Menus" value={stats.menus} icon={BookOpen} tone="info" />
        <StatCard title="Recipes" value={stats.recipes} icon={ChefHat} tone="success" />
        <StatCard title="Allergens Tracked" value={stats.allergens} icon={AlertTriangle} tone="warning" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Config area navigation */}
        <div className="lg:col-span-1 space-y-4">
          {Object.entries(groupedAreas).map(([group, items]) => (
            <div key={group} className="bg-white dark:bg-slate-800 rounded-2xl border border-gray-200 dark:border-slate-700 overflow-hidden">
              <div className="px-4 py-2 bg-slate-50 dark:bg-slate-900/40 border-b border-gray-200 dark:border-slate-700">
                <h3 className="text-xs font-semibold uppercase text-slate-500">{group}</h3>
              </div>
              <div className="p-2 space-y-1">
                {items.map(a => (
                  <button
                    key={a.id}
                    onClick={() => { setArea(a.id); setSearch(''); }}
                    className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors ${
                      area === a.id
                        ? 'bg-[var(--color-accent-operations)]/10 text-[var(--color-accent-operations)] font-medium'
                        : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700'
                    }`}
                  >
                    <a.icon className="w-4 h-4" />
                    <span>{a.label}</span>
                    <span className="ml-auto text-xs text-slate-400">{DATA[a.id].length}</span>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Config area content */}
        <div className="lg:col-span-3 space-y-4">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-bold text-gray-900 dark:text-white flex items-center gap-2">
              <currentArea.icon className="w-5 h-5 text-[var(--color-accent-operations)]" />
              {currentArea.label}
            </h2>
            <div className="relative w-64">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search..."
                className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-gray-900 dark:text-white"
              />
            </div>
          </div>

          <SectionCard>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 dark:bg-slate-900/40 text-left text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-6 py-3 font-medium">ID</th>
                    <th className="px-6 py-3 font-medium">Name</th>
                    <th className="px-6 py-3 font-medium">Detail</th>
                    <th className="px-6 py-3 font-medium">Meta</th>
                    <th className="px-6 py-3 font-medium">Status</th>
                    <th className="px-6 py-3 font-medium text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 dark:divide-slate-700">
                  {filtered.map(r => (
                    <tr key={r.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/40">
                      <td className="px-6 py-3 text-slate-500 font-mono text-xs">{r.id}</td>
                      <td className="px-6 py-3 font-medium text-gray-900 dark:text-white">{r.name}</td>
                      <td className="px-6 py-3 text-slate-600 dark:text-slate-400">{r.detail}</td>
                      <td className="px-6 py-3 text-slate-600 dark:text-slate-400">{r.meta || '—'}</td>
                      <td className="px-6 py-3"><Badge tone={r.status === 'Active' ? 'success' : 'neutral'}>{r.status}</Badge></td>
                      <td className="px-6 py-3 text-right">
                        <div className="inline-flex gap-2">
                          <button onClick={() => addNotification(`Edit ${r.name}`, 'info', 'F&B')} className="p-1 text-slate-400 hover:text-[var(--color-accent-operations)]"><Pencil className="w-4 h-4" /></button>
                          <button onClick={() => addNotification(`Delete ${r.name}`, 'warning', 'F&B')} className="p-1 text-slate-400 hover:text-[var(--color-danger)]"><Trash2 className="w-4 h-4" /></button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </SectionCard>
        </div>
      </div>

      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 w-full max-w-md border border-gray-200 dark:border-slate-700">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold text-gray-900 dark:text-white">New {currentArea.label.replace(/s$/, '')}</h2>
              <button onClick={() => setShowModal(false)} className="p-1 text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Name</label>
                <input className="w-full px-3 py-2 border border-gray-200 dark:border-slate-600 rounded-xl bg-white dark:bg-slate-700 text-gray-900 dark:text-white" placeholder="Enter name..." />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Detail</label>
                <input className="w-full px-3 py-2 border border-gray-200 dark:border-slate-600 rounded-xl bg-white dark:bg-slate-700 text-gray-900 dark:text-white" placeholder="Description..." />
              </div>
              <div className="flex items-center gap-2">
                <input type="checkbox" id="cfgActive" defaultChecked className="w-4 h-4 rounded border-gray-300" />
                <label htmlFor="cfgActive" className="text-sm text-gray-700 dark:text-gray-300">Active</label>
              </div>
              <div className="flex gap-3 pt-2">
                <button onClick={() => { setShowModal(false); addNotification('Configuration saved', 'success', 'F&B'); }} className={button.primary}>Save</button>
                <button onClick={() => setShowModal(false)} className={button.secondary}>Cancel</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
