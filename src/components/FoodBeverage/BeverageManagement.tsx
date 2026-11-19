/**
 * @license
 * SPDX-License-Identifier: Apache-2.5
 *
 * Beverage Management module — F&B Portal.
 * Owns Bar Menus, Wine Lists, Beverage Recipes, and Beverage Costing.
 * Per spec §12 (Beverage Management).
 */

import { useState, useEffect } from 'react';
import { Wine, Package, Calculator, RefreshCw, Droplets, TrendingUp, Plus, Edit, Trash2, X } from 'lucide-react';
import { useERP } from '../../context/ERPContext';
import { PageHeader, SectionCard, Badge } from '../FrontOffice/ui';
import { button, layout } from '../FrontOffice/brandTheme';

type SubTab = 'wine-list' | 'categories' | 'bar-menu' | 'cocktails' | 'costing';

interface Wine {
  id: string;
  menu_item_id: string;
  menu_item_name: string;
  wine_type: 'Red' | 'White' | 'Rose' | 'Sparkling' | 'Dessert' | 'Fortified';
  vintage: number | null;
  region: string | null;
  country: string | null;
  producer: string | null;
  grape_variety: string | null;
  alcohol_content: number | null;
  serving_temperature: string | null;
  glass_type: string | null;
  pairing_notes: string | null;
  is_by_the_glass: boolean;
  bottle_price: number | null;
  glass_price: number | null;
  is_active: boolean;
}

interface BeverageCategory {
  id: string;
  name: string;
  description: string | null;
  display_order: number;
  is_active: boolean;
}

interface BeverageMenuItemCategory {
  id: string;
  menu_item_id: string;
  menu_item_name: string;
  beverage_category_id: string;
  category_name: string;
  outlet_id: string;
  outlet_name: string;
  is_available: boolean;
}

interface BarRecipe {
  id: string;
  recipe_code: string;
  name: string;
  category: 'cocktail' | 'mocktail' | 'spirit' | 'beer' | 'wine' | 'coffee_tea' | 'soft_drink' | 'syrup' | 'infusion' | 'prep_mix' | 'other';
  recipe_type: 'drink_item' | 'sub_recipe' | 'finished_product';
  yield_qty: number;
  yield_unit: string;
  portion_size: number | null;
  portion_unit: string | null;
  abv: number | null;
  serving_glass: string | null;
  total_cost: number;
  cost_per_portion: number;
  selling_price: number | null;
  pour_cost_percent: number;
  status: 'draft' | 'active' | 'archived';
  notes: string | null;
}

const SUB_TABS: { id: SubTab; label: string; icon: typeof Wine }[] = [
  { id: 'wine-list', label: 'Wine List', icon: Wine },
  { id: 'cocktails', label: 'Cocktail Recipes', icon: Droplets },
  { id: 'categories', label: 'Beverage Categories', icon: Package },
  { id: 'bar-menu', label: 'Bar Menu', icon: Package },
  { id: 'costing', label: 'Beverage Costing', icon: TrendingUp },
];

export default function BeverageManagement() {
  const { formatAmount, addNotification } = useERP();
  const [subTab, setSubTab] = useState<SubTab>('wine-list');
  const [loading, setLoading] = useState(false);

  const [wines, setWines] = useState<Wine[]>([]);
  const [categories, setCategories] = useState<BeverageCategory[]>([]);
  const [menuCategories, setMenuCategories] = useState<BeverageMenuItemCategory[]>([]);
  const [barRecipes, setBarRecipes] = useState<BarRecipe[]>([]);

  // Modal states
  const [wineModalOpen, setWineModalOpen] = useState(false);
  const [categoryModalOpen, setCategoryModalOpen] = useState(false);
  const [recipeModalOpen, setRecipeModalOpen] = useState(false);
  const [editingWine, setEditingWine] = useState<Wine | null>(null);
  const [editingCategory, setEditingCategory] = useState<BeverageCategory | null>(null);
  const [editingRecipe, setEditingRecipe] = useState<BarRecipe | null>(null);

  // Form states
  const [wineForm, setWineForm] = useState<Partial<Wine>>({});
  const [categoryForm, setCategoryForm] = useState<Partial<BeverageCategory>>({});
  const [recipeForm, setRecipeForm] = useState<Partial<BarRecipe>>({});

  const fetchData = async () => {
    setLoading(true);
    try {
      const [winesRes, categoriesRes, menuCatsRes, barRecipesRes] = await Promise.all([
        fetch('/api/fb/wine-list'),
        fetch('/api/fb/beverage-categories'),
        fetch('/api/fb/beverage-menu-item-categories'),
        fetch('/api/fb/bar-recipes'),
      ]);
      if (winesRes.ok && winesRes.headers.get('content-type')?.includes('json')) setWines(await winesRes.json());
      if (categoriesRes.ok && categoriesRes.headers.get('content-type')?.includes('json')) setCategories(await categoriesRes.json());
      if (menuCatsRes.ok && menuCatsRes.headers.get('content-type')?.includes('json')) setMenuCategories(await menuCatsRes.json());
      if (barRecipesRes.ok && barRecipesRes.headers.get('content-type')?.includes('json')) setBarRecipes(await barRecipesRes.json());
    } catch (err) {
      console.error('Failed to fetch beverage data:', err);
      addNotification('Failed to load beverage data', 'warning', 'F&B');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  // Wine List CRUD handlers
  const handleAddWine = () => {
    setEditingWine(null);
    setWineForm({});
    setWineModalOpen(true);
  };

  const handleEditWine = (wine: Wine) => {
    setEditingWine(wine);
    setWineForm(wine);
    setWineModalOpen(true);
  };

  const handleDeleteWine = async (id: string) => {
    if (!confirm('Are you sure you want to delete this wine?')) return;
    try {
      const res = await fetch(`/api/fb/wine-list/${id}`, { method: 'DELETE' });
      if (res.ok) {
        addNotification('Wine deleted successfully', 'success', 'F&B');
        fetchData();
      }
    } catch (err) {
      addNotification('Failed to delete wine', 'error', 'F&B');
    }
  };

  const handleSaveWine = async () => {
    try {
      const url = editingWine ? `/api/fb/wine-list/${editingWine.id}` : '/api/fb/wine-list';
      const method = editingWine ? 'PUT' : 'POST';
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(wineForm),
      });
      if (res.ok) {
        addNotification(editingWine ? 'Wine updated successfully' : 'Wine added successfully', 'success', 'F&B');
        setWineModalOpen(false);
        setWineForm({});
        setEditingWine(null);
        fetchData();
      }
    } catch (err) {
      addNotification('Failed to save wine', 'error', 'F&B');
    }
  };

  // Beverage Category CRUD handlers
  const handleAddCategory = () => {
    setEditingCategory(null);
    setCategoryForm({});
    setCategoryModalOpen(true);
  };

  const handleEditCategory = (category: BeverageCategory) => {
    setEditingCategory(category);
    setCategoryForm(category);
    setCategoryModalOpen(true);
  };

  const handleDeleteCategory = async (id: string) => {
    if (!confirm('Are you sure you want to delete this category?')) return;
    try {
      const res = await fetch(`/api/fb/beverage-categories/${id}`, { method: 'DELETE' });
      if (res.ok) {
        addNotification('Category deleted successfully', 'success', 'F&B');
        fetchData();
      }
    } catch (err) {
      addNotification('Failed to delete category', 'error', 'F&B');
    }
  };

  const handleSaveCategory = async () => {
    try {
      const url = editingCategory ? `/api/fb/beverage-categories/${editingCategory.id}` : '/api/fb/beverage-categories';
      const method = editingCategory ? 'PUT' : 'POST';
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(categoryForm),
      });
      if (res.ok) {
        addNotification(editingCategory ? 'Category updated successfully' : 'Category added successfully', 'success', 'F&B');
        setCategoryModalOpen(false);
        setCategoryForm({});
        setEditingCategory(null);
        fetchData();
      }
    } catch (err) {
      addNotification('Failed to save category', 'error', 'F&B');
    }
  };

  // Bar Recipe CRUD handlers
  const handleAddRecipe = () => {
    setEditingRecipe(null);
    setRecipeForm({});
    setRecipeModalOpen(true);
  };

  const handleEditRecipe = (recipe: BarRecipe) => {
    setEditingRecipe(recipe);
    setRecipeForm(recipe);
    setRecipeModalOpen(true);
  };

  const handleDeleteRecipe = async (id: string) => {
    if (!confirm('Are you sure you want to delete this recipe?')) return;
    try {
      const res = await fetch(`/api/fb/bar-recipes/${id}`, { method: 'DELETE' });
      if (res.ok) {
        addNotification('Recipe deleted successfully', 'success', 'F&B');
        fetchData();
      }
    } catch (err) {
      addNotification('Failed to delete recipe', 'error', 'F&B');
    }
  };

  const handleSaveRecipe = async () => {
    try {
      const url = editingRecipe ? `/api/fb/bar-recipes/${editingRecipe.id}` : '/api/fb/bar-recipes';
      const method = editingRecipe ? 'PUT' : 'POST';
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(recipeForm),
      });
      if (res.ok) {
        addNotification(editingRecipe ? 'Recipe updated successfully' : 'Recipe added successfully', 'success', 'F&B');
        setRecipeModalOpen(false);
        setRecipeForm({});
        setEditingRecipe(null);
        fetchData();
      }
    } catch (err) {
      addNotification('Failed to save recipe', 'error', 'F&B');
    }
  };

  return (
    <div className={['accent-fb', layout.sectionStack].join(' ')}>
      <PageHeader
        title="Beverage Management"
        subtitle="Manage wine lists, beverage categories, and bar menus"
        icon={Wine}
        actions={
          <div className="flex items-center gap-2">
            <button onClick={() => fetchData()} className={button.secondary}>
              <RefreshCw className="w-4 h-4" /> Refresh
            </button>
            {subTab === 'wine-list' && (
              <button onClick={handleAddWine} className={button.primary}>
                <Plus className="w-4 h-4" /> Add Wine
              </button>
            )}
            {subTab === 'categories' && (
              <button onClick={handleAddCategory} className={button.primary}>
                <Plus className="w-4 h-4" /> Add Category
              </button>
            )}
            {subTab === 'cocktails' && (
              <button onClick={handleAddRecipe} className={button.primary}>
                <Plus className="w-4 h-4" /> Add Recipe
              </button>
            )}
          </div>
        }
      />

      <div className="flex bg-slate-100 dark:bg-slate-800 p-1 rounded-xl overflow-x-auto">
        {SUB_TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setSubTab(t.id)}
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

      {/* Wine List */}
      {subTab === 'wine-list' && (
        <SectionCard>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 dark:bg-slate-900/40 text-left text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-6 py-3 font-medium">Menu Item</th>
                  <th className="px-6 py-3 font-medium">Type</th>
                  <th className="px-6 py-3 font-medium">Vintage</th>
                  <th className="px-6 py-3 font-medium">Region</th>
                  <th className="px-6 py-3 font-medium">Producer</th>
                  <th className="px-6 py-3 font-medium">Variety</th>
                  <th className="px-6 py-3 font-medium">Bottle Price</th>
                  <th className="px-6 py-3 font-medium">Glass Price</th>
                  <th className="px-6 py-3 font-medium">Status</th>
                  <th className="px-6 py-3 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-slate-700">
                {loading ? (
                  <tr><td colSpan={10} className="px-6 py-4 text-center text-slate-500">Loading...</td></tr>
                ) : wines.length === 0 ? (
                  <tr><td colSpan={10} className="px-6 py-4 text-center text-slate-500">No wines found</td></tr>
                ) : wines.map(w => (
                  <tr key={w.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/40">
                    <td className="px-6 py-3 text-slate-600 dark:text-slate-400">{w.menu_item_name || w.menu_item_id}</td>
                    <td className="px-6 py-3"><Badge tone="info">{w.wine_type}</Badge></td>
                    <td className="px-6 py-3 text-slate-600 dark:text-slate-400">{w.vintage || '—'}</td>
                    <td className="px-6 py-3 text-slate-600 dark:text-slate-400">{w.region || '—'}</td>
                    <td className="px-6 py-3 text-slate-600 dark:text-slate-400">{w.producer || '—'}</td>
                    <td className="px-6 py-3 text-slate-600 dark:text-slate-400">{w.grape_variety || '—'}</td>
                    <td className="px-6 py-3 text-slate-600 dark:text-slate-400">{w.bottle_price ? formatAmount(w.bottle_price) : '—'}</td>
                    <td className="px-6 py-3 text-slate-600 dark:text-slate-400">{w.glass_price ? formatAmount(w.glass_price) : '—'}</td>
                    <td className="px-6 py-3"><Badge tone={w.is_active ? 'success' : 'neutral'}>{w.is_active ? 'Active' : 'Inactive'}</Badge></td>
                    <td className="px-6 py-3">
                      <div className="flex items-center gap-2">
                        <button onClick={() => handleEditWine(w)} className="p-1 hover:bg-slate-100 dark:hover:bg-slate-700 rounded">
                          <Edit className="w-4 h-4 text-slate-600 dark:text-slate-400" />
                        </button>
                        <button onClick={() => handleDeleteWine(w.id)} className="p-1 hover:bg-red-50 dark:hover:bg-red-900/20 rounded">
                          <Trash2 className="w-4 h-4 text-red-600 dark:text-red-400" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </SectionCard>
      )}

      {/* Beverage Categories */}
      {subTab === 'categories' && (
        <SectionCard>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 dark:bg-slate-900/40 text-left text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-6 py-3 font-medium">Name</th>
                  <th className="px-6 py-3 font-medium">Description</th>
                  <th className="px-6 py-3 font-medium">Order</th>
                  <th className="px-6 py-3 font-medium">Status</th>
                  <th className="px-6 py-3 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-slate-700">
                {loading ? (
                  <tr><td colSpan={5} className="px-6 py-4 text-center text-slate-500">Loading...</td></tr>
                ) : categories.length === 0 ? (
                  <tr><td colSpan={5} className="px-6 py-4 text-center text-slate-500">No categories found</td></tr>
                ) : categories.map(c => (
                  <tr key={c.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/40">
                    <td className="px-6 py-3 font-medium text-gray-900 dark:text-white">{c.name}</td>
                    <td className="px-6 py-3 text-slate-600 dark:text-slate-400">{c.description || '—'}</td>
                    <td className="px-6 py-3 text-slate-600 dark:text-slate-400">{c.display_order}</td>
                    <td className="px-6 py-3"><Badge tone={c.is_active ? 'success' : 'neutral'}>{c.is_active ? 'Active' : 'Inactive'}</Badge></td>
                    <td className="px-6 py-3">
                      <div className="flex items-center gap-2">
                        <button onClick={() => handleEditCategory(c)} className="p-1 hover:bg-slate-100 dark:hover:bg-slate-700 rounded">
                          <Edit className="w-4 h-4 text-slate-600 dark:text-slate-400" />
                        </button>
                        <button onClick={() => handleDeleteCategory(c.id)} className="p-1 hover:bg-red-50 dark:hover:bg-red-900/20 rounded">
                          <Trash2 className="w-4 h-4 text-red-600 dark:text-red-400" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </SectionCard>
      )}

      {/* Bar Menu */}
      {subTab === 'bar-menu' && (
        <SectionCard>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 dark:bg-slate-900/40 text-left text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-6 py-3 font-medium">Menu Item</th>
                  <th className="px-6 py-3 font-medium">Category</th>
                  <th className="px-6 py-3 font-medium">Outlet</th>
                  <th className="px-6 py-3 font-medium">Available</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-slate-700">
                {loading ? (
                  <tr><td colSpan={4} className="px-6 py-4 text-center text-slate-500">Loading...</td></tr>
                ) : menuCategories.length === 0 ? (
                  <tr><td colSpan={4} className="px-6 py-4 text-center text-slate-500">No menu items found</td></tr>
                ) : menuCategories.map(m => (
                  <tr key={m.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/40">
                    <td className="px-6 py-3 text-slate-600 dark:text-slate-400">{m.menu_item_name || m.menu_item_id}</td>
                    <td className="px-6 py-3 text-slate-600 dark:text-slate-400">{m.category_name || m.beverage_category_id}</td>
                    <td className="px-6 py-3 text-slate-600 dark:text-slate-400">{m.outlet_name || m.outlet_id}</td>
                    <td className="px-6 py-3"><Badge tone={m.is_available ? 'success' : 'neutral'}>{m.is_available ? 'Yes' : 'No'}</Badge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </SectionCard>
      )}

      {/* Cocktail Recipes */}
      {subTab === 'cocktails' && (
        <SectionCard>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 dark:bg-slate-900/40 text-left text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-6 py-3 font-medium">Code</th>
                  <th className="px-6 py-3 font-medium">Name</th>
                  <th className="px-6 py-3 font-medium">Category</th>
                  <th className="px-6 py-3 font-medium">ABV %</th>
                  <th className="px-6 py-3 font-medium">Glass</th>
                  <th className="px-6 py-3 font-medium">Cost/Portion</th>
                  <th className="px-6 py-3 font-medium">Selling Price</th>
                  <th className="px-6 py-3 font-medium">Pour Cost %</th>
                  <th className="px-6 py-3 font-medium">Status</th>
                  <th className="px-6 py-3 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-slate-700">
                {loading ? (
                  <tr><td colSpan={10} className="px-6 py-4 text-center text-slate-500">Loading...</td></tr>
                ) : barRecipes.length === 0 ? (
                  <tr><td colSpan={10} className="px-6 py-4 text-center text-slate-500">No recipes found</td></tr>
                ) : barRecipes.map(r => (
                  <tr key={r.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/40">
                    <td className="px-6 py-3 text-slate-600 dark:text-slate-400">{r.recipe_code}</td>
                    <td className="px-6 py-3 font-medium text-gray-900 dark:text-white">{r.name}</td>
                    <td className="px-6 py-3"><Badge tone="info">{r.category}</Badge></td>
                    <td className="px-6 py-3 text-slate-600 dark:text-slate-400">{r.abv ? `${r.abv}%` : '—'}</td>
                    <td className="px-6 py-3 text-slate-600 dark:text-slate-400">{r.serving_glass || '—'}</td>
                    <td className="px-6 py-3 text-slate-600 dark:text-slate-400">{formatAmount(r.cost_per_portion)}</td>
                    <td className="px-6 py-3 text-slate-600 dark:text-slate-400">{r.selling_price ? formatAmount(r.selling_price) : '—'}</td>
                    <td className="px-6 py-3"><Badge tone={r.pour_cost_percent > 30 ? 'warning' : 'success'}>{r.pour_cost_percent.toFixed(1)}%</Badge></td>
                    <td className="px-6 py-3"><Badge tone={r.status === 'active' ? 'success' : r.status === 'draft' ? 'warning' : 'neutral'}>{r.status}</Badge></td>
                    <td className="px-6 py-3">
                      <div className="flex items-center gap-2">
                        <button onClick={() => handleEditRecipe(r)} className="p-1 hover:bg-slate-100 dark:hover:bg-slate-700 rounded">
                          <Edit className="w-4 h-4 text-slate-600 dark:text-slate-400" />
                        </button>
                        <button onClick={() => handleDeleteRecipe(r.id)} className="p-1 hover:bg-red-50 dark:hover:bg-red-900/20 rounded">
                          <Trash2 className="w-4 h-4 text-red-600 dark:text-red-400" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </SectionCard>
      )}

      {/* Beverage Costing */}
      {subTab === 'costing' && (
        <SectionCard>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 dark:bg-slate-900/40 text-left text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-6 py-3 font-medium">Recipe</th>
                  <th className="px-6 py-3 font-medium">Category</th>
                  <th className="px-6 py-3 font-medium">Yield Qty</th>
                  <th className="px-6 py-3 font-medium">Total Cost</th>
                  <th className="px-6 py-3 font-medium">Cost/Portion</th>
                  <th className="px-6 py-3 font-medium">Selling Price</th>
                  <th className="px-6 py-3 font-medium">Pour Cost %</th>
                  <th className="px-6 py-3 font-medium">Margin %</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-slate-700">
                {loading ? (
                  <tr><td colSpan={8} className="px-6 py-4 text-center text-slate-500">Loading...</td></tr>
                ) : barRecipes.filter(r => r.selling_price && r.selling_price > 0).length === 0 ? (
                  <tr><td colSpan={8} className="px-6 py-4 text-center text-slate-500">No costing data found</td></tr>
                ) : barRecipes.filter(r => r.selling_price && r.selling_price > 0).map(r => {
                  const marginPercent = r.selling_price ? ((r.selling_price - r.cost_per_portion) / r.selling_price * 100) : 0;
                  return (
                    <tr key={r.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/40">
                      <td className="px-6 py-3 font-medium text-gray-900 dark:text-white">{r.name}</td>
                      <td className="px-6 py-3 text-slate-600 dark:text-slate-400">{r.category}</td>
                      <td className="px-6 py-3 text-slate-600 dark:text-slate-400">{r.yield_qty} {r.yield_unit}</td>
                      <td className="px-6 py-3 text-slate-600 dark:text-slate-400">{formatAmount(r.total_cost)}</td>
                      <td className="px-6 py-3 text-slate-600 dark:text-slate-400">{formatAmount(r.cost_per_portion)}</td>
                      <td className="px-6 py-3 text-slate-600 dark:text-slate-400">{formatAmount(r.selling_price || 0)}</td>
                      <td className="px-6 py-3"><Badge tone={r.pour_cost_percent > 30 ? 'warning' : 'success'}>{r.pour_cost_percent.toFixed(1)}%</Badge></td>
                      <td className="px-6 py-3"><Badge tone={marginPercent < 60 ? 'warning' : 'success'}>{marginPercent.toFixed(1)}%</Badge></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </SectionCard>
      )}

      {/* Wine Modal */}
      {wineModalOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-slate-800 rounded-xl p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold text-gray-900 dark:text-white">{editingWine ? 'Edit Wine' : 'Add Wine'}</h2>
              <button onClick={() => setWineModalOpen(false)} className="p-1 hover:bg-slate-100 dark:hover:bg-slate-700 rounded">
                <X className="w-5 h-5 text-slate-600 dark:text-slate-400" />
              </button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Menu Item ID</label>
                <input
                  type="text"
                  value={wineForm.menu_item_id || ''}
                  onChange={(e) => setWineForm({ ...wineForm, menu_item_id: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-gray-900 dark:text-white"
                  placeholder="Menu item ID"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Wine Type</label>
                <select
                  value={wineForm.wine_type || ''}
                  onChange={(e) => setWineForm({ ...wineForm, wine_type: e.target.value as any })}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-gray-900 dark:text-white"
                >
                  <option value="">Select type</option>
                  <option value="Red">Red</option>
                  <option value="White">White</option>
                  <option value="Rose">Rose</option>
                  <option value="Sparkling">Sparkling</option>
                  <option value="Dessert">Dessert</option>
                  <option value="Fortified">Fortified</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Vintage</label>
                <input
                  type="number"
                  value={wineForm.vintage || ''}
                  onChange={(e) => setWineForm({ ...wineForm, vintage: e.target.value ? parseInt(e.target.value) : null })}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-gray-900 dark:text-white"
                  placeholder="e.g., 2020"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Region</label>
                <input
                  type="text"
                  value={wineForm.region || ''}
                  onChange={(e) => setWineForm({ ...wineForm, region: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-gray-900 dark:text-white"
                  placeholder="e.g., Napa Valley"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Bottle Price</label>
                <input
                  type="number"
                  step="0.01"
                  value={wineForm.bottle_price || ''}
                  onChange={(e) => setWineForm({ ...wineForm, bottle_price: e.target.value ? parseFloat(e.target.value) : null })}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-gray-900 dark:text-white"
                  placeholder="0.00"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Glass Price</label>
                <input
                  type="number"
                  step="0.01"
                  value={wineForm.glass_price || ''}
                  onChange={(e) => setWineForm({ ...wineForm, glass_price: e.target.value ? parseFloat(e.target.value) : null })}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-gray-900 dark:text-white"
                  placeholder="0.00"
                />
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={wineForm.is_active || false}
                  onChange={(e) => setWineForm({ ...wineForm, is_active: e.target.checked })}
                  className="w-4 h-4"
                />
                <label className="text-sm text-gray-700 dark:text-gray-300">Active</label>
              </div>
              <div className="flex justify-end gap-2 pt-4">
                <button onClick={() => setWineModalOpen(false)} className={button.secondary}>Cancel</button>
                <button onClick={handleSaveWine} className={button.primary}>Save</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Category Modal */}
      {categoryModalOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-slate-800 rounded-xl p-6 w-full max-w-lg">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold text-gray-900 dark:text-white">{editingCategory ? 'Edit Category' : 'Add Category'}</h2>
              <button onClick={() => setCategoryModalOpen(false)} className="p-1 hover:bg-slate-100 dark:hover:bg-slate-700 rounded">
                <X className="w-5 h-5 text-slate-600 dark:text-slate-400" />
              </button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Name</label>
                <input
                  type="text"
                  value={categoryForm.name || ''}
                  onChange={(e) => setCategoryForm({ ...categoryForm, name: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-gray-900 dark:text-white"
                  placeholder="Category name"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Description</label>
                <textarea
                  value={categoryForm.description || ''}
                  onChange={(e) => setCategoryForm({ ...categoryForm, description: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-gray-900 dark:text-white"
                  placeholder="Description"
                  rows={3}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Display Order</label>
                <input
                  type="number"
                  value={categoryForm.display_order || 0}
                  onChange={(e) => setCategoryForm({ ...categoryForm, display_order: parseInt(e.target.value) })}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-gray-900 dark:text-white"
                />
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={categoryForm.is_active || false}
                  onChange={(e) => setCategoryForm({ ...categoryForm, is_active: e.target.checked })}
                  className="w-4 h-4"
                />
                <label className="text-sm text-gray-700 dark:text-gray-300">Active</label>
              </div>
              <div className="flex justify-end gap-2 pt-4">
                <button onClick={() => setCategoryModalOpen(false)} className={button.secondary}>Cancel</button>
                <button onClick={handleSaveCategory} className={button.primary}>Save</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Recipe Modal */}
      {recipeModalOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-slate-800 rounded-xl p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold text-gray-900 dark:text-white">{editingRecipe ? 'Edit Recipe' : 'Add Recipe'}</h2>
              <button onClick={() => setRecipeModalOpen(false)} className="p-1 hover:bg-slate-100 dark:hover:bg-slate-700 rounded">
                <X className="w-5 h-5 text-slate-600 dark:text-slate-400" />
              </button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Recipe Code</label>
                <input
                  type="text"
                  value={recipeForm.recipe_code || ''}
                  onChange={(e) => setRecipeForm({ ...recipeForm, recipe_code: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-gray-900 dark:text-white"
                  placeholder="e.g., COCK-001"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Name</label>
                <input
                  type="text"
                  value={recipeForm.name || ''}
                  onChange={(e) => setRecipeForm({ ...recipeForm, name: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-gray-900 dark:text-white"
                  placeholder="Recipe name"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Category</label>
                <select
                  value={recipeForm.category || ''}
                  onChange={(e) => setRecipeForm({ ...recipeForm, category: e.target.value as any })}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-gray-900 dark:text-white"
                >
                  <option value="">Select category</option>
                  <option value="cocktail">Cocktail</option>
                  <option value="mocktail">Mocktail</option>
                  <option value="spirit">Spirit</option>
                  <option value="beer">Beer</option>
                  <option value="wine">Wine</option>
                  <option value="coffee_tea">Coffee/Tea</option>
                  <option value="soft_drink">Soft Drink</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">ABV %</label>
                <input
                  type="number"
                  step="0.1"
                  value={recipeForm.abv || ''}
                  onChange={(e) => setRecipeForm({ ...recipeForm, abv: e.target.value ? parseFloat(e.target.value) : null })}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-gray-900 dark:text-white"
                  placeholder="e.g., 40.0"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Selling Price</label>
                <input
                  type="number"
                  step="0.01"
                  value={recipeForm.selling_price || ''}
                  onChange={(e) => setRecipeForm({ ...recipeForm, selling_price: e.target.value ? parseFloat(e.target.value) : null })}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-gray-900 dark:text-white"
                  placeholder="0.00"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Status</label>
                <select
                  value={recipeForm.status || 'draft'}
                  onChange={(e) => setRecipeForm({ ...recipeForm, status: e.target.value as any })}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-gray-900 dark:text-white"
                >
                  <option value="draft">Draft</option>
                  <option value="active">Active</option>
                  <option value="archived">Archived</option>
                </select>
              </div>
              <div className="flex justify-end gap-2 pt-4">
                <button onClick={() => setRecipeModalOpen(false)} className={button.secondary}>Cancel</button>
                <button onClick={handleSaveRecipe} className={button.primary}>Save</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}