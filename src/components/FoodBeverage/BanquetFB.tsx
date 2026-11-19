/**
 * @license
 * SPDX-License-Identifier: Apache-2.5
 *
 * Banquet F&B module — F&B Portal.
 * Owns Menu, Recipe, Production Requirements, Beverage Requirements for Banquets.
 * Separate from Banquet Portal which manages Event/Client/Venue/BEO/Event timeline.
 * Per spec §15 (Banquet F&B).
 *
 * Fully DB-integrated: Add / Edit / Delete for all four sub-tabs call the
 * `/api/fb/banquet-*` REST endpoints (see foodBeverage.routes.ts).
 */

import { useState, useEffect } from 'react';
import {
  UtensilsCrossed,
  Package,
  ClipboardList,
  Wine,
  Plus,
  Pencil,
  Trash2,
  Clock,
  Search,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  X,
  ListTree,
  DollarSign,
  Send,
  ArrowRightCircle,
} from 'lucide-react';
import { useERP } from '../../context/ERPContext';
import { PageHeader, SectionCard, Badge } from '../FrontOffice/ui';
import { button, layout } from '../FrontOffice/brandTheme';
import { ModalSystem } from '../Shared/ModalSystem';

type SubTab = 'menus' | 'packages' | 'production' | 'beverages';

interface BanquetMenu {
  id: string;
  name: string;
  description: string | null;
  menu_type: 'Wedding' | 'Corporate' | 'Conference' | 'Birthday' | 'Social' | 'Custom';
  price_per_person: number;
  min_guests: number;
  max_guests: number | null;
  courses: string[] | null;
  is_active: boolean;
}

interface BanquetPackage {
  id: string;
  name: string;
  description: string | null;
  package_type: 'All-Inclusive' | 'Food Only' | 'Beverage Only' | 'Premium' | 'Standard' | 'Budget';
  price_per_person: number;
  min_guests: number;
  max_guests: number | null;
  includes_food: boolean;
  includes_beverage: boolean;
  includes_service: boolean;
  inclusions: Record<string, boolean> | null;
  is_active: boolean;
}

interface ProductionRequirement {
  id: string;
  banquet_event_id: string | null;
  menu_id: string | null;
  preparation_area: string;
  prep_start_hours_before: number;
  prep_duration_minutes: number;
  staff_count: number;
  equipment_needed: Record<string, number> | null;
  special_instructions: string | null;
}

interface BeverageRequirement {
  id: string;
  banquet_event_id: string | null;
  beverage_package_id: string | null;
  bar_setup_type: 'Full Bar' | 'Beer & Wine Only' | 'Signature Cocktails' | 'Non-Alcoholic' | 'Custom';
  bartender_count: number;
  bar_start_hours_before: number;
  special_drinks: Record<string, number>[] | null;
  glassware_needed: Record<string, number> | null;
}

// ── Relational entities (link Banquet F&B to Production Coordination & Pricing) ──
interface BanquetMenuItem {
  id: string;
  banquet_menu_id: string;
  menu_item_id: string | null;
  course: string;
  sequence: number;
  quantity_per_person: number;
  is_optional: boolean;
  options: string[] | null;
}

interface BanquetPackageComponent {
  id: string;
  package_id: string;
  menu_item_id: string | null;
  component_type: 'Food' | 'Beverage' | 'Service' | 'Equipment';
  quantity_per_person: number;
}

interface BanquetProductionMenuItem {
  id: string;
  production_requirement_id: string;
  menu_item_id: string | null;
  quantity_per_guest: number;
  total_quantity: number;
  prep_status: 'Pending' | 'In Progress' | 'Ready' | 'Completed';
}

const SUB_TABS: { id: SubTab; label: string; icon: typeof UtensilsCrossed }[] = [
  { id: 'menus', label: 'Event Menus', icon: UtensilsCrossed },
  { id: 'packages', label: 'Event Packages', icon: Package },
  { id: 'production', label: 'Production Requirements', icon: ClipboardList },
  { id: 'beverages', label: 'Beverage Requirements', icon: Wine },
];

const MENU_TYPES: BanquetMenu['menu_type'][] = ['Wedding', 'Corporate', 'Conference', 'Birthday', 'Social', 'Custom'];
const PACKAGE_TYPES: BanquetPackage['package_type'][] = ['All-Inclusive', 'Food Only', 'Beverage Only', 'Premium', 'Standard', 'Budget'];
const BAR_SETUP_TYPES: BeverageRequirement['bar_setup_type'][] = ['Full Bar', 'Beer & Wine Only', 'Signature Cocktails', 'Non-Alcoholic', 'Custom'];
const COMPONENT_TYPES: BanquetPackageComponent['component_type'][] = ['Food', 'Beverage', 'Service', 'Equipment'];
const PREP_STATUS_TYPES: BanquetProductionMenuItem['prep_status'][] = ['Pending', 'In Progress', 'Ready', 'Completed'];
const PREP_STATUS_TONE: Record<BanquetProductionMenuItem['prep_status'], 'warning' | 'info' | 'success' | 'neutral'> = {
  Pending: 'warning',
  'In Progress': 'info',
  Ready: 'success',
  Completed: 'neutral',
};

const MENU_TYPE_TONE: Record<BanquetMenu['menu_type'], 'info' | 'success' | 'warning' | 'accent' | 'neutral'> = {
  Wedding: 'success',
  Corporate: 'info',
  Conference: 'warning',
  Birthday: 'accent',
  Social: 'neutral',
  Custom: 'info',
};

const PACKAGE_TYPE_TONE: Record<BanquetPackage['package_type'], 'success' | 'info' | 'warning' | 'accent' | 'neutral'> = {
  'All-Inclusive': 'success',
  Premium: 'success',
  Standard: 'info',
  'Food Only': 'warning',
  'Beverage Only': 'accent',
  Budget: 'neutral',
};

// ── Empty form templates ────────────────────────────────────────────
const emptyMenu: Omit<BanquetMenu, 'id'> = {
  name: '',
  description: '',
  menu_type: 'Wedding',
  price_per_person: 0,
  min_guests: 1,
  max_guests: null,
  courses: [],
  is_active: true,
};

const emptyPackage: Omit<BanquetPackage, 'id'> = {
  name: '',
  description: '',
  package_type: 'Standard',
  price_per_person: 0,
  min_guests: 1,
  max_guests: null,
  includes_food: true,
  includes_beverage: true,
  includes_service: true,
  inclusions: { decor: false, setup: true, staff: true, linens: false },
  is_active: true,
};

const emptyProduction: Omit<ProductionRequirement, 'id'> = {
  banquet_event_id: null,
  menu_id: null,
  preparation_area: '',
  prep_start_hours_before: 0,
  prep_duration_minutes: 0,
  staff_count: 0,
  equipment_needed: {},
  special_instructions: '',
};

const emptyBeverage: Omit<BeverageRequirement, 'id'> = {
  banquet_event_id: null,
  beverage_package_id: null,
  bar_setup_type: 'Full Bar',
  bartender_count: 1,
  bar_start_hours_before: 1,
  special_drinks: [],
  glassware_needed: {},
};

// ── Helpers ─────────────────────────────────────────────────────────
const inputCls =
  'w-full px-3 py-2 text-sm border border-gray-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-gray-900 dark:text-white outline-none focus:ring-2 focus:ring-[var(--color-accent-banquet)]';
const labelCls = 'block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1.5 uppercase tracking-wider';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className={labelCls}>{label}</label>
      {children}
    </div>
  );
}

// ── Component ───────────────────────────────────────────────────────
export default function BanquetFB() {
  const { formatAmount, addNotification } = useERP();
  const [subTab, setSubTab] = useState<SubTab>('menus');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const [menus, setMenus] = useState<BanquetMenu[]>([]);
  const [packages, setPackages] = useState<BanquetPackage[]>([]);
  const [productionReqs, setProductionReqs] = useState<ProductionRequirement[]>([]);
  const [beverageReqs, setBeverageReqs] = useState<BeverageRequirement[]>([]);

  // Relational data (links to Production Coordination & Pricing & Packages)
  const [menuItems, setMenuItems] = useState<BanquetMenuItem[]>([]);
  const [packageComponents, setPackageComponents] = useState<BanquetPackageComponent[]>([]);
  const [productionMenuItems, setProductionMenuItems] = useState<BanquetProductionMenuItem[]>([]);

  // Catalog menu items (for dropdowns in sub-modals)
  const [catalogMenuItems, setCatalogMenuItems] = useState<{ id: string; name: string; category: string | null }[]>([]);

  // Form / modal state
  const [menuForm, setMenuForm] = useState<Omit<BanquetMenu, 'id'> | null>(null);
  const [menuFormId, setMenuFormId] = useState<string | null>(null); // null = create
  const [packageForm, setPackageForm] = useState<Omit<BanquetPackage, 'id'> | null>(null);
  const [packageFormId, setPackageFormId] = useState<string | null>(null);
  const [prodForm, setProdForm] = useState<Omit<ProductionRequirement, 'id'> | null>(null);
  const [prodFormId, setProdFormId] = useState<string | null>(null);
  const [bevForm, setBevForm] = useState<Omit<BeverageRequirement, 'id'> | null>(null);
  const [bevFormId, setBevFormId] = useState<string | null>(null);

  // Delete confirmation state
  const [deleteTarget, setDeleteTarget] = useState<{ kind: SubTab; id: string; label: string } | null>(null);

  // Sub-entity modal state (Items / Components / Production Menu Items)
  const [itemsModal, setItemsModal] = useState<{ kind: 'menu-items' | 'package-components' | 'production-menu-items'; parentId: string; parentLabel: string } | null>(null);
  const [menuItemForm, setMenuItemForm] = useState<Omit<BanquetMenuItem, 'id' | 'banquet_menu_id'> | null>(null);
  const [menuItemFormId, setMenuItemFormId] = useState<string | null>(null);
  const [componentForm, setComponentForm] = useState<Omit<BanquetPackageComponent, 'id' | 'package_id'> | null>(null);
  const [componentFormId, setComponentFormId] = useState<string | null>(null);
  const [prodMenuItemForm, setProdMenuItemForm] = useState<Omit<BanquetProductionMenuItem, 'id' | 'production_requirement_id'> | null>(null);
  const [prodMenuItemFormId, setProdMenuItemFormId] = useState<string | null>(null);
  const [subDeleteTarget, setSubDeleteTarget] = useState<{ kind: 'menu-items' | 'package-components' | 'production-menu-items'; id: string; label: string } | null>(null);

  // Push-to-Pricing / Push-to-Production-Coordination modal state
  const [pushPriceTarget, setPushPriceTarget] = useState<{ kind: 'menu' | 'package'; id: string; label: string; price: number } | null>(null);
  const [pushProdTarget, setPushProdTarget] = useState<{ id: string; label: string } | null>(null);
  const [pushPriceOutlet, setPushPriceOutlet] = useState('');
  const [pushPriceDate, setPushPriceDate] = useState(new Date().toISOString().slice(0, 10));
  const [pushProdOutlet, setPushProdOutlet] = useState('');
  const [pushProdDate, setPushProdDate] = useState(new Date().toISOString().slice(0, 10));
  const [pushProdMealPeriod, setPushProdMealPeriod] = useState('Dinner');
  const [pushProdCovers, setPushProdCovers] = useState<number>(0);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [menusRes, packagesRes, prodRes, bevRes, menuItemsRes, compRes, prodMenuItemsRes, catalogRes] = await Promise.all([
        fetch('/api/fb/banquet-menus'),
        fetch('/api/fb/banquet-packages'),
        fetch('/api/fb/banquet-production-requirements'),
        fetch('/api/fb/banquet-beverage-requirements'),
        fetch('/api/fb/banquet-menu-items'),
        fetch('/api/fb/banquet-package-components'),
        fetch('/api/fb/banquet-production-menu-items'),
        fetch('/api/fb/menu-items'),
      ]);
      if (menusRes.ok && menusRes.headers.get('content-type')?.includes('json')) setMenus(await menusRes.json());
      if (packagesRes.ok && packagesRes.headers.get('content-type')?.includes('json')) setPackages(await packagesRes.json());
      if (prodRes.ok && prodRes.headers.get('content-type')?.includes('json')) setProductionReqs(await prodRes.json());
      if (bevRes.ok && bevRes.headers.get('content-type')?.includes('json')) setBeverageReqs(await bevRes.json());
      if (menuItemsRes.ok && menuItemsRes.headers.get('content-type')?.includes('json')) setMenuItems(await menuItemsRes.json());
      if (compRes.ok && compRes.headers.get('content-type')?.includes('json')) setPackageComponents(await compRes.json());
      if (prodMenuItemsRes.ok && prodMenuItemsRes.headers.get('content-type')?.includes('json')) setProductionMenuItems(await prodMenuItemsRes.json());
      if (catalogRes.ok && catalogRes.headers.get('content-type')?.includes('json')) {
        const cat = await catalogRes.json();
        setCatalogMenuItems((cat || []).map((x: any) => ({ id: x.id, name: x.name, category: x.category ?? null })));
      }
    } catch (err) {
      console.error('Failed to fetch banquet F&B data:', err);
      addNotification('Failed to load banquet F&B data', 'warning', 'F&B');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const filteredMenus = menus.filter(m => m.name.toLowerCase().includes(search.toLowerCase()));
  const filteredPackages = packages.filter(p => p.name.toLowerCase().includes(search.toLowerCase()));

  // ── CRUD handlers ───────────────────────────────────────────────
  const handleSaveMenu = async () => {
    if (!menuForm || !menuForm.name.trim()) {
      addNotification('Menu name is required', 'warning', 'F&B');
      return;
    }
    setSaving(true);
    try {
      const body = {
        name: menuForm.name.trim(),
        description: menuForm.description || null,
        menu_type: menuForm.menu_type,
        price_per_person: Number(menuForm.price_per_person) || 0,
        min_guests: Number(menuForm.min_guests) || 1,
        max_guests: menuForm.max_guests ? Number(menuForm.max_guests) : null,
        courses: menuForm.courses && menuForm.courses.length > 0 ? menuForm.courses : null,
        is_active: menuForm.is_active,
      };
      const res = await fetch(
        menuFormId ? `/api/fb/banquet-menus/${menuFormId}` : '/api/fb/banquet-menus',
        {
          method: menuFormId ? 'PUT' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${res.status}`);
      }
      addNotification(menuFormId ? 'Menu updated' : 'Menu created', 'success', 'F&B');
      setMenuForm(null);
      setMenuFormId(null);
      await fetchData();
    } catch (err: any) {
      addNotification(`Failed to save menu: ${err.message}`, 'danger', 'F&B');
    } finally {
      setSaving(false);
    }
  };

  const handleSavePackage = async () => {
    if (!packageForm || !packageForm.name.trim()) {
      addNotification('Package name is required', 'warning', 'F&B');
      return;
    }
    setSaving(true);
    try {
      const body = {
        name: packageForm.name.trim(),
        description: packageForm.description || null,
        package_type: packageForm.package_type,
        price_per_person: Number(packageForm.price_per_person) || 0,
        min_guests: Number(packageForm.min_guests) || 1,
        max_guests: packageForm.max_guests ? Number(packageForm.max_guests) : null,
        includes_food: packageForm.includes_food,
        includes_beverage: packageForm.includes_beverage,
        includes_service: packageForm.includes_service,
        inclusions: packageForm.inclusions,
        is_active: packageForm.is_active,
      };
      const res = await fetch(
        packageFormId ? `/api/fb/banquet-packages/${packageFormId}` : '/api/fb/banquet-packages',
        {
          method: packageFormId ? 'PUT' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${res.status}`);
      }
      addNotification(packageFormId ? 'Package updated' : 'Package created', 'success', 'F&B');
      setPackageForm(null);
      setPackageFormId(null);
      await fetchData();
    } catch (err: any) {
      addNotification(`Failed to save package: ${err.message}`, 'danger', 'F&B');
    } finally {
      setSaving(false);
    }
  };

  const handleSaveProduction = async () => {
    if (!prodForm || !prodForm.preparation_area.trim()) {
      addNotification('Preparation area is required', 'warning', 'F&B');
      return;
    }
    setSaving(true);
    try {
      const body = {
        banquet_event_id: prodForm.banquet_event_id || null,
        menu_id: prodForm.menu_id || null,
        preparation_area: prodForm.preparation_area.trim(),
        prep_start_hours_before: Number(prodForm.prep_start_hours_before) || 0,
        prep_duration_minutes: Number(prodForm.prep_duration_minutes) || 0,
        staff_count: Number(prodForm.staff_count) || 0,
        equipment_needed: prodForm.equipment_needed && Object.keys(prodForm.equipment_needed).length > 0 ? prodForm.equipment_needed : null,
        special_instructions: prodForm.special_instructions || null,
      };
      const res = await fetch(
        prodFormId ? `/api/fb/banquet-production-requirements/${prodFormId}` : '/api/fb/banquet-production-requirements',
        {
          // Backend uses PATCH for production requirements updates
          method: prodFormId ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${res.status}`);
      }
      addNotification(prodFormId ? 'Production requirement updated' : 'Production requirement created', 'success', 'F&B');
      setProdForm(null);
      setProdFormId(null);
      await fetchData();
    } catch (err: any) {
      addNotification(`Failed to save production requirement: ${err.message}`, 'danger', 'F&B');
    } finally {
      setSaving(false);
    }
  };

  const handleSaveBeverage = async () => {
    if (!bevForm) {
      addNotification('Beverage form is empty', 'warning', 'F&B');
      return;
    }
    setSaving(true);
    try {
      const body = {
        banquet_event_id: bevForm.banquet_event_id || null,
        beverage_package_id: bevForm.beverage_package_id || null,
        bar_setup_type: bevForm.bar_setup_type,
        bartender_count: Number(bevForm.bartender_count) || 0,
        bar_start_hours_before: Number(bevForm.bar_start_hours_before) || 0,
        special_drinks: bevForm.special_drinks && bevForm.special_drinks.filter(d => d.name && d.name.trim()).length > 0
          ? bevForm.special_drinks.filter(d => d.name && d.name.trim())
          : null,
        glassware_needed: bevForm.glassware_needed && Object.keys(bevForm.glassware_needed).filter(k => k.trim()).length > 0
          ? Object.fromEntries(Object.entries(bevForm.glassware_needed).filter(([k]) => k.trim()))
          : null,
      };
      const res = await fetch(
        bevFormId ? `/api/fb/banquet-beverage-requirements/${bevFormId}` : '/api/fb/banquet-beverage-requirements',
        {
          // Backend uses PATCH for beverage requirements updates
          method: bevFormId ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${res.status}`);
      }
      addNotification(bevFormId ? 'Beverage requirement updated' : 'Beverage requirement created', 'success', 'F&B');
      setBevForm(null);
      setBevFormId(null);
      await fetchData();
    } catch (err: any) {
      addNotification(`Failed to save beverage requirement: ${err.message}`, 'danger', 'F&B');
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setSaving(true);
    try {
      const { kind, id } = deleteTarget;
      const endpointMap: Record<SubTab, string> = {
        menus: 'banquet-menus',
        packages: 'banquet-packages',
        production: 'banquet-production-requirements',
        beverages: 'banquet-beverage-requirements',
      };
      const res = await fetch(`/api/fb/${endpointMap[kind]}/${id}`, { method: 'DELETE' });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${res.status}`);
      }
      addNotification(`${deleteTarget.label} deleted`, 'success', 'F&B');
      setDeleteTarget(null);
      await fetchData();
    } catch (err: any) {
      addNotification(`Failed to delete: ${err.message}`, 'danger', 'F&B');
    } finally {
      setSaving(false);
    }
  };

  // ── Sub-entity CRUD (Menu Items / Package Components / Production Menu Items) ──
  const handleSaveMenuItem = async () => {
    if (!menuItemForm || !itemsModal || itemsModal.kind !== 'menu-items') return;
    if (!menuItemForm.course.trim()) { addNotification('Course is required', 'warning', 'F&B'); return; }
    setSaving(true);
    try {
      const body = {
        banquet_menu_id: itemsModal.parentId,
        menu_item_id: menuItemForm.menu_item_id || null,
        course: menuItemForm.course.trim(),
        sequence: Number(menuItemForm.sequence) || 0,
        quantity_per_person: Number(menuItemForm.quantity_per_person) || 1,
        is_optional: menuItemForm.is_optional,
        options: menuItemForm.is_optional && menuItemForm.options && menuItemForm.options.length > 0 ? menuItemForm.options : null,
      };
      const res = await fetch(
        menuItemFormId ? `/api/fb/banquet-menu-items/${menuItemFormId}` : '/api/fb/banquet-menu-items',
        { method: menuItemFormId ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
      );
      if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || `HTTP ${res.status}`); }
      addNotification(menuItemFormId ? 'Menu item updated' : 'Menu item added', 'success', 'F&B');
      setMenuItemForm(null); setMenuItemFormId(null);
      await fetchData();
    } catch (err: any) { addNotification(`Failed: ${err.message}`, 'danger', 'F&B'); }
    finally { setSaving(false); }
  };

  const handleSaveComponent = async () => {
    if (!componentForm || !itemsModal || itemsModal.kind !== 'package-components') return;
    setSaving(true);
    try {
      const body = {
        package_id: itemsModal.parentId,
        menu_item_id: componentForm.menu_item_id || null,
        component_type: componentForm.component_type,
        quantity_per_person: Number(componentForm.quantity_per_person) || 1,
      };
      const res = await fetch(
        componentFormId ? `/api/fb/banquet-package-components/${componentFormId}` : '/api/fb/banquet-package-components',
        { method: componentFormId ? 'POST' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
      );
      // Backend has no PUT for components; for edits we delete + re-create
      if (componentFormId && res.ok) {
        // already inserted new; now delete old
        await fetch(`/api/fb/banquet-package-components/${componentFormId}`, { method: 'DELETE' });
      }
      if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || `HTTP ${res.status}`); }
      addNotification(componentFormId ? 'Component updated' : 'Component added', 'success', 'F&B');
      setComponentForm(null); setComponentFormId(null);
      await fetchData();
    } catch (err: any) { addNotification(`Failed: ${err.message}`, 'danger', 'F&B'); }
    finally { setSaving(false); }
  };

  const handleSaveProdMenuItem = async () => {
    if (!prodMenuItemForm || !itemsModal || itemsModal.kind !== 'production-menu-items') return;
    setSaving(true);
    try {
      const body = {
        production_requirement_id: itemsModal.parentId,
        menu_item_id: prodMenuItemForm.menu_item_id || null,
        quantity_per_guest: Number(prodMenuItemForm.quantity_per_guest) || 1,
        total_quantity: Number(prodMenuItemForm.total_quantity) || 0,
        prep_status: prodMenuItemForm.prep_status,
      };
      const res = await fetch(
        prodMenuItemFormId ? `/api/fb/banquet-production-menu-items/${prodMenuItemFormId}` : '/api/fb/banquet-production-menu-items',
        { method: prodMenuItemFormId ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
      );
      if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || `HTTP ${res.status}`); }
      addNotification(prodMenuItemFormId ? 'Production menu item updated' : 'Production menu item added', 'success', 'F&B');
      setProdMenuItemForm(null); setProdMenuItemFormId(null);
      await fetchData();
    } catch (err: any) { addNotification(`Failed: ${err.message}`, 'danger', 'F&B'); }
    finally { setSaving(false); }
  };

  const confirmSubDelete = async () => {
    if (!subDeleteTarget) return;
    setSaving(true);
    try {
      const { kind, id } = subDeleteTarget;
      const endpointMap: Record<typeof kind, string> = {
        'menu-items': 'banquet-menu-items',
        'package-components': 'banquet-package-components',
        'production-menu-items': 'banquet-production-menu-items',
      };
      const res = await fetch(`/api/fb/${endpointMap[kind]}/${id}`, { method: 'DELETE' });
      if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || `HTTP ${res.status}`); }
      addNotification(`${subDeleteTarget.label} deleted`, 'success', 'F&B');
      setSubDeleteTarget(null);
      await fetchData();
    } catch (err: any) { addNotification(`Failed to delete: ${err.message}`, 'danger', 'F&B'); }
    finally { setSaving(false); }
  };

  // ── Push to Pricing & Packages (price list) ─────────────────────
  const handlePushToPriceList = async () => {
    if (!pushPriceTarget) return;
    setSaving(true);
    try {
      const endpoint = pushPriceTarget.kind === 'menu'
        ? `/api/fb/banquet-menus/${pushPriceTarget.id}/push-to-price-list`
        : `/api/fb/banquet-packages/${pushPriceTarget.id}/push-to-price-list`;
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          outletId: pushPriceOutlet || undefined,
          outletName: 'Banquet',
          effectiveFrom: pushPriceDate || undefined,
        }),
      });
      if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || `HTTP ${res.status}`); }
      const data = await res.json();
      addNotification(`Pushed to Price Lists: "${data.price_list?.name || pushPriceTarget.label}" (${formatAmount(pushPriceTarget.price)}/person)`, 'success', 'F&B');
      setPushPriceTarget(null);
    } catch (err: any) { addNotification(`Failed to push to price list: ${err.message}`, 'danger', 'F&B'); }
    finally { setSaving(false); }
  };

  // ── Push to Production Coordination (production plan + prep items) ──
  const handlePushToProductionPlan = async () => {
    if (!pushProdTarget) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/fb/banquet-production-requirements/${pushProdTarget.id}/push-to-production-plan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          outletId: pushProdOutlet || undefined,
          planDate: pushProdDate || undefined,
          mealPeriod: pushProdMealPeriod || undefined,
          forecastCovers: pushProdCovers || undefined,
        }),
      });
      if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || `HTTP ${res.status}`); }
      const data = await res.json();
      addNotification(`Pushed to Production Coordination: ${data.prep_count} prep item(s) created for plan ${data.production_plan?.id?.substring(0, 8)}`, 'success', 'F&B');
      setPushProdTarget(null);
    } catch (err: any) { addNotification(`Failed to push to production plan: ${err.message}`, 'danger', 'F&B'); }
    finally { setSaving(false); }
  };

  // ── Modal openers ───────────────────────────────────────────────
  const openCreateMenu = () => { setMenuForm({ ...emptyMenu }); setMenuFormId(null); };
  const openEditMenu = (m: BanquetMenu) => {
    setMenuForm({
      name: m.name, description: m.description || '', menu_type: m.menu_type,
      price_per_person: Number(m.price_per_person), min_guests: m.min_guests,
      max_guests: m.max_guests, courses: m.courses || [], is_active: m.is_active,
    });
    setMenuFormId(m.id);
  };

  const openCreatePackage = () => { setPackageForm({ ...emptyPackage }); setPackageFormId(null); };
  const openEditPackage = (p: BanquetPackage) => {
    setPackageForm({
      name: p.name, description: p.description || '', package_type: p.package_type,
      price_per_person: Number(p.price_per_person), min_guests: p.min_guests,
      max_guests: p.max_guests, includes_food: p.includes_food,
      includes_beverage: p.includes_beverage, includes_service: p.includes_service,
      inclusions: p.inclusions || {}, is_active: p.is_active,
    });
    setPackageFormId(p.id);
  };

  const openCreateProduction = () => { setProdForm({ ...emptyProduction }); setProdFormId(null); };
  const openEditProduction = (r: ProductionRequirement) => {
    setProdForm({
      banquet_event_id: r.banquet_event_id, menu_id: r.menu_id,
      preparation_area: r.preparation_area,
      prep_start_hours_before: r.prep_start_hours_before,
      prep_duration_minutes: r.prep_duration_minutes,
      staff_count: r.staff_count,
      equipment_needed: r.equipment_needed || {},
      special_instructions: r.special_instructions || '',
    });
    setProdFormId(r.id);
  };

  const openCreateBeverage = () => { setBevForm({ ...emptyBeverage }); setBevFormId(null); };
  const openEditBeverage = (r: BeverageRequirement) => {
    setBevForm({
      banquet_event_id: r.banquet_event_id, beverage_package_id: r.beverage_package_id,
      bar_setup_type: r.bar_setup_type, bartender_count: r.bartender_count,
      bar_start_hours_before: r.bar_start_hours_before,
      special_drinks: r.special_drinks || [], glassware_needed: r.glassware_needed || {},
    });
    setBevFormId(r.id);
  };

  // Helper to render the menu name for a production requirement
  const menuNameFor = (menuId: string | null) => {
    if (!menuId) return '—';
    const m = menus.find(x => x.id === menuId);
    return m ? m.name : menuId.substring(0, 8);
  };

  // Count helpers for inline relational badges
  const itemCountForMenu = (menuId: string) => menuItems.filter(i => i.banquet_menu_id === menuId).length;
  const componentCountForPackage = (pkgId: string) => packageComponents.filter(c => c.package_id === pkgId).length;
  const prodMenuItemCountFor = (reqId: string) => productionMenuItems.filter(i => i.production_requirement_id === reqId).length;

  // Catalog menu item name lookup (for dropdown labels + table display)
  const catalogNameFor = (id: string | null) => {
    if (!id) return '—';
    const m = catalogMenuItems.find(x => x.id === id);
    return m ? m.name : id.substring(0, 8);
  };

  // Beverage package name lookup
  const packageNameFor = (id: string | null) => {
    if (!id) return '—';
    const p = packages.find(x => x.id === id);
    return p ? p.name : id.substring(0, 8);
  };
  const renderMenuItemSelect = (value: string | null, onChange: (v: string | null) => void) => (
    <select className={inputCls} value={value || ''} onChange={e => onChange(e.target.value || null)}>
      <option value="">— None —</option>
      {catalogMenuItems.map(mi => (
        <option key={mi.id} value={mi.id}>{mi.name}{mi.category ? ` (${mi.category})` : ''}</option>
      ))}
    </select>
  );

  // Sub-entity modal openers
  const openMenuItemsModal = (menu: BanquetMenu) => {
    setItemsModal({ kind: 'menu-items', parentId: menu.id, parentLabel: menu.name });
    setMenuItemForm(null); setMenuItemFormId(null);
  };
  const openComponentsModal = (pkg: BanquetPackage) => {
    setItemsModal({ kind: 'package-components', parentId: pkg.id, parentLabel: pkg.name });
    setComponentForm(null); setComponentFormId(null);
  };
  const openProdMenuItemsModal = (req: ProductionRequirement) => {
    setItemsModal({ kind: 'production-menu-items', parentId: req.id, parentLabel: req.preparation_area });
    setProdMenuItemForm(null); setProdMenuItemFormId(null);
  };

  const openPushPrice = (kind: 'menu' | 'package', id: string, label: string, price: number) => {
    setPushPriceTarget({ kind, id, label, price });
    setPushPriceOutlet('');
    setPushPriceDate(new Date().toISOString().slice(0, 10));
  };
  const openPushProd = (req: ProductionRequirement) => {
    setPushProdTarget({ id: req.id, label: req.preparation_area });
    setPushProdOutlet('');
    setPushProdDate(new Date().toISOString().slice(0, 10));
    setPushProdMealPeriod('Dinner');
    setPushProdCovers(req.staff_count || 0);
  };

  return (
    <div className={['accent-fb', layout.sectionStack].join(' ')}>
      <PageHeader
        title="Banquet F&B"
        subtitle="Manage menus, packages, and production requirements for banquet events"
        icon={UtensilsCrossed}
        actions={
          <div className="flex gap-2">
            <button onClick={() => fetchData()} className={button.secondary}>
              <Clock className="w-4 h-4" /> Refresh
            </button>
            {subTab === 'menus' && <button onClick={openCreateMenu} className={button.primary}><Plus className="w-4 h-4" /> New Menu</button>}
            {subTab === 'packages' && <button onClick={openCreatePackage} className={button.primary}><Plus className="w-4 h-4" /> New Package</button>}
            {subTab === 'production' && <button onClick={openCreateProduction} className={button.primary}><Plus className="w-4 h-4" /> New Requirement</button>}
            {subTab === 'beverages' && <button onClick={openCreateBeverage} className={button.primary}><Plus className="w-4 h-4" /> New Requirement</button>}
          </div>
        }
      />

      <div className="flex bg-slate-100 dark:bg-slate-800 p-1 rounded-xl overflow-x-auto">
        {SUB_TABS.map(t => (
          <button
            key={t.id}
            onClick={() => { setSubTab(t.id); setSearch(''); }}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-all whitespace-nowrap ${
              subTab === t.id
                ? 'bg-white dark:bg-slate-700 text-[var(--color-accent-banquet)] shadow-sm'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            <t.icon className="w-4 h-4" />
            <span className="text-sm font-medium">{t.label}</span>
          </button>
        ))}
      </div>

      {subTab !== 'production' && subTab !== 'beverages' && (
        <div className="relative max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search..."
            className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-gray-900 dark:text-white"
          />
        </div>
      )}

      {/* Event Menus */}
      {subTab === 'menus' && (
        <SectionCard>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 dark:bg-slate-900/40 text-left text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-6 py-3 font-medium">Menu</th>
                  <th className="px-6 py-3 font-medium">Type</th>
                  <th className="px-6 py-3 font-medium">Price/Person</th>
                  <th className="px-6 py-3 font-medium">Guest Range</th>
                  <th className="px-6 py-3 font-medium">Courses</th>
                  <th className="px-6 py-3 font-medium">Items</th>
                  <th className="px-6 py-3 font-medium">Status</th>
                  <th className="px-6 py-3 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-slate-700">
                {loading ? (
                  <tr><td colSpan={8} className="px-6 py-4 text-center text-slate-500">Loading...</td></tr>
                ) : filteredMenus.length === 0 ? (
                  <tr><td colSpan={8} className="px-6 py-4 text-center text-slate-500">No menus found</td></tr>
                ) : filteredMenus.map(m => (
                  <tr key={m.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/40">
                    <td className="px-6 py-3 font-medium text-gray-900 dark:text-white">
                      {m.name}
                      {m.description && <div className="text-xs text-slate-400 mt-0.5">{m.description}</div>}
                    </td>
                    <td className="px-6 py-3"><Badge tone={MENU_TYPE_TONE[m.menu_type]}>{m.menu_type}</Badge></td>
                    <td className="px-6 py-3 text-slate-600 dark:text-slate-400">{formatAmount(m.price_per_person)}</td>
                    <td className="px-6 py-3 text-slate-600 dark:text-slate-400">{m.min_guests} - {m.max_guests || 'Unlimited'}</td>
                    <td className="px-6 py-3 text-slate-600 dark:text-slate-400">{m.courses?.join(', ') || '—'}</td>
                    <td className="px-6 py-3">
                      <button onClick={() => openMenuItemsModal(m)} className="inline-flex items-center gap-1 text-[var(--color-accent-banquet)] hover:underline font-medium" title="View / manage menu items">
                        <ListTree className="w-3.5 h-3.5" />
                        {itemCountForMenu(m.id)}
                      </button>
                    </td>
                    <td className="px-6 py-3"><Badge tone={m.is_active ? 'success' : 'neutral'}>{m.is_active ? 'Active' : 'Inactive'}</Badge></td>
                    <td className="px-6 py-3 text-right">
                      <div className="inline-flex gap-2">
                        <button onClick={() => openMenuItemsModal(m)} className="p-1 text-slate-400 hover:text-[var(--color-accent-banquet)]" title="Manage items"><ListTree className="w-4 h-4" /></button>
                        <button onClick={() => openPushPrice('menu', m.id, m.name, Number(m.price_per_person))} className="p-1 text-slate-400 hover:text-[var(--color-success)]" title="Push to Price Lists"><DollarSign className="w-4 h-4" /></button>
                        <button onClick={() => openEditMenu(m)} className="p-1 text-slate-400 hover:text-[var(--color-accent-banquet)]" title="Edit"><Pencil className="w-4 h-4" /></button>
                        <button onClick={() => setDeleteTarget({ kind: 'menus', id: m.id, label: `Menu "${m.name}"` })} className="p-1 text-slate-400 hover:text-[var(--color-danger)]" title="Delete"><Trash2 className="w-4 h-4" /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </SectionCard>
      )}

      {/* Event Packages */}
      {subTab === 'packages' && (
        <SectionCard>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 dark:bg-slate-900/40 text-left text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-6 py-3 font-medium">Package</th>
                  <th className="px-6 py-3 font-medium">Type</th>
                  <th className="px-6 py-3 font-medium">Price/Person</th>
                  <th className="px-6 py-3 font-medium">Guest Range</th>
                  <th className="px-6 py-3 font-medium">Includes</th>
                  <th className="px-6 py-3 font-medium">Components</th>
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
                  <tr key={p.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/40">
                    <td className="px-6 py-3 font-medium text-gray-900 dark:text-white">
                      {p.name}
                      {p.description && <div className="text-xs text-slate-400 mt-0.5">{p.description}</div>}
                    </td>
                    <td className="px-6 py-3"><Badge tone={PACKAGE_TYPE_TONE[p.package_type]}>{p.package_type}</Badge></td>
                    <td className="px-6 py-3 text-slate-600 dark:text-slate-400">{formatAmount(p.price_per_person)}</td>
                    <td className="px-6 py-3 text-slate-600 dark:text-slate-400">{p.min_guests} - {p.max_guests || 'Unlimited'}</td>
                    <td className="px-6 py-3 text-slate-600 dark:text-slate-400">
                      {p.includes_food && <span className="mr-2">Food</span>}
                      {p.includes_beverage && <span className="mr-2">Beverage</span>}
                      {p.includes_service && <span>Service</span>}
                    </td>
                    <td className="px-6 py-3">
                      <button onClick={() => openComponentsModal(p)} className="inline-flex items-center gap-1 text-[var(--color-accent-banquet)] hover:underline font-medium" title="View / manage package components">
                        <ListTree className="w-3.5 h-3.5" />
                        {componentCountForPackage(p.id)}
                      </button>
                    </td>
                    <td className="px-6 py-3"><Badge tone={p.is_active ? 'success' : 'neutral'}>{p.is_active ? 'Active' : 'Inactive'}</Badge></td>
                    <td className="px-6 py-3 text-right">
                      <div className="inline-flex gap-2">
                        <button onClick={() => openComponentsModal(p)} className="p-1 text-slate-400 hover:text-[var(--color-accent-banquet)]" title="Manage components"><ListTree className="w-4 h-4" /></button>
                        <button onClick={() => openPushPrice('package', p.id, p.name, Number(p.price_per_person))} className="p-1 text-slate-400 hover:text-[var(--color-success)]" title="Push to Price Lists"><DollarSign className="w-4 h-4" /></button>
                        <button onClick={() => openEditPackage(p)} className="p-1 text-slate-400 hover:text-[var(--color-accent-banquet)]" title="Edit"><Pencil className="w-4 h-4" /></button>
                        <button onClick={() => setDeleteTarget({ kind: 'packages', id: p.id, label: `Package "${p.name}"` })} className="p-1 text-slate-400 hover:text-[var(--color-danger)]" title="Delete"><Trash2 className="w-4 h-4" /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </SectionCard>
      )}

      {/* Production Requirements */}
      {subTab === 'production' && (
        <SectionCard>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 dark:bg-slate-900/40 text-left text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-6 py-3 font-medium">Event ID</th>
                  <th className="px-6 py-3 font-medium">Menu</th>
                  <th className="px-6 py-3 font-medium">Preparation Area</th>
                  <th className="px-6 py-3 font-medium">Staff</th>
                  <th className="px-6 py-3 font-medium">Prep Time</th>
                  <th className="px-6 py-3 font-medium">Menu Items</th>
                  <th className="px-6 py-3 font-medium">Instructions</th>
                  <th className="px-6 py-3 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-slate-700">
                {loading ? (
                  <tr><td colSpan={8} className="px-6 py-4 text-center text-slate-500">Loading...</td></tr>
                ) : productionReqs.length === 0 ? (
                  <tr><td colSpan={8} className="px-6 py-4 text-center text-slate-500">No production requirements found</td></tr>
                ) : productionReqs.map(r => (
                  <tr key={r.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/40">
                    <td className="px-6 py-3 text-slate-600 dark:text-slate-400">{r.banquet_event_id || '—'}</td>
                    <td className="px-6 py-3 text-slate-600 dark:text-slate-400">{menuNameFor(r.menu_id)}</td>
                    <td className="px-6 py-3 text-slate-600 dark:text-slate-400">{r.preparation_area}</td>
                    <td className="px-6 py-3 text-slate-600 dark:text-slate-400">{r.staff_count}</td>
                    <td className="px-6 py-3 text-slate-600 dark:text-slate-400">{r.prep_start_hours_before}h before ({r.prep_duration_minutes}m)</td>
                    <td className="px-6 py-3">
                      <button onClick={() => openProdMenuItemsModal(r)} className="inline-flex items-center gap-1 text-[var(--color-accent-banquet)] hover:underline font-medium" title="View / manage production menu items">
                        <ListTree className="w-3.5 h-3.5" />
                        {prodMenuItemCountFor(r.id)}
                      </button>
                    </td>
                    <td className="px-6 py-3 text-slate-600 dark:text-slate-400 max-w-xs truncate" title={r.special_instructions || ''}>{r.special_instructions || '—'}</td>
                    <td className="px-6 py-3 text-right">
                      <div className="inline-flex gap-2">
                        <button onClick={() => openProdMenuItemsModal(r)} className="p-1 text-slate-400 hover:text-[var(--color-accent-banquet)]" title="Manage menu items"><ListTree className="w-4 h-4" /></button>
                        <button onClick={() => openPushProd(r)} className="p-1 text-slate-400 hover:text-[var(--color-accent-operations)]" title="Push to Production Coordination"><Send className="w-4 h-4" /></button>
                        <button onClick={() => openEditProduction(r)} className="p-1 text-slate-400 hover:text-[var(--color-accent-banquet)]" title="Edit"><Pencil className="w-4 h-4" /></button>
                        <button onClick={() => setDeleteTarget({ kind: 'production', id: r.id, label: `Production requirement (${r.preparation_area})` })} className="p-1 text-slate-400 hover:text-[var(--color-danger)]" title="Delete"><Trash2 className="w-4 h-4" /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </SectionCard>
      )}

      {/* Beverage Requirements */}
      {subTab === 'beverages' && (
        <SectionCard>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 dark:bg-slate-900/40 text-left text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-6 py-3 font-medium">Event ID</th>
                  <th className="px-6 py-3 font-medium">Bar Setup</th>
                  <th className="px-6 py-3 font-medium">Package</th>
                  <th className="px-6 py-3 font-medium">Bartenders</th>
                  <th className="px-6 py-3 font-medium">Start Before</th>
                  <th className="px-6 py-3 font-medium">Special Drinks</th>
                  <th className="px-6 py-3 font-medium">Glassware</th>
                  <th className="px-6 py-3 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-slate-700">
                {loading ? (
                  <tr><td colSpan={8} className="px-6 py-4 text-center text-slate-500">Loading...</td></tr>
                ) : beverageReqs.length === 0 ? (
                  <tr><td colSpan={8} className="px-6 py-4 text-center text-slate-500">No beverage requirements found</td></tr>
                ) : beverageReqs.map(r => {
                  const glasswareTotal = r.glassware_needed ? Object.values(r.glassware_needed).reduce((a, b) => a + b, 0) : 0;
                  return (
                  <tr key={r.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/40">
                    <td className="px-6 py-3 text-slate-600 dark:text-slate-400">{r.banquet_event_id || '—'}</td>
                    <td className="px-6 py-3"><Badge tone={r.bar_setup_type === 'Full Bar' ? 'success' : r.bar_setup_type === 'Signature Cocktails' ? 'accent' : r.bar_setup_type === 'Non-Alcoholic' ? 'info' : 'neutral'}>{r.bar_setup_type}</Badge></td>
                    <td className="px-6 py-3 text-slate-600 dark:text-slate-400">{packageNameFor(r.beverage_package_id)}</td>
                    <td className="px-6 py-3 text-slate-600 dark:text-slate-400">{r.bartender_count}</td>
                    <td className="px-6 py-3 text-slate-600 dark:text-slate-400">{r.bar_start_hours_before}h before</td>
                    <td className="px-6 py-3 text-slate-600 dark:text-slate-400 max-w-xs">
                      {r.special_drinks && r.special_drinks.length > 0 ? (
                        <div>
                          <span className="font-medium">{r.special_drinks.length} drinks</span>
                          <div className="text-xs text-slate-400 mt-0.5 truncate" title={r.special_drinks.map(d => `${d.name} (x${d.qty})`).join(', ')}>
                            {r.special_drinks.map(d => `${d.name} (x${d.qty})`).join(', ')}
                          </div>
                        </div>
                      ) : '—'}
                    </td>
                    <td className="px-6 py-3 text-slate-600 dark:text-slate-400">
                      {glasswareTotal > 0 ? <span>{glasswareTotal} pcs</span> : '—'}
                    </td>
                    <td className="px-6 py-3 text-right">
                      <div className="inline-flex gap-2">
                        <button onClick={() => openEditBeverage(r)} className="p-1 text-slate-400 hover:text-[var(--color-accent-banquet)]" title="Edit"><Pencil className="w-4 h-4" /></button>
                        <button onClick={() => setDeleteTarget({ kind: 'beverages', id: r.id, label: `Beverage requirement (${r.bar_setup_type})` })} className="p-1 text-slate-400 hover:text-[var(--color-danger)]" title="Delete"><Trash2 className="w-4 h-4" /></button>
                      </div>
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </SectionCard>
      )}

      {/* ── Menu Form Modal ─────────────────────────────────────── */}
      <ModalSystem
        isOpen={!!menuForm}
        onClose={() => { setMenuForm(null); setMenuFormId(null); }}
        title={menuFormId ? 'Edit Event Menu' : 'New Event Menu'}
        subtitle={menuFormId ? 'Update banquet menu details' : 'Create a new banquet menu'}
        variant="form"
        size="lg"
        loading={saving}
        showFooter={false}
      >
        {menuForm && (
          <div className="space-y-4">
            <Field label="Menu Name *">
              <input className={inputCls} value={menuForm.name} onChange={e => setMenuForm({ ...menuForm, name: e.target.value })} placeholder="e.g. Classic Wedding Menu" />
            </Field>
            <Field label="Description">
              <textarea className={inputCls} rows={2} value={menuForm.description || ''} onChange={e => setMenuForm({ ...menuForm, description: e.target.value })} placeholder="Short description of the menu" />
            </Field>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Menu Type *">
                <select className={inputCls} value={menuForm.menu_type} onChange={e => setMenuForm({ ...menuForm, menu_type: e.target.value as BanquetMenu['menu_type'] })}>
                  {MENU_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </Field>
              <Field label="Price / Person *">
                <input type="number" min={0} step="0.01" className={inputCls} value={menuForm.price_per_person} onChange={e => setMenuForm({ ...menuForm, price_per_person: Number(e.target.value) })} />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Min Guests *">
                <input type="number" min={1} className={inputCls} value={menuForm.min_guests} onChange={e => setMenuForm({ ...menuForm, min_guests: Number(e.target.value) })} />
              </Field>
              <Field label="Max Guests (blank = unlimited)">
                <input type="number" min={0} className={inputCls} value={menuForm.max_guests ?? ''} onChange={e => setMenuForm({ ...menuForm, max_guests: e.target.value ? Number(e.target.value) : null })} />
              </Field>
            </div>
            <Field label="Courses (comma-separated)">
              <input className={inputCls} value={(menuForm.courses || []).join(', ')} onChange={e => setMenuForm({ ...menuForm, courses: e.target.value.split(',').map(s => s.trim()).filter(Boolean) })} placeholder="Appetizers, Main Course, Dessert" />
            </Field>
            <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
              <input type="checkbox" checked={menuForm.is_active} onChange={e => setMenuForm({ ...menuForm, is_active: e.target.checked })} />
              Active
            </label>
            <div className="pt-4 flex gap-3">
              <button onClick={() => { setMenuForm(null); setMenuFormId(null); }} className={button.secondary}>Cancel</button>
              <button onClick={handleSaveMenu} disabled={saving || !menuForm.name.trim()} className={button.primary}>
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                {menuFormId ? 'Save Changes' : 'Create Menu'}
              </button>
            </div>
          </div>
        )}
      </ModalSystem>

      {/* ── Package Form Modal ──────────────────────────────────── */}
      <ModalSystem
        isOpen={!!packageForm}
        onClose={() => { setPackageForm(null); setPackageFormId(null); }}
        title={packageFormId ? 'Edit Event Package' : 'New Event Package'}
        subtitle={packageFormId ? 'Update banquet package details' : 'Create a new banquet package'}
        variant="form"
        size="lg"
        loading={saving}
        showFooter={false}
      >
        {packageForm && (
          <div className="space-y-4">
            <Field label="Package Name *">
              <input className={inputCls} value={packageForm.name} onChange={e => setPackageForm({ ...packageForm, name: e.target.value })} placeholder="e.g. All-Inclusive Wedding Package" />
            </Field>
            <Field label="Description">
              <textarea className={inputCls} rows={2} value={packageForm.description || ''} onChange={e => setPackageForm({ ...packageForm, description: e.target.value })} placeholder="Short description of the package" />
            </Field>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Package Type *">
                <select className={inputCls} value={packageForm.package_type} onChange={e => setPackageForm({ ...packageForm, package_type: e.target.value as BanquetPackage['package_type'] })}>
                  {PACKAGE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </Field>
              <Field label="Price / Person *">
                <input type="number" min={0} step="0.01" className={inputCls} value={packageForm.price_per_person} onChange={e => setPackageForm({ ...packageForm, price_per_person: Number(e.target.value) })} />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Min Guests *">
                <input type="number" min={1} className={inputCls} value={packageForm.min_guests} onChange={e => setPackageForm({ ...packageForm, min_guests: Number(e.target.value) })} />
              </Field>
              <Field label="Max Guests (blank = unlimited)">
                <input type="number" min={0} className={inputCls} value={packageForm.max_guests ?? ''} onChange={e => setPackageForm({ ...packageForm, max_guests: e.target.value ? Number(e.target.value) : null })} />
              </Field>
            </div>
            <div className="flex flex-wrap gap-4">
              <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
                <input type="checkbox" checked={packageForm.includes_food} onChange={e => setPackageForm({ ...packageForm, includes_food: e.target.checked })} />
                Includes Food
              </label>
              <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
                <input type="checkbox" checked={packageForm.includes_beverage} onChange={e => setPackageForm({ ...packageForm, includes_beverage: e.target.checked })} />
                Includes Beverage
              </label>
              <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
                <input type="checkbox" checked={packageForm.includes_service} onChange={e => setPackageForm({ ...packageForm, includes_service: e.target.checked })} />
                Includes Service
              </label>
              <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
                <input type="checkbox" checked={packageForm.is_active} onChange={e => setPackageForm({ ...packageForm, is_active: e.target.checked })} />
                Active
              </label>
            </div>
            <Field label={'Inclusions (JSON, e.g. decor / setup / staff / linens)'}>
              <textarea
                className={inputCls}
                rows={3}
                value={JSON.stringify(packageForm.inclusions || {}, null, 2)}
                onChange={e => {
                  try { setPackageForm({ ...packageForm, inclusions: JSON.parse(e.target.value) }); }
                  catch { /* ignore invalid JSON while typing */ }
                }}
                placeholder={'{"decor": true, "setup": true, "staff": true}'}
              />
            </Field>
            <div className="pt-4 flex gap-3">
              <button onClick={() => { setPackageForm(null); setPackageFormId(null); }} className={button.secondary}>Cancel</button>
              <button onClick={handleSavePackage} disabled={saving || !packageForm.name.trim()} className={button.primary}>
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                {packageFormId ? 'Save Changes' : 'Create Package'}
              </button>
            </div>
          </div>
        )}
      </ModalSystem>

      {/* ── Production Requirement Form Modal ───────────────────── */}
      <ModalSystem
        isOpen={!!prodForm}
        onClose={() => { setProdForm(null); setProdFormId(null); }}
        title={prodFormId ? 'Edit Production Requirement' : 'New Production Requirement'}
        subtitle={prodFormId ? 'Update production requirement details' : 'Create a new production requirement'}
        variant="form"
        size="lg"
        loading={saving}
        showFooter={false}
      >
        {prodForm && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <Field label="Banquet Event ID (optional)">
                <input className={inputCls} value={prodForm.banquet_event_id || ''} onChange={e => setProdForm({ ...prodForm, banquet_event_id: e.target.value || null })} placeholder="Event reference" />
              </Field>
              <Field label="Menu (optional)">
                <select className={inputCls} value={prodForm.menu_id || ''} onChange={e => setProdForm({ ...prodForm, menu_id: e.target.value || null })}>
                  <option value="">— None —</option>
                  {menus.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                </select>
              </Field>
            </div>
            <Field label="Preparation Area *">
              <input className={inputCls} value={prodForm.preparation_area} onChange={e => setProdForm({ ...prodForm, preparation_area: e.target.value })} placeholder="e.g. Main Kitchen, Pastry Section" />
            </Field>
            <div className="grid grid-cols-3 gap-4">
              <Field label="Prep Start (h before)">
                <input type="number" min={0} className={inputCls} value={prodForm.prep_start_hours_before} onChange={e => setProdForm({ ...prodForm, prep_start_hours_before: Number(e.target.value) })} />
              </Field>
              <Field label="Prep Duration (min)">
                <input type="number" min={0} className={inputCls} value={prodForm.prep_duration_minutes} onChange={e => setProdForm({ ...prodForm, prep_duration_minutes: Number(e.target.value) })} />
              </Field>
              <Field label="Staff Count">
                <input type="number" min={0} className={inputCls} value={prodForm.staff_count} onChange={e => setProdForm({ ...prodForm, staff_count: Number(e.target.value) })} />
              </Field>
            </div>
            <Field label={'Equipment Needed (JSON, e.g. {"oven": 4, "grill": 2})'}>
              <textarea
                className={inputCls}
                rows={3}
                value={JSON.stringify(prodForm.equipment_needed || {}, null, 2)}
                onChange={e => {
                  try { setProdForm({ ...prodForm, equipment_needed: JSON.parse(e.target.value) }); }
                  catch { /* ignore invalid JSON while typing */ }
                }}
                placeholder={'{"oven": 4, "steam_table": 2}'}
              />
            </Field>
            <Field label="Special Instructions">
              <textarea className={inputCls} rows={3} value={prodForm.special_instructions || ''} onChange={e => setProdForm({ ...prodForm, special_instructions: e.target.value })} placeholder="Notes for the kitchen team..." />
            </Field>
            <div className="pt-4 flex gap-3">
              <button onClick={() => { setProdForm(null); setProdFormId(null); }} className={button.secondary}>Cancel</button>
              <button onClick={handleSaveProduction} disabled={saving || !prodForm.preparation_area.trim()} className={button.primary}>
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                {prodFormId ? 'Save Changes' : 'Create Requirement'}
              </button>
            </div>
          </div>
        )}
      </ModalSystem>

      {/* ── Beverage Requirement Form Modal ─────────────────────── */}
      <ModalSystem
        isOpen={!!bevForm}
        onClose={() => { setBevForm(null); setBevFormId(null); }}
        title={bevFormId ? 'Edit Beverage Requirement' : 'New Beverage Requirement'}
        subtitle={bevFormId ? 'Update beverage requirement details' : 'Create a new beverage requirement'}
        variant="form"
        size="lg"
        loading={saving}
        showFooter={false}
      >
        {bevForm && (
          <div className="space-y-4">
            {/* Beverage catalog suggestions datalist (used by special drinks name inputs) */}
            <datalist id="beverage-catalog-list">
              {catalogMenuItems
                .filter(mi => {
                  const c = (mi.category || '').toLowerCase();
                  return c === 'beer' || c === 'cocktail' || c === 'wine' || c === 'spirit'
                    || c === 'coffee' || c === 'tea' || c === 'juice' || c === 'soda'
                    || c === 'water' || c === 'drink' || c === 'beverage';
                })
                .map(mi => <option key={mi.id} value={mi.name}>{mi.category}</option>)}
            </datalist>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Banquet Event ID (optional)">
                <input className={inputCls} value={bevForm.banquet_event_id || ''} onChange={e => setBevForm({ ...bevForm, banquet_event_id: e.target.value || null })} placeholder="Event reference" />
              </Field>
              <Field label="Beverage Package (optional)">
                <select className={inputCls} value={bevForm.beverage_package_id || ''} onChange={e => setBevForm({ ...bevForm, beverage_package_id: e.target.value || null })}>
                  <option value="">— None —</option>
                  {packages.map(p => <option key={p.id} value={p.id}>{p.name} ({p.package_type})</option>)}
                </select>
              </Field>
            </div>
            <Field label="Bar Setup Type *">
              <select className={inputCls} value={bevForm.bar_setup_type} onChange={e => setBevForm({ ...bevForm, bar_setup_type: e.target.value as BeverageRequirement['bar_setup_type'] })}>
                {BAR_SETUP_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </Field>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Bartender Count">
                <input type="number" min={0} className={inputCls} value={bevForm.bartender_count} onChange={e => setBevForm({ ...bevForm, bartender_count: Number(e.target.value) })} />
              </Field>
              <Field label="Bar Start (h before)">
                <input type="number" min={0} className={inputCls} value={bevForm.bar_start_hours_before} onChange={e => setBevForm({ ...bevForm, bar_start_hours_before: Number(e.target.value) })} />
              </Field>
            </div>

            {/* Special Drinks — editable list */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className={labelCls + ' mb-0'}>Special Drinks</label>
                <button
                  onClick={() => setBevForm({ ...bevForm, special_drinks: [...(bevForm.special_drinks || []), { name: '', qty: 0 }] })}
                  className="inline-flex items-center gap-1 text-xs text-[var(--color-accent-banquet)] hover:underline font-medium"
                >
                  <Plus className="w-3.5 h-3.5" /> Add Drink
                </button>
              </div>
              {(bevForm.special_drinks || []).length === 0 ? (
                <p className="text-xs text-slate-400 italic py-2">No special drinks added. Click "Add Drink" to add one.</p>
              ) : (
                <div className="space-y-2">
                  {(bevForm.special_drinks || []).map((d, idx) => (
                    <div key={idx} className="flex items-center gap-2">
                      <input
                        className={inputCls + ' flex-1'}
                        value={d.name || ''}
                        onChange={e => {
                          const next = [...(bevForm.special_drinks || [])];
                          next[idx] = { ...next[idx], name: e.target.value };
                          setBevForm({ ...bevForm, special_drinks: next });
                        }}
                        placeholder="Drink name (e.g. Margarita)"
                        list="beverage-catalog-list"
                      />
                      <input
                        type="number"
                        min={0}
                        className={inputCls + ' w-28'}
                        value={d.qty || 0}
                        onChange={e => {
                          const next = [...(bevForm.special_drinks || [])];
                          next[idx] = { ...next[idx], qty: Number(e.target.value) };
                          setBevForm({ ...bevForm, special_drinks: next });
                        }}
                        placeholder="Qty"
                      />
                      <span className="text-xs text-slate-400">pcs</span>
                      <button
                        onClick={() => setBevForm({ ...bevForm, special_drinks: (bevForm.special_drinks || []).filter((_, i) => i !== idx) })}
                        className="p-1 text-slate-400 hover:text-[var(--color-danger)]"
                        title="Remove"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Glassware Needed — editable list */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className={labelCls + ' mb-0'}>Glassware Needed</label>
                <button
                  onClick={() => setBevForm({ ...bevForm, glassware_needed: { ...(bevForm.glassware_needed || {}), '': 0 } })}
                  className="inline-flex items-center gap-1 text-xs text-[var(--color-accent-banquet)] hover:underline font-medium"
                >
                  <Plus className="w-3.5 h-3.5" /> Add Glassware
                </button>
              </div>
              {bevForm.glassware_needed && Object.keys(bevForm.glassware_needed).length > 0 ? (
                <div className="space-y-2">
                  {Object.entries(bevForm.glassware_needed).map(([key, qty], idx) => (
                    <div key={idx} className="flex items-center gap-2">
                      <input
                        className={inputCls + ' flex-1'}
                        value={key}
                        onChange={e => {
                          const entries = Object.entries(bevForm.glassware_needed || {});
                          entries[idx] = [e.target.value, qty];
                          setBevForm({ ...bevForm, glassware_needed: Object.fromEntries(entries) });
                        }}
                        placeholder="Glass type (e.g. wine_glass)"
                      />
                      <input
                        type="number"
                        min={0}
                        className={inputCls + ' w-28'}
                        value={qty}
                        onChange={e => {
                          const entries = Object.entries(bevForm.glassware_needed || {});
                          entries[idx] = [key, Number(e.target.value)];
                          setBevForm({ ...bevForm, glassware_needed: Object.fromEntries(entries) });
                        }}
                        placeholder="Qty"
                      />
                      <span className="text-xs text-slate-400">pcs</span>
                      <button
                        onClick={() => {
                          const entries = Object.entries(bevForm.glassware_needed || {}).filter((_, i) => i !== idx);
                          setBevForm({ ...bevForm, glassware_needed: Object.fromEntries(entries) });
                        }}
                        className="p-1 text-slate-400 hover:text-[var(--color-danger)]"
                        title="Remove"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-slate-400 italic py-2">No glassware specified. Click "Add Glassware" to add one.</p>
              )}
            </div>

            <div className="pt-4 flex gap-3">
              <button onClick={() => { setBevForm(null); setBevFormId(null); }} className={button.secondary}>Cancel</button>
              <button onClick={handleSaveBeverage} disabled={saving} className={button.primary}>
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                {bevFormId ? 'Save Changes' : 'Create Requirement'}
              </button>
            </div>
          </div>
        )}
      </ModalSystem>

      {/* ── Delete Confirmation Modal ───────────────────────────── */}
      <ModalSystem
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        title="Confirm Delete"
        subtitle={deleteTarget?.label}
        variant="confirm"
        size="sm"
        loading={saving}
        confirmLabel="Delete"
        confirmColor="rose"
        onConfirm={confirmDelete}
      >
        <div className="flex items-start gap-3 text-sm text-slate-600 dark:text-slate-300">
          <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
          <p>
            Are you sure you want to permanently delete <span className="font-semibold">{deleteTarget?.label}</span>?
            This action cannot be undone.
          </p>
        </div>
      </ModalSystem>

      {/* ── Sub-entity Delete Confirmation Modal ────────────────── */}
      <ModalSystem
        isOpen={!!subDeleteTarget}
        onClose={() => setSubDeleteTarget(null)}
        title="Confirm Delete"
        subtitle={subDeleteTarget?.label}
        variant="confirm"
        size="sm"
        loading={saving}
        confirmLabel="Delete"
        confirmColor="rose"
        onConfirm={confirmSubDelete}
      >
        <div className="flex items-start gap-3 text-sm text-slate-600 dark:text-slate-300">
          <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
          <p>Permanently delete <span className="font-semibold">{subDeleteTarget?.label}</span>?</p>
        </div>
      </ModalSystem>

      {/* ── Menu Items Sub-Modal (fb_banquet_menu_items) ────────── */}
      <ModalSystem
        isOpen={!!itemsModal && itemsModal.kind === 'menu-items'}
        onClose={() => { setItemsModal(null); setMenuItemForm(null); setMenuItemFormId(null); }}
        title="Menu Items"
        subtitle={itemsModal?.parentLabel ? `Courses & items for: ${itemsModal.parentLabel}` : ''}
        variant="form"
        size="lg"
        loading={saving}
        showFooter={false}
      >
        {itemsModal && itemsModal.kind === 'menu-items' && (
          <div className="space-y-4">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 dark:bg-slate-900/40 text-left text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-3 py-2 font-medium">Course</th>
                    <th className="px-3 py-2 font-medium">Seq</th>
                    <th className="px-3 py-2 font-medium">Qty/Person</th>
                    <th className="px-3 py-2 font-medium">Optional</th>
                    <th className="px-3 py-2 font-medium text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 dark:divide-slate-700">
                  {menuItems.filter(i => i.banquet_menu_id === itemsModal.parentId).length === 0 ? (
                    <tr><td colSpan={5} className="px-3 py-4 text-center text-slate-500">No menu items yet</td></tr>
                  ) : menuItems.filter(i => i.banquet_menu_id === itemsModal.parentId).sort((a, b) => a.sequence - b.sequence).map(i => (
                    <tr key={i.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/40">
                      <td className="px-3 py-2 font-medium text-gray-900 dark:text-white">
                        {i.course}
                        {i.is_optional && (i.options?.length || 0) > 0 && (
                          <div className="text-xs text-amber-600 dark:text-amber-400 mt-0.5">
                            {i.options!.length} options: {i.options!.map(id => catalogNameFor(id)).join(', ')}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2 text-slate-600 dark:text-slate-400">{i.sequence}</td>
                      <td className="px-3 py-2 text-slate-600 dark:text-slate-400">{i.quantity_per_person}</td>
                      <td className="px-3 py-2"><Badge tone={i.is_optional ? 'warning' : 'neutral'}>{i.is_optional ? `Yes (${i.options?.length || 0})` : 'No'}</Badge></td>
                      <td className="px-3 py-2 text-right">
                        <div className="inline-flex gap-2">
                          <button onClick={() => { setMenuItemForm({ menu_item_id: i.menu_item_id, course: i.course, sequence: i.sequence, quantity_per_person: i.quantity_per_person, is_optional: i.is_optional, options: i.options || [] }); setMenuItemFormId(i.id); }} className="p-1 text-slate-400 hover:text-[var(--color-accent-banquet)]" title="Edit"><Pencil className="w-4 h-4" /></button>
                          <button onClick={() => setSubDeleteTarget({ kind: 'menu-items', id: i.id, label: `Menu item "${i.course}"` })} className="p-1 text-slate-400 hover:text-[var(--color-danger)]" title="Delete"><Trash2 className="w-4 h-4" /></button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {menuItemForm ? (
              <div className="p-4 rounded-xl border border-gray-200 dark:border-slate-700 space-y-3">
                <h4 className="text-sm font-semibold text-gray-900 dark:text-white">{menuItemFormId ? 'Edit Menu Item' : 'Add Menu Item'}</h4>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Course *">
                    <input className={inputCls} value={menuItemForm.course} onChange={e => setMenuItemForm({ ...menuItemForm, course: e.target.value })} placeholder="e.g. Appetizers" />
                  </Field>
                  <Field label="Menu Item (optional)">
                    {renderMenuItemSelect(menuItemForm.menu_item_id, v => setMenuItemForm({ ...menuItemForm, menu_item_id: v }))}
                  </Field>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Sequence">
                    <input type="number" min={0} className={inputCls} value={menuItemForm.sequence} onChange={e => setMenuItemForm({ ...menuItemForm, sequence: Number(e.target.value) })} />
                  </Field>
                  <Field label="Qty / Person">
                    <input type="number" min={0} step="0.01" className={inputCls} value={menuItemForm.quantity_per_person} onChange={e => setMenuItemForm({ ...menuItemForm, quantity_per_person: Number(e.target.value) })} />
                  </Field>
                </div>
                <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
                  <input type="checkbox" checked={menuItemForm.is_optional} onChange={e => setMenuItemForm({ ...menuItemForm, is_optional: e.target.checked, options: e.target.checked ? (menuItemForm.options || []) : [] })} />
                  Optional course (guest chooses from options)
                </label>
                {menuItemForm.is_optional && (
                  <div className="p-3 rounded-xl border border-amber-200 dark:border-amber-900/40 bg-amber-50/50 dark:bg-amber-900/10 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className={labelCls + ' mb-0'}>Course Options * (pick at least 2)</span>
                      <span className="text-xs text-slate-500">{(menuItemForm.options || []).length} selected</span>
                    </div>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      These are the alternative dishes the guest can choose from for this course.
                    </p>
                    <div className="max-h-48 overflow-y-auto rounded-lg border border-gray-200 dark:border-slate-700 divide-y divide-gray-100 dark:divide-slate-700">
                      {catalogMenuItems.map(mi => {
                        const selected = (menuItemForm.options || []).includes(mi.id);
                        return (
                          <label key={mi.id} className="flex items-center gap-2 px-3 py-2 text-sm text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700/40 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={selected}
                              onChange={e => {
                                const cur = menuItemForm.options || [];
                                setMenuItemForm({
                                  ...menuItemForm,
                                  options: e.target.checked ? [...cur, mi.id] : cur.filter(x => x !== mi.id),
                                  menu_item_id: e.target.checked && !menuItemForm.menu_item_id ? mi.id : menuItemForm.menu_item_id,
                                });
                              }}
                            />
                            <span className="font-medium">{mi.name}</span>
                            {mi.category && <span className="text-xs text-slate-400">({mi.category})</span>}
                          </label>
                        );
                      })}
                    </div>
                    {(menuItemForm.options || []).length > 0 && (
                      <div className="flex flex-wrap gap-1.5 pt-1">
                        {(menuItemForm.options || []).map(id => {
                          const mi = catalogMenuItems.find(x => x.id === id);
                          return (
                            <span key={id} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/30 text-amber-800 dark:text-amber-300 text-xs font-medium">
                              {mi?.name || id.substring(0, 8)}
                              <button
                                onClick={() => setMenuItemForm({ ...menuItemForm, options: (menuItemForm.options || []).filter(x => x !== id) })}
                                className="hover:text-amber-900 dark:hover:text-amber-100"
                                title="Remove"
                              >
                                <X className="w-3 h-3" />
                              </button>
                            </span>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
                <div className="flex gap-3">
                  <button onClick={() => { setMenuItemForm(null); setMenuItemFormId(null); }} className={button.secondary}>Cancel</button>
                  <button onClick={handleSaveMenuItem} disabled={saving || !menuItemForm.course.trim()} className={button.primary}>
                    {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                    {menuItemFormId ? 'Save' : 'Add'}
                  </button>
                </div>
              </div>
            ) : (
              <button onClick={() => setMenuItemForm({ menu_item_id: null, course: '', sequence: 1, quantity_per_person: 1, is_optional: false, options: [] })} className={button.secondary}>
                <Plus className="w-4 h-4" /> Add Menu Item
              </button>
            )}
          </div>
        )}
      </ModalSystem>

      {/* ── Package Components Sub-Modal (fb_banquet_package_components) ── */}
      <ModalSystem
        isOpen={!!itemsModal && itemsModal.kind === 'package-components'}
        onClose={() => { setItemsModal(null); setComponentForm(null); setComponentFormId(null); }}
        title="Package Components"
        subtitle={itemsModal?.parentLabel ? `Components for: ${itemsModal.parentLabel}` : ''}
        variant="form"
        size="lg"
        loading={saving}
        showFooter={false}
      >
        {itemsModal && itemsModal.kind === 'package-components' && (
          <div className="space-y-4">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 dark:bg-slate-900/40 text-left text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-3 py-2 font-medium">Component Type</th>
                    <th className="px-3 py-2 font-medium">Qty/Person</th>
                    <th className="px-3 py-2 font-medium text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 dark:divide-slate-700">
                  {packageComponents.filter(c => c.package_id === itemsModal.parentId).length === 0 ? (
                    <tr><td colSpan={3} className="px-3 py-4 text-center text-slate-500">No components yet</td></tr>
                  ) : packageComponents.filter(c => c.package_id === itemsModal.parentId).map(c => (
                    <tr key={c.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/40">
                      <td className="px-3 py-2 font-medium text-gray-900 dark:text-white"><Badge tone={c.component_type === 'Food' ? 'warning' : c.component_type === 'Beverage' ? 'accent' : c.component_type === 'Service' ? 'info' : 'neutral'}>{c.component_type}</Badge></td>
                      <td className="px-3 py-2 text-slate-600 dark:text-slate-400">{c.quantity_per_person}</td>
                      <td className="px-3 py-2 text-right">
                        <div className="inline-flex gap-2">
                          <button onClick={() => { setComponentForm({ menu_item_id: c.menu_item_id, component_type: c.component_type, quantity_per_person: c.quantity_per_person }); setComponentFormId(c.id); }} className="p-1 text-slate-400 hover:text-[var(--color-accent-banquet)]" title="Edit"><Pencil className="w-4 h-4" /></button>
                          <button onClick={() => setSubDeleteTarget({ kind: 'package-components', id: c.id, label: `${c.component_type} component` })} className="p-1 text-slate-400 hover:text-[var(--color-danger)]" title="Delete"><Trash2 className="w-4 h-4" /></button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {componentForm ? (
              <div className="p-4 rounded-xl border border-gray-200 dark:border-slate-700 space-y-3">
                <h4 className="text-sm font-semibold text-gray-900 dark:text-white">{componentFormId ? 'Edit Component' : 'Add Component'}</h4>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Component Type *">
                    <select className={inputCls} value={componentForm.component_type} onChange={e => setComponentForm({ ...componentForm, component_type: e.target.value as BanquetPackageComponent['component_type'] })}>
                      {COMPONENT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </Field>
                  <Field label="Qty / Person">
                    <input type="number" min={0} step="0.01" className={inputCls} value={componentForm.quantity_per_person} onChange={e => setComponentForm({ ...componentForm, quantity_per_person: Number(e.target.value) })} />
                  </Field>
                </div>
                <Field label="Menu Item (optional)">
                  {renderMenuItemSelect(componentForm.menu_item_id, v => setComponentForm({ ...componentForm, menu_item_id: v }))}
                </Field>
                <div className="flex gap-3">
                  <button onClick={() => { setComponentForm(null); setComponentFormId(null); }} className={button.secondary}>Cancel</button>
                  <button onClick={handleSaveComponent} disabled={saving} className={button.primary}>
                    {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                    {componentFormId ? 'Save' : 'Add'}
                  </button>
                </div>
              </div>
            ) : (
              <button onClick={() => setComponentForm({ menu_item_id: null, component_type: 'Food', quantity_per_person: 1 })} className={button.secondary}>
                <Plus className="w-4 h-4" /> Add Component
              </button>
            )}
          </div>
        )}
      </ModalSystem>

      {/* ── Production Menu Items Sub-Modal (fb_banquet_production_menu_items) ── */}
      <ModalSystem
        isOpen={!!itemsModal && itemsModal.kind === 'production-menu-items'}
        onClose={() => { setItemsModal(null); setProdMenuItemForm(null); setProdMenuItemFormId(null); }}
        title="Production Menu Items"
        subtitle={itemsModal?.parentLabel ? `Menu items to produce for: ${itemsModal.parentLabel}` : ''}
        variant="form"
        size="lg"
        loading={saving}
        showFooter={false}
      >
        {itemsModal && itemsModal.kind === 'production-menu-items' && (
          <div className="space-y-4">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 dark:bg-slate-900/40 text-left text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-3 py-2 font-medium">Menu Item</th>
                    <th className="px-3 py-2 font-medium">Qty/Guest</th>
                    <th className="px-3 py-2 font-medium">Total Qty</th>
                    <th className="px-3 py-2 font-medium">Prep Status</th>
                    <th className="px-3 py-2 font-medium text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 dark:divide-slate-700">
                  {productionMenuItems.filter(i => i.production_requirement_id === itemsModal.parentId).length === 0 ? (
                    <tr><td colSpan={5} className="px-3 py-4 text-center text-slate-500">No production menu items yet</td></tr>
                  ) : productionMenuItems.filter(i => i.production_requirement_id === itemsModal.parentId).map(i => (
                    <tr key={i.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/40">
                      <td className="px-3 py-2 text-slate-600 dark:text-slate-400">{catalogNameFor(i.menu_item_id)}</td>
                      <td className="px-3 py-2 text-slate-600 dark:text-slate-400">{i.quantity_per_guest}</td>
                      <td className="px-3 py-2 text-slate-600 dark:text-slate-400">{i.total_quantity}</td>
                      <td className="px-3 py-2"><Badge tone={PREP_STATUS_TONE[i.prep_status]}>{i.prep_status}</Badge></td>
                      <td className="px-3 py-2 text-right">
                        <div className="inline-flex gap-2">
                          <button onClick={() => { setProdMenuItemForm({ menu_item_id: i.menu_item_id, quantity_per_guest: i.quantity_per_guest, total_quantity: i.total_quantity, prep_status: i.prep_status }); setProdMenuItemFormId(i.id); }} className="p-1 text-slate-400 hover:text-[var(--color-accent-banquet)]" title="Edit"><Pencil className="w-4 h-4" /></button>
                          <button onClick={() => setSubDeleteTarget({ kind: 'production-menu-items', id: i.id, label: `Production menu item (qty ${i.total_quantity})` })} className="p-1 text-slate-400 hover:text-[var(--color-danger)]" title="Delete"><Trash2 className="w-4 h-4" /></button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {prodMenuItemForm ? (
              <div className="p-4 rounded-xl border border-gray-200 dark:border-slate-700 space-y-3">
                <h4 className="text-sm font-semibold text-gray-900 dark:text-white">{prodMenuItemFormId ? 'Edit Production Menu Item' : 'Add Production Menu Item'}</h4>
                <Field label="Menu Item (optional)">
                  {renderMenuItemSelect(prodMenuItemForm.menu_item_id, v => setProdMenuItemForm({ ...prodMenuItemForm, menu_item_id: v }))}
                </Field>
                <div className="grid grid-cols-3 gap-3">
                  <Field label="Qty / Guest">
                    <input type="number" min={0} step="0.01" className={inputCls} value={prodMenuItemForm.quantity_per_guest} onChange={e => setProdMenuItemForm({ ...prodMenuItemForm, quantity_per_guest: Number(e.target.value) })} />
                  </Field>
                  <Field label="Total Qty">
                    <input type="number" min={0} step="0.01" className={inputCls} value={prodMenuItemForm.total_quantity} onChange={e => setProdMenuItemForm({ ...prodMenuItemForm, total_quantity: Number(e.target.value) })} />
                  </Field>
                  <Field label="Prep Status">
                    <select className={inputCls} value={prodMenuItemForm.prep_status} onChange={e => setProdMenuItemForm({ ...prodMenuItemForm, prep_status: e.target.value as BanquetProductionMenuItem['prep_status'] })}>
                      {PREP_STATUS_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </Field>
                </div>
                <div className="flex gap-3">
                  <button onClick={() => { setProdMenuItemForm(null); setProdMenuItemFormId(null); }} className={button.secondary}>Cancel</button>
                  <button onClick={handleSaveProdMenuItem} disabled={saving} className={button.primary}>
                    {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                    {prodMenuItemFormId ? 'Save' : 'Add'}
                  </button>
                </div>
              </div>
            ) : (
              <button onClick={() => setProdMenuItemForm({ menu_item_id: null, quantity_per_guest: 1, total_quantity: 0, prep_status: 'Pending' })} className={button.secondary}>
                <Plus className="w-4 h-4" /> Add Production Menu Item
              </button>
            )}
          </div>
        )}
      </ModalSystem>

      {/* ── Push to Price List Modal ────────────────────────────── */}
      <ModalSystem
        isOpen={!!pushPriceTarget}
        onClose={() => setPushPriceTarget(null)}
        title="Push to Price Lists"
        subtitle={pushPriceTarget ? `${pushPriceTarget.label} — ${formatAmount(pushPriceTarget.price)}/person` : ''}
        variant="form"
        size="md"
        loading={saving}
        showFooter={false}
      >
        {pushPriceTarget && (
          <div className="space-y-4">
            <div className="flex items-start gap-3 p-3 rounded-xl bg-[var(--color-success)]/10 text-sm text-slate-700 dark:text-slate-300">
              <DollarSign className="w-5 h-5 text-[var(--color-success)] shrink-0 mt-0.5" />
              <p>
                This will create a new <strong>Price List</strong> in the
                <strong> Pricing &amp; Packages</strong> module with one line item priced at
                <strong> {formatAmount(pushPriceTarget.price)}/person</strong>, so banquet pricing
                appears alongside regular outlet pricing.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Outlet ID (optional — defaults to Banquet)">
                <input className={inputCls} value={pushPriceOutlet} onChange={e => setPushPriceOutlet(e.target.value)} placeholder="Auto (Banquet)" />
              </Field>
              <Field label="Effective From">
                <input type="date" className={inputCls} value={pushPriceDate} onChange={e => setPushPriceDate(e.target.value)} />
              </Field>
            </div>
            <div className="flex gap-3">
              <button onClick={() => setPushPriceTarget(null)} className={button.secondary}>Cancel</button>
              <button onClick={handlePushToPriceList} disabled={saving} className={button.primary}>
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowRightCircle className="w-4 h-4" />}
                Push to Price Lists
              </button>
            </div>
          </div>
        )}
      </ModalSystem>

      {/* ── Push to Production Coordination Modal ───────────────── */}
      <ModalSystem
        isOpen={!!pushProdTarget}
        onClose={() => setPushProdTarget(null)}
        title="Push to Production Coordination"
        subtitle={pushProdTarget ? `Prep work for: ${pushProdTarget.label}` : ''}
        variant="form"
        size="md"
        loading={saving}
        showFooter={false}
      >
        {pushProdTarget && (
          <div className="space-y-4">
            <div className="flex items-start gap-3 p-3 rounded-xl bg-[var(--color-accent-operations)]/10 text-sm text-slate-700 dark:text-slate-300">
              <Send className="w-5 h-5 text-[var(--color-accent-operations)] shrink-0 mt-0.5" />
              <p>
                This will create a <strong>Production Plan</strong> + linked <strong>Prep Items</strong>
                in the <strong>Production Coordination</strong> module so the kitchen team picks up
                this banquet prep work in their KDS / prep-planning workflow. One prep item is created
                for the preparation area, plus one prep item per linked production menu item.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Outlet ID (optional — defaults to Ballroom)">
                <input className={inputCls} value={pushProdOutlet} onChange={e => setPushProdOutlet(e.target.value)} placeholder="Auto (Grand Ballroom)" />
              </Field>
              <Field label="Plan Date">
                <input type="date" className={inputCls} value={pushProdDate} onChange={e => setPushProdDate(e.target.value)} />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Meal Period">
                <select className={inputCls} value={pushProdMealPeriod} onChange={e => setPushProdMealPeriod(e.target.value)}>
                  {['Breakfast', 'Lunch', 'Dinner', 'All Day'].map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </Field>
              <Field label="Forecast Covers">
                <input type="number" min={0} className={inputCls} value={pushProdCovers} onChange={e => setPushProdCovers(Number(e.target.value))} />
              </Field>
            </div>
            <div className="flex gap-3">
              <button onClick={() => setPushProdTarget(null)} className={button.secondary}>Cancel</button>
              <button onClick={handlePushToProductionPlan} disabled={saving} className={button.primary}>
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                Push to Production Coordination
              </button>
            </div>
          </div>
        )}
      </ModalSystem>
    </div>
  );
}
