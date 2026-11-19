/**
 * @license
 * SPDX-License-Identifier: Apache-2.5
 */

import { useState, useEffect } from 'react';
import {
  BookOpen,
  Utensils,
  Plus,
  Edit,
  Trash2,
  RefreshCw,
  X,
  Clock,
  DollarSign,
  Layers,
  QrCode,
  Link as LinkIcon,
  Unlink,
  Eye,
  EyeOff,
  Search,
} from 'lucide-react';
import { useERP } from '../../context/ERPContext';
import StatCard from '../FrontOffice/StatCard';
import { PageHeader, Badge } from '../FrontOffice/ui';
import { button, layout } from '../FrontOffice/brandTheme';

// ── Types ───────────────────────────────────────────────────────────────
interface MenuItem {
  id: string;
  outlet_id: string | null;
  name: string;
  category: string;
  subcategory: string | null;
  item_code: string | null;
  sku: string | null;
  description: string | null;
  images: string[] | null;
  preparation_time_minutes: number | null;
  selling_price: number;
  multiple_price_levels: Record<string, number>;
  revenue_account: string | null;
  tax_code: string | null;
  is_active: boolean;
  pos_button_group: string | null;
  meal_periods: string[] | null;
  is_fixed_menu: boolean;
  default_station_id: string | null;
  menu_type_id: string | null;
  nutritional_info: Record<string, any> | null;
  allergen_info: string[] | null;
  created_at: string;
  updated_at: string;
}

interface Outlet {
  id: string;
  name: string;
  type: string;
}

interface ModifierGroup {
  id: string;
  outlet_id: string | null;
  name: string;
  description: string | null;
  selection_type: 'single' | 'multi' | 'quantity';
  min_selections: number;
  max_selections: number | null;
  is_required: boolean;
  sort_order: number;
  is_active: boolean;
  options?: ModifierOption[];
}

interface ModifierOption {
  id: string;
  modifier_group_id: string;
  name: string;
  price_adjustment: number;
  is_default: boolean;
  sort_order: number;
  is_active: boolean;
}

interface MenuItemModifier {
  id: string;
  menu_item_id: string;
  modifier_group_id: string;
  modifier_group?: ModifierGroup;
}

interface AvailabilityRule {
  id: string;
  menu_item_id: string;
  outlet_id: string | null;
  rule_type: 'time_based' | 'seasonal' | 'outlet_specific' | 'daily';
  applicable_days: number[];
  start_time: string | null;
  end_time: string | null;
  start_date: string | null;
  end_date: string | null;
  is_available: boolean;
  reason: string | null;
  is_active: boolean;
  menu_item?: { id: string; name: string };
  outlet?: { id: string; name: string };
}

interface DigitalMenu {
  id: string;
  outlet_id: string | null;
  name: string;
  description: string | null;
  qr_code: string | null;
  published_url: string | null;
  primary_language: string;
  supported_languages: string[];
  theme: Record<string, any>;
  is_published: boolean;
  is_active: boolean;
  items?: DigitalMenuItem[];
  outlet?: { id: string; name: string };
}

interface DigitalMenuItem {
  id: string;
  digital_menu_id: string;
  menu_item_id: string;
  display_category: string | null;
  sort_order: number;
  translated_name: Record<string, string>;
  translated_description: Record<string, string>;
  is_featured: boolean;
  is_visible: boolean;
  nutrition_facts: Record<string, any> | null;
  dietary_labels: string[] | null;
  menu_item?: MenuItem;
}

interface MenuType {
  id: string;
  name: string;
  description: string | null;
  icon: string | null;
  allows_multiple_courses: boolean;
  allows_substitutions: boolean;
  is_fixed_price: boolean;
  is_rotational: boolean;
  is_active: boolean;
  sort_order: number;
}

interface Menu {
  id: string;
  outlet_id: string | null;
  menu_type_id: string;
  name: string;
  description: string | null;
  base_price: number | null;
  currency: string;
  course_structure: Record<string, any>[];
  valid_from: string | null;
  valid_to: string | null;
  is_published: boolean;
  is_active: boolean;
  sort_order: number;
  menu_type?: MenuType;
  outlet?: Outlet;
}

interface MenuItemMenu {
  id: string;
  menu_id: string;
  menu_item_id: string;
  course_name: string | null;
  course_order: number | null;
  display_order: number;
  override_price: number | null;
  override_name: string | null;
  override_description: string | null;
  is_available: boolean;
  is_featured: boolean;
  dietary_tags: string[];
  menu?: Menu;
  menu_item?: MenuItem;
}

interface Station {
  id: string;
  outlet_id: string;
  name: string;
  code: string | null;
  description: string | null;
  station_type: string;
  display_order: number;
  kds_enabled: boolean;
  printer_id: string | null;
  is_active: boolean;
  outlet?: Outlet;
}

interface MenuItemStation {
  id: string;
  menu_item_id: string;
  station_id: string;
  is_primary: boolean;
  preparation_time_minutes: number | null;
  display_order: number;
  is_active: boolean;
  station?: Station;
  menu_item?: MenuItem;
}

interface MenuItemOutlet {
  id: string;
  menu_item_id: string;
  outlet_id: string;
  is_primary: boolean;
  outlet?: Outlet;
}

export default function MenuCatalogManagement() {
  const { formatAmount, addNotification } = useERP();
  const [activeTab, setActiveTab] = useState<'items' | 'modifiers' | 'availability' | 'digital' | 'menus' | 'versions'>('items');
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [outlets, setOutlets] = useState<Outlet[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [modalType, setModalType] = useState<'menuItem' | 'modifierGroup' | 'modifierOption' | 'availabilityRule' | 'digitalMenu' | 'digitalMenuItem' | 'menu' | 'menuItemMenu'>('menuItem');
  const [editingItem, setEditingItem] = useState<MenuItem | ModifierGroup | ModifierOption | AvailabilityRule | DigitalMenu | DigitalMenuItem | Menu | MenuItemMenu | null>(null);
  const [selectedMenuItem, setSelectedMenuItem] = useState<string | null>(null);
  const [selectedDigitalMenu, setSelectedDigitalMenu] = useState<string | null>(null);
  const [selectedMenu, setSelectedMenu] = useState<string | null>(null);
  const [showMenuItemsModal, setShowMenuItemsModal] = useState(false);
  const [selectedModifierGroup, setSelectedModifierGroup] = useState<string | null>(null);
  const [showModifierOptionsModal, setShowModifierOptionsModal] = useState(false);

  // Filter states
  const [filterCategory, setFilterCategory] = useState<string>('all');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [filterSearch, setFilterSearch] = useState<string>('');
  const [filterMenuType, setFilterMenuType] = useState<string>('all');
  const [filterMenuStatus, setFilterMenuStatus] = useState<string>('all');
  const [filterModifierStatus, setFilterModifierStatus] = useState<string>('all');
  const [filterAvailabilityStatus, setFilterAvailabilityStatus] = useState<string>('all');
  const [filterDigitalStatus, setFilterDigitalStatus] = useState<string>('all');

  // Modifiers state
  const [modifierGroups, setModifierGroups] = useState<ModifierGroup[]>([]);
  const [menuItemModifiers, setMenuItemModifiers] = useState<MenuItemModifier[]>([]);

  // Availability state
  const [availabilityRules, setAvailabilityRules] = useState<AvailabilityRule[]>([]);

  // Digital menu state
  const [digitalMenus, setDigitalMenus] = useState<DigitalMenu[]>([]);
  const [digitalMenuItems, setDigitalMenuItems] = useState<DigitalMenuItem[]>([]);

  // Menus state
  const [menuTypes, setMenuTypes] = useState<MenuType[]>([]);
  const [menus, setMenus] = useState<Menu[]>([]);
  const [menuItemMenus, setMenuItemMenus] = useState<MenuItemMenu[]>([]);

  // Stations state
  const [stations, setStations] = useState<Station[]>([]);
  const [menuItemStations, setMenuItemStations] = useState<MenuItemStation[]>([]);

  // Menu Item Outlets state
  const [menuItemOutlets, setMenuItemOutlets] = useState<MenuItemOutlet[]>([]);

  // Form data
  const [formData, setFormData] = useState<Record<string, any>>({});

  const tabs = [
    { id: 'items', label: 'Menu Items', icon: Utensils },
    { id: 'menus', label: 'Menus', icon: BookOpen },
    { id: 'versions', label: 'Versions & Publishing', icon: Clock },
    { id: 'modifiers', label: 'Modifiers', icon: Layers },
    { id: 'availability', label: 'Availability', icon: Clock },
    { id: 'digital', label: 'Digital Menu', icon: QrCode },
  ];

  // ── Auth helper ──────────────────────────────────────────────────────
  const getAuthHeaders = (): Record<string, string> => {
    const token = localStorage.getItem('auth_token') || localStorage.getItem('hotel_erp_session');
    return token ? { Authorization: `Bearer ${token}` } : {};
  };

  // ── Data Fetching ─────────────────────────────────────────────────────
  const fetchMenuItems = async () => {
    try {
      const response = await fetch('/api/fb/menu-items', { headers: getAuthHeaders() });
      if (!response.ok) throw new Error('Failed to fetch menu items');
      const data = await response.json();
      setMenuItems(data.data || data || []);
    } catch (error) {
      console.error('Error fetching menu items:', error);
      addNotification('Failed to load menu items', 'warning', 'F&B');
    }
  };

  const fetchOutlets = async () => {
    try {
      const response = await fetch('/api/fb/outlets', { headers: getAuthHeaders() });
      if (!response.ok) throw new Error('Failed to fetch outlets');
      const data = await response.json();
      setOutlets(data.data || data || []);
    } catch (error) {
      console.error('Error fetching outlets:', error);
    }
  };

  const fetchModifierGroups = async () => {
    try {
      const response = await fetch('/api/fb/menu-catalog/modifier-groups', { headers: getAuthHeaders() });
      if (!response.ok) throw new Error('Failed to fetch modifier groups');
      const data = await response.json();
      setModifierGroups(data || []);
    } catch (error) {
      console.error('Error fetching modifier groups:', error);
      addNotification('Failed to load modifier groups', 'warning', 'F&B');
    }
  };

  const fetchMenuItemModifiers = async (menuItemId?: string) => {
    try {
      const url = menuItemId 
        ? `/api/fb/menu-catalog/menu-item-modifiers?menu_item_id=${menuItemId}`
        : '/api/fb/menu-catalog/menu-item-modifiers';
      const response = await fetch(url, { headers: getAuthHeaders() });
      if (!response.ok) throw new Error('Failed to fetch menu item modifiers');
      const data = await response.json();
      setMenuItemModifiers(data || []);
    } catch (error) {
      console.error('Error fetching menu item modifiers:', error);
    }
  };

  const fetchAvailabilityRules = async (menuItemId?: string) => {
    try {
      const url = menuItemId
        ? `/api/fb/menu-catalog/availability-rules?menu_item_id=${menuItemId}`
        : '/api/fb/menu-catalog/availability-rules';
      const response = await fetch(url, { headers: getAuthHeaders() });
      if (!response.ok) throw new Error('Failed to fetch availability rules');
      const data = await response.json();
      setAvailabilityRules(data || []);
    } catch (error) {
      console.error('Error fetching availability rules:', error);
    }
  };

  const fetchDigitalMenus = async () => {
    try {
      const response = await fetch('/api/fb/menu-catalog/digital-menus', { headers: getAuthHeaders() });
      if (!response.ok) throw new Error('Failed to fetch digital menus');
      const data = await response.json();
      setDigitalMenus(data || []);
    } catch (error) {
      console.error('Error fetching digital menus:', error);
    }
  };

  const fetchDigitalMenuItems = async (digitalMenuId?: string) => {
    try {
      const url = digitalMenuId
        ? `/api/fb/menu-catalog/digital-menu-items?digital_menu_id=${digitalMenuId}`
        : '/api/fb/menu-catalog/digital-menu-items';
      const response = await fetch(url, { headers: getAuthHeaders() });
      if (!response.ok) throw new Error('Failed to fetch digital menu items');
      const data = await response.json();
      setDigitalMenuItems(data || []);
    } catch (error) {
      console.error('Error fetching digital menu items:', error);
    }
  };

  const fetchMenuTypes = async () => {
    try {
      const response = await fetch('/api/fb/menu-catalog/menu-types', { headers: getAuthHeaders() });
      if (!response.ok) throw new Error('Failed to fetch menu types');
      const data = await response.json();
      setMenuTypes(data || []);
    } catch (error) {
      console.error('Error fetching menu types:', error);
    }
  };

  const fetchMenus = async () => {
    try {
      const response = await fetch('/api/fb/menu-catalog/menus', { headers: getAuthHeaders() });
      if (!response.ok) throw new Error('Failed to fetch menus');
      const data = await response.json();
      setMenus(data || []);
    } catch (error) {
      console.error('Error fetching menus:', error);
    }
  };

  const fetchMenuItemMenus = async (menuId?: string) => {
    try {
      const url = menuId
        ? `/api/fb/menu-catalog/menu-items-menus?menu_id=${menuId}`
        : '/api/fb/menu-catalog/menu-items-menus';
      const response = await fetch(url, { headers: getAuthHeaders() });
      if (!response.ok) throw new Error('Failed to fetch menu items');
      const data = await response.json();
      setMenuItemMenus(data || []);
    } catch (error) {
      console.error('Error fetching menu items:', error);
    }
  };

  const fetchStations = async () => {
    try {
      const response = await fetch('/api/fb/menu-catalog/stations', { headers: getAuthHeaders() });
      if (!response.ok) throw new Error('Failed to fetch stations');
      const data = await response.json();
      setStations(data || []);
    } catch (error) {
      console.error('Error fetching stations:', error);
    }
  };

  const fetchMenuItemStations = async (menuItemId?: string) => {
    try {
      const url = menuItemId
        ? `/api/fb/menu-catalog/menu-item-stations?menu_item_id=${menuItemId}`
        : '/api/fb/menu-catalog/menu-item-stations';
      const response = await fetch(url, { headers: getAuthHeaders() });
      if (!response.ok) throw new Error('Failed to fetch menu item stations');
      const data = await response.json();
      setMenuItemStations(data || []);
    } catch (error) {
      console.error('Error fetching menu item stations:', error);
    }
  };

  const fetchMenuItemOutlets = async (menuItemId?: string) => {
    try {
      const url = menuItemId
        ? `/api/fb/menu-catalog/menu-item-outlets?menu_item_id=${menuItemId}`
        : '/api/fb/menu-catalog/menu-item-outlets';
      const response = await fetch(url, { headers: getAuthHeaders() });
      if (!response.ok) throw new Error('Failed to fetch menu item outlets');
      const data = await response.json();
      setMenuItemOutlets(data || []);
    } catch (error) {
      console.error('Error fetching menu item outlets:', error);
    }
  };

  useEffect(() => {
    setLoading(true);
    Promise.all([fetchMenuItems(), fetchOutlets()]).finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (activeTab === 'modifiers') {
      fetchModifierGroups();
      fetchMenuItemModifiers();
    } else if (activeTab === 'availability') {
      fetchAvailabilityRules();
    } else if (activeTab === 'digital') {
      fetchDigitalMenus();
      fetchDigitalMenuItems();
    } else if (activeTab === 'menus') {
      fetchMenuTypes();
      fetchMenus();
    } else if (activeTab === 'items') {
      fetchStations();
      fetchMenuItemOutlets();
    }
  }, [activeTab]);

  // ── Menu Item Handlers ───────────────────────────────────────────────
  const handleCreateMenuItem = () => {
    setEditingItem(null);
    setModalType('menuItem');
    setFormData({
      item_code: null,
      sku: null,
      name: '',
      description: null,
      category: '',
      subcategory: null,
      selling_price: 0,
      preparation_time_minutes: null,
      multiple_price_levels: {},
      revenue_account: null,
      tax_code: '',
      is_active: true,
      pos_button_group: '',
      is_fixed_menu: false,
      outlet_id: null,
      meal_periods: [],
      default_station_id: null,
      assigned_stations: [],
      assigned_outlets: [],
      allergen_info: []
    });
    setShowModal(true);
  };

  const handleEditMenuItem = (item: MenuItem) => {
    setEditingItem(item);
    setModalType('menuItem');
    const itemStations = menuItemStations.filter(s => s.menu_item_id === item.id);
    const itemOutlets = menuItemOutlets.filter(o => o.menu_item_id === item.id);
    setFormData({
      item_code: item.item_code,
      sku: item.sku,
      name: item.name,
      description: item.description,
      category: item.category,
      subcategory: item.subcategory,
      selling_price: item.selling_price,
      preparation_time_minutes: item.preparation_time_minutes,
      multiple_price_levels: item.multiple_price_levels || {},
      revenue_account: item.revenue_account,
      tax_code: item.tax_code || '',
      is_active: item.is_active,
      pos_button_group: item.pos_button_group || '',
      is_fixed_menu: item.is_fixed_menu,
      outlet_id: item.outlet_id,
      meal_periods: item.meal_periods || [],
      default_station_id: item.default_station_id,
      assigned_stations: itemStations.map(s => s.station_id),
      assigned_outlets: itemOutlets.map(o => o.outlet_id),
      allergen_info: item.allergen_info || []
    });
    setShowModal(true);
  };

  const handleSaveMenuItem = async () => {
    try {
      // First, save the menu item
      const url = editingItem
        ? `/api/fb/menu-items/${editingItem.id}`
        : '/api/fb/menu-items';
      const method = editingItem ? 'PUT' : 'POST';
      
      // Remove assigned_stations and assigned_outlets from formData as they're not part of menu_items table
      const { assigned_stations, assigned_outlets, ...itemData } = formData;
      
      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify(itemData)
      });
      if (!response.ok) throw new Error('Failed to save menu item');
      const savedItem = await response.json();
      
      // Then, save outlet assignments
      const menuItemId = savedItem.id || editingItem?.id;
      if (menuItemId && assigned_outlets && assigned_outlets.length > 0) {
        const outletAssignments = assigned_outlets.map((outletId: string, index: number) => ({
          outlet_id: outletId,
          is_primary: index === 0 // First outlet is primary
        }));
        
        await fetch(`/api/fb/menu-catalog/menu-items/${menuItemId}/outlets`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
          body: JSON.stringify({ outlets: outletAssignments })
        });
      } else if (menuItemId) {
        // Clear all outlets if none selected
        await fetch(`/api/fb/menu-catalog/menu-items/${menuItemId}/outlets`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
          body: JSON.stringify({ outlets: [] })
        });
      }
      
      // Then, save station assignments
      if (menuItemId && assigned_stations && assigned_stations.length > 0) {
        const stationAssignments = assigned_stations.map((stationId: string, index: number) => ({
          station_id: stationId,
          is_primary: index === 0, // First station is primary
          display_order: index
        }));
        
        await fetch(`/api/fb/menu-catalog/menu-items/${menuItemId}/stations`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
          body: JSON.stringify({ stations: stationAssignments })
        });
      } else if (menuItemId) {
        // Clear all stations if none selected
        await fetch(`/api/fb/menu-catalog/menu-items/${menuItemId}/stations`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
          body: JSON.stringify({ stations: [] })
        });
      }
      
      addNotification(editingItem ? 'Menu item updated successfully' : 'Menu item created successfully', 'success', 'F&B');
      setShowModal(false);
      fetchMenuItems();
      fetchMenuItemStations();
      fetchMenuItemOutlets();
    } catch (error) {
      console.error('Error saving menu item:', error);
      addNotification('Failed to save menu item', 'warning', 'F&B');
    }
  };

  const handleDeleteMenuItem = async (id: string) => {
    if (!confirm('Are you sure you want to delete this menu item?')) return;
    try {
      const response = await fetch(`/api/fb/menu-items/${id}`, { method: 'DELETE', headers: getAuthHeaders() });
      if (!response.ok) throw new Error('Failed to delete menu item');
      addNotification('Menu item deleted successfully', 'success', 'F&B');
      fetchMenuItems();
    } catch (error) {
      console.error('Error deleting menu item:', error);
      addNotification('Failed to delete menu item', 'warning', 'F&B');
    }
  };

  // ── Modifier Handlers ────────────────────────────────────────────────
  const handleCreateModifierGroup = () => {
    setEditingItem(null);
    setModalType('modifierGroup');
    setFormData({
      name: '',
      description: '',
      selection_type: 'single',
      min_selections: 0,
      max_selections: null,
      is_required: false,
      is_active: true,
      outlet_id: outlets[0]?.id || null
    });
    setShowModal(true);
  };

  const handleEditModifierGroup = (group: ModifierGroup) => {
    setEditingItem(group);
    setModalType('modifierGroup');
    setFormData(group);
    setShowModal(true);
  };

  const handleSaveModifierGroup = async () => {
    try {
      const url = editingItem
        ? `/api/fb/menu-catalog/modifier-groups/${editingItem.id}`
        : '/api/fb/menu-catalog/modifier-groups';
      const method = editingItem ? 'PUT' : 'POST';
      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify(formData)
      });
      if (!response.ok) throw new Error('Failed to save modifier group');
      addNotification(editingItem ? 'Modifier group updated' : 'Modifier group created', 'success', 'F&B');
      setShowModal(false);
      fetchModifierGroups();
    } catch (error) {
      console.error('Error saving modifier group:', error);
      addNotification('Failed to save modifier group', 'warning', 'F&B');
    }
  };

  const handleDeleteModifierGroup = async (id: string) => {
    if (!confirm('Are you sure you want to delete this modifier group?')) return;
    try {
      const response = await fetch(`/api/fb/menu-catalog/modifier-groups/${id}`, { method: 'DELETE', headers: getAuthHeaders() });
      if (!response.ok) throw new Error('Failed to delete modifier group');
      addNotification('Modifier group deleted successfully', 'success', 'F&B');
      fetchModifierGroups();
    } catch (error) {
      console.error('Error deleting modifier group:', error);
      addNotification('Failed to delete modifier group', 'warning', 'F&B');
    }
  };

  const handleCreateModifierOption = (groupId: string) => {
    setEditingItem(null);
    setModalType('modifierOption');
    setFormData({
      modifier_group_id: groupId,
      name: '',
      price_adjustment: 0,
      is_default: false,
      is_active: true
    });
    setShowModal(true);
  };

  const handleSaveModifierOption = async () => {
    try {
      const url = editingItem
        ? `/api/fb/menu-catalog/modifier-options/${editingItem.id}`
        : '/api/fb/menu-catalog/modifier-options';
      const method = editingItem ? 'PUT' : 'POST';
      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify(formData)
      });
      if (!response.ok) throw new Error('Failed to save modifier option');
      addNotification('Modifier option saved successfully', 'success', 'F&B');
      setShowModal(false);
      fetchModifierGroups();
    } catch (error) {
      console.error('Error saving modifier option:', error);
      addNotification('Failed to save modifier option', 'warning', 'F&B');
    }
  };

  const handleDeleteModifierOption = async (id: string) => {
    if (!confirm('Delete this modifier option?')) return;
    try {
      const response = await fetch(`/api/fb/menu-catalog/modifier-options/${id}`, { method: 'DELETE', headers: getAuthHeaders() });
      if (!response.ok) throw new Error('Failed to delete modifier option');
      addNotification('Modifier option deleted', 'success', 'F&B');
      fetchModifierGroups();
    } catch (error) {
      console.error('Error deleting modifier option:', error);
      addNotification('Failed to delete modifier option', 'warning', 'F&B');
    }
  };

  const handleLinkModifierToMenuItem = async (groupId: string) => {
    if (!selectedMenuItem) return;
    try {
      const response = await fetch('/api/fb/menu-catalog/menu-item-modifiers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({ menu_item_id: selectedMenuItem, modifier_group_id: groupId })
      });
      if (!response.ok) throw new Error('Failed to link modifier');
      addNotification('Modifier group linked to menu item', 'success', 'F&B');
      fetchMenuItemModifiers(selectedMenuItem);
    } catch (error) {
      console.error('Error linking modifier:', error);
      addNotification('Failed to link modifier group', 'warning', 'F&B');
    }
  };

  const handleUnlinkModifierFromMenuItem = async (id: string) => {
    if (!confirm('Remove this modifier group from the menu item?')) return;
    try {
      const response = await fetch(`/api/fb/menu-catalog/menu-item-modifiers/${id}`, { method: 'DELETE', headers: getAuthHeaders() });
      if (!response.ok) throw new Error('Failed to unlink modifier');
      addNotification('Modifier group removed', 'success', 'F&B');
      fetchMenuItemModifiers(selectedMenuItem!);
    } catch (error) {
      console.error('Error unlinking modifier:', error);
      addNotification('Failed to remove modifier group', 'warning', 'F&B');
    }
  };

  // ── Availability Handlers ─────────────────────────────────────────────
  const handleCreateAvailabilityRule = () => {
    setEditingItem(null);
    setModalType('availabilityRule');
    setFormData({
      menu_item_id: selectedMenuItem || menuItems[0]?.id || '',
      outlet_id: null,
      rule_type: 'time_based',
      applicable_days: [0, 1, 2, 3, 4, 5, 6],
      start_time: null,
      end_time: null,
      start_date: null,
      end_date: null,
      is_available: true,
      reason: '',
      is_active: true
    });
    setShowModal(true);
  };

  const handleEditAvailabilityRule = (rule: AvailabilityRule) => {
    setEditingItem(rule);
    setModalType('availabilityRule');
    setFormData(rule);
    setShowModal(true);
  };

  const handleSaveAvailabilityRule = async () => {
    try {
      const url = editingItem
        ? `/api/fb/menu-catalog/availability-rules/${editingItem.id}`
        : '/api/fb/menu-catalog/availability-rules';
      const method = editingItem ? 'PUT' : 'POST';
      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify(formData)
      });
      if (!response.ok) throw new Error('Failed to save availability rule');
      addNotification('Availability rule saved', 'success', 'F&B');
      setShowModal(false);
      fetchAvailabilityRules(selectedMenuItem || undefined);
    } catch (error) {
      console.error('Error saving availability rule:', error);
      addNotification('Failed to save availability rule', 'warning', 'F&B');
    }
  };

  const handleDeleteAvailabilityRule = async (id: string) => {
    if (!confirm('Delete this availability rule?')) return;
    try {
      const response = await fetch(`/api/fb/menu-catalog/availability-rules/${id}`, { method: 'DELETE', headers: getAuthHeaders() });
      if (!response.ok) throw new Error('Failed to delete availability rule');
      addNotification('Availability rule deleted', 'success', 'F&B');
      fetchAvailabilityRules(selectedMenuItem || undefined);
    } catch (error) {
      console.error('Error deleting availability rule:', error);
      addNotification('Failed to delete availability rule', 'warning', 'F&B');
    }
  };

  // ── Digital Menu Handlers ─────────────────────────────────────────────
  const handleCreateDigitalMenu = () => {
    setEditingItem(null);
    setModalType('digitalMenu');
    setFormData({
      name: '',
      description: '',
      outlet_id: outlets[0]?.id || null,
      primary_language: 'en',
      supported_languages: ['en'],
      theme: {},
      is_published: false,
      is_active: true
    });
    setShowModal(true);
  };

  const handleEditDigitalMenu = (menu: DigitalMenu) => {
    setEditingItem(menu);
    setModalType('digitalMenu');
    setFormData(menu);
    setShowModal(true);
  };

  const handleSaveDigitalMenu = async () => {
    try {
      const url = editingItem
        ? `/api/fb/menu-catalog/digital-menus/${editingItem.id}`
        : '/api/fb/menu-catalog/digital-menus';
      const method = editingItem ? 'PUT' : 'POST';
      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify(formData)
      });
      if (!response.ok) throw new Error('Failed to save digital menu');
      addNotification('Digital menu saved', 'success', 'F&B');
      setShowModal(false);
      fetchDigitalMenus();
    } catch (error) {
      console.error('Error saving digital menu:', error);
      addNotification('Failed to save digital menu', 'warning', 'F&B');
    }
  };

  const handleDeleteDigitalMenu = async (id: string) => {
    if (!confirm('Delete this digital menu?')) return;
    try {
      const response = await fetch(`/api/fb/menu-catalog/digital-menus/${id}`, { method: 'DELETE', headers: getAuthHeaders() });
      if (!response.ok) throw new Error('Failed to delete digital menu');
      addNotification('Digital menu deleted', 'success', 'F&B');
      fetchDigitalMenus();
    } catch (error) {
      console.error('Error deleting digital menu:', error);
      addNotification('Failed to delete digital menu', 'warning', 'F&B');
    }
  };

  const handleAddItemToDigitalMenu = () => {
    if (!selectedDigitalMenu) return;
    setEditingItem(null);
    setModalType('digitalMenuItem');
    setFormData({
      digital_menu_id: selectedDigitalMenu,
      menu_item_id: menuItems[0]?.id || '',
      display_category: '',
      sort_order: 0,
      translated_name: {},
      translated_description: {},
      is_featured: false,
      is_visible: true,
      nutrition_facts: {},
      dietary_labels: []
    });
    setShowModal(true);
  };

  const handleSaveDigitalMenuItem = async () => {
    try {
      const url = editingItem
        ? `/api/fb/menu-catalog/digital-menu-items/${editingItem.id}`
        : '/api/fb/menu-catalog/digital-menu-items';
      const method = editingItem ? 'PUT' : 'POST';
      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify(formData)
      });
      if (!response.ok) throw new Error('Failed to save digital menu item');
      addNotification('Item added to digital menu', 'success', 'F&B');
      setShowModal(false);
      fetchDigitalMenuItems(selectedDigitalMenu || undefined);
    } catch (error) {
      console.error('Error saving digital menu item:', error);
      addNotification('Failed to add item to digital menu', 'warning', 'F&B');
    }
  };

  const handleRemoveDigitalMenuItem = async (id: string) => {
    if (!confirm('Remove this item from the digital menu?')) return;
    try {
      const response = await fetch(`/api/fb/menu-catalog/digital-menu-items/${id}`, { method: 'DELETE', headers: getAuthHeaders() });
      if (!response.ok) throw new Error('Failed to remove item');
      addNotification('Item removed from digital menu', 'success', 'F&B');
      fetchDigitalMenuItems(selectedDigitalMenu || undefined);
    } catch (error) {
      console.error('Error removing item:', error);
      addNotification('Failed to remove item', 'warning', 'F&B');
    }
  };

  const handleGenerateQR = async (menuId: string) => {
    const qrCode = `${window.location.origin}/digital-menu/${menuId}`;
    try {
      const response = await fetch(`/api/fb/menu-catalog/digital-menus/${menuId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({ qr_code: qrCode, published_url: qrCode })
      });
      if (!response.ok) throw new Error('Failed to generate QR code');
      addNotification('QR code generated', 'success', 'F&B');
      fetchDigitalMenus();
    } catch (error) {
      console.error('Error generating QR code:', error);
      addNotification('Failed to generate QR code', 'warning', 'F&B');
    }
  };

  // ── Menu Handlers ─────────────────────────────────────────────────────
  const handleCreateMenu = () => {
    setEditingItem(null);
    setModalType('menu');
    setFormData({
      name: '',
      description: '',
      outlet_id: outlets[0]?.id || null,
      menu_type_id: menuTypes[0]?.id || '',
      base_price: null,
      currency: 'USD',
      course_structure: [],
      valid_from: null,
      valid_to: null,
      is_published: false,
      is_active: true
    });
    setShowModal(true);
  };

  const handleEditMenu = (menu: Menu) => {
    setEditingItem(menu);
    setModalType('menu');
    setFormData(menu);
    setShowModal(true);
  };

  const handleSaveMenu = async () => {
    try {
      const url = editingItem
        ? `/api/fb/menu-catalog/menus/${editingItem.id}`
        : '/api/fb/menu-catalog/menus';
      const method = editingItem ? 'PUT' : 'POST';
      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify(formData)
      });
      if (!response.ok) throw new Error('Failed to save menu');
      addNotification(editingItem ? 'Menu updated successfully' : 'Menu created successfully', 'success', 'F&B');
      setShowModal(false);
      fetchMenus();
    } catch (error) {
      console.error('Error saving menu:', error);
      addNotification('Failed to save menu', 'warning', 'F&B');
    }
  };

  const handleDeleteMenu = async (id: string) => {
    if (!confirm('Delete this menu? This will also remove all item associations.')) return;
    try {
      const response = await fetch(`/api/fb/menu-catalog/menus/${id}`, { method: 'DELETE', headers: getAuthHeaders() });
      if (!response.ok) throw new Error('Failed to delete menu');
      addNotification('Menu deleted successfully', 'success', 'F&B');
      fetchMenus();
    } catch (error) {
      console.error('Error deleting menu:', error);
      addNotification('Failed to delete menu', 'warning', 'F&B');
    }
  };

  const handleAddItemToMenu = () => {
    if (!selectedMenu) return;
    setEditingItem(null);
    setModalType('menuItemMenu');
    setFormData({
      menu_id: selectedMenu,
      menu_item_id: menuItems[0]?.id || '',
      course_name: null,
      course_order: null,
      display_order: 0,
      override_price: null,
      override_name: null,
      override_description: null,
      is_available: true,
      is_featured: false,
      dietary_tags: []
    });
    setShowMenuItemsModal(false);
    setShowModal(true);
  };

  const handleSaveMenuItemMenu = async () => {
    try {
      const url = editingItem
        ? `/api/fb/menu-catalog/menu-items-menus/${editingItem.id}`
        : '/api/fb/menu-catalog/menu-items-menus';
      const method = editingItem ? 'PUT' : 'POST';
      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify(formData)
      });
      if (!response.ok) throw new Error('Failed to add item to menu');
      addNotification('Item added to menu successfully', 'success', 'F&B');
      setShowModal(false);
      fetchMenuItemMenus(selectedMenu || undefined);
    } catch (error) {
      console.error('Error adding item to menu:', error);
      addNotification('Failed to add item to menu', 'warning', 'F&B');
    }
  };

  const handleRemoveItemFromMenu = async (id: string) => {
    if (!confirm('Remove this item from the menu?')) return;
    try {
      const response = await fetch(`/api/fb/menu-catalog/menu-items-menus/${id}`, { method: 'DELETE', headers: getAuthHeaders() });
      if (!response.ok) throw new Error('Failed to remove item');
      addNotification('Item removed from menu', 'success', 'F&B');
      fetchMenuItemMenus(selectedMenu || undefined);
    } catch (error) {
      console.error('Error removing item:', error);
      addNotification('Failed to remove item', 'warning', 'F&B');
    }
  };

  // ── KPI Calculations ────────────────────────────────────────────────
  const activeItems = menuItems.filter(i => i.is_active).length;
  const totalItems = menuItems.length;
  const uniqueCategories = new Set(menuItems.map(i => i.category)).size;
  const avgPrice = menuItems.length > 0 ? menuItems.reduce((sum, i) => sum + i.selling_price, 0) / menuItems.length : 0;

  const getModalSaveHandler = () => {
    switch (modalType) {
      case 'menuItem': return handleSaveMenuItem;
      case 'modifierGroup': return handleSaveModifierGroup;
      case 'modifierOption': return handleSaveModifierOption;
      case 'availabilityRule': return handleSaveAvailabilityRule;
      case 'digitalMenu': return handleSaveDigitalMenu;
      case 'digitalMenuItem': return handleSaveDigitalMenuItem;
      case 'menu': return handleSaveMenu;
      case 'menuItemMenu': return handleSaveMenuItemMenu;
    }
  };

  const getAddButton = () => {
    switch (activeTab) {
      case 'items': return { handler: handleCreateMenuItem, label: 'Add Item' };
      case 'menus': return { handler: handleCreateMenu, label: 'New Menu' };
      case 'versions': return { handler: handleCreateMenu, label: 'New Version' };
      case 'modifiers': return { handler: handleCreateModifierGroup, label: 'Add Group' };
      case 'availability': return { handler: handleCreateAvailabilityRule, label: 'Add Rule' };
      case 'digital': return { handler: handleCreateDigitalMenu, label: 'New Menu' };
      default: return { handler: () => {}, label: 'Add' };
    }
  };

  const addButton = getAddButton();

  return (
    <div className={layout.sectionStack}>
      {/* Header */}
      <PageHeader
        title="Menu & Catalog Management"
        subtitle="Single source of truth for all menus"
        icon={Utensils}
        actions={
          <>
            <button onClick={fetchMenuItems} className={button.secondary}>
              <RefreshCw className="w-4 h-4" />
              Refresh
            </button>
            <button onClick={addButton.handler} className={button.primary}>
              <Plus className="w-4 h-4" />
              {addButton.label}
            </button>
          </>
        }
      />

      {/* KPI Cards */}
      <div className={layout.kpiGrid}>
        <StatCard title="Total Items" value={String(totalItems)} icon={Utensils} tone="accent" />
        <StatCard title="Active Items" value={String(activeItems)} icon={BookOpen} tone="success" />
        <StatCard title="Categories" value={String(uniqueCategories)} icon={Layers} tone="info" />
        <StatCard title="Avg Price" value={formatAmount(avgPrice)} icon={DollarSign} tone="warning" />
      </div>

      {/* Tabs */}
      <div className="flex bg-slate-100 dark:bg-slate-900/40 p-1 rounded-2xl border border-gray-200 dark:border-slate-700">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id as any)}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl transition-all ${
              activeTab === tab.id
                ? 'bg-white dark:bg-slate-800 text-[var(--color-accent-operations)] shadow-sm font-medium'
                : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-slate-50 dark:hover:bg-slate-700'
            }`}
          >
            <tab.icon className="w-4 h-4" />
            <span className="text-sm">{tab.label}</span>
          </button>
        ))}
      </div>

      {/* Content Area */}
      <div className="bg-white dark:bg-slate-800 rounded-2xl border border-gray-200 dark:border-slate-700 p-6 card-shadow">
        {/* Items Tab */}
        {activeTab === 'items' && (
          <div className="space-y-4">
            {/* Filters */}
            <div className="flex flex-wrap items-center gap-4 p-4 bg-slate-50 dark:bg-slate-900/40 rounded-xl border border-gray-200 dark:border-slate-700">
              <div className="flex items-center gap-2">
                <Search className="w-4 h-4 text-slate-500" />
                <input
                  type="text"
                  placeholder="Search items..."
                  value={filterSearch}
                  onChange={(e) => setFilterSearch(e.target.value)}
                  className="px-3 py-2 text-sm border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white w-48"
                />
              </div>
              <div className="flex items-center gap-2">
                <label className="text-sm text-slate-600 dark:text-slate-400">Category:</label>
                <select
                  value={filterCategory}
                  onChange={(e) => setFilterCategory(e.target.value)}
                  className="px-3 py-2 text-sm border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white"
                >
                  <option value="all">All Categories</option>
                  {[...new Set(menuItems.map(i => i.category))].map(cat => (
                    <option key={cat} value={cat}>{cat}</option>
                  ))}
                </select>
              </div>
              <div className="flex items-center gap-2">
                <label className="text-sm text-slate-600 dark:text-slate-400">Status:</label>
                <select
                  value={filterStatus}
                  onChange={(e) => setFilterStatus(e.target.value)}
                  className="px-3 py-2 text-sm border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white"
                >
                  <option value="all">All Status</option>
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                </select>
              </div>
              {(filterCategory !== 'all' || filterStatus !== 'all' || filterSearch) && (
                <button
                  onClick={() => { setFilterCategory('all'); setFilterStatus('all'); setFilterSearch(''); }}
                  className="text-sm text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
                >
                  Clear Filters
                </button>
              )}
            </div>

            {loading ? (
              <div className="text-center py-8 text-gray-500">Loading menu items...</div>
            ) : menuItems.length === 0 ? (
              <div className="text-center py-8 text-gray-500">
                <Utensils className="w-10 h-10 mx-auto mb-2 opacity-50" />
                <p className="text-sm">No menu items found</p>
                <p className="text-xs mt-1">Click "Add Item" to create your first menu item</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 dark:bg-slate-900/40 text-left text-xs uppercase text-slate-500">
                    <tr>
                      <th className="px-4 py-3 font-medium">Name</th>
                      <th className="px-4 py-3 font-medium">Category</th>
                      <th className="px-4 py-3 font-medium">Code</th>
                      <th className="px-4 py-3 font-medium">SKU</th>
                      <th className="px-4 py-3 font-medium">Price</th>
                      <th className="px-4 py-3 font-medium">Prep Time</th>
                      <th className="px-4 py-3 font-medium">Meal Periods</th>
                      <th className="px-4 py-3 font-medium">Outlets</th>
                      <th className="px-4 py-3 font-medium">Stations</th>
                      <th className="px-4 py-3 font-medium">Status</th>
                      <th className="px-4 py-3 font-medium">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200 dark:divide-slate-700">
                    {menuItems
                      .filter(item => {
                        const matchesCategory = filterCategory === 'all' || item.category === filterCategory;
                        const matchesStatus = filterStatus === 'all' || (filterStatus === 'active' ? item.is_active : !item.is_active);
                        const matchesSearch = !filterSearch || 
                          item.name.toLowerCase().includes(filterSearch.toLowerCase()) ||
                          (item.item_code && item.item_code.toLowerCase().includes(filterSearch.toLowerCase())) ||
                          (item.sku && item.sku.toLowerCase().includes(filterSearch.toLowerCase()));
                        return matchesCategory && matchesStatus && matchesSearch;
                      })
                      .map((item) => {
                      const itemStations = menuItemStations.filter(s => s.menu_item_id === item.id);
                      const itemOutlets = menuItemOutlets.filter(o => o.menu_item_id === item.id);
                      return (
                        <tr key={item.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/40">
                          <td className="px-4 py-3">
                            <div className="font-medium text-gray-900 dark:text-white">{item.name}</div>
                            {item.description && (
                              <div className="text-xs text-slate-500 dark:text-slate-400 line-clamp-1 max-w-xs">{item.description}</div>
                            )}
                            {item.allergen_info && item.allergen_info.length > 0 && (
                              <div className="flex items-center gap-1 mt-1 flex-wrap">
                                {item.allergen_info.slice(0, 3).map((a: string) => (
                                  <span key={a} className="text-[10px] px-1.5 py-0.5 rounded-full bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400">{a}</span>
                                ))}
                                {item.allergen_info.length > 3 && <span className="text-[10px] text-slate-500">+{item.allergen_info.length - 3}</span>}
                              </div>
                            )}
                          </td>
                          <td className="px-4 py-3 text-slate-600 dark:text-slate-400">
                            {item.category}
                            {item.subcategory && <span className="text-slate-400"> / {item.subcategory}</span>}
                          </td>
                          <td className="px-4 py-3 text-slate-600 dark:text-slate-400 font-mono text-xs">{item.item_code || '—'}</td>
                          <td className="px-4 py-3 text-slate-600 dark:text-slate-400 font-mono text-xs">{item.sku || '—'}</td>
                          <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{formatAmount(item.selling_price)}</td>
                          <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{item.preparation_time_minutes ? `${item.preparation_time_minutes} min` : '—'}</td>
                          <td className="px-4 py-3">
                            {item.meal_periods && item.meal_periods.length > 0 ? (
                              <div className="flex flex-wrap gap-1">
                                {item.meal_periods.slice(0, 3).map((mp: string) => (
                                  <Badge key={mp} tone="info" className="text-xs">{mp}</Badge>
                                ))}
                                {item.meal_periods.length > 3 && <span className="text-xs text-slate-500">+{item.meal_periods.length - 3}</span>}
                              </div>
                            ) : <span className="text-slate-400">—</span>}
                          </td>
                          <td className="px-4 py-3">
                            {itemOutlets.length > 0 ? (
                              <div className="flex flex-wrap gap-1">
                                {itemOutlets.slice(0, 2).map((link) => (
                                  <Badge key={link.id} tone="neutral" className="text-xs">
                                    {link.outlet?.name || link.outlet_id.substring(0, 6)}
                                    {link.is_primary && ' *'}
                                  </Badge>
                                ))}
                                {itemOutlets.length > 2 && <span className="text-xs text-slate-500">+{itemOutlets.length - 2}</span>}
                              </div>
                            ) : <span className="text-slate-400">—</span>}
                          </td>
                          <td className="px-4 py-3">
                            {itemStations.length > 0 ? (
                              <div className="flex flex-wrap gap-1">
                                {itemStations.slice(0, 2).map((link) => (
                                  <Badge key={link.id} tone="info" className="text-xs">
                                    {link.station?.code || link.station?.name || link.station_id.substring(0, 6)}
                                    {link.is_primary && ' *'}
                                  </Badge>
                                ))}
                                {itemStations.length > 2 && <span className="text-xs text-slate-500">+{itemStations.length - 2}</span>}
                              </div>
                            ) : <span className="text-slate-400">—</span>}
                          </td>
                          <td className="px-4 py-3">
                            <Badge tone={item.is_active ? 'success' : 'neutral'}>
                              {item.is_active ? 'Active' : 'Inactive'}
                            </Badge>
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2">
                              <button onClick={() => handleEditMenuItem(item)} className={button.ghost}>
                                <Edit className="w-4 h-4" />
                              </button>
                              <button onClick={() => handleDeleteMenuItem(item.id)} className={button.ghost}>
                                <Trash2 className="w-4 h-4 text-red-600 dark:text-red-400" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* Menus Tab */}
        {activeTab === 'menus' && (
          <div className="space-y-6">
            {/* Filters */}
            <div className="flex flex-wrap items-center gap-4 p-4 bg-slate-50 dark:bg-slate-900/40 rounded-xl border border-gray-200 dark:border-slate-700">
              <div className="flex items-center gap-2">
                <Search className="w-4 h-4 text-slate-500" />
                <input
                  type="text"
                  placeholder="Search menus..."
                  value={filterSearch}
                  onChange={(e) => setFilterSearch(e.target.value)}
                  className="px-3 py-2 text-sm border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white w-48"
                />
              </div>
              <div className="flex items-center gap-2">
                <label className="text-sm text-slate-600 dark:text-slate-400">Type:</label>
                <select
                  value={filterMenuType}
                  onChange={(e) => setFilterMenuType(e.target.value)}
                  className="px-3 py-2 text-sm border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white"
                >
                  <option value="all">All Types</option>
                  {menuTypes.map(mt => (
                    <option key={mt.id} value={mt.id}>{mt.name.replace(/_/g, ' ')}</option>
                  ))}
                </select>
              </div>
              <div className="flex items-center gap-2">
                <label className="text-sm text-slate-600 dark:text-slate-400">Status:</label>
                <select
                  value={filterMenuStatus}
                  onChange={(e) => setFilterMenuStatus(e.target.value)}
                  className="px-3 py-2 text-sm border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white"
                >
                  <option value="all">All Status</option>
                  <option value="published">Published</option>
                  <option value="draft">Draft</option>
                </select>
              </div>
              {(filterMenuType !== 'all' || filterMenuStatus !== 'all' || filterSearch) && (
                <button
                  onClick={() => { setFilterMenuType('all'); setFilterMenuStatus('all'); setFilterSearch(''); }}
                  className="text-sm text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
                >
                  Clear Filters
                </button>
              )}
            </div>

            {/* Menus List */}
            <div className="space-y-3">
              <h3 className="text-lg font-bold text-gray-900 dark:text-white flex items-center gap-2">
                <div className="p-2 rounded-lg bg-[var(--color-accent-operations)]/10 text-[var(--color-accent-operations)]">
                  <BookOpen className="w-5 h-5" />
                </div>
                Menu Collections
              </h3>
              {menus.length === 0 ? (
                <div className="text-center py-8 text-gray-500 text-sm">No menus found. Create a menu to organize your items.</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50 dark:bg-slate-900/40 text-left text-xs uppercase text-slate-500">
                      <tr>
                        <th className="px-4 py-3 font-medium">Name</th>
                        <th className="px-4 py-3 font-medium">Type</th>
                        <th className="px-4 py-3 font-medium">Base Price</th>
                        <th className="px-4 py-3 font-medium">Valid From</th>
                        <th className="px-4 py-3 font-medium">Valid To</th>
                        <th className="px-4 py-3 font-medium">Outlet</th>
                        <th className="px-4 py-3 font-medium">Status</th>
                        <th className="px-4 py-3 font-medium">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200 dark:divide-slate-700">
                      {menus
                        .filter(menu => {
                          const matchesType = filterMenuType === 'all' || menu.menu_type_id === filterMenuType;
                          const matchesStatus = filterMenuStatus === 'all' || 
                            (filterMenuStatus === 'published' ? menu.is_published : !menu.is_published);
                          const matchesSearch = !filterSearch || 
                            menu.name.toLowerCase().includes(filterSearch.toLowerCase()) ||
                            (menu.description && menu.description.toLowerCase().includes(filterSearch.toLowerCase()));
                          return matchesType && matchesStatus && matchesSearch;
                        })
                        .map((menu) => (
                        <tr key={menu.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/40">
                          <td className="px-4 py-3">
                            <div className="font-medium text-gray-900 dark:text-white">{menu.name}</div>
                            {menu.description && (
                              <div className="text-xs text-slate-500 dark:text-slate-400 line-clamp-1 max-w-xs">{menu.description}</div>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            {menu.menu_type && <Badge tone="info">{menu.menu_type.name.replace(/_/g, ' ')}</Badge>}
                          </td>
                          <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{menu.base_price ? formatAmount(menu.base_price) : '—'}</td>
                          <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{menu.valid_from || '—'}</td>
                          <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{menu.valid_to || '—'}</td>
                          <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{menu.outlet?.name || '—'}</td>
                          <td className="px-4 py-3">
                            <Badge tone={menu.is_published ? 'success' : 'neutral'}>
                              {menu.is_published ? 'Published' : 'Draft'}
                            </Badge>
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2">
                              <button onClick={() => { setSelectedMenu(menu.id); fetchMenuItemMenus(menu.id); setShowMenuItemsModal(true); }} className={button.ghost} title="View Items">
                                <Eye className="w-4 h-4" />
                              </button>
                              <button onClick={() => handleEditMenu(menu)} className={button.ghost}>
                                <Edit className="w-4 h-4" />
                              </button>
                              <button onClick={() => handleDeleteMenu(menu.id)} className={button.ghost}>
                                <Trash2 className="w-4 h-4 text-red-600 dark:text-red-400" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Modifiers Tab */}
        {activeTab === 'modifiers' && (
          <div className="space-y-4">
            {/* Filters */}
            <div className="flex flex-wrap items-center gap-4 p-4 bg-slate-50 dark:bg-slate-900/40 rounded-xl border border-gray-200 dark:border-slate-700">
              <div className="flex items-center gap-2">
                <Search className="w-4 h-4 text-slate-500" />
                <input
                  type="text"
                  placeholder="Search modifier groups..."
                  value={filterSearch}
                  onChange={(e) => setFilterSearch(e.target.value)}
                  className="px-3 py-2 text-sm border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white w-48"
                />
              </div>
              <div className="flex items-center gap-2">
                <label className="text-sm text-slate-600 dark:text-slate-400">Status:</label>
                <select
                  value={filterModifierStatus}
                  onChange={(e) => setFilterModifierStatus(e.target.value)}
                  className="px-3 py-2 text-sm border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white"
                >
                  <option value="all">All Status</option>
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                </select>
              </div>
              {(filterModifierStatus !== 'all' || filterSearch) && (
                <button
                  onClick={() => { setFilterModifierStatus('all'); setFilterSearch(''); }}
                  className="text-sm text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
                >
                  Clear Filters
                </button>
              )}
            </div>

            {loading ? (
              <div className="text-center py-8 text-gray-500">Loading modifier groups...</div>
            ) : modifierGroups.length === 0 ? (
              <div className="text-center py-8 text-gray-500">
                <Layers className="w-10 h-10 mx-auto mb-2 opacity-50" />
                <p className="text-sm">No modifier groups found</p>
                <p className="text-xs mt-1">Click "Add Group" to create your first modifier group</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 dark:bg-slate-900/40 text-left text-xs uppercase text-slate-500">
                    <tr>
                      <th className="px-4 py-3 font-medium">Name</th>
                      <th className="px-4 py-3 font-medium">Selection Type</th>
                      <th className="px-4 py-3 font-medium">Required</th>
                      <th className="px-4 py-3 font-medium">Min/Max</th>
                      <th className="px-4 py-3 font-medium">Options</th>
                      <th className="px-4 py-3 font-medium">Sort Order</th>
                      <th className="px-4 py-3 font-medium">Status</th>
                      <th className="px-4 py-3 font-medium">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200 dark:divide-slate-700">
                    {modifierGroups
                      .filter(group => {
                        const matchesStatus = filterModifierStatus === 'all' || 
                          (filterModifierStatus === 'active' ? group.is_active : !group.is_active);
                        const matchesSearch = !filterSearch || 
                          group.name.toLowerCase().includes(filterSearch.toLowerCase()) ||
                          (group.description && group.description.toLowerCase().includes(filterSearch.toLowerCase()));
                        return matchesStatus && matchesSearch;
                      })
                      .map((group) => (
                        <tr key={group.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/40">
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-3">
                              <div className="shrink-0 p-2 rounded-lg bg-[var(--color-accent-operations)]/10 text-[var(--color-accent-operations)]">
                                <Layers className="w-4 h-4" />
                              </div>
                              <div>
                                <div className="font-medium text-gray-900 dark:text-white">{group.name}</div>
                                {group.description && (
                                  <div className="text-xs text-slate-500 dark:text-slate-400 line-clamp-1 max-w-xs">{group.description}</div>
                                )}
                              </div>
                            </div>
                          </td>
                          <td className="px-4 py-3 text-slate-600 dark:text-slate-400 capitalize">{group.selection_type}</td>
                          <td className="px-4 py-3">
                            <Badge tone={group.is_required ? 'success' : 'neutral'}>
                              {group.is_required ? 'Required' : 'Optional'}
                            </Badge>
                          </td>
                          <td className="px-4 py-3 text-slate-600 dark:text-slate-400">
                            {group.min_selections} / {group.max_selections || '∞'}
                          </td>
                          <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{(group.options || []).length}</td>
                          <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{group.sort_order}</td>
                          <td className="px-4 py-3">
                            <Badge tone={group.is_active ? 'success' : 'neutral'}>
                              {group.is_active ? 'Active' : 'Inactive'}
                            </Badge>
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2">
                              <button
                                onClick={() => { setSelectedModifierGroup(group.id); setShowModifierOptionsModal(true); }}
                                className={button.ghost}
                                title="View Options"
                              >
                                <Eye className="w-4 h-4" />
                              </button>
                              <button onClick={() => handleEditModifierGroup(group)} className={button.ghost}>
                                <Edit className="w-4 h-4" />
                              </button>
                              <button onClick={() => handleDeleteModifierGroup(group.id)} className={button.ghost}>
                                <Trash2 className="w-4 h-4 text-red-600 dark:text-red-400" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* Availability Tab */}
        {activeTab === 'availability' && (
          <div className="space-y-6">
            {/* Filters */}
            <div className="flex flex-wrap items-center gap-4 p-4 bg-slate-50 dark:bg-slate-900/40 rounded-xl border border-gray-200 dark:border-slate-700">
              <div className="flex items-center gap-2">
                <Search className="w-4 h-4 text-slate-500" />
                <input
                  type="text"
                  placeholder="Search rules..."
                  value={filterSearch}
                  onChange={(e) => setFilterSearch(e.target.value)}
                  className="px-3 py-2 text-sm border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white w-48"
                />
              </div>
              <div className="flex items-center gap-2">
                <label className="text-sm text-slate-600 dark:text-slate-400">Type:</label>
                <select
                  value={selectedMenuItem || ''}
                  onChange={(e) => { setSelectedMenuItem(e.target.value); fetchAvailabilityRules(e.target.value); }}
                  className="px-3 py-2 text-sm border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white"
                >
                  <option value="">All Items</option>
                  {menuItems.map((item) => (
                    <option key={item.id} value={item.id}>{item.name}</option>
                  ))}
                </select>
              </div>
              <div className="flex items-center gap-2">
                <label className="text-sm text-slate-600 dark:text-slate-400">Status:</label>
                <select
                  value={filterAvailabilityStatus}
                  onChange={(e) => setFilterAvailabilityStatus(e.target.value)}
                  className="px-3 py-2 text-sm border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white"
                >
                  <option value="all">All Status</option>
                  <option value="available">Available</option>
                  <option value="unavailable">Unavailable</option>
                  <option value="active">Active Rules</option>
                  <option value="inactive">Inactive Rules</option>
                </select>
              </div>
              {(filterAvailabilityStatus !== 'all' || filterSearch) && (
                <button
                  onClick={() => { setFilterAvailabilityStatus('all'); setFilterSearch(''); }}
                  className="text-sm text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
                >
                  Clear Filters
                </button>
              )}
            </div>

            {availabilityRules.length === 0 ? (
              <div className="text-center py-8 text-gray-500 text-sm">No availability rules found</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 dark:bg-slate-900/40 text-left text-xs uppercase text-slate-500">
                    <tr>
                      <th className="px-4 py-3 font-medium">Rule Type</th>
                      <th className="px-4 py-3 font-medium">Menu Item</th>
                      <th className="px-4 py-3 font-medium">Outlet</th>
                      <th className="px-4 py-3 font-medium">Days</th>
                      <th className="px-4 py-3 font-medium">Time Range</th>
                      <th className="px-4 py-3 font-medium">Date Range</th>
                      <th className="px-4 py-3 font-medium">Availability</th>
                      <th className="px-4 py-3 font-medium">Status</th>
                      <th className="px-4 py-3 font-medium">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200 dark:divide-slate-700">
                    {availabilityRules
                      .filter(rule => {
                        const matchesStatus = filterAvailabilityStatus === 'all' || 
                          (filterAvailabilityStatus === 'available' ? rule.is_available : 
                           filterAvailabilityStatus === 'unavailable' ? !rule.is_available :
                           filterAvailabilityStatus === 'active' ? rule.is_active :
                           filterAvailabilityStatus === 'inactive' ? !rule.is_active : true);
                        const matchesSearch = !filterSearch || 
                          rule.menu_item?.name.toLowerCase().includes(filterSearch.toLowerCase()) ||
                          rule.outlet?.name.toLowerCase().includes(filterSearch.toLowerCase()) ||
                          rule.reason?.toLowerCase().includes(filterSearch.toLowerCase());
                        return matchesStatus && matchesSearch;
                      })
                      .map((rule) => (
                      <tr key={rule.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/40">
                        <td className="px-4 py-3 text-slate-600 dark:text-slate-400 capitalize">{rule.rule_type.replace('_', ' ')}</td>
                        <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{rule.menu_item?.name || '—'}</td>
                        <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{rule.outlet?.name || 'All outlets'}</td>
                        <td className="px-4 py-3 text-slate-600 dark:text-slate-400 text-xs">{rule.applicable_days.join(', ')}</td>
                        <td className="px-4 py-3 text-slate-600 dark:text-slate-400 text-xs">{rule.start_time} - {rule.end_time}</td>
                        <td className="px-4 py-3 text-slate-600 dark:text-slate-400 text-xs">
                          {rule.start_date && rule.end_date ? `${rule.start_date} to ${rule.end_date}` : rule.start_date || rule.end_date || '—'}
                        </td>
                        <td className="px-4 py-3">
                          <Badge tone={rule.is_available ? 'success' : 'danger'}>
                            {rule.is_available ? 'Available' : 'Unavailable'}
                          </Badge>
                        </td>
                        <td className="px-4 py-3">
                          <Badge tone={rule.is_active ? 'success' : 'neutral'}>
                            {rule.is_active ? 'Active' : 'Inactive'}
                          </Badge>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <button onClick={() => handleEditAvailabilityRule(rule)} className={button.ghost}>
                              <Edit className="w-4 h-4" />
                            </button>
                            <button onClick={() => handleDeleteAvailabilityRule(rule.id)} className={button.ghost}>
                              <Trash2 className="w-4 h-4 text-red-600 dark:text-red-400" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* Versions & Publishing Tab (consolidated) */}
        {activeTab === 'versions' && (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold text-gray-900 dark:text-white flex items-center gap-2">
                <div className="p-2 rounded-lg bg-[var(--color-accent-operations)]/10 text-[var(--color-accent-operations)]">
                  <Clock className="w-5 h-5" />
                </div>
                Menu Versions & Publishing
              </h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 dark:bg-slate-900/40 text-left text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-4 py-3 font-medium">Menu</th>
                    <th className="px-4 py-3 font-medium">Type</th>
                    <th className="px-4 py-3 font-medium">Items</th>
                    <th className="px-4 py-3 font-medium">Valid From</th>
                    <th className="px-4 py-3 font-medium">Valid To</th>
                    <th className="px-4 py-3 font-medium">Updated</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                    <th className="px-4 py-3 font-medium text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 dark:divide-slate-700">
                  {menus.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="px-4 py-8 text-center text-slate-500 text-sm">No menu versions found. Create a menu first.</td>
                    </tr>
                  ) : (
                    menus.map(m => {
                      const itemCount = menuItemMenus.filter(mim => mim.menu_id === m.id).length;
                      return (
                        <tr key={m.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/40">
                          <td className="px-4 py-3 font-medium text-gray-900 dark:text-white">{m.name}</td>
                          <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{m.menu_type?.name?.replace(/_/g, ' ') || '—'}</td>
                          <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{itemCount}</td>
                          <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{m.valid_from || '—'}</td>
                          <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{m.valid_to || '—'}</td>
                          <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{m.updated_at ? new Date(m.updated_at).toLocaleDateString() : '—'}</td>
                          <td className="px-4 py-3"><Badge tone={m.is_published ? 'success' : 'neutral'}>{m.is_published ? 'Published' : 'Draft'}</Badge></td>
                          <td className="px-4 py-3 text-right">
                            <div className="flex items-center justify-end gap-2">
                              <button onClick={() => { setSelectedMenu(m.id); fetchMenuItemMenus(m.id); setShowMenuItemsModal(true); }} className={button.ghost}>
                                <Eye className="w-4 h-4" />
                              </button>
                              <button
                                onClick={async () => {
                                  try {
                                    const response = await fetch(`/api/fb/menu-catalog/menus/${m.id}`, {
                                      method: 'PATCH',
                                      headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
                                      body: JSON.stringify({ is_published: !m.is_published })
                                    });
                                    if (!response.ok) throw new Error('Failed to update');
                                    addNotification(`${m.name} ${m.is_published ? 'unpublished' : 'published'}`, 'success', 'F&B');
                                    fetchMenus();
                                  } catch {
                                    addNotification('Failed to update menu', 'warning', 'F&B');
                                  }
                                }}
                                className={button.ghost}
                              >
                                {m.is_published ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                                <span>{m.is_published ? 'Unpublish' : 'Publish'}</span>
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Digital Tab */}
        {activeTab === 'digital' && (
          <div className="space-y-6">
            {/* Filters */}
            <div className="flex flex-wrap items-center gap-4 p-4 bg-slate-50 dark:bg-slate-900/40 rounded-xl border border-gray-200 dark:border-slate-700">
              <div className="flex items-center gap-2">
                <Search className="w-4 h-4 text-slate-500" />
                <input
                  type="text"
                  placeholder="Search digital menus..."
                  value={filterSearch}
                  onChange={(e) => setFilterSearch(e.target.value)}
                  className="px-3 py-2 text-sm border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white w-48"
                />
              </div>
              <div className="flex items-center gap-2">
                <label className="text-sm text-slate-600 dark:text-slate-400">Status:</label>
                <select
                  value={filterDigitalStatus}
                  onChange={(e) => setFilterDigitalStatus(e.target.value)}
                  className="px-3 py-2 text-sm border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white"
                >
                  <option value="all">All Status</option>
                  <option value="published">Published</option>
                  <option value="draft">Draft</option>
                </select>
              </div>
              {(filterDigitalStatus !== 'all' || filterSearch) && (
                <button
                  onClick={() => { setFilterDigitalStatus('all'); setFilterSearch(''); }}
                  className="text-sm text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
                >
                  Clear Filters
                </button>
              )}
            </div>

            {/* Digital Menus List */}
            <div className="space-y-3">
              <h3 className="text-lg font-bold text-gray-900 dark:text-white flex items-center gap-2">
                <div className="p-2 rounded-lg bg-[var(--color-accent-operations)]/10 text-[var(--color-accent-operations)]">
                  <QrCode className="w-5 h-5" />
                </div>
                Digital Menus
              </h3>
              {digitalMenus.length === 0 ? (
                <div className="text-center py-8 text-gray-500 text-sm">No digital menus found</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50 dark:bg-slate-900/40 text-left text-xs uppercase text-slate-500">
                      <tr>
                        <th className="px-4 py-3 font-medium">Name</th>
                        <th className="px-4 py-3 font-medium">Outlet</th>
                        <th className="px-4 py-3 font-medium">Languages</th>
                        <th className="px-4 py-3 font-medium">Primary Language</th>
                        <th className="px-4 py-3 font-medium">QR Code</th>
                        <th className="px-4 py-3 font-medium">Published URL</th>
                        <th className="px-4 py-3 font-medium">Status</th>
                        <th className="px-4 py-3 font-medium">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200 dark:divide-slate-700">
                      {digitalMenus
                        .filter(menu => {
                          const matchesStatus = filterDigitalStatus === 'all' || 
                            (filterDigitalStatus === 'published' ? menu.is_published : !menu.is_published);
                          const matchesSearch = !filterSearch || 
                            menu.name.toLowerCase().includes(filterSearch.toLowerCase()) ||
                            (menu.outlet?.name && menu.outlet.name.toLowerCase().includes(filterSearch.toLowerCase()));
                          return matchesStatus && matchesSearch;
                        })
                        .map((menu) => (
                        <tr key={menu.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/40">
                          <td className="px-4 py-3 font-medium text-gray-900 dark:text-white">{menu.name}</td>
                          <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{menu.outlet?.name || 'All outlets'}</td>
                          <td className="px-4 py-3 text-slate-600 dark:text-slate-400 text-xs">{menu.supported_languages?.join(', ') || '—'}</td>
                          <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{menu.primary_language}</td>
                          <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{menu.qr_code ? '✓' : '—'}</td>
                          <td className="px-4 py-3 text-slate-600 dark:text-slate-400 text-xs max-w-xs truncate">{menu.published_url || '—'}</td>
                          <td className="px-4 py-3">
                            <Badge tone={menu.is_published ? 'success' : 'neutral'}>
                              {menu.is_published ? 'Published' : 'Draft'}
                            </Badge>
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2">
                              <button onClick={() => handleGenerateQR(menu.id)} className={button.ghost} title="Generate QR Code">
                                <QrCode className="w-4 h-4" />
                              </button>
                              <button onClick={() => { setSelectedDigitalMenu(menu.id); fetchDigitalMenuItems(menu.id); }} className={button.ghost} title="View Items">
                                <Eye className="w-4 h-4" />
                              </button>
                              <button onClick={() => handleEditDigitalMenu(menu)} className={button.ghost}>
                                <Edit className="w-4 h-4" />
                              </button>
                              <button onClick={() => handleDeleteDigitalMenu(menu.id)} className={button.ghost}>
                                <Trash2 className="w-4 h-4 text-red-600 dark:text-red-400" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Digital Menu Items */}
            {selectedDigitalMenu && (
              <div className="space-y-3 border-t border-gray-200 dark:border-slate-700 pt-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-lg font-bold text-gray-900 dark:text-white flex items-center gap-2">
                    <div className="p-2 rounded-lg bg-[var(--color-accent-operations)]/10 text-[var(--color-accent-operations)]">
                      <Utensils className="w-5 h-5" />
                    </div>
                    Menu Items: {digitalMenus.find(m => m.id === selectedDigitalMenu)?.name}
                  </h3>
                  <button onClick={handleAddItemToDigitalMenu} className={button.primary}>
                    <Plus className="w-3 h-3" /> Add Item
                  </button>
                </div>
                {digitalMenuItems.filter(i => i.digital_menu_id === selectedDigitalMenu).length === 0 ? (
                  <div className="text-center py-8 text-gray-500 text-sm">No items in this menu</div>
                ) : (
                  <div className="space-y-2">
                    {digitalMenuItems.filter(i => i.digital_menu_id === selectedDigitalMenu).map((item) => (
                      <div key={item.id} className="flex items-center justify-between bg-white dark:bg-slate-800 rounded-xl px-3 py-2 border border-gray-200 dark:border-slate-700">
                        <div className="flex items-center gap-3">
                          <div className="w-6 h-6 bg-[var(--color-accent-operations)]/10 rounded-xl flex items-center justify-center">
                            <Utensils className="w-3 h-3 text-[var(--color-accent-operations)]" />
                          </div>
                          <div>
                            <span className="text-sm text-gray-900 dark:text-white">{item.menu_item?.name}</span>
                            {item.display_category && (
                              <span className="text-xs text-gray-600 dark:text-gray-400 ml-2">({item.display_category})</span>
                            )}
                            {item.is_featured && (
                              <Badge tone="warning" className="ml-2">Featured</Badge>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <button onClick={() => handleRemoveDigitalMenuItem(item.id)} className={button.ghost}>
                            <Trash2 className="w-3 h-3 text-red-600 dark:text-red-400" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Menu Items Modal (View Items popup) */}
      {showMenuItemsModal && selectedMenu && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 overflow-y-auto">
          <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 w-full max-w-3xl my-8 border border-gray-200 dark:border-slate-700">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
                <div className="p-2 rounded-lg bg-[var(--color-accent-operations)]/10 text-[var(--color-accent-operations)]">
                  <Utensils className="w-5 h-5" />
                </div>
                Menu Items: {menus.find(m => m.id === selectedMenu)?.name}
              </h2>
              <button onClick={() => { setShowMenuItemsModal(false); setSelectedMenu(null); }} className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="flex items-center justify-end mb-3">
              <button onClick={handleAddItemToMenu} className={button.primary}>
                <Plus className="w-3 h-3" /> Add Item
              </button>
            </div>
            {menuItemMenus.filter(m => m.menu_id === selectedMenu).length === 0 ? (
              <div className="text-center py-8 text-gray-500 text-sm">No items in this menu</div>
            ) : (
              <div className="space-y-2 max-h-[60vh] overflow-y-auto">
                {menuItemMenus.filter(m => m.menu_id === selectedMenu).map((link) => (
                  <div key={link.id} className="flex items-center justify-between bg-white dark:bg-slate-800 rounded-xl px-3 py-2 border border-gray-200 dark:border-slate-700">
                    <div className="flex items-center gap-3">
                      <div className="w-6 h-6 bg-[var(--color-accent-operations)]/10 rounded-xl flex items-center justify-center">
                        <Utensils className="w-3 h-3 text-[var(--color-accent-operations)]" />
                      </div>
                      <div>
                        <span className="text-sm text-gray-900 dark:text-white">{link.override_name || link.menu_item?.name}</span>
                        {link.course_name && (
                          <Badge tone="info" className="ml-2">{link.course_name}</Badge>
                        )}
                        {link.override_price !== null && (
                          <span className="text-xs text-gray-600 dark:text-gray-400 ml-2">({formatAmount(link.override_price)})</span>
                        )}
                        {link.is_featured && (
                          <Badge tone="warning" className="ml-2">Featured</Badge>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button onClick={() => handleRemoveItemFromMenu(link.id)} className={button.ghost}>
                        <Trash2 className="w-3 h-3 text-red-600 dark:text-red-400" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Modifier Options Modal (View Options popup) */}
      {showModifierOptionsModal && selectedModifierGroup && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 overflow-y-auto">
          <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 w-full max-w-2xl my-8 border border-gray-200 dark:border-slate-700">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
                <div className="p-2 rounded-lg bg-[var(--color-accent-operations)]/10 text-[var(--color-accent-operations)]">
                  <Layers className="w-5 h-5" />
                </div>
                Options: {modifierGroups.find(g => g.id === selectedModifierGroup)?.name}
              </h2>
              <button onClick={() => { setShowModifierOptionsModal(false); setSelectedModifierGroup(null); }} className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="flex items-center justify-end mb-3">
              <button onClick={() => handleCreateModifierOption(selectedModifierGroup)} className={button.primary}>
                <Plus className="w-3 h-3" /> Add Option
              </button>
            </div>
            {(() => {
              const group = modifierGroups.find(g => g.id === selectedModifierGroup);
              const options = group?.options || [];
              if (options.length === 0) {
                return <div className="text-center py-8 text-gray-500 text-sm">No options in this group</div>;
              }
              return (
                <div className="space-y-2 max-h-[60vh] overflow-y-auto">
                  {options.map((option) => (
                    <div key={option.id} className="flex items-center justify-between bg-white dark:bg-slate-800 rounded-xl px-3 py-2 border border-gray-200 dark:border-slate-700">
                      <div className="flex items-center gap-3">
                        <div className="w-6 h-6 bg-[var(--color-accent-operations)]/10 rounded-xl flex items-center justify-center">
                          <Layers className="w-3 h-3 text-[var(--color-accent-operations)]" />
                        </div>
                        <div>
                          <span className="text-sm text-gray-900 dark:text-white">{option.name}</span>
                          {option.price_adjustment !== 0 && (
                            <span className="text-xs text-gray-600 dark:text-gray-400 ml-2">({formatAmount(option.price_adjustment)})</span>
                          )}
                          {option.is_default && (
                            <Badge tone="info" className="ml-2 text-xs">Default</Badge>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <button onClick={() => handleDeleteModifierOption(option.id)} className={button.ghost}>
                          <Trash2 className="w-3 h-3 text-red-600 dark:text-red-400" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              );
            })()}
            {/* Link modifiers to menu item section */}
            <div className="mt-4 pt-4 border-t border-gray-200 dark:border-slate-700">
              <h3 className="text-sm font-bold text-gray-900 dark:text-white mb-3 flex items-center gap-2">
                <LinkIcon className="w-4 h-4 text-[var(--color-accent-operations)]" />
                Link to Menu Item
              </h3>
              <div className="flex gap-3">
                <select
                  value={selectedMenuItem || ''}
                  onChange={(e) => { setSelectedMenuItem(e.target.value); fetchMenuItemModifiers(e.target.value); }}
                  className="flex-1 px-3 py-2 border border-gray-300 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-gray-900 dark:text-white text-sm"
                >
                  <option value="">Select menu item...</option>
                  {menuItems.map((item) => (
                    <option key={item.id} value={item.id}>{item.name}</option>
                  ))}
                </select>
              </div>
              {selectedMenuItem && (
                <div className="mt-3 space-y-2">
                  <div className="text-xs text-gray-600 dark:text-gray-400">Linked modifier groups:</div>
                  {menuItemModifiers.filter(m => m.menu_item_id === selectedMenuItem).length === 0 ? (
                    <div className="text-xs text-gray-500 italic">None linked</div>
                  ) : (
                    menuItemModifiers.filter(m => m.menu_item_id === selectedMenuItem).map((link) => (
                      <div key={link.id} className="flex items-center justify-between bg-slate-50 dark:bg-slate-900/40 rounded-xl px-3 py-2 border border-gray-200 dark:border-slate-700">
                        <span className="text-sm text-gray-900 dark:text-white">{link.modifier_group?.name}</span>
                        <button onClick={() => handleUnlinkModifierFromMenuItem(link.id)} className={button.ghost}>
                          <Unlink className="w-3 h-3" />
                        </button>
                      </div>
                    ))
                  )}
                  <div className="flex gap-2 mt-2">
                    <select
                      value=""
                      onChange={(e) => e.target.value && handleLinkModifierToMenuItem(e.target.value)}
                      className="flex-1 px-3 py-2 border border-gray-300 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-gray-900 dark:text-white text-sm"
                    >
                      <option value="">Add modifier group...</option>
                      {modifierGroups.filter(g => !menuItemModifiers.find(m => m.modifier_group_id === g.id)).map((group) => (
                        <option key={group.id} value={group.id}>{group.name}</option>
                      ))}
                    </select>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Unified Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto border border-gray-200 dark:border-slate-700 card-shadow">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold text-gray-900 dark:text-white">
                {editingItem ? `Edit ${modalType.replace(/([A-Z])/g, ' $1').trim()}` : `New ${modalType.replace(/([A-Z])/g, ' $1').trim()}`}
              </h2>
              <button onClick={() => setShowModal(false)} className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="space-y-4">
              {/* Dynamic form fields based on modalType */}
              {modalType === 'menuItem' && (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Item Code</label>
                      <input
                        type="text"
                        value={formData.item_code || ''}
                        onChange={(e) => setFormData({ ...formData, item_code: e.target.value })}
                        className="w-full px-3 py-2 border border-gray-300 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-gray-900 dark:text-white"
                        placeholder="e.g., ITM001"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">SKU</label>
                      <input
                        type="text"
                        value={formData.sku || ''}
                        onChange={(e) => setFormData({ ...formData, sku: e.target.value })}
                        className="w-full px-3 py-2 border border-gray-300 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-gray-900 dark:text-white"
                        placeholder="e.g., SKU-001"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Item Name</label>
                    <input
                      type="text"
                      value={formData.name}
                      onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-gray-900 dark:text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Description</label>
                    <textarea
                      value={formData.description || ''}
                      onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-gray-900 dark:text-white"
                      rows={2}
                      placeholder="Detailed description of the item"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Category</label>
                      <input
                        type="text"
                        value={formData.category}
                        onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                        className="w-full px-3 py-2 border border-gray-300 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-gray-900 dark:text-white"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Subcategory</label>
                      <input
                        type="text"
                        value={formData.subcategory || ''}
                        onChange={(e) => setFormData({ ...formData, subcategory: e.target.value })}
                        className="w-full px-3 py-2 border border-gray-300 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-gray-900 dark:text-white"
                        placeholder="e.g., Hot Appetizers"
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Selling Price</label>
                      <input
                        type="number"
                        value={formData.selling_price}
                        onChange={(e) => setFormData({ ...formData, selling_price: parseFloat(e.target.value) || 0 })}
                        className="w-full px-3 py-2 border border-gray-300 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-gray-900 dark:text-white"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Prep Time (min)</label>
                      <input
                        type="number"
                        value={formData.preparation_time_minutes || ''}
                        onChange={(e) => setFormData({ ...formData, preparation_time_minutes: parseInt(e.target.value) || null })}
                        className="w-full px-3 py-2 border border-gray-300 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-gray-900 dark:text-white"
                        placeholder="e.g., 15"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Tax Code</label>
                    <input
                      type="text"
                      value={formData.tax_code || ''}
                      onChange={(e) => setFormData({ ...formData, tax_code: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-gray-900 dark:text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Revenue Account</label>
                    <input
                      type="text"
                      value={formData.revenue_account || ''}
                      onChange={(e) => setFormData({ ...formData, revenue_account: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-gray-900 dark:text-white"
                      placeholder="e.g., 4000"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Meal Periods</label>
                    <input
                      type="text"
                      value={formData.meal_periods?.join(', ') || ''}
                      onChange={(e) => setFormData({ ...formData, meal_periods: e.target.value.split(',').map(s => s.trim()).filter(Boolean) })}
                      placeholder="Breakfast, Lunch, Dinner"
                      className="w-full px-3 py-2 border border-gray-300 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-gray-900 dark:text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Allergens</label>
                    <input
                      type="text"
                      value={formData.allergen_info?.join(', ') || ''}
                      onChange={(e) => setFormData({ ...formData, allergen_info: e.target.value.split(',').map(s => s.trim()).filter(Boolean) })}
                      placeholder="gluten, dairy, nuts, shellfish, eggs, soy"
                      className="w-full px-3 py-2 border border-gray-300 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-gray-900 dark:text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Outlets</label>
                    <div className="space-y-2 max-h-32 overflow-y-auto border border-gray-200 dark:border-slate-700 rounded-xl p-2">
                      {outlets.map((outlet) => (
                        <label key={outlet.id} className="flex items-center gap-2 p-2 hover:bg-slate-50 dark:hover:bg-slate-700 rounded-lg cursor-pointer">
                          <input
                            type="checkbox"
                            checked={formData.assigned_outlets?.includes(outlet.id) || false}
                            onChange={(e) => {
                              const current = formData.assigned_outlets || [];
                              if (e.target.checked) {
                                setFormData({ ...formData, assigned_outlets: [...current, outlet.id] });
                              } else {
                                setFormData({ ...formData, assigned_outlets: current.filter((id: string) => id !== outlet.id) });
                              }
                            }}
                            className="w-4 h-4 rounded border-gray-300"
                          />
                          <span className="text-sm text-gray-900 dark:text-white">{outlet.name}</span>
                        </label>
                      ))}
                      {outlets.length === 0 && (
                        <div className="text-xs text-gray-500 italic p-2">No outlets available.</div>
                      )}
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Default Station (KDS)</label>
                    <select
                      value={formData.default_station_id || ''}
                      onChange={(e) => setFormData({ ...formData, default_station_id: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-gray-900 dark:text-white"
                    >
                      <option value="">No default station</option>
                      {stations.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.code})</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Assigned Stations (KDS)</label>
                    <div className="space-y-2 max-h-32 overflow-y-auto border border-gray-200 dark:border-slate-700 rounded-xl p-2">
                      {stations.map((station) => (
                        <label key={station.id} className="flex items-center gap-2 p-2 hover:bg-slate-50 dark:hover:bg-slate-700 rounded-lg cursor-pointer">
                          <input
                            type="checkbox"
                            checked={formData.assigned_stations?.includes(station.id) || false}
                            onChange={(e) => {
                              const current = formData.assigned_stations || [];
                              if (e.target.checked) {
                                setFormData({ ...formData, assigned_stations: [...current, station.id] });
                              } else {
                                setFormData({ ...formData, assigned_stations: current.filter((id: string) => id !== station.id) });
                              }
                            }}
                            className="w-4 h-4 rounded border-gray-300"
                          />
                          <div className="flex-1">
                            <span className="text-sm text-gray-900 dark:text-white">{station.name}</span>
                            {station.code && <Badge tone="info" className="ml-2 text-xs">{station.code}</Badge>}
                          </div>
                        </label>
                      ))}
                      {stations.length === 0 && (
                        <div className="text-xs text-gray-500 italic p-2">No stations available. Create stations first.</div>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      id="isActive"
                      checked={formData.is_active}
                      onChange={(e) => setFormData({ ...formData, is_active: e.target.checked })}
                      className="w-4 h-4 rounded border-gray-300"
                    />
                    <label htmlFor="isActive" className="text-sm text-gray-700 dark:text-gray-300">Active</label>
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      id="isFixedMenu"
                      checked={formData.is_fixed_menu}
                      onChange={(e) => setFormData({ ...formData, is_fixed_menu: e.target.checked })}
                      className="w-4 h-4 rounded border-gray-300"
                    />
                    <label htmlFor="isFixedMenu" className="text-sm text-gray-700 dark:text-gray-300">Fixed Menu</label>
                  </div>
                </>
              )}
              {modalType === 'modifierGroup' && (
                <>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Group Name</label>
                    <input
                      type="text"
                      value={formData.name}
                      onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-gray-900 dark:text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Selection Type</label>
                    <select
                      value={formData.selection_type}
                      onChange={(e) => setFormData({ ...formData, selection_type: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-gray-900 dark:text-white"
                    >
                      <option value="single">Single</option>
                      <option value="multi">Multi</option>
                      <option value="quantity">Quantity</option>
                    </select>
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      id="isRequired"
                      checked={formData.is_required}
                      onChange={(e) => setFormData({ ...formData, is_required: e.target.checked })}
                      className="w-4 h-4 rounded border-gray-300"
                    />
                    <label htmlFor="isRequired" className="text-sm text-gray-700 dark:text-gray-300">Required</label>
                  </div>
                </>
              )}
              {modalType === 'modifierOption' && (
                <>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Option Name</label>
                    <input
                      type="text"
                      value={formData.name}
                      onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-gray-900 dark:text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Price Adjustment</label>
                    <input
                      type="number"
                      value={formData.price_adjustment}
                      onChange={(e) => setFormData({ ...formData, price_adjustment: parseFloat(e.target.value) || 0 })}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-gray-900 dark:text-white"
                    />
                  </div>
                </>
              )}
              {modalType === 'availabilityRule' && (
                <>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Menu Item</label>
                    <select
                      value={formData.menu_item_id}
                      onChange={(e) => setFormData({ ...formData, menu_item_id: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-gray-900 dark:text-white"
                    >
                      {menuItems.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Rule Type</label>
                    <select
                      value={formData.rule_type}
                      onChange={(e) => setFormData({ ...formData, rule_type: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-gray-900 dark:text-white"
                    >
                      <option value="time_based">Time-based</option>
                      <option value="seasonal">Seasonal</option>
                      <option value="outlet_specific">Outlet-specific</option>
                      <option value="daily">Daily</option>
                    </select>
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      id="isAvailable"
                      checked={formData.is_available}
                      onChange={(e) => setFormData({ ...formData, is_available: e.target.checked })}
                      className="w-4 h-4 rounded border-gray-300"
                    />
                    <label htmlFor="isAvailable" className="text-sm text-gray-700 dark:text-gray-300">Available</label>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Start Time</label>
                    <input
                      type="time"
                      value={formData.start_time || ''}
                      onChange={(e) => setFormData({ ...formData, start_time: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-gray-900 dark:text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">End Time</label>
                    <input
                      type="time"
                      value={formData.end_time || ''}
                      onChange={(e) => setFormData({ ...formData, end_time: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-gray-900 dark:text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Reason</label>
                    <input
                      type="text"
                      value={formData.reason || ''}
                      onChange={(e) => setFormData({ ...formData, reason: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-gray-900 dark:text-white"
                    />
                  </div>
                </>
              )}
              {modalType === 'digitalMenu' && (
                <>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Menu Name</label>
                    <input
                      type="text"
                      value={formData.name}
                      onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-gray-900 dark:text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Outlet</label>
                    <select
                      value={formData.outlet_id || ''}
                      onChange={(e) => setFormData({ ...formData, outlet_id: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-gray-900 dark:text-white"
                    >
                      <option value="">All outlets</option>
                      {outlets.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Primary Language</label>
                    <input
                      type="text"
                      value={formData.primary_language}
                      onChange={(e) => setFormData({ ...formData, primary_language: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-gray-900 dark:text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Supported Languages (comma-separated)</label>
                    <input
                      type="text"
                      value={formData.supported_languages?.join(', ') || ''}
                      onChange={(e) => setFormData({ ...formData, supported_languages: e.target.value.split(',').map(s => s.trim()).filter(Boolean) })}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-gray-900 dark:text-white"
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      id="isPublished"
                      checked={formData.is_published}
                      onChange={(e) => setFormData({ ...formData, is_published: e.target.checked })}
                      className="w-4 h-4 rounded border-gray-300"
                    />
                    <label htmlFor="isPublished" className="text-sm text-gray-700 dark:text-gray-300">Published</label>
                  </div>
                </>
              )}
              {modalType === 'digitalMenuItem' && (
                <>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Menu Item</label>
                    <select
                      value={formData.menu_item_id}
                      onChange={(e) => setFormData({ ...formData, menu_item_id: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-gray-900 dark:text-white"
                    >
                      {menuItems.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Display Category</label>
                    <input
                      type="text"
                      value={formData.display_category || ''}
                      onChange={(e) => setFormData({ ...formData, display_category: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-gray-900 dark:text-white"
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      id="isFeatured"
                      checked={formData.is_featured}
                      onChange={(e) => setFormData({ ...formData, is_featured: e.target.checked })}
                      className="w-4 h-4 rounded border-gray-300"
                    />
                    <label htmlFor="isFeatured" className="text-sm text-gray-700 dark:text-gray-300">Featured</label>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Dietary Labels</label>
                    <input
                      type="text"
                      value={formData.dietary_labels?.join(', ') || ''}
                      onChange={(e) => setFormData({ ...formData, dietary_labels: e.target.value.split(',').map(s => s.trim()).filter(Boolean) })}
                      placeholder="vegetarian, vegan, gluten-free, keto, low-sodium"
                      className="w-full px-3 py-2 border border-gray-300 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-gray-900 dark:text-white"
                    />
                  </div>
                </>
              )}
              {modalType === 'menu' && (
                <>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Menu Name</label>
                    <input
                      type="text"
                      value={formData.name}
                      onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-gray-900 dark:text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Description</label>
                    <input
                      type="text"
                      value={formData.description || ''}
                      onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-gray-900 dark:text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Outlet</label>
                    <select
                      value={formData.outlet_id || ''}
                      onChange={(e) => setFormData({ ...formData, outlet_id: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-gray-900 dark:text-white"
                    >
                      <option value="">All outlets</option>
                      {outlets.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Menu Type</label>
                    <select
                      value={formData.menu_type_id || ''}
                      onChange={(e) => setFormData({ ...formData, menu_type_id: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-gray-900 dark:text-white"
                    >
                      {menuTypes.map((type) => <option key={type.id} value={type.id}>{type.name.replace(/_/g, ' ')}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Base Price (for fixed-price menus)</label>
                    <input
                      type="number"
                      value={formData.base_price || ''}
                      onChange={(e) => setFormData({ ...formData, base_price: parseFloat(e.target.value) || null })}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-gray-900 dark:text-white"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Valid From</label>
                      <input
                        type="date"
                        value={formData.valid_from || ''}
                        onChange={(e) => setFormData({ ...formData, valid_from: e.target.value })}
                        className="w-full px-3 py-2 border border-gray-300 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-gray-900 dark:text-white"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Valid To</label>
                      <input
                        type="date"
                        value={formData.valid_to || ''}
                        onChange={(e) => setFormData({ ...formData, valid_to: e.target.value })}
                        className="w-full px-3 py-2 border border-gray-300 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-gray-900 dark:text-white"
                      />
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      id="isPublishedMenu"
                      checked={formData.is_published}
                      onChange={(e) => setFormData({ ...formData, is_published: e.target.checked })}
                      className="w-4 h-4 rounded border-gray-300"
                    />
                    <label htmlFor="isPublishedMenu" className="text-sm text-gray-700 dark:text-gray-300">Published</label>
                  </div>
                </>
              )}
              {modalType === 'menuItemMenu' && (
                <>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Menu Item</label>
                    <select
                      value={formData.menu_item_id}
                      onChange={(e) => setFormData({ ...formData, menu_item_id: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-gray-900 dark:text-white"
                    >
                      {menuItems.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Course Name (for multi-course menus)</label>
                    <input
                      type="text"
                      value={formData.course_name || ''}
                      onChange={(e) => setFormData({ ...formData, course_name: e.target.value })}
                      placeholder="Appetizer, Main, Dessert..."
                      className="w-full px-3 py-2 border border-gray-300 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-gray-900 dark:text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Course Order</label>
                    <input
                      type="number"
                      value={formData.course_order || ''}
                      onChange={(e) => setFormData({ ...formData, course_order: parseInt(e.target.value) || null })}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-gray-900 dark:text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Override Price (optional)</label>
                    <input
                      type="number"
                      value={formData.override_price || ''}
                      onChange={(e) => setFormData({ ...formData, override_price: parseFloat(e.target.value) || null })}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-gray-900 dark:text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Override Name (optional)</label>
                    <input
                      type="text"
                      value={formData.override_name || ''}
                      onChange={(e) => setFormData({ ...formData, override_name: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-gray-900 dark:text-white"
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      id="isFeaturedMenu"
                      checked={formData.is_featured}
                      onChange={(e) => setFormData({ ...formData, is_featured: e.target.checked })}
                      className="w-4 h-4 rounded border-gray-300"
                    />
                    <label htmlFor="isFeaturedMenu" className="text-sm text-gray-700 dark:text-gray-300">Featured</label>
                  </div>
                </>
              )}
              <div className="flex gap-3 pt-4">
                <button
                  onClick={getModalSaveHandler()}
                  className="flex-1 px-4 py-2 bg-[var(--color-accent-operations)] text-white rounded-xl hover:bg-[var(--color-accent-operations-hover)] font-medium text-sm smooth-transition"
                >
                  {editingItem ? 'Update' : 'Create'}
                </button>
                <button
                  onClick={() => setShowModal(false)}
                  className="px-4 py-2 bg-white dark:bg-slate-800 text-gray-700 dark:text-gray-200 border border-gray-200 dark:border-slate-700 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-700 font-medium text-sm smooth-transition"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
