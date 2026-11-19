/**
 * @license
 * SPDX-License-Identifier: Apache-2.5
 */

import { useState, useEffect, useMemo } from 'react';
import {
  ChefHat,
  BookOpen,
  Plus,
  Edit,
  Trash2,
  Scale,
  DollarSign,
  Layers,
  RefreshCw,
  X,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  AlertTriangle,
  Wine,
} from 'lucide-react';
import { useERP } from '../../context/ERPContext';
import StatCard from '../FrontOffice/StatCard';
import { PageHeader, Badge } from '../FrontOffice/ui';
import { button, layout } from '../FrontOffice/brandTheme';

interface RecipeLine {
  id: string;
  recipe_id: string;
  ingredient_id: string | null;
  sub_recipe_id: string | null;
  quantity: number;
  unit: string;
  cost_at_time_of_costing: number;
  ingredients?: {
    id: string;
    name: string;
    current_cost: number;
    unit_of_measure: string;
    category: string;
  } | null;
  sub_recipe?: {
    id: string;
    name: string;
    category: string;
    yield_qty: number;
    yield_unit: string;
  } | null;
}

interface Recipe {
  id: string;
  menu_item_id: string | null;
  name?: string | null;
  yield: number;
  portions: number;
  created_at: string;
  updated_at: string;
  menu_items?: {
    name: string;
    selling_price: number;
    category?: string;
    preparation_time_minutes?: number | null;
    description?: string | null;
    item_code?: string | null;
  } | null;
  recipe_lines?: RecipeLine[];
  // Bar recipe fields
  is_bar_recipe?: boolean;
  recipe_code?: string | null;
  bar_category?: string | null;
  abv?: number | null;
  serving_glass?: string | null;
  total_cost?: number | null;
  cost_per_portion?: number | null;
  selling_price?: number | null;
  pour_cost_percent?: number | null;
  recipe_type?: string | null;
}

interface Ingredient {
  id: string;
  name: string;
  category: string;
  unit_of_measure: string;
  par_level: number;
  reorder_point: number;
  current_cost: number;
  suppliers: string[];
  is_active: boolean;
}

interface MenuItem {
  id: string;
  name: string;
  item_code: string | null;
  category: string | null;
  selling_price: number;
  preparation_time_minutes: number | null;
  is_active: boolean;
}

interface SubRecipeLine {
  id: string;
  sub_recipe_id: string;
  ingredient_id: string;
  quantity: number;
  unit: string;
  cost_at_time_of_costing: number;
  ingredients?: {
    id: string;
    name: string;
    current_cost: number;
    unit_of_measure: string;
    category: string;
  };
}

interface SubRecipe {
  id: string;
  name: string;
  description: string | null;
  category: string;
  yield_qty: number;
  yield_unit: string;
  portions: number;
  prep_time_minutes: number;
  cook_time_minutes: number;
  shelf_life_hours: number | null;
  storage_temp: string | null;
  haccp_control: string | null;
  is_active: boolean;
  sub_recipe_lines?: SubRecipeLine[];
  // Bar sub-recipe fields (for syrups, infusions, etc.)
  is_bar_recipe?: boolean;
  recipe_code?: string | null;
  bar_category?: string | null;
}

export default function RecipeProductionManagement() {
  const { formatAmount, addNotification } = useERP();
  const [activeTab, setActiveTab] = useState<'recipes' | 'sub-recipes' | 'costing' | 'standards'>('recipes');
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [ingredients, setIngredients] = useState<Ingredient[]>([]);
  const [subRecipes, setSubRecipes] = useState<SubRecipe[]>([]);
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingRecipe, setEditingRecipe] = useState<Recipe | null>(null);
  const [expandedRecipes, setExpandedRecipes] = useState<Set<string>>(new Set());
  const [expandedSubRecipes, setExpandedSubRecipes] = useState<Set<string>>(new Set());
  const [showSubRecipeModal, setShowSubRecipeModal] = useState(false);
  const [editingSubRecipe, setEditingSubRecipe] = useState<SubRecipe | null>(null);
  const [subRecipeForm, setSubRecipeForm] = useState({
    name: '', description: '', category: 'Sauce', yieldQty: 1, yieldUnit: 'kg',
    portions: 1, prepTime: 0, cookTime: 0, shelfLife: 48, storageTemp: 'Refrigerated', haccp: 'Standard',
    isBarRecipe: false, recipeCode: '', barCategory: 'syrup',
  });
  const [subRecipeLines, setSubRecipeLines] = useState<{ ingredient_id: string; quantity: number; unit: string }[]>([]);
  const [formData, setFormData] = useState({
    menu_item_id: '',
    name: '',
    yield: 1,
    portions: 1,
    isBarRecipe: false,
    recipeCode: '',
    barCategory: 'cocktail',
    abv: null,
    servingGlass: '',
    sellingPrice: null,
  });
  const [recipeLines, setRecipeLines] = useState<{ ingredient_id: string; sub_recipe_id: string; type: 'ingredient' | 'sub-recipe'; quantity: number; unit: string }[]>([]);

  const tabs = [
    { id: 'recipes', label: 'Recipes', icon: BookOpen },
    { id: 'sub-recipes', label: 'Sub Recipes', icon: Layers },
    { id: 'costing', label: 'Recipe Costing', icon: DollarSign },
    { id: 'standards', label: 'Production Standards', icon: CheckCircle2 },
  ];

  const fetchRecipes = async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/fb/recipes');
      if (!response.ok) throw new Error('Failed to fetch recipes');
      const data = await response.json();
      setRecipes(data.data || data || []);
    } catch (error) {
      console.error('Error fetching recipes:', error);
      addNotification('Failed to load recipes', 'warning', 'F&B');
    } finally {
      setLoading(false);
    }
  };

  const fetchIngredients = async () => {
    try {
      const response = await fetch('/api/fb/ingredients');
      if (!response.ok) throw new Error('Failed to fetch ingredients');
      const data = await response.json();
      setIngredients(data.data || data || []);
    } catch (error) {
      console.error('Error fetching ingredients:', error);
    }
  };

  const fetchSubRecipes = async () => {
    try {
      const response = await fetch('/api/fb/sub-recipes');
      if (!response.ok) throw new Error('Failed to fetch sub-recipes');
      const data = await response.json();
      setSubRecipes(data.data || data || []);
    } catch (error) {
      console.error('Error fetching sub-recipes:', error);
    }
  };

  const fetchMenuItems = async () => {
    try {
      const response = await fetch('/api/fb/menu-items');
      if (!response.ok) throw new Error('Failed to fetch menu items');
      const data = await response.json();
      setMenuItems(data.data || data || []);
    } catch (error) {
      console.error('Error fetching menu items:', error);
    }
  };

  useEffect(() => {
    fetchRecipes();
    fetchIngredients();
    fetchSubRecipes();
    fetchMenuItems();
  }, []);

  // ── Computed values ───────────────────────────────────────────────────
  const ingredientById = useMemo(() => {
    const map: Record<string, Ingredient> = {};
    for (const ing of ingredients) map[ing.id] = ing;
    return map;
  }, [ingredients]);

  // Menu items available to link to a recipe: those without an existing recipe,
  // plus the menu item of the recipe currently being edited (so it stays selectable).
  const linkedMenuItemIds = useMemo(() => {
    const set = new Set<string>();
    for (const r of recipes) if (r.menu_item_id) set.add(r.menu_item_id);
    return set;
  }, [recipes]);

  const availableMenuItems = useMemo(() => {
    const editingId = editingRecipe?.menu_item_id || '';
    return menuItems.filter(mi => !linkedMenuItemIds.has(mi.id) || mi.id === editingId);
  }, [menuItems, linkedMenuItemIds, editingRecipe]);

  const recipeCost = (recipe: Recipe): number => {
    if (!recipe.recipe_lines) return 0;
    return recipe.recipe_lines.reduce((sum, line) => {
      const ing = line.ingredients || ingredientById[line.ingredient_id];
      const cost = ing ? Number(ing.current_cost) : Number(line.cost_at_time_of_costing) || 0;
      return sum + cost * Number(line.quantity);
    }, 0);
  };

  const costPerPortion = (recipe: Recipe): number => {
    const total = recipeCost(recipe);
    const yieldPct = recipe.yield || 1;
    const portions = recipe.portions || 1;
    return (total / yieldPct) / portions;
  };

  const foodCostPct = (recipe: Recipe): number => {
    const portionCost = costPerPortion(recipe);
    const price = Number(recipe.menu_items?.selling_price || 0);
    if (price === 0) return 0;
    return (portionCost / price) * 100;
  };

  // Shared ingredients: ingredients used in 2+ recipes (for reference)
  const sharedIngredients = useMemo(() => {
    const ingUsage: Record<string, { recipes: string[]; totalQty: number; unit: string }> = {};
    for (const r of recipes) {
      if (!r.recipe_lines) continue;
      for (const line of r.recipe_lines) {
        if (!ingUsage[line.ingredient_id]) {
          ingUsage[line.ingredient_id] = { recipes: [], totalQty: 0, unit: line.unit };
        }
        if (!ingUsage[line.ingredient_id].recipes.includes(r.id)) {
          ingUsage[line.ingredient_id].recipes.push(r.id);
        }
        ingUsage[line.ingredient_id].totalQty += Number(line.quantity);
      }
    }
    return Object.entries(ingUsage)
      .filter(([, info]) => info.recipes.length >= 2)
      .map(([ingId, info]) => ({
        ingredient: ingredientById[ingId] || recipes.flatMap(r => r.recipe_lines || []).find(l => l.ingredient_id === ingId)?.ingredients,
        recipeCount: info.recipes.length,
        recipeNames: info.recipes.map(rid => recipes.find(r => r.id === rid)?.menu_items?.name || 'Unknown').filter(Boolean),
        totalQty: info.totalQty,
        unit: info.unit,
      }))
      .filter(sr => sr.ingredient)
      .sort((a, b) => b.recipeCount - a.recipeCount);
  }, [recipes, ingredientById]);

  // ── Handlers ──────────────────────────────────────────────────────────
  const handleCreateRecipe = () => {
    setEditingRecipe(null);
    setFormData({ menu_item_id: '', name: '', yield: 1, portions: 1, isBarRecipe: false, recipeCode: '', barCategory: 'cocktail', abv: null, servingGlass: '', sellingPrice: null });
    setRecipeLines([{ ingredient_id: '', sub_recipe_id: '', type: 'ingredient', quantity: 1, unit: 'kg' }]);
    setShowModal(true);
  };

  const handleEditRecipe = (recipe: Recipe) => {
    setEditingRecipe(recipe);
    setFormData({
      menu_item_id: recipe.menu_item_id || '',
      name: recipe.name || '',
      yield: recipe.yield,
      portions: recipe.portions,
      isBarRecipe: recipe.is_bar_recipe || false,
      recipeCode: recipe.recipe_code || '',
      barCategory: recipe.bar_category || 'cocktail',
      abv: recipe.abv || null,
      servingGlass: recipe.serving_glass || '',
      sellingPrice: recipe.selling_price || null,
    });
    setRecipeLines(
      (recipe.recipe_lines || []).map(l => ({
        ingredient_id: l.ingredient_id || '',
        sub_recipe_id: l.sub_recipe_id || '',
        type: (l.sub_recipe_id ? 'sub-recipe' : 'ingredient') as 'ingredient' | 'sub-recipe',
        quantity: Number(l.quantity),
        unit: l.unit,
      }))
    );
    setShowModal(true);
  };

  const handleSaveRecipe = async () => {
    try {
      const url = editingRecipe ? `/api/fb/recipes/${editingRecipe.id}` : '/api/fb/recipes';
      const method = editingRecipe ? 'PATCH' : 'POST';
      const body: Record<string, unknown> = {
        portions: formData.portions,
        yield: formData.yield,
        lines: recipeLines
          .filter(l => l.ingredient_id || l.sub_recipe_id)
          .map(l => ({
            ingredientId: l.ingredient_id || null,
            subRecipeId: l.sub_recipe_id || null,
            quantity: l.quantity,
            unit: l.unit,
          })),
        isBarRecipe: formData.isBarRecipe,
        recipeCode: formData.recipeCode,
        barCategory: formData.barCategory,
        abv: formData.abv,
        servingGlass: formData.servingGlass,
        sellingPrice: formData.sellingPrice,
      };
      if (formData.menu_item_id) body.menuItemId = formData.menu_item_id;
      if (formData.name) body.name = formData.name;
      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!response.ok) throw new Error('Failed to save recipe');
      addNotification(editingRecipe ? 'Recipe updated successfully' : 'Recipe created successfully', 'success', 'F&B');
      setShowModal(false);
      fetchRecipes();
    } catch (error) {
      console.error('Error saving recipe:', error);
      addNotification('Failed to save recipe', 'warning', 'F&B');
    }
  };

  const handleDeleteRecipe = async (id: string) => {
    if (!confirm('Are you sure you want to delete this recipe?')) return;
    try {
      const response = await fetch(`/api/fb/recipes/${id}`, { method: 'DELETE' });
      if (!response.ok) throw new Error('Failed to delete recipe');
      addNotification('Recipe deleted successfully', 'success', 'F&B');
      fetchRecipes();
    } catch (error) {
      console.error('Error deleting recipe:', error);
      addNotification('Failed to delete recipe', 'warning', 'F&B');
    }
  };

  const toggleExpand = (id: string) => {
    const next = new Set(expandedRecipes);
    next.has(id) ? next.delete(id) : next.add(id);
    setExpandedRecipes(next);
  };

  // ── KPIs ──────────────────────────────────────────────────────────────
  const totalRecipes = recipes.length;
  const avgYield = recipes.length > 0 ? recipes.reduce((sum, r) => sum + r.yield, 0) / recipes.length : 0;
  const avgFoodCostPct = recipes.length > 0
    ? recipes.reduce((sum, r) => sum + foodCostPct(r), 0) / recipes.length
    : 0;
  const totalIngredients = ingredients.length;

  return (
    <div className={layout.sectionStack}>
      {/* Header */}
      <PageHeader
        title="Recipe & Production Management"
        subtitle="The operational heart of the F&B department"
        icon={ChefHat}
        actions={
          <>
            <button onClick={() => { fetchRecipes(); fetchIngredients(); fetchMenuItems(); }} className={button.secondary}>
              <RefreshCw className="w-4 h-4" />
              Refresh
            </button>
            <button onClick={handleCreateRecipe} className={button.primary}>
              <Plus className="w-4 h-4" />
              Add Recipe
            </button>
          </>
        }
      />

      {/* KPI Cards */}
      <div className={layout.kpiGrid}>
        <StatCard title="Total Recipes" value={String(totalRecipes)} icon={BookOpen} tone="accent" />
        <StatCard title="Avg Yield" value={`${(avgYield * 100).toFixed(1)}%`} icon={Scale} tone="info" />
        <StatCard title="Avg Food Cost" value={`${avgFoodCostPct.toFixed(1)}%`} icon={DollarSign} tone="warning" />
        <StatCard title="Ingredients" value={String(totalIngredients)} icon={Layers} tone="success" />
      </div>

      {/* Tabs */}
      <div className="flex bg-slate-100 dark:bg-slate-900/40 p-1 rounded-2xl border border-gray-200 dark:border-slate-700 overflow-x-auto">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id as typeof activeTab)}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl transition-all whitespace-nowrap ${
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
        {/* ── Recipes Tab ─────────────────────────────────────────────── */}
        {activeTab === 'recipes' && (
          <div className="space-y-4">
            {loading ? (
              <div className="text-center py-8 text-slate-500">Loading recipes...</div>
            ) : recipes.length === 0 ? (
              <div className="text-center py-8 text-slate-500">
                <BookOpen className="w-10 h-10 mx-auto mb-2 opacity-50" />
                <p className="text-sm">No recipes found</p>
                <p className="text-xs mt-1">Click "Add Recipe" to create your first recipe</p>
              </div>
            ) : (
              <div className="space-y-3">
                {recipes.map((recipe) => {
                  const isExpanded = expandedRecipes.has(recipe.id);
                  const totalCost = recipeCost(recipe);
                  const portionCost = costPerPortion(recipe);
                  const fcPct = foodCostPct(recipe);
                  const lineCount = recipe.recipe_lines?.length || 0;
                  return (
                    <div key={recipe.id} className={`bg-slate-50 dark:bg-slate-700/40 rounded-lg border ${recipe.is_bar_recipe ? 'border-[var(--color-warning)]/30' : 'border-gray-200 dark:border-slate-600'} hover:border-[var(--color-accent-operations)] transition`}>
                      <div className="flex items-center justify-between p-4">
                        <div className="flex items-center gap-4">
                          <button onClick={() => toggleExpand(recipe.id)} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300">
                            {isExpanded ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
                          </button>
                          <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${recipe.is_bar_recipe ? 'bg-[var(--color-warning)]/10' : 'bg-[var(--color-accent-operations)]/10'}`}>
                            {recipe.is_bar_recipe ? <Wine className="w-5 h-5 text-[var(--color-warning)]" /> : <BookOpen className="w-5 h-5 text-[var(--color-accent-operations)]" />}
                          </div>
                          <div>
                            <div className="flex items-center gap-2">
                              <h3 className="text-sm font-semibold text-slate-900 dark:text-white">{recipe.menu_items?.name || recipe.name || 'Untitled Recipe'}</h3>
                              {recipe.is_bar_recipe && <Badge tone="warning">Bar</Badge>}
                              {recipe.recipe_code && <span className="text-xs font-mono text-slate-500">{recipe.recipe_code}</span>}
                            </div>
                            <p className="text-xs text-slate-500 dark:text-slate-400">
                              {recipe.is_bar_recipe ? (recipe.bar_category || 'N/A') : (recipe.menu_items?.category || 'N/A')} • Yield: {(recipe.yield * 100).toFixed(0)}% • Portions: {recipe.portions} • {lineCount} ingredients
                            </p>
                            <div className="flex items-center gap-3 mt-1 flex-wrap">
                              <span className="text-xs font-medium text-slate-700 dark:text-slate-300">
                                Cost: {formatAmount(portionCost)}/portion
                              </span>
                              {!recipe.is_bar_recipe && (
                                <span className={`text-xs font-medium ${fcPct > 35 ? 'text-[var(--color-danger)]' : fcPct > 28 ? 'text-[var(--color-warning)]' : 'text-[var(--color-success)]'}`}>
                                  Food Cost: {fcPct.toFixed(1)}%
                                </span>
                              )}
                              {recipe.is_bar_recipe && recipe.abv && (
                                <Badge tone="warning">ABV: {recipe.abv}%</Badge>
                              )}
                              {recipe.is_bar_recipe && recipe.serving_glass && (
                                <Badge tone="warning">{recipe.serving_glass}</Badge>
                              )}
                              {recipe.menu_items?.selling_price && (
                                <span className="text-xs text-slate-500">Price: {formatAmount(Number(recipe.menu_items.selling_price))}</span>
                              )}
                              {recipe.is_bar_recipe && recipe.selling_price && (
                                <span className="text-xs text-slate-500">Price: {formatAmount(recipe.selling_price)}</span>
                              )}
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-3">
                          <button onClick={() => handleEditRecipe(recipe)} className="p-1 text-slate-400 hover:text-[var(--color-accent-operations)]">
                            <Edit className="w-4 h-4" />
                          </button>
                          <button onClick={() => handleDeleteRecipe(recipe.id)} className="p-1 text-slate-400 hover:text-[var(--color-danger)]">
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                      {isExpanded && (
                        <div className="border-t border-slate-200 dark:border-slate-600 px-4 pb-4 pt-3">
                          <div className="text-xs font-medium text-slate-600 dark:text-slate-400 mb-2">Recipe Components:</div>
                          <div className="overflow-x-auto">
                            <table className="w-full text-xs">
                              <thead>
                                <tr className="border-b border-slate-200 dark:border-slate-600">
                                  <th className="text-left py-1.5 px-2 text-slate-500">Component</th>
                                  <th className="text-left py-1.5 px-2 text-slate-500">Type</th>
                                  <th className="text-left py-1.5 px-2 text-slate-500">Category</th>
                                  <th className="text-right py-1.5 px-2 text-slate-500">Quantity</th>
                                  <th className="text-right py-1.5 px-2 text-slate-500">Unit Cost</th>
                                  <th className="text-right py-1.5 px-2 text-slate-500">Line Cost</th>
                                </tr>
                              </thead>
                              <tbody>
                                {(recipe.recipe_lines || []).map((line) => {
                                  const isSubRecipe = !!line.sub_recipe_id;
                                  const ing = line.ingredients || ingredientById[line.ingredient_id];
                                  const sr = line.sub_recipe;
                                  const unitCost = isSubRecipe
                                    ? 0 // Sub-recipe cost is computed from its own lines
                                    : (ing ? Number(ing.current_cost) : Number(line.cost_at_time_of_costing) || 0);
                                  const lineCost = unitCost * Number(line.quantity);
                                  return (
                                    <tr key={line.id} className="border-b border-slate-100 dark:border-slate-700/50">
                                      <td className="py-1.5 px-2 text-slate-900 dark:text-white font-medium">
                                        {isSubRecipe ? (
                                          <span className="flex items-center gap-1">
                                            <Layers className="w-3 h-3 text-[var(--color-info)]" />
                                            {sr?.name || 'Unknown Sub-Recipe'}
                                          </span>
                                        ) : (
                                          ing?.name || 'Unknown'
                                        )}
                                      </td>
                                      <td className="py-1.5 px-2">
                                        {isSubRecipe ? (
                                          <Badge tone="info">Sub-Recipe</Badge>
                                        ) : (
                                          <Badge tone="neutral">Ingredient</Badge>
                                        )}
                                      </td>
                                      <td className="py-1.5 px-2 text-slate-500">
                                        {isSubRecipe ? sr?.category : ing?.category || '—'}
                                      </td>
                                      <td className="py-1.5 px-2 text-right text-slate-600 dark:text-slate-400">
                                        {Number(line.quantity).toFixed(3)} {line.unit}
                                        {isSubRecipe && sr && <span className="text-xs text-slate-400 ml-1">({sr.yield_qty} {sr.yield_unit} batch)</span>}
                                      </td>
                                      <td className="py-1.5 px-2 text-right text-slate-600 dark:text-slate-400">
                                        {isSubRecipe ? <span className="text-[var(--color-info)] italic">computed</span> : formatAmount(unitCost)}
                                      </td>
                                      <td className="py-1.5 px-2 text-right text-slate-900 dark:text-white font-medium">
                                        {isSubRecipe ? <span className="text-[var(--color-info)] italic">see sub-recipe</span> : formatAmount(lineCost)}
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                              <tfoot>
                                <tr className="border-t-2 border-slate-300 dark:border-slate-500">
                                  <td colSpan={5} className="py-1.5 px-2 text-right text-slate-600 dark:text-slate-400 font-medium">Total (pre-yield):</td>
                                  <td className="py-1.5 px-2 text-right text-slate-900 dark:text-white font-bold">{formatAmount(totalCost)}</td>
                                </tr>
                                <tr>
                                  <td colSpan={5} className="py-1.5 px-2 text-right text-slate-600 dark:text-slate-400 font-medium">Per portion (post-yield):</td>
                                  <td className="py-1.5 px-2 text-right text-[var(--color-accent-operations)] font-bold">{formatAmount(portionCost)}</td>
                                </tr>
                              </tfoot>
                            </table>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ── Sub-Recipes Tab ─────────────────────────────────────────── */}
        {activeTab === 'sub-recipes' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <div className="p-2 rounded-lg bg-[var(--color-accent-operations)]/10 text-[var(--color-accent-operations)]">
                  <Layers className="w-5 h-5" />
                </div>
                Sub-Recipes (Preparations)
              </h3>
              <button
                onClick={() => {
                  setEditingSubRecipe(null);
                  setSubRecipeForm({ name: '', description: '', category: 'Sauce', yieldQty: 1, yieldUnit: 'kg', portions: 1, prepTime: 0, cookTime: 0, shelfLife: 48, storageTemp: 'Refrigerated', haccp: 'Standard', isBarRecipe: false, recipeCode: '', barCategory: 'syrup' });
                  setSubRecipeLines([{ ingredient_id: '', quantity: 1, unit: 'kg' }]);
                  setShowSubRecipeModal(true);
                }}
                className={button.primary}
              >
                <Plus className="w-4 h-4" /> Add Sub-Recipe
              </button>
            </div>
            <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">
              Intermediate preparations like sauces, doughs, stocks, syrups, and infusions — each with its own ingredient list and cost.
            </p>
            {subRecipes.length === 0 ? (
              <div className="text-center py-8 text-slate-500">
                <Layers className="w-10 h-10 mx-auto mb-2 opacity-50" />
                <p className="text-sm">No sub-recipes found</p>
                <p className="text-xs mt-1">Click "Add Sub-Recipe" to create preparations like tomato sauce, pizza dough, or simple syrup</p>
              </div>
            ) : (
              <div className="space-y-3">
                {subRecipes.map((sr) => {
                  const isExpanded = expandedSubRecipes.has(sr.id);
                  const lineCost = (sr.sub_recipe_lines || []).reduce((sum, line) => {
                    const ing = line.ingredients || ingredientById[line.ingredient_id];
                    const cost = ing ? Number(ing.current_cost) : Number(line.cost_at_time_of_costing) || 0;
                    return sum + cost * Number(line.quantity);
                  }, 0);
                  const costPerUnit = sr.yield_qty > 0 ? lineCost / sr.yield_qty : 0;
                  const ingCount = sr.sub_recipe_lines?.length || 0;
                  const totalTime = sr.prep_time_minutes + sr.cook_time_minutes;
                  return (
                    <div key={sr.id} className={`bg-slate-50 dark:bg-slate-700/40 rounded-lg border ${sr.is_bar_recipe ? 'border-[var(--color-warning)]/30' : 'border-gray-200 dark:border-slate-600'}`}>
                      <div className="flex items-center justify-between p-4">
                        <div className="flex items-center gap-4">
                          <button onClick={() => {
                            const next = new Set(expandedSubRecipes);
                            next.has(sr.id) ? next.delete(sr.id) : next.add(sr.id);
                            setExpandedSubRecipes(next);
                          }} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300">
                            {isExpanded ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
                          </button>
                          <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${sr.is_bar_recipe ? 'bg-[var(--color-warning)]/10' : 'bg-[var(--color-info)]/10'}`}>
                            {sr.is_bar_recipe ? <Wine className="w-5 h-5 text-[var(--color-warning)]" /> : <Layers className="w-5 h-5 text-[var(--color-info)]" />}
                          </div>
                          <div>
                            <div className="flex items-center gap-2">
                              <h4 className="text-sm font-semibold text-slate-900 dark:text-white">{sr.name}</h4>
                              {sr.is_bar_recipe && <Badge tone="warning">Bar</Badge>}
                              {sr.recipe_code && <span className="text-xs font-mono text-slate-500">{sr.recipe_code}</span>}
                            </div>
                            <p className="text-xs text-slate-500 dark:text-slate-400">
                              {sr.is_bar_recipe ? (sr.bar_category || 'N/A') : sr.category} • Yield: {sr.yield_qty} {sr.yield_unit} • {ingCount} ingredients • {totalTime} min total
                            </p>
                            <div className="flex items-center gap-3 mt-1">
                              <span className="text-xs font-medium text-slate-700 dark:text-slate-300">
                                Cost: {formatAmount(lineCost)} ({formatAmount(costPerUnit)}/{sr.yield_unit})
                              </span>
                              {!sr.is_bar_recipe && sr.shelf_life_hours && (
                                <span className="text-xs text-slate-500">Shelf: {sr.shelf_life_hours}h</span>
                              )}
                              {!sr.is_bar_recipe && sr.storage_temp && (
                                <Badge tone="info">{sr.storage_temp}</Badge>
                              )}
                              {!sr.is_bar_recipe && sr.haccp_control && (
                                <Badge tone="warning">{sr.haccp_control}</Badge>
                              )}
                            </div>
                            {sr.description && (
                              <p className="text-xs text-slate-500 mt-0.5">{sr.description}</p>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => {
                              setEditingSubRecipe(sr);
                              setSubRecipeForm({
                                name: sr.name, description: sr.description || '', category: sr.category,
                                yieldQty: sr.yield_qty, yieldUnit: sr.yield_unit, portions: sr.portions,
                                prepTime: sr.prep_time_minutes, cookTime: sr.cook_time_minutes,
                                shelfLife: sr.shelf_life_hours || 48, storageTemp: sr.storage_temp || 'Refrigerated',
                                haccp: sr.haccp_control || 'Standard',
                                isBarRecipe: sr.is_bar_recipe || false,
                                recipeCode: sr.recipe_code || '',
                                barCategory: sr.bar_category || 'syrup',
                              });
                              setSubRecipeLines((sr.sub_recipe_lines || []).map(l => ({ ingredient_id: l.ingredient_id, quantity: Number(l.quantity), unit: l.unit })));
                              setShowSubRecipeModal(true);
                            }}
                            className="p-1 text-slate-400 hover:text-[var(--color-accent-operations)]"
                          >
                            <Edit className="w-4 h-4" />
                          </button>
                          <button
                            onClick={async () => {
                              if (!confirm(`Delete sub-recipe "${sr.name}"?`)) return;
                              try {
                                const resp = await fetch(`/api/fb/sub-recipes/${sr.id}`, { method: 'DELETE' });
                                if (!resp.ok) throw new Error();
                                addNotification('Sub-recipe deleted', 'success', 'F&B');
                                fetchSubRecipes();
                              } catch { addNotification('Failed to delete sub-recipe', 'warning', 'F&B'); }
                            }}
                            className="p-1 text-slate-400 hover:text-[var(--color-danger)]"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                      {isExpanded && (
                        <div className="border-t border-slate-200 dark:border-slate-600 px-4 pb-4 pt-3">
                          <div className="text-xs font-medium text-slate-600 dark:text-slate-400 mb-2">Ingredients:</div>
                          <div className="overflow-x-auto">
                            <table className="w-full text-xs">
                              <thead>
                                <tr className="border-b border-slate-200 dark:border-slate-600">
                                  <th className="text-left py-1.5 px-2 text-slate-500">Ingredient</th>
                                  <th className="text-left py-1.5 px-2 text-slate-500">Category</th>
                                  <th className="text-right py-1.5 px-2 text-slate-500">Quantity</th>
                                  <th className="text-right py-1.5 px-2 text-slate-500">Unit Cost</th>
                                  <th className="text-right py-1.5 px-2 text-slate-500">Line Cost</th>
                                </tr>
                              </thead>
                              <tbody>
                                {(sr.sub_recipe_lines || []).map((line) => {
                                  const ing = line.ingredients || ingredientById[line.ingredient_id];
                                  const unitCost = ing ? Number(ing.current_cost) : Number(line.cost_at_time_of_costing) || 0;
                                  const lc = unitCost * Number(line.quantity);
                                  return (
                                    <tr key={line.id} className="border-b border-slate-100 dark:border-slate-700/50">
                                      <td className="py-1.5 px-2 text-slate-900 dark:text-white font-medium">{ing?.name || 'Unknown'}</td>
                                      <td className="py-1.5 px-2 text-slate-500">{ing?.category || '—'}</td>
                                      <td className="py-1.5 px-2 text-right text-slate-600 dark:text-slate-400">{Number(line.quantity).toFixed(3)} {line.unit}</td>
                                      <td className="py-1.5 px-2 text-right text-slate-600 dark:text-slate-400">{formatAmount(unitCost)}</td>
                                      <td className="py-1.5 px-2 text-right text-slate-900 dark:text-white font-medium">{formatAmount(lc)}</td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                              <tfoot>
                                <tr className="border-t-2 border-slate-300 dark:border-slate-500">
                                  <td colSpan={4} className="py-1.5 px-2 text-right text-slate-600 dark:text-slate-400 font-medium">Total Cost:</td>
                                  <td className="py-1.5 px-2 text-right text-[var(--color-info)] font-bold">{formatAmount(lineCost)}</td>
                                </tr>
                                <tr>
                                  <td colSpan={4} className="py-1.5 px-2 text-right text-slate-600 dark:text-slate-400 font-medium">Per {sr.yield_unit}:</td>
                                  <td className="py-1.5 px-2 text-right text-slate-900 dark:text-white font-bold">{formatAmount(costPerUnit)}</td>
                                </tr>
                              </tfoot>
                            </table>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ── Costing Tab ─────────────────────────────────────────────── */}
        {activeTab === 'costing' && (
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
              <div className="bg-[var(--color-success)]/10 rounded-lg p-3 border border-[var(--color-success)]/20">
                <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-1">Ingredient Cost</h3>
                <p className="text-xs text-gray-600 dark:text-gray-400">Sum of all recipe lines</p>
              </div>
              <div className="bg-[var(--color-warning)]/10 rounded-lg p-3 border border-[var(--color-warning)]/20">
                <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-1">Yield Adjustment</h3>
                <p className="text-xs text-gray-600 dark:text-gray-400">Post-yield portion cost</p>
              </div>
              <div className="bg-[var(--color-info)]/10 rounded-lg p-3 border border-[var(--color-info)]/20">
                <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-1">Selling Price</h3>
                <p className="text-xs text-gray-600 dark:text-gray-400">Menu item price</p>
              </div>
              <div className="bg-[var(--color-accent-operations)]/10 rounded-lg p-3 border border-[var(--color-accent-operations)]/20">
                <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-1">Food Cost %</h3>
                <p className="text-xs text-gray-600 dark:text-gray-400">Cost vs selling price</p>
              </div>
              <div className="bg-[var(--color-danger)]/10 rounded-lg p-3 border border-[var(--color-danger)]/20">
                <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-1">Margin</h3>
                <p className="text-xs text-gray-600 dark:text-gray-400">Gross profit per portion</p>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-700">
                    <th className="text-left py-2 px-3 text-slate-600 dark:text-slate-400">Recipe</th>
                    <th className="text-right py-2 px-3 text-slate-600 dark:text-slate-400">Total Cost</th>
                    <th className="text-right py-2 px-3 text-slate-600 dark:text-slate-400">Portion Cost</th>
                    <th className="text-right py-2 px-3 text-slate-600 dark:text-slate-400">Selling Price</th>
                    <th className="text-right py-2 px-3 text-slate-600 dark:text-slate-400">Food Cost %</th>
                    <th className="text-right py-2 px-3 text-slate-600 dark:text-slate-400">Margin</th>
                    <th className="text-center py-2 px-3 text-slate-600 dark:text-slate-400">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {recipes.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="py-8 text-center text-slate-500 text-sm">No recipes found. Create recipes to see costing analysis.</td>
                    </tr>
                  ) : (
                    recipes.map(r => {
                      const total = recipeCost(r);
                      const portion = costPerPortion(r);
                      const price = Number(r.menu_items?.selling_price || 0);
                      const fcPct = foodCostPct(r);
                      const margin = price - portion;
                      const status = fcPct === 0 ? 'no-price' : fcPct > 35 ? 'high' : fcPct > 28 ? 'target' : 'low';
                      const statusMap = {
                        'no-price': { label: 'No Price', tone: 'neutral' as const },
                        'high': { label: 'Over Target', tone: 'danger' as const },
                        'target': { label: 'On Target', tone: 'warning' as const },
                        'low': { label: 'Profitable', tone: 'success' as const },
                      };
                      const s = statusMap[status as keyof typeof statusMap];
                      return (
                        <tr key={r.id} className="border-b border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700/30">
                          <td className="py-2 px-3 text-slate-900 dark:text-white font-medium">{r.menu_items?.name || 'Unknown'}</td>
                          <td className="py-2 px-3 text-right text-slate-600 dark:text-slate-400">{formatAmount(total)}</td>
                          <td className="py-2 px-3 text-right text-slate-900 dark:text-white font-medium">{formatAmount(portion)}</td>
                          <td className="py-2 px-3 text-right text-slate-600 dark:text-slate-400">{price > 0 ? formatAmount(price) : '—'}</td>
                          <td className={`py-2 px-3 text-right font-medium ${fcPct > 35 ? 'text-[var(--color-danger)]' : fcPct > 28 ? 'text-[var(--color-warning)]' : 'text-[var(--color-success)]'}`}>
                            {fcPct > 0 ? `${fcPct.toFixed(1)}%` : '—'}
                          </td>
                          <td className="py-2 px-3 text-right text-slate-900 dark:text-white font-medium">{price > 0 ? formatAmount(margin) : '—'}</td>
                          <td className="py-2 px-3 text-center">
                            <Badge tone={s.tone}>{s.label}</Badge>
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

        {/* ── Standards Tab ───────────────────────────────────────────── */}
        {activeTab === 'standards' && (
          <div className="space-y-4">
            <h3 className="text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2 mb-2">
              <div className="p-2 rounded-lg bg-[var(--color-accent-operations)]/10 text-[var(--color-accent-operations)]">
                <CheckCircle2 className="w-5 h-5" />
              </div>
              Production Standards
            </h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-700">
                    <th className="text-left py-2 px-3 text-slate-600 dark:text-slate-400">Recipe</th>
                    <th className="text-left py-2 px-3 text-slate-600 dark:text-slate-400">Prep Time</th>
                    <th className="text-left py-2 px-3 text-slate-600 dark:text-slate-400">Portions</th>
                    <th className="text-left py-2 px-3 text-slate-600 dark:text-slate-400">Yield</th>
                    <th className="text-right py-2 px-3 text-slate-600 dark:text-slate-400">Portion Cost</th>
                    <th className="text-right py-2 px-3 text-slate-600 dark:text-slate-400">Ingredients</th>
                    <th className="text-left py-2 px-3 text-slate-600 dark:text-slate-400">HACCP</th>
                  </tr>
                </thead>
                <tbody>
                  {recipes.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="py-8 text-center text-slate-500 text-sm">No recipes found.</td>
                    </tr>
                  ) : (
                    recipes.map(r => {
                      const prepTime = r.menu_items?.preparation_time_minutes;
                      const portion = costPerPortion(r);
                      const ingCount = r.recipe_lines?.length || 0;
                      const haccpMap: Record<string, string> = {
                        'Main Course': 'Core Temp',
                        'Appetizer': 'Cold Chain',
                        'Dessert': 'Cold Chain',
                        'Cocktail': 'Time/Temp',
                        'Bar Bites': 'Fry Temp',
                        'Breakfast': 'Time/Temp',
                      };
                      const haccp = haccpMap[r.menu_items?.category || ''] || 'Standard';
                      return (
                        <tr key={r.id} className="border-b border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700/30">
                          <td className="py-2 px-3 text-slate-900 dark:text-white font-medium">{r.menu_items?.name || 'Unknown'}</td>
                          <td className="py-2 px-3 text-slate-600 dark:text-slate-400">
                            {prepTime ? `${prepTime} min` : '—'}
                          </td>
                          <td className="py-2 px-3 text-slate-600 dark:text-slate-400">{r.portions}</td>
                          <td className="py-2 px-3 text-slate-600 dark:text-slate-400">{(r.yield * 100).toFixed(0)}%</td>
                          <td className="py-2 px-3 text-right text-slate-900 dark:text-white font-medium">{formatAmount(portion)}</td>
                          <td className="py-2 px-3 text-right text-slate-600 dark:text-slate-400">{ingCount}</td>
                          <td className="py-2 px-3 text-slate-600 dark:text-slate-400">
                            <Badge tone="info">{haccp}</Badge>
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

      </div>

      {/* Recipe Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 overflow-y-auto">
          <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto my-8 border border-gray-200 dark:border-slate-700 card-shadow">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
                <div className="p-2 rounded-lg bg-[var(--color-accent-operations)]/10 text-[var(--color-accent-operations)]">
                  <ChefHat className="w-5 h-5" />
                </div>
                {editingRecipe ? 'Edit Recipe' : 'New Recipe'}
              </h2>
              <button onClick={() => setShowModal(false)} className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="space-y-4">
              {/* Bar Recipe Toggle */}
              <div className="flex items-center gap-2 p-3 bg-slate-50 dark:bg-slate-900/40 rounded-xl border border-gray-200 dark:border-slate-700">
                <input
                  type="checkbox"
                  checked={formData.isBarRecipe}
                  onChange={(e) => setFormData({ ...formData, isBarRecipe: e.target.checked })}
                  className="w-4 h-4"
                />
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300">This is a Bar Recipe (cocktail, mocktail, spirit, etc.)</label>
              </div>

              {!formData.isBarRecipe ? (
                <>
                  {/* Regular Recipe Form */}
                  {/* Menu Item — optional, can be standalone recipe */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Menu Item <span className="text-slate-400 text-xs">(optional — leave empty for standalone recipe)</span></label>
                    <select
                      value={formData.menu_item_id}
                      onChange={(e) => setFormData({ ...formData, menu_item_id: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white"
                    >
                      <option value="">— No menu item (standalone recipe) —</option>
                      {availableMenuItems.map(mi => (
                        <option key={mi.id} value={mi.id}>{mi.name}{mi.item_code ? ` (${mi.item_code})` : ''}</option>
                      ))}
                    </select>
                  </div>
                  {/* Standalone recipe name — shown when no menu item selected */}
                  {!formData.menu_item_id && (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Recipe Name <span className="text-red-500">*</span></label>
                      <input
                        type="text"
                        value={formData.name}
                        onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                        placeholder="e.g., House Special Sauce, Daily Soup Base"
                        className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white"
                      />
                    </div>
                  )}
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Yield (0-1)</label>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        max="1"
                        value={formData.yield}
                        onChange={(e) => setFormData({ ...formData, yield: parseFloat(e.target.value) || 1 })}
                        className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Portions</label>
                      <input
                        type="number"
                        min="1"
                        value={formData.portions}
                        onChange={(e) => setFormData({ ...formData, portions: parseInt(e.target.value) || 1 })}
                        className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white"
                      />
                    </div>
                  </div>
                </>
              ) : (
                <>
                  {/* Bar Recipe Form */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Recipe Name <span className="text-red-500">*</span></label>
                    <input
                      type="text"
                      value={formData.name}
                      onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                      placeholder="e.g., Old Fashioned, Mojito, Margarita"
                      className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white"
                    />
                  </div>
                  <div className="grid grid-cols-3 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Recipe Code</label>
                      <input
                        type="text"
                        value={formData.recipeCode}
                        onChange={(e) => setFormData({ ...formData, recipeCode: e.target.value })}
                        placeholder="e.g., COCKTAIL-001"
                        className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Bar Category</label>
                      <select
                        value={formData.barCategory}
                        onChange={(e) => setFormData({ ...formData, barCategory: e.target.value })}
                        className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white text-sm"
                      >
                        <option value="cocktail">Cocktail</option>
                        <option value="mocktail">Mocktail</option>
                        <option value="spirit">Spirit</option>
                        <option value="beer">Beer</option>
                        <option value="wine">Wine</option>
                        <option value="coffee_tea">Coffee/Tea</option>
                        <option value="soft_drink">Soft Drink</option>
                        <option value="other">Other</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">ABV %</label>
                      <input
                        type="number" step="0.1" min="0" max="100"
                        value={formData.abv || ''}
                        onChange={(e) => setFormData({ ...formData, abv: e.target.value ? parseFloat(e.target.value) : null })}
                        placeholder="e.g., 40.0"
                        className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white"
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Serving Glass</label>
                      <input
                        type="text"
                        value={formData.servingGlass}
                        onChange={(e) => setFormData({ ...formData, servingGlass: e.target.value })}
                        placeholder="e.g., highball, martini"
                        className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Selling Price</label>
                      <input
                        type="number" step="0.01" min="0"
                        value={formData.sellingPrice || ''}
                        onChange={(e) => setFormData({ ...formData, sellingPrice: e.target.value ? parseFloat(e.target.value) : null })}
                        placeholder="0.00"
                        className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white"
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Yield (ml)</label>
                      <input
                        type="number"
                        step="1"
                        min="1"
                        value={formData.yield * 100}
                        onChange={(e) => setFormData({ ...formData, yield: (parseFloat(e.target.value) || 100) / 100 })}
                        className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Portions</label>
                      <input
                        type="number"
                        min="1"
                        value={formData.portions}
                        onChange={(e) => setFormData({ ...formData, portions: parseInt(e.target.value) || 1 })}
                        className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white"
                      />
                    </div>
                  </div>
                </>
              )}

              {/* Recipe Lines — can be ingredients OR sub-recipes */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Recipe Components (Ingredients & Sub-Recipes)</label>
                  <div className="flex items-center gap-3">
                    <button
                      onClick={() => setRecipeLines([...recipeLines, { ingredient_id: '', sub_recipe_id: '', type: 'ingredient', quantity: 1, unit: 'kg' }])}
                      className="text-xs text-[var(--color-accent-operations)] hover:opacity-80 flex items-center gap-1"
                    >
                      <Plus className="w-3 h-3" /> Add Ingredient
                    </button>
                    <button
                      onClick={() => setRecipeLines([...recipeLines, { ingredient_id: '', sub_recipe_id: '', type: 'sub-recipe', quantity: 1, unit: 'kg' }])}
                      className="text-xs text-[var(--color-info)] hover:opacity-80 flex items-center gap-1"
                    >
                      <Layers className="w-3 h-3" /> Add Sub-Recipe
                    </button>
                  </div>
                </div>
                <div className="space-y-2">
                  {recipeLines.map((line, idx) => (
                    <div key={idx} className="flex items-center gap-2">
                      {/* Type toggle: Ingredient or Sub-Recipe */}
                      <select
                        value={line.type}
                        onChange={(e) => {
                          const next = [...recipeLines];
                          next[idx] = { ...next[idx], type: e.target.value as 'ingredient' | 'sub-recipe', ingredient_id: '', sub_recipe_id: '' };
                          setRecipeLines(next);
                        }}
                        className="w-28 px-2 py-1.5 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white text-xs"
                      >
                        <option value="ingredient">Ingredient</option>
                        <option value="sub-recipe">Sub-Recipe</option>
                      </select>
                      {/* Ingredient selector */}
                      {line.type === 'ingredient' && (
                        <select
                          value={line.ingredient_id}
                          onChange={(e) => {
                            const next = [...recipeLines];
                            next[idx] = { ...next[idx], ingredient_id: e.target.value, sub_recipe_id: '' };
                            const ing = ingredients.find(i => i.id === e.target.value);
                            if (ing) next[idx].unit = ing.unit_of_measure;
                            setRecipeLines(next);
                          }}
                          className="flex-1 px-2 py-1.5 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white text-sm"
                        >
                          <option value="">Select ingredient...</option>
                          {ingredients.map(ing => (
                            <option key={ing.id} value={ing.id}>{ing.name} ({ing.category})</option>
                          ))}
                        </select>
                      )}
                      {/* Sub-Recipe selector */}
                      {line.type === 'sub-recipe' && (
                        <select
                          value={line.sub_recipe_id}
                          onChange={(e) => {
                            const next = [...recipeLines];
                            const sr = subRecipes.find(s => s.id === e.target.value);
                            next[idx] = { ...next[idx], sub_recipe_id: e.target.value, ingredient_id: '', unit: sr?.yield_unit || 'kg' };
                            setRecipeLines(next);
                          }}
                          className="flex-1 px-2 py-1.5 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white text-sm"
                        >
                          <option value="">Select sub-recipe...</option>
                          {subRecipes.map(sr => (
                            <option key={sr.id} value={sr.id}>{sr.name} ({sr.category})</option>
                          ))}
                        </select>
                      )}
                      <input
                        type="number"
                        step="0.001"
                        value={line.quantity}
                        onChange={(e) => {
                          const next = [...recipeLines];
                          next[idx] = { ...next[idx], quantity: parseFloat(e.target.value) || 0 };
                          setRecipeLines(next);
                        }}
                        className="w-20 px-2 py-1.5 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white text-sm"
                        placeholder="Qty"
                      />
                      <input
                        type="text"
                        value={line.unit}
                        onChange={(e) => {
                          const next = [...recipeLines];
                          next[idx] = { ...next[idx], unit: e.target.value };
                          setRecipeLines(next);
                        }}
                        className="w-16 px-2 py-1.5 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white text-sm"
                        placeholder="Unit"
                      />
                      <button
                        onClick={() => setRecipeLines(recipeLines.filter((_, i) => i !== idx))}
                        className="p-1 text-slate-400 hover:text-[var(--color-danger)]"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
              <div className="flex gap-3 pt-4">
                <button
                  onClick={handleSaveRecipe}
                  className={`${button.primary} flex-1`}
                >
                  {editingRecipe ? 'Update Recipe' : 'Create Recipe'}
                </button>
                <button
                  onClick={() => setShowModal(false)}
                  className={button.secondary}
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Sub-Recipe Modal */}
      {showSubRecipeModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 overflow-y-auto">
          <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto my-8 border border-gray-200 dark:border-slate-700 card-shadow">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
                <div className="p-2 rounded-lg bg-[var(--color-info)]/10 text-[var(--color-info)]">
                  <Layers className="w-5 h-5" />
                </div>
                {editingSubRecipe ? 'Edit Sub-Recipe' : 'New Sub-Recipe'}
              </h2>
              <button onClick={() => setShowSubRecipeModal(false)} className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="space-y-4">
              {/* Bar Sub-Recipe Toggle */}
              <div className="flex items-center gap-2 p-3 bg-slate-50 dark:bg-slate-900/40 rounded-xl border border-gray-200 dark:border-slate-700">
                <input
                  type="checkbox"
                  checked={subRecipeForm.isBarRecipe}
                  onChange={(e) => setSubRecipeForm({ ...subRecipeForm, isBarRecipe: e.target.checked })}
                  className="w-4 h-4"
                />
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300">This is a Bar Sub-Recipe (syrup, infusion, cocktail mix, etc.)</label>
              </div>

              {!subRecipeForm.isBarRecipe ? (
                <>
                  {/* Regular Sub-Recipe Form */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Name</label>
                    <input
                      type="text"
                      value={subRecipeForm.name}
                      onChange={(e) => setSubRecipeForm({ ...subRecipeForm, name: e.target.value })}
                      placeholder="e.g., Tomato Sauce"
                      className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Description</label>
                    <input
                      type="text"
                      value={subRecipeForm.description}
                      onChange={(e) => setSubRecipeForm({ ...subRecipeForm, description: e.target.value })}
                      placeholder="Brief description of the preparation"
                      className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white"
                    />
                  </div>
                  <div className="grid grid-cols-3 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Category</label>
                      <select
                        value={subRecipeForm.category}
                        onChange={(e) => setSubRecipeForm({ ...subRecipeForm, category: e.target.value })}
                        className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white text-sm"
                      >
                        <option value="Sauce">Sauce</option>
                        <option value="Dough">Dough</option>
                        <option value="Stock">Stock</option>
                        <option value="Marinade">Marinade</option>
                        <option value="Dressing">Dressing</option>
                        <option value="Base">Base</option>
                        <option value="Other">Other</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Yield Qty</label>
                      <input
                        type="number" step="0.001" min="0"
                        value={subRecipeForm.yieldQty}
                        onChange={(e) => setSubRecipeForm({ ...subRecipeForm, yieldQty: parseFloat(e.target.value) || 1 })}
                        className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Yield Unit</label>
                      <input
                        type="text"
                        value={subRecipeForm.yieldUnit}
                        onChange={(e) => setSubRecipeForm({ ...subRecipeForm, yieldUnit: e.target.value })}
                        className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white"
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-4 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Prep (min)</label>
                      <input type="number" min="0" value={subRecipeForm.prepTime}
                        onChange={(e) => setSubRecipeForm({ ...subRecipeForm, prepTime: parseInt(e.target.value) || 0 })}
                        className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white" />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Cook (min)</label>
                      <input type="number" min="0" value={subRecipeForm.cookTime}
                        onChange={(e) => setSubRecipeForm({ ...subRecipeForm, cookTime: parseInt(e.target.value) || 0 })}
                        className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white" />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Shelf (h)</label>
                      <input type="number" min="0" value={subRecipeForm.shelfLife}
                        onChange={(e) => setSubRecipeForm({ ...subRecipeForm, shelfLife: parseInt(e.target.value) || 0 })}
                        className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white" />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Storage</label>
                      <select value={subRecipeForm.storageTemp}
                        onChange={(e) => setSubRecipeForm({ ...subRecipeForm, storageTemp: e.target.value })}
                        className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white text-sm">
                        <option value="Refrigerated">Refrigerated</option>
                        <option value="Frozen">Frozen</option>
                        <option value="Room Temp">Room Temp</option>
                      </select>
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">HACCP Control</label>
                    <input type="text" value={subRecipeForm.haccp}
                      onChange={(e) => setSubRecipeForm({ ...subRecipeForm, haccp: e.target.value })}
                      placeholder="e.g., Core Temp, Cold Chain"
                      className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white" />
                  </div>
                </>
              ) : (
                <>
                  {/* Bar Sub-Recipe Form */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Name</label>
                    <input
                      type="text"
                      value={subRecipeForm.name}
                      onChange={(e) => setSubRecipeForm({ ...subRecipeForm, name: e.target.value })}
                      placeholder="e.g., Simple Syrup, Orange Infusion"
                      className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Description</label>
                    <input
                      type="text"
                      value={subRecipeForm.description}
                      onChange={(e) => setSubRecipeForm({ ...subRecipeForm, description: e.target.value })}
                      placeholder="Brief description of the bar preparation"
                      className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white"
                    />
                  </div>
                  <div className="grid grid-cols-3 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Recipe Code</label>
                      <input
                        type="text"
                        value={subRecipeForm.recipeCode}
                        onChange={(e) => setSubRecipeForm({ ...subRecipeForm, recipeCode: e.target.value })}
                        placeholder="e.g., SYRUP-001"
                        className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Bar Category</label>
                      <select
                        value={subRecipeForm.barCategory}
                        onChange={(e) => setSubRecipeForm({ ...subRecipeForm, barCategory: e.target.value })}
                        className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white text-sm"
                      >
                        <option value="syrup">Syrup</option>
                        <option value="infusion">Infusion</option>
                        <option value="prep_mix">Prep Mix</option>
                        <option value="other">Other</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Prep (min)</label>
                      <input type="number" min="0" value={subRecipeForm.prepTime}
                        onChange={(e) => setSubRecipeForm({ ...subRecipeForm, prepTime: parseInt(e.target.value) || 0 })}
                        className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white" />
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Yield Qty</label>
                      <input
                        type="number" step="0.001" min="0"
                        value={subRecipeForm.yieldQty}
                        onChange={(e) => setSubRecipeForm({ ...subRecipeForm, yieldQty: parseFloat(e.target.value) || 1 })}
                        className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Yield Unit</label>
                      <input
                        type="text"
                        value={subRecipeForm.yieldUnit}
                        onChange={(e) => setSubRecipeForm({ ...subRecipeForm, yieldUnit: e.target.value })}
                        className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Portions</label>
                      <input type="number" min="1" value={subRecipeForm.portions}
                        onChange={(e) => setSubRecipeForm({ ...subRecipeForm, portions: parseInt(e.target.value) || 1 })}
                        className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white" />
                    </div>
                  </div>
                </>
              )}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Ingredients</label>
                  <button
                    onClick={() => setSubRecipeLines([...subRecipeLines, { ingredient_id: '', quantity: 1, unit: 'kg' }])}
                    className="text-xs text-[var(--color-accent-operations)] hover:opacity-80 flex items-center gap-1"
                  >
                    <Plus className="w-3 h-3" /> Add Line
                  </button>
                </div>
                <div className="space-y-2">
                  {subRecipeLines.map((line, idx) => (
                    <div key={idx} className="flex items-center gap-2">
                      <select
                        value={line.ingredient_id}
                        onChange={(e) => {
                          const next = [...subRecipeLines];
                          next[idx] = { ...next[idx], ingredient_id: e.target.value };
                          const ing = ingredients.find(i => i.id === e.target.value);
                          if (ing) next[idx].unit = ing.unit_of_measure;
                          setSubRecipeLines(next);
                        }}
                        className="flex-1 px-2 py-1.5 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white text-sm"
                      >
                        <option value="">Select ingredient...</option>
                        {ingredients.map(ing => (
                          <option key={ing.id} value={ing.id}>{ing.name} ({ing.category})</option>
                        ))}
                      </select>
                      <input type="number" step="0.001" value={line.quantity}
                        onChange={(e) => {
                          const next = [...subRecipeLines];
                          next[idx] = { ...next[idx], quantity: parseFloat(e.target.value) || 0 };
                          setSubRecipeLines(next);
                        }}
                        className="w-20 px-2 py-1.5 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white text-sm" />
                      <input type="text" value={line.unit}
                        onChange={(e) => {
                          const next = [...subRecipeLines];
                          next[idx] = { ...next[idx], unit: e.target.value };
                          setSubRecipeLines(next);
                        }}
                        className="w-16 px-2 py-1.5 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white text-sm" />
                      <button onClick={() => setSubRecipeLines(subRecipeLines.filter((_, i) => i !== idx))}
                        className="p-1 text-slate-400 hover:text-[var(--color-danger)]">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
              <div className="flex gap-3 pt-4">
                <button
                  onClick={async () => {
                    try {
                      const body = {
                        name: subRecipeForm.name,
                        description: subRecipeForm.description,
                        category: subRecipeForm.category,
                        yieldQty: subRecipeForm.yieldQty,
                        yieldUnit: subRecipeForm.yieldUnit,
                        portions: 1,
                        prepTimeMinutes: subRecipeForm.prepTime,
                        cookTimeMinutes: subRecipeForm.cookTime,
                        shelfLifeHours: subRecipeForm.shelfLife,
                        storageTemp: subRecipeForm.storageTemp,
                        haccpControl: subRecipeForm.haccp,
                        lines: subRecipeLines.filter(l => l.ingredient_id).map(l => ({
                          ingredientId: l.ingredient_id, quantity: l.quantity, unit: l.unit,
                        })),
                        isBarRecipe: subRecipeForm.isBarRecipe,
                        recipeCode: subRecipeForm.recipeCode,
                        barCategory: subRecipeForm.barCategory,
                      };
                      const url = editingSubRecipe ? `/api/fb/sub-recipes/${editingSubRecipe.id}` : '/api/fb/sub-recipes';
                      const method = editingSubRecipe ? 'PATCH' : 'POST';
                      const response = await fetch(url, {
                        method, headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(body),
                      });
                      if (!response.ok) throw new Error();
                      addNotification(editingSubRecipe ? 'Sub-recipe updated' : 'Sub-recipe created', 'success', 'F&B');
                      setShowSubRecipeModal(false);
                      fetchSubRecipes();
                    } catch {
                      addNotification('Failed to save sub-recipe', 'warning', 'F&B');
                    }
                  }}
                  className={`${button.primary} flex-1`}
                >
                  {editingSubRecipe ? 'Update Sub-Recipe' : 'Create Sub-Recipe'}
                </button>
                <button onClick={() => setShowSubRecipeModal(false)}
                  className={button.secondary}
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
