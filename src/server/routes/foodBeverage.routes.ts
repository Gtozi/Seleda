import { Router } from 'express';
import crypto from 'crypto';
import { authenticate, requirePermission } from '../middleware/auth';
import { hasSupabaseAdminConfig, supabaseAdmin } from '../supabaseAdmin';
import { twinWriteProcRequisition } from '../services/procurementIntegration';
import { resolveUinvItemByName, uinvConsumeFromStore, FB_BEV_STORE_ID } from '../services/unifiedInventoryBridge';

const router = Router();

function dbNotConfigured(res: any) {
  return res.status(503).json({ error: 'Database not configured' });
}

// ── Outlets ───────────────────────────────────────────────────────
router.get('/outlets', authenticate, async (_req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { data, error } = await supabaseAdmin.from('outlets').select('*').order('name');
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

router.post('/outlets', authenticate, requirePermission('fb:outlet:create'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { data, error } = await supabaseAdmin.from('outlets').insert(req.body).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.status(201).json(data);
});

// ── Menu Items ────────────────────────────────────────────────────
router.get('/menu-items', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { outletId, category, isActive } = req.query as Record<string, string>;
  let q = supabaseAdmin.from('menu_items').select('*').order('name');
  if (outletId) q = q.eq('outlet_id', outletId);
  if (category) q = q.eq('category', category);
  if (isActive !== undefined) q = q.eq('is_active', isActive === 'true');
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

router.post('/menu-items', authenticate, requirePermission('fb:menu:create'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { data, error } = await supabaseAdmin.from('menu_items').insert(req.body).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.status(201).json(data);
});

router.put('/menu-items/:id', authenticate, requirePermission('fb:menu:update'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { data, error } = await supabaseAdmin.from('menu_items').update(req.body).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

// ── Recipes ───────────────────────────────────────────────────────
// Note: GET /recipes and POST /recipes are defined later in this file
// with full menu_items + sub_recipe joins (around line 1345+)

// Calculate plate cost from recipe ingredients
router.get('/recipes/:id/plate-cost', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  
  try {
    const recipeId = req.params.id;
    
    // Get recipe with ingredients and their current costs
    const { data: recipe, error: recipeError } = await supabaseAdmin
      .from('recipes')
      .select('*, recipe_lines(*, ingredients(*))')
      .eq('id', recipeId)
      .single();
    
    if (recipeError) return res.status(500).json({ error: recipeError.message });
    
    // Calculate total ingredient cost
    let totalIngredientCost = 0;
    const ingredientBreakdown: any[] = [];
    
    if (recipe.recipe_lines) {
      recipe.recipe_lines.forEach((line: any) => {
        const ingredient = line.ingredient;
        const quantity = line.quantity || 0;
        const currentCost = ingredient?.current_cost || 0;
        const lineCost = quantity * currentCost;
        
        totalIngredientCost += lineCost;
        
        ingredientBreakdown.push({
          ingredientId: ingredient?.id,
          ingredientName: ingredient?.name,
          quantity,
          unit: line.unit,
          costPerUnit: currentCost,
          lineCost
        });
      });
    }
    
    // Apply yield percentage (loss factor)
    const yieldPercentage = recipe.yield || 1.0;
    const adjustedPlateCost = totalIngredientCost / yieldPercentage;
    
    return res.json({
      recipeId,
      yieldPercentage,
      totalIngredientCost,
      adjustedPlateCost,
      ingredientBreakdown,
      portions: recipe.portions || 1,
      costPerPortion: adjustedPlateCost / (recipe.portions || 1)
    });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to calculate plate cost' });
  }
});

// ── Ingredients ───────────────────────────────────────────────────
router.get('/ingredients', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { category, isActive } = req.query as Record<string, string>;
  let q = supabaseAdmin.from('ingredients').select('*').order('name');
  if (category) q = q.eq('category', category);
  if (isActive !== undefined) q = q.eq('is_active', isActive === 'true');
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

router.post('/ingredients', authenticate, requirePermission('fb:ingredient:create'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { data, error } = await supabaseAdmin.from('ingredients').insert(req.body).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.status(201).json(data);
});

router.put('/ingredients/:id', authenticate, requirePermission('fb:ingredient:update'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { data, error } = await supabaseAdmin.from('ingredients').update(req.body).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

// Weighted-average cost recalculation for an ingredient
router.put('/ingredients/:id/recalculate-cost', authenticate, requirePermission('fb:ingredient:update'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  
  try {
    const ingredientId = req.params.id;
    
    // Get all receipt transactions for this ingredient (positive quantities only)
    const { data: receipts, error: receiptsError } = await supabaseAdmin
      .from('stock_transactions')
      .select('*')
      .eq('ingredient_id', ingredientId)
      .eq('transaction_type', 'Receipt')
      .order('date', { ascending: true });
    
    if (receiptsError) return res.status(500).json({ error: receiptsError.message });
    
    // Calculate weighted average cost
    let totalValue = 0;
    let totalQuantity = 0;
    
    receipts?.forEach(receipt => {
      const qty = receipt.quantity || 0;
      const costPerUnit = receipt.cost_per_unit || 0;
      totalValue += qty * costPerUnit;
      totalQuantity += qty;
    });
    
    const weightedAverageCost = totalQuantity > 0 ? totalValue / totalQuantity : 0;
    
    // Update ingredient with new cost
    const { data: updatedIngredient, error: updateError } = await supabaseAdmin
      .from('ingredients')
      .update({ current_cost: weightedAverageCost, updated_at: new Date().toISOString() })
      .eq('id', ingredientId)
      .select()
      .single();
    
    if (updateError) return res.status(500).json({ error: updateError.message });
    
    return res.json({
      ingredient: updatedIngredient,
      previousReceipts: receipts?.length || 0,
      totalQuantity,
      totalValue,
      newWeightedAverageCost: weightedAverageCost
    });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to recalculate weighted average cost' });
  }
});

// ── Stock Locations ───────────────────────────────────────────────
router.get('/stock-locations', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { type, outletId } = req.query as Record<string, string>;
  let q = supabaseAdmin.from('stock_locations').select('*').order('name');
  if (type) q = q.eq('type', type);
  if (outletId) q = q.eq('outlet_id', outletId);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

// ── Stock Transactions ────────────────────────────────────────────
router.get('/stock-transactions', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { ingredientId, locationId, transactionType, startDate, endDate } = req.query as Record<string, string>;
  let q = supabaseAdmin.from('stock_transactions').select('*, ingredients(*), stock_locations(*)').order('date', { ascending: false });
  if (ingredientId) q = q.eq('ingredient_id', ingredientId);
  if (locationId) q = q.eq('location_id', locationId);
  if (transactionType) q = q.eq('transaction_type', transactionType);
  if (startDate) q = q.gte('date', startDate);
  if (endDate) q = q.lte('date', endDate);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

router.post('/stock-transactions', authenticate, requirePermission('fb:stock:create'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  
  try {
    const transaction = req.body;
    
    // Insert the stock transaction
    const { data: newTransaction, error: insertError } = await supabaseAdmin
      .from('stock_transactions')
      .insert(transaction)
      .select()
      .single();
    
    if (insertError) return res.status(500).json({ error: insertError.message });
    
    // If this is a Receipt, automatically recalculate weighted-average cost for the ingredient
    if (transaction.transaction_type === 'Receipt') {
      const ingredientId = transaction.ingredient_id;
      
      // Get all receipt transactions for this ingredient
      const { data: receipts, error: receiptsError } = await supabaseAdmin
        .from('stock_transactions')
        .select('*')
        .eq('ingredient_id', ingredientId)
        .eq('transaction_type', 'Receipt')
        .order('date', { ascending: true });
      
      if (!receiptsError && receipts) {
        // Calculate weighted average cost
        let totalValue = 0;
        let totalQuantity = 0;
        
        receipts.forEach(receipt => {
          const qty = receipt.quantity || 0;
          const costPerUnit = receipt.cost_per_unit || 0;
          totalValue += qty * costPerUnit;
          totalQuantity += qty;
        });
        
        const weightedAverageCost = totalQuantity > 0 ? totalValue / totalQuantity : 0;
        
        // Update ingredient with new cost
        await supabaseAdmin
          .from('ingredients')
          .update({ current_cost: weightedAverageCost, updated_at: new Date().toISOString() })
          .eq('id', ingredientId);
        
        newTransaction.weighted_average_cost_updated = weightedAverageCost;
      }
    }
    
    return res.status(201).json(newTransaction);
  } catch (error) {
    return res.status(500).json({ error: 'Failed to create stock transaction' });
  }
});

// ── Requisitions ───────────────────────────────────────────────────
router.get('/requisitions', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { status } = req.query as Record<string, string>;
  let q = supabaseAdmin.from('requisitions').select('*, requisition_lines(*, ingredients(*)), stock_locations(*), outlets(*)').order('created_at', { ascending: false });
  if (status) q = q.eq('status', status);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

router.post('/requisitions', authenticate, requirePermission('fb:requisition:create'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { requisition, lines } = req.body;
  const { data: requisitionData, error: requisitionError } = await supabaseAdmin.from('requisitions').insert(requisition).select().single();
  if (requisitionError) return res.status(500).json({ error: requisitionError.message });

  if (lines && lines.length > 0) {
    const requisitionLines = lines.map((line: any) => ({ ...line, requisition_id: requisitionData.id }));
    const { error: linesError } = await supabaseAdmin.from('requisition_lines').insert(requisitionLines);
    if (linesError) return res.status(500).json({ error: linesError.message });
  }

  return res.status(201).json(requisitionData);
});

router.put('/requisitions/:id/approve', authenticate, requirePermission('fb:requisition:approve'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { approvedBy } = req.body;
  const { data, error } = await supabaseAdmin.from('requisitions').update({ status: 'Approved', approved_by: approvedBy, approved_at: new Date().toISOString() }).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

router.put('/requisitions/:id/fulfill', authenticate, requirePermission('fb:requisition:fulfill'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { fulfilledBy, lines } = req.body;
  const { data, error } = await supabaseAdmin.from('requisitions').update({ status: 'Fulfilled', fulfilled_by: fulfilledBy, fulfilled_at: new Date().toISOString() }).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });

  // Update requisition lines with fulfilled quantities
  if (lines && lines.length > 0) {
    for (const line of lines) {
      await supabaseAdmin.from('requisition_lines').update({ quantity_fulfilled: line.quantity_fulfilled }).eq('id', line.id);
    }
  }

  return res.json(data);
});

// ── Orders (POS) ───────────────────────────────────────────────────
router.get('/orders', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { outletId, status, startDate, endDate } = req.query as Record<string, string>;
  let q = supabaseAdmin.from('orders').select('*, order_lines(*, menu_items(*)), outlets(*)').order('created_at', { ascending: false });
  if (outletId) q = q.eq('outlet_id', outletId);
  if (status) q = q.eq('status', status);
  if (startDate) q = q.gte('created_at', startDate);
  if (endDate) q = q.lte('created_at', endDate);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

router.post('/orders', authenticate, requirePermission('fb:order:create'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { order, lines } = req.body;
  const { data: orderData, error: orderError } = await supabaseAdmin.from('orders').insert(order).select().single();
  if (orderError) return res.status(500).json({ error: orderError.message });

  if (lines && lines.length > 0) {
    const orderLines = lines.map((line: any) => ({ ...line, order_id: orderData.id }));
    const { error: linesError } = await supabaseAdmin.from('order_lines').insert(orderLines);
    if (linesError) return res.status(500).json({ error: linesError.message });
  }

  return res.status(201).json(orderData);
});

router.put('/orders/:id', authenticate, requirePermission('fb:order:update'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { data, error } = await supabaseAdmin.from('orders').update(req.body).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

router.put('/orders/:id/void', authenticate, requirePermission('fb:order:void'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { voidReason, voidedBy } = req.body;
  const { data, error } = await supabaseAdmin.from('orders').update({ status: 'Void', void_reason: voidReason, voided_by: voidedBy, voided_at: new Date().toISOString() }).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

// ── Banquet Events (read-only from canonical event_bookings) ──────
// Event CRUD is owned by /api/banquet-events (banquetEvents.routes.ts).
// This read endpoint lets the F&B portal list events for catering planning
// without duplicating the write path.
router.get('/banquet-events', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { status, startDate, endDate } = req.query as Record<string, string>;
  let q = supabaseAdmin.from('event_bookings').select('*').order('start_date', { ascending: false });
  if (status) q = q.eq('status', status);
  if (startDate) q = q.gte('start_date', startDate);
  if (endDate) q = q.lte('start_date', endDate);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

// ── Wastage Logs ───────────────────────────────────────────────────
router.get('/wastage-logs', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { ingredientId, locationId, reason, startDate, endDate } = req.query as Record<string, string>;
  let q = supabaseAdmin.from('wastage_logs').select('*, ingredients(*), stock_locations(*)').order('created_at', { ascending: false });
  if (ingredientId) q = q.eq('ingredient_id', ingredientId);
  if (locationId) q = q.eq('location_id', locationId);
  if (reason) q = q.eq('reason', reason);
  if (startDate) q = q.gte('created_at', startDate);
  if (endDate) q = q.lte('created_at', endDate);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

router.post('/wastage-logs', authenticate, requirePermission('fb:wastage:create'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { data, error } = await supabaseAdmin.from('wastage_logs').insert(req.body).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.status(201).json(data);
});

// ── Stock Counts ───────────────────────────────────────────────────
router.get('/stock-counts', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { locationId, status, startDate, endDate } = req.query as Record<string, string>;
  let q = supabaseAdmin.from('stock_counts').select('*, stock_count_lines(*, ingredients(*)), stock_locations(*)').order('count_date', { ascending: false });
  if (locationId) q = q.eq('location_id', locationId);
  if (status) q = q.eq('status', status);
  if (startDate) q = q.gte('count_date', startDate);
  if (endDate) q = q.lte('count_date', endDate);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

router.post('/stock-counts', authenticate, requirePermission('fb:stockcount:create'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { stockCount, lines } = req.body;
  const { data: stockCountData, error: stockCountError } = await supabaseAdmin.from('stock_counts').insert(stockCount).select().single();
  if (stockCountError) return res.status(500).json({ error: stockCountError.message });

  if (lines && lines.length > 0) {
    const stockCountLines = lines.map((line: any) => ({ ...line, stock_count_id: stockCountData.id }));
    const { error: linesError } = await supabaseAdmin.from('stock_count_lines').insert(stockCountLines);
    if (linesError) return res.status(500).json({ error: linesError.message });
  }

  return res.status(201).json(stockCountData);
});

router.put('/stock-counts/:id/approve', authenticate, requirePermission('fb:stockcount:approve'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { approvedBy } = req.body;
  const { data, error } = await supabaseAdmin.from('stock_counts').update({ status: 'Approved', approved_by: approvedBy }).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

// ── KPI Reporting ──────────────────────────────────────────────────
router.get('/kpis', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { startDate, endDate, outletId } = req.query as Record<string, string>;

  try {
    // Get orders for the period
    let ordersQuery = supabaseAdmin.from('orders').select('*');
    if (startDate) ordersQuery = ordersQuery.gte('created_at', startDate);
    if (endDate) ordersQuery = ordersQuery.lte('created_at', endDate);
    if (outletId) ordersQuery = ordersQuery.eq('outlet_id', outletId);
    const { data: orders, error: ordersError } = await ordersQuery;

    if (ordersError) return res.status(500).json({ error: ordersError.message });

    // Calculate KPIs
    const totalRevenue = orders?.reduce((sum, order) => sum + (order.total_amount || 0), 0) || 0;
    const totalOrders = orders?.length || 0;
    const averageCheck = totalOrders > 0 ? totalRevenue / totalOrders : 0;
    const paidOrders = orders?.filter(o => o.status === 'Paid').length || 0;
    const voidOrders = orders?.filter(o => o.status === 'Void').length || 0;
    const voidRate = totalOrders > 0 ? (voidOrders / totalOrders) * 100 : 0;

    // Get wastage data
    let wastageQuery = supabaseAdmin.from('wastage_logs').select('*');
    if (startDate) wastageQuery = wastageQuery.gte('created_at', startDate);
    if (endDate) wastageQuery = wastageQuery.lte('created_at', endDate);
    const { data: wastageLogs, error: wastageError } = await wastageQuery;

    if (wastageError) return res.status(500).json({ error: wastageError.message });

    const totalWastageValue = wastageLogs?.reduce((sum, log) => sum + (log.cost_value || 0), 0) || 0;

    // Get stock transactions for COGS calculation
    let stockQuery = supabaseAdmin.from('stock_transactions').select('*').eq('transaction_type', 'POSDepletion');
    if (startDate) stockQuery = stockQuery.gte('date', startDate);
    if (endDate) stockQuery = stockQuery.lte('date', endDate);
    const { data: stockTransactions, error: stockError } = await stockQuery;

    if (stockError) return res.status(500).json({ error: stockError.message });

    const totalCOGS = stockTransactions?.reduce((sum, tx) => sum + (tx.total_value || 0), 0) || 0;
    const foodCostPercent = totalRevenue > 0 ? (totalCOGS / totalRevenue) * 100 : 0;

    const kpis = {
      totalRevenue,
      totalOrders,
      averageCheck,
      paidOrders,
      voidOrders,
      voidRate,
      totalWastageValue,
      totalCOGS,
      foodCostPercent,
      period: { startDate, endDate },
      outletId
    };

    return res.json(kpis);
  } catch (error) {
    return res.status(500).json({ error: 'Failed to calculate KPIs' });
  }
});

router.get('/kpis/by-outlet', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { startDate, endDate } = req.query as Record<string, string>;

  try {
    // Get all outlets
    const { data: outlets, error: outletsError } = await supabaseAdmin.from('outlets').select('*').eq('is_active', true);
    if (outletsError) return res.status(500).json({ error: outletsError.message });

    // Calculate KPIs per outlet
    const outletKPIs = await Promise.all(
      (outlets || []).map(async (outlet) => {
        let ordersQuery = supabaseAdmin!.from('orders').select('*').eq('outlet_id', outlet.id);
        if (startDate) ordersQuery = ordersQuery.gte('created_at', startDate);
        if (endDate) ordersQuery = ordersQuery.lte('created_at', endDate);
        const { data: orders } = await ordersQuery;

        const totalRevenue = orders?.reduce((sum, order) => sum + (order.total_amount || 0), 0) || 0;
        const totalOrders = orders?.length || 0;
        const averageCheck = totalOrders > 0 ? totalRevenue / totalOrders : 0;

        return {
          outletId: outlet.id,
          outletName: outlet.name,
          outletType: outlet.type,
          totalRevenue,
          totalOrders,
          averageCheck
        };
      })
    );

    return res.json(outletKPIs);
  } catch (error) {
    return res.status(500).json({ error: 'Failed to calculate outlet KPIs' });
  }
});

// ── Table Management ─────────────────────────────────────────────────
router.get('/tables', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { outletId, status } = req.query as Record<string, string>;
  let q = supabaseAdmin.from('fb_tables').select('*').order('table_number');
  if (outletId) q = q.eq('outlet_id', outletId);
  if (status) q = q.eq('status', status);
  const { data: tables, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  // Fetch outlets separately and join in JS (schema cache is unreliable)
  const { data: outlets, error: oErr } = await supabaseAdmin.from('outlets').select('*');
  if (oErr) return res.status(500).json({ error: oErr.message });
  const outletMap = new Map((outlets || []).map((o: any) => [o.id, o]));
  const result = (tables || []).map((t: any) => ({
    ...t,
    outlet_name: outletMap.get(t.outlet_id)?.name || null,
  }));
  return res.json(result);
});

router.post('/tables', authenticate, requirePermission('fb:table:create'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { data, error } = await supabaseAdmin.from('fb_tables').insert(req.body).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.status(201).json(data);
});

router.put('/tables/:id', authenticate, requirePermission('fb:table:update'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { data, error } = await supabaseAdmin.from('fb_tables').update(req.body).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

router.delete('/tables/:id', authenticate, requirePermission('fb:table:delete'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { error } = await supabaseAdmin.from('fb_tables').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  return res.status(204).send();
});

router.post('/tables/assign', authenticate, requirePermission('fb:table:assign'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { tableId, orderId, serverId } = req.body;
  
  const { data, error } = await supabaseAdmin.rpc('assign_table_to_order', {
    p_table_id: tableId,
    p_order_id: orderId,
    p_server_id: serverId
  });
  
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

router.post('/tables/release', authenticate, requirePermission('fb:table:release'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { tableId, markDirty } = req.body;
  
  const { data, error } = await supabaseAdmin.rpc('release_table_from_order', {
    p_table_id: tableId,
    p_mark_dirty: markDirty !== false
  });
  
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

router.put('/tables/:id/clean', authenticate, requirePermission('fb:table:clean'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  
  const { data, error } = await supabaseAdmin.rpc('mark_table_clean', {
    p_table_id: req.params.id
  });
  
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

router.get('/tables/available', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { outletId, partySize, section } = req.query as Record<string, string>;
  
  const { data, error } = await supabaseAdmin.rpc('get_available_tables', {
    p_outlet_id: outletId,
    p_party_size: parseInt(partySize),
    p_section: section || null
  });
  
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

router.get('/tables/summary', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { outletId } = req.query as Record<string, string>;
  
  const { data, error } = await supabaseAdmin.rpc('get_table_status_summary', {
    p_outlet_id: outletId
  });
  
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

// ── Table Reservations ───────────────────────────────────────────────
router.get('/table-reservations', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { tableId, reservationId, status } = req.query as Record<string, string>;
  let q = supabaseAdmin.from('fb_table_reservations').select('*').order('arrival_time');
  if (tableId) q = q.eq('table_id', tableId);
  if (reservationId) q = q.eq('reservation_id', reservationId);
  if (status) q = q.eq('status', status);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

router.post('/table-reservations', authenticate, requirePermission('fb:reservation:create'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { data, error } = await supabaseAdmin.from('fb_table_reservations').insert(req.body).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.status(201).json(data);
});

router.put('/table-reservations/:id', authenticate, requirePermission('fb:reservation:update'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { data, error } = await supabaseAdmin.from('fb_table_reservations').update(req.body).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

router.post('/table-reservations/auto-assign/:reservationId', authenticate, requirePermission('fb:reservation:auto_assign'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  
  const { data, error } = await supabaseAdmin.rpc('auto_assign_table_from_reservation', {
    p_reservation_id: req.params.reservationId
  });
  
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

// ── Waitlist ─────────────────────────────────────────────────────────
router.get('/waitlist', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { seated, cancelled } = req.query as Record<string, string>;
  let q = supabaseAdmin.from('fb_waitlist').select('*').order('queued_at', { ascending: false });
  if (seated !== undefined) q = q.eq('seated', seated === 'true');
  if (cancelled !== undefined) q = q.eq('cancelled', cancelled === 'true');
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

router.post('/waitlist', authenticate, requirePermission('fb:waitlist:create'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { guestName, partySize, contactPhone, notes } = req.body;
  
  const { data, error } = await supabaseAdmin.rpc('add_to_waitlist', {
    p_guest_name: guestName,
    p_party_size: partySize,
    p_contact_phone: contactPhone || null,
    p_notes: notes || null
  });
  
  if (error) return res.status(500).json({ error: error.message });
  return res.status(201).json({ id: data });
});

router.put('/waitlist/:id', authenticate, requirePermission('fb:waitlist:update'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { data, error } = await supabaseAdmin.from('fb_waitlist').update(req.body).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

router.post('/waitlist/seat-next', authenticate, requirePermission('fb:waitlist:seat'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { tableId, partySize } = req.body;
  
  const { data, error } = await supabaseAdmin.rpc('seat_next_waitlist_guest', {
    p_table_id: tableId,
    p_party_size: partySize
  });
  
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

router.post('/waitlist/:id/notify', authenticate, requirePermission('fb:waitlist:notify'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  
  const { data, error } = await supabaseAdmin
    .from('fb_waitlist')
    .update({ notified: true, notified_at: new Date().toISOString() })
    .eq('id', req.params.id)
    .select()
    .single();
  
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

router.post('/waitlist/:id/cancel', authenticate, requirePermission('fb:waitlist:cancel'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  
  const { data, error } = await supabaseAdmin
    .from('fb_waitlist')
    .update({ cancelled: true, cancelled_at: new Date().toISOString() })
    .eq('id', req.params.id)
    .select()
    .single();
  
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

// ── Server Sections ───────────────────────────────────────────────────
router.get('/server-sections', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { outletId, serverId } = req.query as Record<string, string>;
  let q = supabaseAdmin.from('fb_server_sections').select('*').order('section_name');
  if (outletId) q = q.eq('outlet_id', outletId);
  if (serverId) q = q.eq('server_id', serverId);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

router.post('/server-sections', authenticate, requirePermission('fb:section:create'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { data, error } = await supabaseAdmin.from('fb_server_sections').insert(req.body).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.status(201).json(data);
});

router.put('/server-sections/:id', authenticate, requirePermission('fb:section:update'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { data, error } = await supabaseAdmin.from('fb_server_sections').update(req.body).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

router.delete('/server-sections/:id', authenticate, requirePermission('fb:section:delete'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { error } = await supabaseAdmin.from('fb_server_sections').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  return res.status(204).send();
});

// ── Table Turn History ───────────────────────────────────────────────
router.get('/table-turn-history', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { tableId, startDate, endDate } = req.query as Record<string, string>;
  let q = supabaseAdmin!.from('fb_table_turn_history').select('*').order('turn_start_time', { ascending: false });
  if (tableId) q = q.eq('table_id', tableId);
  if (startDate) q = q.gte('turn_start_time', startDate);
  if (endDate) q = q.lte('turn_start_time', endDate);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

// ── Supplier Management ───────────────────────────────────────────────
router.get('/suppliers', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { isActive, search, category } = req.query as Record<string, string>;
  let q = supabaseAdmin.from('fb_suppliers').select('*').order('name');
  if (isActive !== undefined) q = q.eq('is_active', isActive === 'true');
  if (search) q = q.ilike('name', `%${search}%`);
  if (category) {
    const { data: categoryAssignments } = await supabaseAdmin
      .from('fb_supplier_category_assignments')
      .select('supplier_id')
      .eq('category_id', category);
    const supplierIds = categoryAssignments?.map(a => a.supplier_id) || [];
    if (supplierIds.length > 0) {
      q = q.in('id', supplierIds);
    } else {
      q = q.eq('id', 'none'); // Return no results if no suppliers in category
    }
  }
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

router.get('/suppliers/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { data, error } = await supabaseAdmin.from('fb_suppliers').select('*').eq('id', req.params.id).single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

router.post('/suppliers', authenticate, requirePermission('fb:supplier:create'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { data, error } = await supabaseAdmin.from('fb_suppliers').insert(req.body).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.status(201).json(data);
});

router.put('/suppliers/:id', authenticate, requirePermission('fb:supplier:update'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { data, error } = await supabaseAdmin.from('fb_suppliers').update(req.body).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

router.delete('/suppliers/:id', authenticate, requirePermission('fb:supplier:delete'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { error } = await supabaseAdmin.from('fb_suppliers').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  return res.status(204).send();
});

// Supplier Contacts
router.get('/suppliers/:id/contacts', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { data, error } = await supabaseAdmin.from('fb_supplier_contacts').select('*').eq('supplier_id', req.params.id).order('is_primary', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

router.post('/suppliers/:id/contacts', authenticate, requirePermission('fb:supplier:update'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { data, error } = await supabaseAdmin.from('fb_supplier_contacts').insert({ ...req.body, supplier_id: req.params.id }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.status(201).json(data);
});

router.put('/suppliers/:id/contacts/:contactId', authenticate, requirePermission('fb:supplier:update'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { data, error } = await supabaseAdmin.from('fb_supplier_contacts').update(req.body).eq('id', req.params.contactId).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

router.delete('/suppliers/:id/contacts/:contactId', authenticate, requirePermission('fb:supplier:update'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { error } = await supabaseAdmin.from('fb_supplier_contacts').delete().eq('id', req.params.contactId);
  if (error) return res.status(500).json({ error: error.message });
  return res.status(204).send();
});

// Supplier Categories
router.get('/supplier-categories', authenticate, async (_req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { data, error } = await supabaseAdmin.from('fb_supplier_categories').select('*').order('name');
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

router.post('/supplier-categories', authenticate, requirePermission('fb:supplier:create'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { data, error } = await supabaseAdmin.from('fb_supplier_categories').insert(req.body).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.status(201).json(data);
});

router.put('/supplier-categories/:id', authenticate, requirePermission('fb:supplier:update'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { data, error } = await supabaseAdmin.from('fb_supplier_categories').update(req.body).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

router.delete('/supplier-categories/:id', authenticate, requirePermission('fb:supplier:delete'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { error } = await supabaseAdmin.from('fb_supplier_categories').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  return res.status(204).send();
});

router.post('/suppliers/:id/categories/:categoryId', authenticate, requirePermission('fb:supplier:update'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { error } = await supabaseAdmin.from('fb_supplier_category_assignments').insert({
    supplier_id: req.params.id,
    category_id: req.params.categoryId
  });
  if (error) return res.status(500).json({ error: error.message });
  return res.status(201).send();
});

router.delete('/suppliers/:id/categories/:categoryId', authenticate, requirePermission('fb:supplier:update'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { error } = await supabaseAdmin.from('fb_supplier_category_assignments')
    .delete()
    .eq('supplier_id', req.params.id)
    .eq('category_id', req.params.categoryId);
  if (error) return res.status(500).json({ error: error.message });
  return res.status(204).send();
});

// Supplier Performance
router.get('/suppliers/:id/performance', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { startDate, endDate } = req.query as Record<string, string>;
  let q = supabaseAdmin.from('fb_supplier_performance').select('*').eq('supplier_id', req.params.id).order('period_start', { ascending: false });
  if (startDate) q = q.gte('period_start', startDate);
  if (endDate) q = q.lte('period_end', endDate);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

router.post('/suppliers/:id/performance/calculate', authenticate, requirePermission('fb:supplier:view'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { startDate, endDate } = req.body;
  
  const { data, error } = await supabaseAdmin.rpc('calculate_supplier_performance', {
    p_supplier_id: req.params.id,
    p_period_start: startDate,
    p_period_end: endDate
  });
  
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ id: data });
});

// Supplier Search and Analytics
router.get('/suppliers/search', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { q } = req.query as Record<string, string>;
  if (!q) return res.json([]);
  
  const { data, error } = await supabaseAdmin
    .from('fb_suppliers')
    .select('*')
    .or(`name.ilike.%${q}%,supplier_code.ilike.%${q}%,contact_person.ilike.%${q}%`)
    .eq('is_active', true)
    .limit(20);
    
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

router.get('/suppliers/:id/statistics', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  
  try {
    // Get supplier statistics
    const { data: orders } = await supabaseAdmin
      .from('fb_purchase_orders')
      .select('total_amount, order_date, status')
      .eq('supplier_id', req.params.id)
      .in('status', ['received', 'closed']);
    
    const totalOrders = orders?.length || 0;
    const totalSpend = orders?.reduce((sum, order) => sum + (order.total_amount || 0), 0) || 0;
    const averageOrderValue = totalOrders > 0 ? totalSpend / totalOrders : 0;
    const lastOrderDate = orders && orders.length > 0 ? orders[orders.length - 1].order_date : undefined;
    
    // Get performance metrics
    const { data: performance } = await supabaseAdmin
      .from('fb_supplier_performance')
      .select('*')
      .eq('supplier_id', req.params.id)
      .order('period_start', { ascending: false })
      .limit(1);
    
    const onTimeDeliveryRate = performance?.[0]?.on_time_delivery_rate || 0;
    const qualityScore = performance?.[0]?.quality_score || 0;
    
    return res.json({
      totalOrders,
      totalSpend,
      averageOrderValue,
      onTimeDeliveryRate,
      qualityScore,
      lastOrderDate,
    });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to calculate statistics' });
  }
});

// ── Purchase Orders ───────────────────────────────────────────────────
router.get('/purchase-orders', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { supplierId, status, outletId, startDate, endDate } = req.query as Record<string, string>;
  let q = supabaseAdmin.from('fb_purchase_orders').select('*').order('order_date', { ascending: false });
  if (supplierId) q = q.eq('supplier_id', supplierId);
  if (status) q = q.eq('status', status);
  if (outletId) q = q.eq('outlet_id', outletId);
  if (startDate) q = q.gte('order_date', startDate);
  if (endDate) q = q.lte('order_date', endDate);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

router.get('/purchase-orders/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { data, error } = await supabaseAdmin.from('fb_purchase_orders').select('*').eq('id', req.params.id).single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

router.post('/purchase-orders', authenticate, requirePermission('fb:po:create'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { data, error } = await supabaseAdmin.from('fb_purchase_orders').insert(req.body).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.status(201).json(data);
});

router.put('/purchase-orders/:id', authenticate, requirePermission('fb:po:update'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { data, error } = await supabaseAdmin.from('fb_purchase_orders').update(req.body).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

router.delete('/purchase-orders/:id', authenticate, requirePermission('fb:po:delete'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { error } = await supabaseAdmin.from('fb_purchase_orders').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  return res.status(204).send();
});

// Purchase Order Lines
router.get('/purchase-orders/:id/lines', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { data, error } = await supabaseAdmin.from('fb_purchase_order_lines').select('*').eq('po_id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

router.post('/purchase-orders/:id/lines', authenticate, requirePermission('fb:po:update'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { data, error } = await supabaseAdmin.from('fb_purchase_order_lines').insert({ ...req.body, po_id: req.params.id }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.status(201).json(data);
});

router.put('/purchase-orders/:id/lines/:lineId', authenticate, requirePermission('fb:po:update'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { data, error } = await supabaseAdmin.from('fb_purchase_order_lines').update(req.body).eq('id', req.params.lineId).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

router.delete('/purchase-orders/:id/lines/:lineId', authenticate, requirePermission('fb:po:update'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { error } = await supabaseAdmin.from('fb_purchase_order_lines').delete().eq('id', req.params.lineId);
  if (error) return res.status(500).json({ error: error.message });
  return res.status(204).send();
});

// Purchase Order Workflow
router.post('/purchase-orders/:id/submit', authenticate, requirePermission('fb:po:submit'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { data, error } = await supabaseAdmin.from('fb_purchase_orders').update({ status: 'submitted' }).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

router.post('/purchase-orders/:id/approve', authenticate, requirePermission('fb:po:approve'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { data, error } = await supabaseAdmin.from('fb_purchase_orders').update({ 
    status: 'acknowledged',
    approved_by: req.body.approvedBy,
    approved_at: new Date().toISOString()
  }).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

router.post('/purchase-orders/:id/cancel', authenticate, requirePermission('fb:po:cancel'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { data, error } = await supabaseAdmin.from('fb_purchase_orders').update({ 
    status: 'cancelled',
    notes: req.body.reason
  }).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

router.get('/purchase-orders/:id/calculate-total', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { data, error } = await supabaseAdmin.rpc('calculate_po_total', { p_po_id: req.params.id });
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ total: data });
});

// Goods Receipts
router.get('/goods-receipts', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { poId, supplierId, outletId, startDate, endDate } = req.query as Record<string, string>;
  let q = supabaseAdmin.from('fb_goods_receipts').select('*').order('received_date', { ascending: false });
  if (poId) q = q.eq('po_id', poId);
  if (supplierId) q = q.eq('supplier_id', supplierId);
  if (outletId) q = q.eq('outlet_id', outletId);
  if (startDate) q = q.gte('received_date', startDate);
  if (endDate) q = q.lte('received_date', endDate);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

router.get('/goods-receipts/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { data, error } = await supabaseAdmin.from('fb_goods_receipts').select('*').eq('id', req.params.id).single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

router.post('/goods-receipts', authenticate, requirePermission('fb:receipt:create'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { data, error } = await supabaseAdmin.from('fb_goods_receipts').insert(req.body).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.status(201).json(data);
});

router.put('/goods-receipts/:id', authenticate, requirePermission('fb:receipt:update'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { data, error } = await supabaseAdmin.from('fb_goods_receipts').update(req.body).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

// Supplier Invoices
router.get('/supplier-invoices', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { supplierId, poId, status, startDate, endDate } = req.query as Record<string, string>;
  let q = supabaseAdmin.from('fb_supplier_invoices').select('*').order('invoice_date', { ascending: false });
  if (supplierId) q = q.eq('supplier_id', supplierId);
  if (poId) q = q.eq('po_id', poId);
  if (status) q = q.eq('status', status);
  if (startDate) q = q.gte('invoice_date', startDate);
  if (endDate) q = q.lte('invoice_date', endDate);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

router.get('/supplier-invoices/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { data, error } = await supabaseAdmin.from('fb_supplier_invoices').select('*').eq('id', req.params.id).single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

router.post('/supplier-invoices', authenticate, requirePermission('fb:invoice:create'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { data, error } = await supabaseAdmin.from('fb_supplier_invoices').insert(req.body).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.status(201).json(data);
});

router.put('/supplier-invoices/:id', authenticate, requirePermission('fb:invoice:update'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { data, error } = await supabaseAdmin.from('fb_supplier_invoices').update(req.body).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

router.delete('/supplier-invoices/:id', authenticate, requirePermission('fb:invoice:delete'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { error } = await supabaseAdmin.from('fb_supplier_invoices').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  return res.status(204).send();
});

router.post('/supplier-invoices/:id/paid', authenticate, requirePermission('fb:invoice:pay'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { data, error } = await supabaseAdmin.from('fb_supplier_invoices').update({
    status: 'paid',
    payment_date: new Date().toISOString(),
    payment_reference: req.body.paymentReference
  }).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

// =====================
// F&B Recipe & Ingredient API (migrated from server.ts inline handlers)
// =====================
router.get('/ingredients', authenticate, async (_req, res) => {
  if (hasSupabaseAdminConfig && supabaseAdmin) {
    const { data, error } = await supabaseAdmin.from('ingredients').select('*').eq('is_active', true).order('name');
    if (error) return res.status(500).json({ error: error.message });
    return res.json(data);
  }
  return res.status(503).json({ error: 'Database not configured' });
});

router.post('/ingredients', authenticate, requirePermission('fb:kitchen:write'), async (req, res) => {
  const { name, category, unitOfMeasure, parLevel, reorderPoint, currentCost } = req.body;
  if (hasSupabaseAdminConfig && supabaseAdmin) {
    const { data, error } = await supabaseAdmin.from('ingredients')
      .insert({ name, category, unit_of_measure: unitOfMeasure, par_level: parLevel, reorder_point: reorderPoint, current_cost: currentCost, is_active: true })
      .select().single();
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ success: true, ingredient: data });
  }
  return res.status(503).json({ error: 'Database not configured' });
});

router.patch('/ingredients/:id', authenticate, requirePermission('fb:kitchen:write'), async (req, res) => {
  const { name, category, unitOfMeasure, parLevel, reorderPoint, currentCost, isActive } = req.body;
  if (hasSupabaseAdminConfig && supabaseAdmin) {
    const updateFields: Record<string, any> = {};
    if (name !== undefined) updateFields.name = name;
    if (category !== undefined) updateFields.category = category;
    if (unitOfMeasure !== undefined) updateFields.unit_of_measure = unitOfMeasure;
    if (parLevel !== undefined) updateFields.par_level = parLevel;
    if (reorderPoint !== undefined) updateFields.reorder_point = reorderPoint;
    if (currentCost !== undefined) updateFields.current_cost = currentCost;
    if (isActive !== undefined) updateFields.is_active = isActive;
    const { error } = await supabaseAdmin.from('ingredients').update(updateFields).eq('id', req.params.id);
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ success: true });
  }
  return res.status(503).json({ error: 'Database not configured' });
});

router.delete('/ingredients/:id', authenticate, requirePermission('fb:kitchen:write'), async (req, res) => {
  if (hasSupabaseAdminConfig && supabaseAdmin) {
    const { error } = await supabaseAdmin.from('ingredients').update({ is_active: false }).eq('id', req.params.id);
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ success: true });
  }
  return res.status(503).json({ error: 'Database not configured' });
});

router.patch('/menu-items/:id', authenticate, requirePermission('fb:write'), async (req, res) => {
  if (hasSupabaseAdminConfig && supabaseAdmin) {
    const { data, error } = await supabaseAdmin.from('menu_items')
      .update(req.body)
      .eq('id', req.params.id)
      .select()
      .single();
    if (error) return res.status(500).json({ error: error.message });
    return res.json(data);
  }
  return res.status(503).json({ error: 'Database not configured' });
});

router.delete('/menu-items/:id', authenticate, requirePermission('fb:write'), async (req, res) => {
  if (hasSupabaseAdminConfig && supabaseAdmin) {
    const { error } = await supabaseAdmin.from('menu_items')
      .delete()
      .eq('id', req.params.id);
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ success: true });
  }
  return res.status(503).json({ error: 'Database not configured' });
});

router.get('/recipes', authenticate, async (_req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  
  // Fetch regular recipes
  const { data: recipes, error: rErr } = await supabaseAdmin.from('recipes').select('*').order('created_at', { ascending: false });
  if (rErr) return res.status(500).json({ error: rErr.message });

  // Fetch bar recipes (recipe_type='drink_item')
  const { data: barRecipes, error: barErr } = await supabaseAdmin
    .from('bar_recipes')
    .select('*')
    .eq('recipe_type', 'drink_item')
    .eq('is_deleted', false)
    .order('created_at', { ascending: false });
  if (barErr) return res.status(500).json({ error: barErr.message });

  const { data: menuItems, error: miErr } = await supabaseAdmin.from('menu_items').select('id, name, selling_price, category, preparation_time_minutes, description, item_code');
  if (miErr) return res.status(500).json({ error: miErr.message });

  const { data: lines, error: lErr } = await supabaseAdmin.from('recipe_lines').select('*');
  if (lErr) return res.status(500).json({ error: lErr.message });

  // Fetch bar_recipe_ingredients for bar recipes
  const { data: barLines, error: blErr } = await supabaseAdmin.from('bar_recipe_ingredients').select('*');
  if (blErr) return res.status(500).json({ error: blErr.message });

  const { data: ingredients, error: iErr } = await supabaseAdmin.from('ingredients').select('id, name, current_cost, unit_of_measure, category');
  if (iErr) return res.status(500).json({ error: iErr.message });

  const { data: subRecipes, error: srErr } = await supabaseAdmin.from('sub_recipes').select('id, name, category, yield_qty, yield_unit');
  if (srErr) return res.status(500).json({ error: srErr.message });

  const miMap: Record<string, any> = {};
  for (const mi of menuItems || []) miMap[mi.id] = mi;
  const ingMap: Record<string, any> = {};
  for (const ing of ingredients || []) ingMap[ing.id] = ing;
  const srMap: Record<string, any> = {};
  for (const sr of subRecipes || []) srMap[sr.id] = sr;

  // Process regular recipes
  const regularRecipes = (recipes || []).map((r: any) => ({
    ...r,
    is_bar_recipe: false,
    menu_items: miMap[r.menu_item_id] || null,
    recipe_lines: (lines || []).filter((l: any) => l.recipe_id === r.id).map((l: any) => ({
      ...l,
      ingredients: ingMap[l.ingredient_id] || null,
      sub_recipe: srMap[l.sub_recipe_id] || null,
    })),
  }));

  // Process bar recipes (cocktails, mocktails, etc.)
  const barRecipesMapped = (barRecipes || []).map((br: any) => ({
    id: br.id,
    menu_item_id: null,
    name: br.name,
    yield: br.yield_qty,
    portions: Math.round(br.yield_qty / br.portion_size) || 1,
    created_at: br.created_at,
    updated_at: br.updated_at,
    is_bar_recipe: true,
    recipe_code: br.recipe_code,
    bar_category: br.category,
    abv: br.abv,
    serving_glass: br.serving_glass,
    total_cost: br.total_cost,
    cost_per_portion: br.cost_per_portion,
    selling_price: br.selling_price,
    pour_cost_percent: br.pour_cost_percent,
    recipe_type: br.recipe_type,
    menu_items: null,
    recipe_lines: (barLines || []).filter((l: any) => l.recipe_id === br.id).map((l: any) => ({
      id: l.id,
      recipe_id: br.id,
      ingredient_id: l.ingredient_id,
      sub_recipe_id: null,
      quantity: l.quantity,
      unit: l.unit,
      cost_at_time_of_costing: l.cost_at_time_of_costing || 0,
      ingredients: ingMap[l.ingredient_id] || null,
      sub_recipe: null,
    })),
  }));

  return res.json([...regularRecipes, ...barRecipesMapped]);
});

router.post('/recipes', authenticate, requirePermission('fb:kitchen:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { menuItemId, name, portions, yield: recipeYield, lines, isBarRecipe, recipeCode, barCategory, abv, servingGlass, sellingPrice } = req.body;

  if (isBarRecipe) {
    // Create bar recipe (cocktail, mocktail, etc.)
    const { data: barData, error: barError } = await supabaseAdmin
      .from('bar_recipes')
      .insert({
        recipe_code: recipeCode || `DRINK-${Date.now()}`,
        name,
        category: barCategory || 'cocktail',
        recipe_type: 'drink_item',
        yield_qty: recipeYield,
        yield_unit: 'ml',
        portion_size: recipeYield / portions,
        portion_unit: 'ml',
        prep_time_minutes: 0,
        abv: abv || null,
        serving_glass: servingGlass || null,
        total_cost: 0,
        cost_per_portion: 0,
        selling_price: sellingPrice || null,
        pour_cost_percent: 0,
        status: 'active',
        notes: null,
      })
      .select()
      .single();
    if (barError) return res.status(500).json({ error: barError.message });

    if (lines && lines.length > 0) {
      const { error: linesError } = await supabaseAdmin.from('bar_recipe_ingredients').insert(
        lines.map((line: any) => ({
          recipe_id: barData.id,
          ingredient_id: line.ingredientId,
          quantity: line.quantity,
          unit: line.unit,
          cost_at_time_of_costing: line.cost || 0,
        }))
      );
      if (linesError) return res.status(500).json({ error: linesError.message });
    }
    return res.json(barData);
  } else {
    // Create regular recipe
    const recipeId = crypto.randomUUID();
    const insertBody: Record<string, unknown> = {
      id: recipeId,
      portions,
      yield: recipeYield,
    };
    // menu_item_id is now optional (nullable) — only set if provided
    if (menuItemId) insertBody.menu_item_id = menuItemId;
    // name for standalone recipes without a menu item
    if (name) insertBody.name = name;

    const { data: recipeData, error: recipeError } = await supabaseAdmin.from('recipes')
      .insert(insertBody)
      .select()
      .single();

    if (recipeError) return res.status(500).json({ error: recipeError.message });

    if (lines && lines.length > 0) {
      const { error: linesError } = await supabaseAdmin.from('recipe_lines')
        .insert(lines.map((line: any) => ({
          id: crypto.randomUUID(),
          recipe_id: recipeId,
          ingredient_id: line.ingredientId || null,
          sub_recipe_id: line.subRecipeId || null,
          quantity: line.quantity,
          unit: line.unit,
          cost_at_time_of_costing: line.cost || 0,
        })));

      if (linesError) return res.status(500).json({ error: linesError.message });
    }

    return res.json(recipeData);
  }
});

router.patch('/recipes/:id', authenticate, requirePermission('fb:kitchen:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { menuItemId, name, portions, yield: recipeYield, lines } = req.body;
  const updateFields: Record<string, unknown> = {};
  if (menuItemId !== undefined) updateFields.menu_item_id = menuItemId || null;
  if (name !== undefined) updateFields.name = name;
  if (portions !== undefined) updateFields.portions = portions;
  if (recipeYield !== undefined) updateFields.yield = recipeYield;

  const { data, error } = await supabaseAdmin.from('recipes')
    .update(updateFields)
    .eq('id', req.params.id)
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });

  // If lines provided, replace all recipe_lines
  if (lines !== undefined) {
    await supabaseAdmin.from('recipe_lines').delete().eq('recipe_id', req.params.id);
    if (lines.length > 0) {
      const { error: linesError } = await supabaseAdmin.from('recipe_lines')
        .insert(lines.map((line: any) => ({
          id: crypto.randomUUID(),
          recipe_id: req.params.id,
          ingredient_id: line.ingredientId || null,
          sub_recipe_id: line.subRecipeId || null,
          quantity: line.quantity,
          unit: line.unit,
          cost_at_time_of_costing: line.cost || 0,
        })));
      if (linesError) return res.status(500).json({ error: linesError.message });
    }
  }

  return res.json(data);
});

router.delete('/recipes/:id', authenticate, requirePermission('fb:kitchen:write'), async (req, res) => {
  if (hasSupabaseAdminConfig && supabaseAdmin) {
    const { error } = await supabaseAdmin.from('recipes')
      .delete()
      .eq('id', req.params.id);
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ success: true });
  }
  return res.status(503).json({ error: 'Database not configured' });
});

router.get('/recipes/:id/cost', authenticate, async (req, res) => {
  if (hasSupabaseAdminConfig && supabaseAdmin) {
    const { data, error } = await supabaseAdmin.rpc('calculate_recipe_cost', { p_recipe_id: req.params.id });
    if (error) return res.status(500).json({ error: error.message });
    return res.json(data);
  }
  return res.status(503).json({ error: 'Database not configured' });
});

// =====================
// F&B Sub-Recipes API (intermediate preparations like sauces, doughs, stocks)
// Also includes bar sub-recipes (recipe_type='sub_recipe') for syrups, infusions, etc.
// =====================
router.get('/sub-recipes', authenticate, async (_req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  
  // Fetch regular sub_recipes
  const { data: subRecipes, error: srError } = await supabaseAdmin
    .from('sub_recipes')
    .select('*')
    .order('name');
  if (srError) return res.status(500).json({ error: srError.message });

  // Fetch bar sub-recipes (recipe_type='sub_recipe')
  const { data: barSubRecipes, error: barError } = await supabaseAdmin
    .from('bar_recipes')
    .select('*')
    .eq('recipe_type', 'sub_recipe')
    .eq('is_deleted', false)
    .order('name');
  if (barError) return res.status(500).json({ error: barError.message });

  // Fetch sub_recipe_lines for regular sub_recipes
  const { data: lines, error: linesError } = await supabaseAdmin
    .from('sub_recipe_lines')
    .select('*');
  if (linesError) return res.status(500).json({ error: linesError.message });

  // Fetch bar_recipe_ingredients for bar sub-recipes
  const { data: barLines, error: barLinesError } = await supabaseAdmin
    .from('bar_recipe_ingredients')
    .select('*');
  if (barLinesError) return res.status(500).json({ error: barLinesError.message });

  const { data: ingredients, error: ingError } = await supabaseAdmin
    .from('ingredients')
    .select('id, name, current_cost, unit_of_measure, category');
  if (ingError) return res.status(500).json({ error: ingError.message });

  const ingMap: Record<string, any> = {};
  for (const ing of ingredients || []) ingMap[ing.id] = ing;

  // Process regular sub_recipes
  const regularSubRecipes = (subRecipes || []).map((sr: any) => ({
    ...sr,
    is_bar_recipe: false,
    sub_recipe_lines: (lines || []).filter((l: any) => l.sub_recipe_id === sr.id).map((l: any) => ({
      ...l,
      ingredients: ingMap[l.ingredient_id] || null,
    })),
  }));

  // Process bar sub-recipes (syrups, infusions, etc.)
  const barSubRecipesMapped = (barSubRecipes || []).map((br: any) => ({
    id: br.id,
    name: br.name,
    description: br.notes,
    category: br.category,
    yield_qty: br.yield_qty,
    yield_unit: br.yield_unit,
    portions: Math.round(br.yield_qty / br.portion_size) || 1,
    prep_time_minutes: br.prep_time_minutes,
    cook_time_minutes: 0,
    shelf_life_hours: null,
    storage_temp: null,
    haccp_control: null,
    is_active: br.status === 'active',
    is_bar_recipe: true,
    recipe_code: br.recipe_code,
    bar_category: br.category,
    sub_recipe_lines: (barLines || []).filter((l: any) => l.recipe_id === br.id).map((l: any) => ({
      id: l.id,
      sub_recipe_id: br.id,
      ingredient_id: l.ingredient_id,
      quantity: l.quantity,
      unit: l.unit,
      cost_at_time_of_costing: l.cost_at_time_of_costing || 0,
      ingredients: ingMap[l.ingredient_id] || null,
    })),
  }));

  return res.json([...regularSubRecipes, ...barSubRecipesMapped]);
});

router.post('/sub-recipes', authenticate, requirePermission('fb:kitchen:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { name, description, category, yieldQty, yieldUnit, portions, prepTimeMinutes, cookTimeMinutes, shelfLifeHours, storageTemp, haccpControl, lines, isBarRecipe, recipeCode, barCategory } = req.body;

  if (isBarRecipe) {
    // Create bar sub-recipe (syrup, infusion, etc.)
    const { data: barData, error: barError } = await supabaseAdmin
      .from('bar_recipes')
      .insert({
        recipe_code: recipeCode || `SUB-${Date.now()}`,
        name,
        category: barCategory || 'syrup',
        recipe_type: 'sub_recipe',
        yield_qty: yieldQty,
        yield_unit: yieldUnit,
        portion_size: yieldQty / portions,
        portion_unit: yieldUnit,
        prep_time_minutes: prepTimeMinutes || 0,
        status: 'active',
        notes: description,
      })
      .select()
      .single();
    if (barError) return res.status(500).json({ error: barError.message });

    if (lines && lines.length > 0) {
      const { error: linesError } = await supabaseAdmin.from('bar_recipe_ingredients').insert(
        lines.map((line: any) => ({
          recipe_id: barData.id,
          ingredient_id: line.ingredientId,
          quantity: line.quantity,
          unit: line.unit,
          cost_at_time_of_costing: line.cost || 0,
        }))
      );
      if (linesError) return res.status(500).json({ error: linesError.message });
    }
    return res.json(barData);
  } else {
    // Create regular sub-recipe
    const subRecipeId = crypto.randomUUID();
    const { data: subRecipeData, error: subRecipeError } = await supabaseAdmin
      .from('sub_recipes')
      .insert({
        id: subRecipeId,
        name, description, category,
        yield_qty: yieldQty, yield_unit: yieldUnit,
        portions, prep_time_minutes: prepTimeMinutes, cook_time_minutes: cookTimeMinutes,
        shelf_life_hours: shelfLifeHours, storage_temp: storageTemp, haccp_control: haccpControl,
        is_active: true,
      })
      .select()
      .single();
    if (subRecipeError) return res.status(500).json({ error: subRecipeError.message });
    if (lines && lines.length > 0) {
      const { error: linesError } = await supabaseAdmin.from('sub_recipe_lines').insert(
        lines.map((line: any) => ({
          id: crypto.randomUUID(),
          sub_recipe_id: subRecipeId,
          ingredient_id: line.ingredientId,
          quantity: line.quantity,
          unit: line.unit,
          cost_at_time_of_costing: line.cost || 0,
        }))
      );
      if (linesError) return res.status(500).json({ error: linesError.message });
    }
    return res.json(subRecipeData);
  }
});

router.patch('/sub-recipes/:id', authenticate, requirePermission('fb:kitchen:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { name, description, category, yieldQty, yieldUnit, portions, prepTimeMinutes, cookTimeMinutes, shelfLifeHours, storageTemp, haccpControl, isActive } = req.body;
  const updateFields: Record<string, unknown> = {};
  if (name !== undefined) updateFields.name = name;
  if (description !== undefined) updateFields.description = description;
  if (category !== undefined) updateFields.category = category;
  if (yieldQty !== undefined) updateFields.yield_qty = yieldQty;
  if (yieldUnit !== undefined) updateFields.yield_unit = yieldUnit;
  if (portions !== undefined) updateFields.portions = portions;
  if (prepTimeMinutes !== undefined) updateFields.prep_time_minutes = prepTimeMinutes;
  if (cookTimeMinutes !== undefined) updateFields.cook_time_minutes = cookTimeMinutes;
  if (shelfLifeHours !== undefined) updateFields.shelf_life_hours = shelfLifeHours;
  if (storageTemp !== undefined) updateFields.storage_temp = storageTemp;
  if (haccpControl !== undefined) updateFields.haccp_control = haccpControl;
  if (isActive !== undefined) updateFields.is_active = isActive;
  const { data, error } = await supabaseAdmin.from('sub_recipes').update(updateFields).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

router.delete('/sub-recipes/:id', authenticate, requirePermission('fb:kitchen:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { error } = await supabaseAdmin.from('sub_recipes').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ success: true });
});

// =====================
// F&B Wastage API (migrated from server.ts inline handlers)
// =====================
router.get('/wastage', authenticate, async (_req, res) => {
  if (hasSupabaseAdminConfig && supabaseAdmin) {
    const { data, error } = await supabaseAdmin.from('wastage_logs')
      .select('*, ingredients(name, category, unit_of_measure)')
      .order('created_at', { ascending: false });
    if (error) return res.status(500).json({ error: error.message });
    return res.json(data);
  }
  return res.status(503).json({ error: 'Database not configured' });
});

router.post('/wastage', authenticate, requirePermission('fb:kitchen:write'), async (req, res) => {
  const { ingredientId, locationId, quantity, unit, reason, costValue, notes } = req.body;
  if (hasSupabaseAdminConfig && supabaseAdmin) {
    const { data, error } = await supabaseAdmin.from('wastage_logs')
      .insert({ ingredient_id: ingredientId, location_id: locationId, quantity, unit, reason, cost_value: costValue, notes, logged_by: req.user!.id })
      .select().single();
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ success: true, wastage: data });
  }
  return res.status(503).json({ error: 'Database not configured' });
});

router.get('/wastage/summary', authenticate, async (_req, res) => {
  if (hasSupabaseAdminConfig && supabaseAdmin) {
    const { data, error } = await supabaseAdmin.from('waste_summary').select('*');
    if (error) return res.status(500).json({ error: error.message });
    return res.json(data);
  }
  return res.status(503).json({ error: 'Database not configured' });
});

// =====================
// F&B Outlets API (migrated from server.ts inline handlers)
// =====================
router.patch('/outlets/:id', authenticate, requirePermission('fb:write'), async (req, res) => {
  if (hasSupabaseAdminConfig && supabaseAdmin) {
    const { data, error } = await supabaseAdmin.from('outlets')
      .update(req.body)
      .eq('id', req.params.id)
      .select()
      .single();
    if (error) return res.status(500).json({ error: error.message });
    return res.json(data);
  }
  return res.status(503).json({ error: 'Database not configured' });
});

router.delete('/outlets/:id', authenticate, requirePermission('fb:write'), async (req, res) => {
  if (hasSupabaseAdminConfig && supabaseAdmin) {
    const { error } = await supabaseAdmin.from('outlets')
      .delete()
      .eq('id', req.params.id);
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ success: true });
  }
  return res.status(503).json({ error: 'Database not configured' });
});

// ── Outlet Statistics (for KPI cards) ─────────────────────────────────
router.get('/outlets/statistics', authenticate, async (_req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  try {
    const { data: outlets, error } = await supabaseAdmin
      .from('outlets')
      .select('type, is_active, revenue_center_code');

    if (error) return res.status(500).json({ error: error.message });

    const totalOutlets = outlets?.length || 0;
    const activeOutlets = outlets?.filter(o => o.is_active).length || 0;
    const outletTypes = new Set(outlets?.map(o => o.type)).size;
    const configuredOutlets = outlets?.filter(o => o.revenue_center_code && o.revenue_center_code.length > 0).length || 0;

    return res.json({
      totalOutlets,
      activeOutlets,
      outletTypes,
      configuredOutlets
    });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to calculate statistics' });
  }
});

// ── Kitchen Management ───────────────────────────────────────────────
router.get('/kitchen/stations', authenticate, async (_req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  try {
    const { data, error } = await supabaseAdmin
      .from('kitchen_stations')
      .select('*')
      .order('station_name');

    if (error) return res.status(500).json({ error: error.message });
    return res.json(data || []);
  } catch (error) {
    return res.status(500).json({ error: 'Failed to fetch kitchen stations' });
  }
});

router.post('/kitchen/stations', authenticate, requirePermission('fb:kitchen:create'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  try {
    const { data, error } = await supabaseAdmin
      .from('kitchen_stations')
      .insert(req.body)
      .select()
      .single();

    if (error) return res.status(500).json({ error: error.message });
    return res.status(201).json(data);
  } catch (error) {
    return res.status(500).json({ error: 'Failed to create kitchen station' });
  }
});

router.patch('/kitchen/stations/:id', authenticate, requirePermission('fb:kitchen:update'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  try {
    const { data, error } = await supabaseAdmin
      .from('kitchen_stations')
      .update(req.body)
      .eq('id', req.params.id)
      .select()
      .single();

    if (error) return res.status(500).json({ error: error.message });
    return res.json(data);
  } catch (error) {
    return res.status(500).json({ error: 'Failed to update kitchen station' });
  }
});

router.delete('/kitchen/stations/:id', authenticate, requirePermission('fb:kitchen:delete'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  try {
    const { error } = await supabaseAdmin
      .from('kitchen_stations')
      .delete()
      .eq('id', req.params.id);

    if (error) return res.status(500).json({ error: error.message });
    return res.status(204).send();
  } catch (error) {
    return res.status(500).json({ error: 'Failed to delete kitchen station' });
  }
});

router.get('/kitchen/statistics', authenticate, async (_req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  try {
    // Get all stations
    const { data: stations, error: stationsError } = await supabaseAdmin
      .from('kitchen_stations')
      .select('id, is_active, kds_instance_id');

    if (stationsError) return res.status(500).json({ error: stationsError.message });

    // Get all assigned equipment
    const { data: equipment, error: equipmentError } = await supabaseAdmin
      .from('kitchen_station_inventory')
      .select('id, status');

    if (equipmentError) return res.status(500).json({ error: equipmentError.message });

    const totalStations = stations?.length || 0;
    const activeStations = stations?.filter(s => s.is_active).length || 0;
    const totalEquipment = equipment?.length || 0;
    const availableEquipment = equipment?.filter(e => e.status === 'Available').length || 0;
    const stationsWithKDS = stations?.filter(s => s.kds_instance_id).length || 0;

    return res.json({
      totalStations,
      activeStations,
      totalEquipment,
      availableEquipment,
      stationsWithKDS
    });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to calculate kitchen statistics' });
  }
});

router.get('/kitchen/stations/:id/equipment', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  try {
    const { data, error } = await supabaseAdmin
      .from('kitchen_station_inventory')
      .select('*, inventory_items(name, description, unit_of_measure, item_code)')
      .eq('station_id', req.params.id)
      .order('created_at', { ascending: false });

    if (error) return res.status(500).json({ error: error.message });
    return res.json(data || []);
  } catch (error) {
    return res.status(500).json({ error: 'Failed to fetch station equipment' });
  }
});

router.get('/kitchen/inventory-items', authenticate, async (_req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  try {
    // Fetch equipment-category unified inventory items
    const { data, error } = await supabaseAdmin
      .from('uinv_items')
      .select('*')
      .eq('category', 'Engineering')
      .eq('is_active', true)
      .order('item_name');

    if (error) return res.status(500).json({ error: error.message });
    // Map to legacy response shape for frontend compatibility
    return res.json((data || []).map((i: any) => ({
      id: i.id,
      name: i.item_name,
      item_name: i.item_name,
      unit_of_measure: i.unit_of_measure,
      unit_cost: i.last_cost || 0,
      is_active: i.is_active,
      category: i.subcategory || 'Equipment',
      property_id: i.property_id,
    })));
  } catch (error) {
    return res.status(500).json({ error: 'Failed to fetch kitchen inventory items' });
  }
});

router.post('/kitchen/stations/:id/equipment', authenticate, requirePermission('fb:kitchen:update'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  try {
    const { inventory_item_id, assigned_quantity, status, notes } = req.body;

    const { data, error } = await supabaseAdmin
      .from('kitchen_station_inventory')
      .insert({
        station_id: req.params.id,
        inventory_item_id,
        assigned_quantity: assigned_quantity || 1,
        status: status || 'Available',
        notes
      })
      .select()
      .single();

    if (error) return res.status(500).json({ error: error.message });
    return res.status(201).json(data);
  } catch (error) {
    return res.status(500).json({ error: 'Failed to assign equipment to station' });
  }
});

// =====================
// F&B Banquet Events API — DUPLICATE REMOVED
// Event CRUD is owned by /api/banquet-events (banquetEvents.routes.ts).
// The GET /banquet-events handler earlier in this file reads from the
// canonical event_bookings table. These duplicate writers were removed
// because banquet_events is now a read-only compatibility view (migration 444)
// and writing through it would error.
// =====================

// =====================
// F&B Pricing & Packages API
// =====================

// ── Price Lists ───────────────────────────────────────────────────────
router.get('/price-lists', authenticate, async (_req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { data: lists, error: lErr } = await supabaseAdmin.from('fb_price_lists').select('*').order('created_at', { ascending: false });
  if (lErr) return res.status(500).json({ error: lErr.message });
  const { data: items, error: iErr } = await supabaseAdmin.from('fb_price_list_items').select('*');
  if (iErr) return res.status(500).json({ error: iErr.message });
  const result = (lists || []).map((pl: any) => ({
    ...pl,
    item_count: (items || []).filter((i: any) => i.price_list_id === pl.id).length,
    price_list_items: (items || []).filter((i: any) => i.price_list_id === pl.id),
  }));
  return res.json(result);
});

router.post('/price-lists', authenticate, requirePermission('fb:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { name, outletId, outletName, currency, effectiveFrom, effectiveTo, status, description, items } = req.body;
  const id = crypto.randomUUID();
  const { data, error } = await supabaseAdmin.from('fb_price_lists').insert({
    id, name, outlet_id: outletId || null, outlet_name: outletName || null,
    currency: currency || 'USD', effective_from: effectiveFrom,
    effective_to: effectiveTo || null, status: status || 'Draft', description: description || null,
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  if (items && items.length > 0) {
    const { error: ie } = await supabaseAdmin.from('fb_price_list_items').insert(
      items.map((it: any) => ({
        id: crypto.randomUUID(), price_list_id: id,
        menu_item_id: it.menuItemId || null, menu_item_name: it.menuItemName || null,
        price: it.price || 0,
      }))
    );
    if (ie) return res.status(500).json({ error: ie.message });
  }
  return res.json(data);
});

router.patch('/price-lists/:id', authenticate, requirePermission('fb:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { name, outletId, outletName, currency, effectiveFrom, effectiveTo, status, description, items } = req.body;
  const updateFields: Record<string, unknown> = {};
  if (name !== undefined) updateFields.name = name;
  if (outletId !== undefined) updateFields.outlet_id = outletId || null;
  if (outletName !== undefined) updateFields.outlet_name = outletName || null;
  if (currency !== undefined) updateFields.currency = currency;
  if (effectiveFrom !== undefined) updateFields.effective_from = effectiveFrom;
  if (effectiveTo !== undefined) updateFields.effective_to = effectiveTo || null;
  if (status !== undefined) updateFields.status = status;
  if (description !== undefined) updateFields.description = description;
  const { data, error } = await supabaseAdmin.from('fb_price_lists').update(updateFields).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  if (items !== undefined) {
    await supabaseAdmin.from('fb_price_list_items').delete().eq('price_list_id', req.params.id);
    if (items.length > 0) {
      const { error: ie } = await supabaseAdmin.from('fb_price_list_items').insert(
        items.map((it: any) => ({
          id: crypto.randomUUID(), price_list_id: req.params.id,
          menu_item_id: it.menuItemId || null, menu_item_name: it.menuItemName || null,
          price: it.price || 0,
        }))
      );
      if (ie) return res.status(500).json({ error: ie.message });
    }
  }
  return res.json(data);
});

router.delete('/price-lists/:id', authenticate, requirePermission('fb:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { error } = await supabaseAdmin.from('fb_price_lists').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ success: true });
});

// ── Meal Plans ────────────────────────────────────────────────────────
router.get('/meal-plans', authenticate, async (_req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { data: plans, error: pErr } = await supabaseAdmin.from('fb_meal_plans').select('*').order('created_at', { ascending: false });
  if (pErr) return res.status(500).json({ error: pErr.message });
  const { data: items, error: iErr } = await supabaseAdmin.from('fb_meal_plan_menu_items').select('*').order('sort_order');
  if (iErr) return res.status(500).json({ error: iErr.message });
  const result = (plans || []).map((mp: any) => ({
    ...mp,
    menu_items: (items || []).filter((i: any) => i.meal_plan_id === mp.id),
  }));
  return res.json(result);
});

router.post('/meal-plans', authenticate, requirePermission('fb:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { name, type, adultPrice, childPrice, includes, status, description, menuItems } = req.body;
  const id = crypto.randomUUID();
  const { data, error } = await supabaseAdmin.from('fb_meal_plans').insert({
    id, name, type, adult_price: adultPrice, child_price: childPrice,
    includes: includes || [], status: status || 'Active', description: description || null,
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  if (menuItems && menuItems.length > 0) {
    const { error: ie } = await supabaseAdmin.from('fb_meal_plan_menu_items').insert(
      menuItems.map((mi: any, idx: number) => ({
        id: crypto.randomUUID(), meal_plan_id: id,
        menu_item_id: mi.menuItemId || null, menu_item_name: mi.menuItemName || '',
        meal_period: mi.mealPeriod || 'breakfast', sort_order: mi.sortOrder ?? idx,
      }))
    );
    if (ie) return res.status(500).json({ error: ie.message });
  }
  return res.json(data);
});

router.patch('/meal-plans/:id', authenticate, requirePermission('fb:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { name, type, adultPrice, childPrice, includes, status, description, menuItems } = req.body;
  const updateFields: Record<string, unknown> = {};
  if (name !== undefined) updateFields.name = name;
  if (type !== undefined) updateFields.type = type;
  if (adultPrice !== undefined) updateFields.adult_price = adultPrice;
  if (childPrice !== undefined) updateFields.child_price = childPrice;
  if (includes !== undefined) updateFields.includes = includes;
  if (status !== undefined) updateFields.status = status;
  if (description !== undefined) updateFields.description = description;
  const { data, error } = await supabaseAdmin.from('fb_meal_plans').update(updateFields).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  if (menuItems !== undefined) {
    await supabaseAdmin.from('fb_meal_plan_menu_items').delete().eq('meal_plan_id', req.params.id);
    if (menuItems.length > 0) {
      const { error: ie } = await supabaseAdmin.from('fb_meal_plan_menu_items').insert(
        menuItems.map((mi: any, idx: number) => ({
          id: crypto.randomUUID(), meal_plan_id: req.params.id,
          menu_item_id: mi.menuItemId || null, menu_item_name: mi.menuItemName || '',
          meal_period: mi.mealPeriod || 'breakfast', sort_order: mi.sortOrder ?? idx,
        }))
      );
      if (ie) return res.status(500).json({ error: ie.message });
    }
  }
  return res.json(data);
});

router.delete('/meal-plans/:id', authenticate, requirePermission('fb:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { error } = await supabaseAdmin.from('fb_meal_plans').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ success: true });
});

// ── Meal Plan Cost Analysis ───────────────────────────────────────────
router.get('/meal-plans/cost-analysis', authenticate, async (_req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { data: plans, error: pErr } = await supabaseAdmin.from('fb_meal_plans').select('*').order('name');
  if (pErr) return res.status(500).json({ error: pErr.message });
  const { data: planItems, error: piErr } = await supabaseAdmin.from('fb_meal_plan_menu_items').select('*').order('sort_order');
  if (piErr) return res.status(500).json({ error: piErr.message });
  const { data: recipes, error: rErr } = await supabaseAdmin.from('recipes').select('id, menu_item_id, yield, portions');
  if (rErr) return res.status(500).json({ error: rErr.message });
  const { data: recipeLines, error: rlErr } = await supabaseAdmin.from('recipe_lines').select('recipe_id, ingredient_id, quantity');
  if (rlErr) return res.status(500).json({ error: rlErr.message });
  const { data: ingredients, error: iErr } = await supabaseAdmin.from('ingredients').select('id, current_cost');
  if (iErr) return res.status(500).json({ error: iErr.message });
  const { data: menuItems, error: miErr } = await supabaseAdmin.from('menu_items').select('id, name, selling_price');
  if (miErr) return res.status(500).json({ error: miErr.message });

  const ingredientCostMap = new Map((ingredients || []).map((i: any) => [i.id, Number(i.current_cost) || 0]));
  const recipeByMenuItem = new Map((recipes || []).map((r: any) => [r.menu_item_id, r]));
  const linesByRecipe = new Map<string, any[]>();
  (recipeLines || []).forEach((rl: any) => {
    const arr = linesByRecipe.get(rl.recipe_id) || [];
    arr.push(rl);
    linesByRecipe.set(rl.recipe_id, arr);
  });
  const menuItemMap = new Map((menuItems || []).map((m: any) => [m.id, m]));

  const computePlateCost = (menuItemId: string | null): { plateCost: number; hasRecipe: boolean } => {
    if (!menuItemId) return { plateCost: 0, hasRecipe: false };
    const recipe = recipeByMenuItem.get(menuItemId);
    if (!recipe) return { plateCost: 0, hasRecipe: false };
    const lines = linesByRecipe.get(recipe.id) || [];
    const totalIngredientCost = lines.reduce((sum, l) => sum + (Number(l.quantity) || 0) * (ingredientCostMap.get(l.ingredient_id) || 0), 0);
    const yieldPct = Number(recipe.yield) || 1;
    const portions = Number(recipe.portions) || 1;
    return { plateCost: totalIngredientCost / yieldPct / portions, hasRecipe: true };
  };

  const result = (plans || []).map((mp: any) => {
    const items = (planItems || []).filter((pi: any) => pi.meal_plan_id === mp.id);
    const itemBreakdown = items.map((pi: any) => {
      const mi = menuItemMap.get(pi.menu_item_id);
      const { plateCost, hasRecipe } = computePlateCost(pi.menu_item_id);
      return {
        menu_item_id: pi.menu_item_id,
        menu_item_name: pi.menu_item_name,
        meal_period: pi.meal_period,
        plate_cost: plateCost,
        selling_price: mi ? Number(mi.selling_price) || 0 : 0,
        has_recipe: hasRecipe,
      };
    });
    const totalCost = itemBreakdown.reduce((s, i) => s + i.plate_cost, 0);
    const adultPrice = Number(mp.adult_price) || 0;
    const childPrice = Number(mp.child_price) || 0;
    return {
      id: mp.id,
      name: mp.name,
      type: mp.type,
      status: mp.status,
      adult_price: adultPrice,
      child_price: childPrice,
      menu_item_count: items.length,
      total_cost: totalCost,
      adult_margin: adultPrice - totalCost,
      adult_margin_pct: adultPrice > 0 ? ((adultPrice - totalCost) / adultPrice) * 100 : 0,
      child_margin: childPrice - totalCost,
      child_margin_pct: childPrice > 0 ? ((childPrice - totalCost) / childPrice) * 100 : 0,
      items: itemBreakdown,
    };
  });
  return res.json(result);
});

// ── F&B Packages ──────────────────────────────────────────────────────
router.get('/packages', authenticate, async (_req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { data: pkgs, error: pErr } = await supabaseAdmin.from('fb_packages').select('*').order('created_at', { ascending: false });
  if (pErr) return res.status(500).json({ error: pErr.message });
  const { data: comps, error: cErr } = await supabaseAdmin.from('fb_package_components').select('*').order('sort_order');
  if (cErr) return res.status(500).json({ error: cErr.message });
  const { data: outlets, error: oErr } = await supabaseAdmin.from('fb_package_outlets').select('*');
  if (oErr) return res.status(500).json({ error: oErr.message });
  const { data: pkgItems, error: piErr } = await supabaseAdmin.from('fb_package_menu_items').select('*').order('sort_order');
  if (piErr) return res.status(500).json({ error: piErr.message });
  const result = (pkgs || []).map((p: any) => ({
    ...p,
    components: (comps || []).filter((c: any) => c.package_id === p.id),
    outlets: (outlets || []).filter((o: any) => o.package_id === p.id),
    menu_items: (pkgItems || []).filter((i: any) => i.package_id === p.id),
  }));
  return res.json(result);
});

router.post('/packages', authenticate, requirePermission('fb:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { name, description, packageType, pricePerPerson, minCovers, status, components, outlets, menuItems } = req.body;
  const id = crypto.randomUUID();
  const { data, error } = await supabaseAdmin.from('fb_packages').insert({
    id, name, description: description || null, package_type: packageType || 'custom',
    price_per_person: pricePerPerson, min_covers: minCovers || 1, status: status || 'Active',
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  if (components && components.length > 0) {
    const { error: ce } = await supabaseAdmin.from('fb_package_components').insert(
      components.map((c: any, idx: number) => ({
        id: crypto.randomUUID(), package_id: id, component_name: c.componentName || c.name,
        component_type: c.componentType || 'meal', sort_order: c.sortOrder || idx,
      }))
    );
    if (ce) return res.status(500).json({ error: ce.message });
  }
  if (outlets && outlets.length > 0) {
    const { error: oe } = await supabaseAdmin.from('fb_package_outlets').insert(
      outlets.map((o: any) => ({
        id: crypto.randomUUID(), package_id: id, outlet_id: o.outletId || null, outlet_name: o.outletName || null,
      }))
    );
    if (oe) return res.status(500).json({ error: oe.message });
  }
  if (menuItems && menuItems.length > 0) {
    const { error: mie } = await supabaseAdmin.from('fb_package_menu_items').insert(
      menuItems.map((mi: any, idx: number) => ({
        id: crypto.randomUUID(), package_id: id,
        menu_item_id: mi.menuItemId || null, menu_item_name: mi.menuItemName || '',
        component_type: mi.componentType || 'meal', sort_order: mi.sortOrder ?? idx,
      }))
    );
    if (mie) return res.status(500).json({ error: mie.message });
  }
  return res.json(data);
});

router.patch('/packages/:id', authenticate, requirePermission('fb:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { name, description, packageType, pricePerPerson, minCovers, status, components, outlets, menuItems } = req.body;
  const updateFields: Record<string, unknown> = {};
  if (name !== undefined) updateFields.name = name;
  if (description !== undefined) updateFields.description = description;
  if (packageType !== undefined) updateFields.package_type = packageType;
  if (pricePerPerson !== undefined) updateFields.price_per_person = pricePerPerson;
  if (minCovers !== undefined) updateFields.min_covers = minCovers;
  if (status !== undefined) updateFields.status = status;
  const { data, error } = await supabaseAdmin.from('fb_packages').update(updateFields).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  if (components !== undefined) {
    await supabaseAdmin.from('fb_package_components').delete().eq('package_id', req.params.id);
    if (components.length > 0) {
      const { error: ce } = await supabaseAdmin.from('fb_package_components').insert(
        components.map((c: any, idx: number) => ({
          id: crypto.randomUUID(), package_id: req.params.id, component_name: c.componentName || c.name,
          component_type: c.componentType || 'meal', sort_order: c.sortOrder || idx,
        }))
      );
      if (ce) return res.status(500).json({ error: ce.message });
    }
  }
  if (outlets !== undefined) {
    await supabaseAdmin.from('fb_package_outlets').delete().eq('package_id', req.params.id);
    if (outlets.length > 0) {
      const { error: oe } = await supabaseAdmin.from('fb_package_outlets').insert(
        outlets.map((o: any) => ({
          id: crypto.randomUUID(), package_id: req.params.id, outlet_id: o.outletId || null, outlet_name: o.outletName || null,
        }))
      );
      if (oe) return res.status(500).json({ error: oe.message });
    }
  }
  if (menuItems !== undefined) {
    await supabaseAdmin.from('fb_package_menu_items').delete().eq('package_id', req.params.id);
    if (menuItems.length > 0) {
      const { error: mie } = await supabaseAdmin.from('fb_package_menu_items').insert(
        menuItems.map((mi: any, idx: number) => ({
          id: crypto.randomUUID(), package_id: req.params.id,
          menu_item_id: mi.menuItemId || null, menu_item_name: mi.menuItemName || '',
          component_type: mi.componentType || 'meal', sort_order: mi.sortOrder ?? idx,
        }))
      );
      if (mie) return res.status(500).json({ error: mie.message });
    }
  }
  return res.json(data);
});

router.delete('/packages/:id', authenticate, requirePermission('fb:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { error } = await supabaseAdmin.from('fb_packages').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ success: true });
});

// ── Package Cost Analysis ─────────────────────────────────────────────
router.get('/packages/cost-analysis', authenticate, async (_req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { data: pkgs, error: pErr } = await supabaseAdmin.from('fb_packages').select('*').order('name');
  if (pErr) return res.status(500).json({ error: pErr.message });
  const { data: pkgItems, error: piErr } = await supabaseAdmin.from('fb_package_menu_items').select('*').order('sort_order');
  if (piErr) return res.status(500).json({ error: piErr.message });
  const { data: recipes, error: rErr } = await supabaseAdmin.from('recipes').select('id, menu_item_id, yield, portions');
  if (rErr) return res.status(500).json({ error: rErr.message });
  const { data: recipeLines, error: rlErr } = await supabaseAdmin.from('recipe_lines').select('recipe_id, ingredient_id, quantity');
  if (rlErr) return res.status(500).json({ error: rlErr.message });
  const { data: ingredients, error: iErr } = await supabaseAdmin.from('ingredients').select('id, current_cost');
  if (iErr) return res.status(500).json({ error: iErr.message });
  const { data: menuItems, error: miErr } = await supabaseAdmin.from('menu_items').select('id, name, selling_price');
  if (miErr) return res.status(500).json({ error: miErr.message });

  const ingredientCostMap = new Map((ingredients || []).map((i: any) => [i.id, Number(i.current_cost) || 0]));
  const recipeByMenuItem = new Map((recipes || []).map((r: any) => [r.menu_item_id, r]));
  const linesByRecipe = new Map<string, any[]>();
  (recipeLines || []).forEach((rl: any) => {
    const arr = linesByRecipe.get(rl.recipe_id) || [];
    arr.push(rl);
    linesByRecipe.set(rl.recipe_id, arr);
  });
  const menuItemMap = new Map((menuItems || []).map((m: any) => [m.id, m]));

  const computePlateCost = (menuItemId: string | null): { plateCost: number; hasRecipe: boolean } => {
    if (!menuItemId) return { plateCost: 0, hasRecipe: false };
    const recipe = recipeByMenuItem.get(menuItemId);
    if (!recipe) return { plateCost: 0, hasRecipe: false };
    const lines = linesByRecipe.get(recipe.id) || [];
    const totalIngredientCost = lines.reduce((sum, l) => sum + (Number(l.quantity) || 0) * (ingredientCostMap.get(l.ingredient_id) || 0), 0);
    const yieldPct = Number(recipe.yield) || 1;
    const portions = Number(recipe.portions) || 1;
    return { plateCost: totalIngredientCost / yieldPct / portions, hasRecipe: true };
  };

  const result = (pkgs || []).map((p: any) => {
    const items = (pkgItems || []).filter((pi: any) => pi.package_id === p.id);
    const itemBreakdown = items.map((pi: any) => {
      const mi = menuItemMap.get(pi.menu_item_id);
      const { plateCost, hasRecipe } = computePlateCost(pi.menu_item_id);
      return {
        menu_item_id: pi.menu_item_id,
        menu_item_name: pi.menu_item_name,
        component_type: pi.component_type,
        plate_cost: plateCost,
        selling_price: mi ? Number(mi.selling_price) || 0 : 0,
        has_recipe: hasRecipe,
      };
    });
    const totalCost = itemBreakdown.reduce((s, i) => s + i.plate_cost, 0);
    const pricePerPerson = Number(p.price_per_person) || 0;
    return {
      id: p.id,
      name: p.name,
      package_type: p.package_type,
      status: p.status,
      price_per_person: pricePerPerson,
      min_covers: p.min_covers,
      menu_item_count: items.length,
      total_cost: totalCost,
      margin: pricePerPerson - totalCost,
      margin_pct: pricePerPerson > 0 ? ((pricePerPerson - totalCost) / pricePerPerson) * 100 : 0,
      items: itemBreakdown,
    };
  });
  return res.json(result);
});

// ── Promotions ────────────────────────────────────────────────────────
router.get('/promotions', authenticate, async (_req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { data, error } = await supabaseAdmin.from('fb_promotions').select('*').order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

router.post('/promotions', authenticate, requirePermission('fb:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { name, type, discountDescription, discountValue, discountType, schedule, startDate, endDate, channels, status } = req.body;
  const id = crypto.randomUUID();
  const { data, error } = await supabaseAdmin.from('fb_promotions').insert({
    id, name, type, discount_description: discountDescription,
    discount_value: discountValue || null, discount_type: discountType || null,
    schedule: schedule || null, start_date: startDate || null, end_date: endDate || null,
    channels: channels || [], status: status || 'Active',
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

router.patch('/promotions/:id', authenticate, requirePermission('fb:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { name, type, discountDescription, discountValue, discountType, schedule, startDate, endDate, channels, status } = req.body;
  const updateFields: Record<string, unknown> = {};
  if (name !== undefined) updateFields.name = name;
  if (type !== undefined) updateFields.type = type;
  if (discountDescription !== undefined) updateFields.discount_description = discountDescription;
  if (discountValue !== undefined) updateFields.discount_value = discountValue;
  if (discountType !== undefined) updateFields.discount_type = discountType;
  if (schedule !== undefined) updateFields.schedule = schedule;
  if (startDate !== undefined) updateFields.start_date = startDate;
  if (endDate !== undefined) updateFields.end_date = endDate;
  if (channels !== undefined) updateFields.channels = channels;
  if (status !== undefined) updateFields.status = status;
  const { data, error } = await supabaseAdmin.from('fb_promotions').update(updateFields).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

router.delete('/promotions/:id', authenticate, requirePermission('fb:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { error } = await supabaseAdmin.from('fb_promotions').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ success: true });
});

// ── Special Offers ────────────────────────────────────────────────────
router.get('/special-offers', authenticate, async (_req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { data: offers, error: oErr } = await supabaseAdmin.from('fb_special_offers').select('*').order('created_at', { ascending: false });
  if (oErr) return res.status(500).json({ error: oErr.message });
  const { data: items, error: iErr } = await supabaseAdmin.from('fb_special_offer_menu_items').select('*').order('sort_order');
  if (iErr) return res.status(500).json({ error: iErr.message });
  const result = (offers || []).map((o: any) => ({
    ...o,
    menu_items: (items || []).filter((i: any) => i.special_offer_id === o.id),
  }));
  return res.json(result);
});

router.post('/special-offers', authenticate, requirePermission('fb:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { name, description, outletId, outletName, validUntil, status, price, menuItems } = req.body;
  const id = crypto.randomUUID();
  const { data, error } = await supabaseAdmin.from('fb_special_offers').insert({
    id, name, description: description || null, outlet_id: outletId || null,
    outlet_name: outletName || null, valid_until: validUntil, status: status || 'Active',
    price: price || 0,
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  if (menuItems && menuItems.length > 0) {
    const { error: ie } = await supabaseAdmin.from('fb_special_offer_menu_items').insert(
      menuItems.map((mi: any, idx: number) => ({
        id: crypto.randomUUID(), special_offer_id: id,
        menu_item_id: mi.menuItemId || null, menu_item_name: mi.menuItemName || '',
        course_type: mi.courseType || 'main', sort_order: mi.sortOrder ?? idx,
      }))
    );
    if (ie) return res.status(500).json({ error: ie.message });
  }
  return res.json(data);
});

router.patch('/special-offers/:id', authenticate, requirePermission('fb:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { name, description, outletId, outletName, validUntil, status, price, menuItems } = req.body;
  const updateFields: Record<string, unknown> = {};
  if (name !== undefined) updateFields.name = name;
  if (description !== undefined) updateFields.description = description;
  if (outletId !== undefined) updateFields.outlet_id = outletId || null;
  if (outletName !== undefined) updateFields.outlet_name = outletName || null;
  if (validUntil !== undefined) updateFields.valid_until = validUntil;
  if (status !== undefined) updateFields.status = status;
  if (price !== undefined) updateFields.price = price;
  const { data, error } = await supabaseAdmin.from('fb_special_offers').update(updateFields).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  if (menuItems !== undefined) {
    await supabaseAdmin.from('fb_special_offer_menu_items').delete().eq('special_offer_id', req.params.id);
    if (menuItems.length > 0) {
      const { error: ie } = await supabaseAdmin.from('fb_special_offer_menu_items').insert(
        menuItems.map((mi: any, idx: number) => ({
          id: crypto.randomUUID(), special_offer_id: req.params.id,
          menu_item_id: mi.menuItemId || null, menu_item_name: mi.menuItemName || '',
          course_type: mi.courseType || 'main', sort_order: mi.sortOrder ?? idx,
        }))
      );
      if (ie) return res.status(500).json({ error: ie.message });
    }
  }
  return res.json(data);
});

router.delete('/special-offers/:id', authenticate, requirePermission('fb:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { error } = await supabaseAdmin.from('fb_special_offers').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ success: true });
});

// ── Special Offer Cost Analysis ───────────────────────────────────────
router.get('/special-offers/cost-analysis', authenticate, async (_req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { data: offers, error: oErr } = await supabaseAdmin.from('fb_special_offers').select('*').order('name');
  if (oErr) return res.status(500).json({ error: oErr.message });
  const { data: offerItems, error: oiErr } = await supabaseAdmin.from('fb_special_offer_menu_items').select('*').order('sort_order');
  if (oiErr) return res.status(500).json({ error: oiErr.message });
  const { data: recipes, error: rErr } = await supabaseAdmin.from('recipes').select('id, menu_item_id, yield, portions');
  if (rErr) return res.status(500).json({ error: rErr.message });
  const { data: recipeLines, error: rlErr } = await supabaseAdmin.from('recipe_lines').select('recipe_id, ingredient_id, quantity');
  if (rlErr) return res.status(500).json({ error: rlErr.message });
  const { data: ingredients, error: iErr } = await supabaseAdmin.from('ingredients').select('id, current_cost');
  if (iErr) return res.status(500).json({ error: iErr.message });
  const { data: menuItems, error: miErr } = await supabaseAdmin.from('menu_items').select('id, name, selling_price');
  if (miErr) return res.status(500).json({ error: miErr.message });

  const ingredientCostMap = new Map((ingredients || []).map((i: any) => [i.id, Number(i.current_cost) || 0]));
  const recipeByMenuItem = new Map((recipes || []).map((r: any) => [r.menu_item_id, r]));
  const linesByRecipe = new Map<string, any[]>();
  (recipeLines || []).forEach((rl: any) => {
    const arr = linesByRecipe.get(rl.recipe_id) || [];
    arr.push(rl);
    linesByRecipe.set(rl.recipe_id, arr);
  });
  const menuItemMap = new Map((menuItems || []).map((m: any) => [m.id, m]));

  const computePlateCost = (menuItemId: string | null): { plateCost: number; hasRecipe: boolean } => {
    if (!menuItemId) return { plateCost: 0, hasRecipe: false };
    const recipe = recipeByMenuItem.get(menuItemId);
    if (!recipe) return { plateCost: 0, hasRecipe: false };
    const lines = linesByRecipe.get(recipe.id) || [];
    const totalIngredientCost = lines.reduce((sum, l) => sum + (Number(l.quantity) || 0) * (ingredientCostMap.get(l.ingredient_id) || 0), 0);
    const yieldPct = Number(recipe.yield) || 1;
    const portions = Number(recipe.portions) || 1;
    return { plateCost: totalIngredientCost / yieldPct / portions, hasRecipe: true };
  };

  const result = (offers || []).map((o: any) => {
    const items = (offerItems || []).filter((oi: any) => oi.special_offer_id === o.id);
    const itemBreakdown = items.map((oi: any) => {
      const mi = menuItemMap.get(oi.menu_item_id);
      const { plateCost, hasRecipe } = computePlateCost(oi.menu_item_id);
      return {
        menu_item_id: oi.menu_item_id,
        menu_item_name: oi.menu_item_name,
        course_type: oi.course_type,
        plate_cost: plateCost,
        selling_price: mi ? Number(mi.selling_price) || 0 : 0,
        has_recipe: hasRecipe,
      };
    });
    const totalCost = itemBreakdown.reduce((s, i) => s + i.plate_cost, 0);
    const price = Number(o.price) || 0;
    return {
      id: o.id,
      name: o.name,
      outlet_name: o.outlet_name,
      valid_until: o.valid_until,
      status: o.status,
      price,
      menu_item_count: items.length,
      total_cost: totalCost,
      margin: price - totalCost,
      margin_pct: price > 0 ? ((price - totalCost) / price) * 100 : 0,
      items: itemBreakdown,
    };
  });
  return res.json(result);
});

// =====================
// F&B Service Operations API
// =====================

// ── Service Standards ───────────────────────────────────────────────
router.get('/service-standards', authenticate, async (_req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { data, error } = await supabaseAdmin.from('fb_service_standards').select('*').order('measured_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

router.post('/service-standards', authenticate, requirePermission('fb:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { name, targetValue, actualValue, unit, status, outletId, measuredAt } = req.body;
  const id = crypto.randomUUID();
  const { data, error } = await supabaseAdmin.from('fb_service_standards').insert({
    id, name, target_value: targetValue, actual_value: actualValue, unit: unit || 'min',
    status: status || 'Meeting', outlet_id: outletId || null, measured_at: measuredAt || new Date().toISOString().split('T')[0],
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

router.patch('/service-standards/:id', authenticate, requirePermission('fb:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { name, targetValue, actualValue, unit, status, outletId, measuredAt } = req.body;
  const updateFields: Record<string, unknown> = {};
  if (name !== undefined) updateFields.name = name;
  if (targetValue !== undefined) updateFields.target_value = targetValue;
  if (actualValue !== undefined) updateFields.actual_value = actualValue;
  if (unit !== undefined) updateFields.unit = unit;
  if (status !== undefined) updateFields.status = status;
  if (outletId !== undefined) updateFields.outlet_id = outletId || null;
  if (measuredAt !== undefined) updateFields.measured_at = measuredAt;
  const { data, error } = await supabaseAdmin.from('fb_service_standards').update(updateFields).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

router.delete('/service-standards/:id', authenticate, requirePermission('fb:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { error } = await supabaseAdmin.from('fb_service_standards').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ success: true });
});

// ── F&B Guest Requests ───────────────────────────────────────────────
router.get('/guest-requests', authenticate, async (_req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { data, error } = await supabaseAdmin.from('fb_guest_requests').select('*').order('logged_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

router.post('/guest-requests', authenticate, requirePermission('fb:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { guestName, roomNumber, outletId, outletName, request, priority, status, notes } = req.body;
  const id = crypto.randomUUID();
  const { data, error } = await supabaseAdmin.from('fb_guest_requests').insert({
    id, guest_name: guestName || null, room_number: roomNumber || null,
    outlet_id: outletId || null, outlet_name: outletName || null,
    request, priority: priority || 'Medium', status: status || 'Open', notes: notes || null,
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

router.patch('/guest-requests/:id', authenticate, requirePermission('fb:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { guestName, roomNumber, outletId, outletName, request, priority, status, notes, resolvedAt } = req.body;
  const updateFields: Record<string, unknown> = {};
  if (guestName !== undefined) updateFields.guest_name = guestName;
  if (roomNumber !== undefined) updateFields.room_number = roomNumber;
  if (outletId !== undefined) updateFields.outlet_id = outletId || null;
  if (outletName !== undefined) updateFields.outlet_name = outletName || null;
  if (request !== undefined) updateFields.request = request;
  if (priority !== undefined) updateFields.priority = priority;
  if (status !== undefined) {
    updateFields.status = status;
    if (status === 'Resolved') updateFields.resolved_at = new Date().toISOString();
  }
  if (notes !== undefined) updateFields.notes = notes;
  if (resolvedAt !== undefined) updateFields.resolved_at = resolvedAt;
  const { data, error } = await supabaseAdmin.from('fb_guest_requests').update(updateFields).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

router.delete('/guest-requests/:id', authenticate, requirePermission('fb:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { error } = await supabaseAdmin.from('fb_guest_requests').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ success: true });
});

// ── Production Coordination ─────────────────────────────────────────────
// KDS Stations
router.get('/kds-stations', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { outletId, status } = req.query as Record<string, string>;
  let q = supabaseAdmin.from('fb_kds_stations').select('*').order('name');
  if (outletId) q = q.eq('outlet_id', outletId);
  if (status) q = q.eq('status', status);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });

  // Fetch outlets for name enrichment
  const { data: outlets } = await supabaseAdmin.from('outlets').select('id, name');
  const outletMap = new Map(outlets?.map(o => [o.id, o.name]) || []);

  const enrichedData = (data || []).map(station => ({
    ...station,
    outlet_name: outletMap.get(station.outlet_id) || station.outlet_id,
  }));

  return res.json(enrichedData);
});

router.post('/kds-stations', authenticate, requirePermission('fb:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { data, error } = await supabaseAdmin.from('fb_kds_stations').insert(req.body).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.status(201).json(data);
});

router.put('/kds-stations/:id', authenticate, requirePermission('fb:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { data, error } = await supabaseAdmin.from('fb_kds_stations').update(req.body).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

router.delete('/kds-stations/:id', authenticate, requirePermission('fb:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { error } = await supabaseAdmin.from('fb_kds_stations').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ success: true });
});

// KDS Tickets
router.get('/kds-tickets', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { outletId, stationId, status } = req.query as Record<string, string>;
  let q = supabaseAdmin.from('fb_kds_tickets').select('*').order('created_at', { ascending: false });
  if (outletId) q = q.eq('outlet_id', outletId);
  if (stationId) q = q.eq('station_id', stationId);
  if (status) q = q.eq('status', status);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });

  // Fetch outlets for name enrichment
  const { data: outlets } = await supabaseAdmin.from('outlets').select('id, name');
  const outletMap = new Map(outlets?.map(o => [o.id, o.name]) || []);

  const enrichedData = (data || []).map(ticket => ({
    ...ticket,
    outlet_name: outletMap.get(ticket.outlet_id) || ticket.outlet_id,
  }));

  return res.json(enrichedData);
});

router.post('/kds-tickets', authenticate, requirePermission('fb:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { data, error } = await supabaseAdmin.from('fb_kds_tickets').insert(req.body).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.status(201).json(data);
});

router.patch('/kds-tickets/:id', authenticate, requirePermission('fb:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { data, error } = await supabaseAdmin.from('fb_kds_tickets').update(req.body).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

router.delete('/kds-tickets/:id', authenticate, requirePermission('fb:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { error } = await supabaseAdmin.from('fb_kds_tickets').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ success: true });
});

// Production Plans
router.get('/production-plans', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { outletId, date, status } = req.query as Record<string, string>;
  let q = supabaseAdmin.from('fb_production_plans').select('*').order('plan_date', { ascending: false });
  if (outletId) q = q.eq('outlet_id', outletId);
  if (date) q = q.eq('plan_date', date);
  if (status) q = q.eq('status', status);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });

  // Fetch outlets for name enrichment
  const { data: outlets } = await supabaseAdmin.from('outlets').select('id, name');
  const outletMap = new Map(outlets?.map(o => [o.id, o.name]) || []);

  // Fetch prep-item counts per plan
  const { data: prepItems } = await supabaseAdmin.from('fb_prep_items').select('plan_id');
  const prepCountMap = new Map<string, number>();
  (prepItems || []).forEach((p: any) => {
    if (p.plan_id) prepCountMap.set(p.plan_id, (prepCountMap.get(p.plan_id) || 0) + 1);
  });

  const enrichedData = (data || []).map(plan => ({
    ...plan,
    outlet_name: outletMap.get(plan.outlet_id) || plan.outlet_id,
    prep_count: prepCountMap.get(plan.id) || 0,
  }));

  return res.json(enrichedData);
});

router.post('/production-plans', authenticate, requirePermission('fb:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { data, error } = await supabaseAdmin.from('fb_production_plans').insert(req.body).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.status(201).json(data);
});

router.patch('/production-plans/:id', authenticate, requirePermission('fb:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { data, error } = await supabaseAdmin.from('fb_production_plans').update(req.body).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

router.delete('/production-plans/:id', authenticate, requirePermission('fb:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { error } = await supabaseAdmin.from('fb_production_plans').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ success: true });
});

// Prep Items
router.get('/prep-items', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { outletId, station, status, planId } = req.query as Record<string, string>;
  let q = supabaseAdmin.from('fb_prep_items').select('*').order('due_by');
  if (outletId) q = q.eq('outlet_id', outletId);
  if (station) q = q.eq('station', station);
  if (status) q = q.eq('status', status);
  if (planId) q = q.eq('plan_id', planId);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });

  // Fetch outlets for name enrichment
  const { data: outlets } = await supabaseAdmin.from('outlets').select('id, name');
  const outletMap = new Map(outlets?.map(o => [o.id, o.name]) || []);

  // Fetch production plans for plan_name enrichment
  const { data: plans } = await supabaseAdmin.from('fb_production_plans').select('id, plan_date, meal_period');
  const planMap = new Map<string, string>();
  (plans || []).forEach((p: any) => {
    planMap.set(p.id, `${p.meal_period} ${p.plan_date}`);
  });

  // Fetch batches for batch_name enrichment
  const { data: batches } = await supabaseAdmin.from('fb_batch_production').select('id, name');
  const batchMap = new Map<string, string>();
  (batches || []).forEach((b: any) => {
    batchMap.set(b.id, b.name);
  });

  const enrichedData = (data || []).map(item => ({
    ...item,
    outlet_name: outletMap.get(item.outlet_id) || item.outlet_id,
    plan_name: item.plan_id ? (planMap.get(item.plan_id) || null) : null,
    batch_name: item.batch_id ? (batchMap.get(item.batch_id) || null) : null,
  }));

  return res.json(enrichedData);
});

router.post('/prep-items', authenticate, requirePermission('fb:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { data, error } = await supabaseAdmin.from('fb_prep_items').insert(req.body).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.status(201).json(data);
});

router.patch('/prep-items/:id', authenticate, requirePermission('fb:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { data, error } = await supabaseAdmin.from('fb_prep_items').update(req.body).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

router.delete('/prep-items/:id', authenticate, requirePermission('fb:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { error } = await supabaseAdmin.from('fb_prep_items').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ success: true });
});

// Batch Production
router.get('/batch-production', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { outletId, batchType, status } = req.query as Record<string, string>;
  let q = supabaseAdmin.from('fb_batch_production').select('*').order('created_at', { ascending: false });
  if (outletId) q = q.eq('outlet_id', outletId);
  if (batchType) q = q.eq('batch_type', batchType);
  if (status) q = q.eq('status', status);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });

  // Fetch outlets for name enrichment
  const { data: outlets } = await supabaseAdmin.from('outlets').select('id, name');
  const outletMap = new Map(outlets?.map(o => [o.id, o.name]) || []);

  // Fetch prep-item counts per batch
  const { data: prepItems } = await supabaseAdmin.from('fb_prep_items').select('batch_id');
  const batchPrepCountMap = new Map<string, number>();
  (prepItems || []).forEach((p: any) => {
    if (p.batch_id) batchPrepCountMap.set(p.batch_id, (batchPrepCountMap.get(p.batch_id) || 0) + 1);
  });

  const enrichedData = (data || []).map(batch => ({
    ...batch,
    outlet_name: outletMap.get(batch.outlet_id) || batch.outlet_id,
    prep_count: batchPrepCountMap.get(batch.id) || 0,
  }));

  return res.json(enrichedData);
});

router.post('/batch-production', authenticate, requirePermission('fb:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { data, error } = await supabaseAdmin.from('fb_batch_production').insert(req.body).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.status(201).json(data);
});

router.patch('/batch-production/:id', authenticate, requirePermission('fb:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { data, error } = await supabaseAdmin.from('fb_batch_production').update(req.body).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

router.delete('/batch-production/:id', authenticate, requirePermission('fb:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { error } = await supabaseAdmin.from('fb_batch_production').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ success: true });
});

// Kitchen Messages
router.get('/kitchen-messages', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { priority } = req.query as Record<string, string>;
  let q = supabaseAdmin.from('fb_kitchen_messages').select('*').order('created_at', { ascending: false });
  if (priority) q = q.eq('priority', priority);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

router.post('/kitchen-messages', authenticate, requirePermission('fb:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { data, error } = await supabaseAdmin.from('fb_kitchen_messages').insert(req.body).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.status(201).json(data);
});

router.delete('/kitchen-messages/:id', authenticate, requirePermission('fb:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { error } = await supabaseAdmin.from('fb_kitchen_messages').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ success: true });
});

// ── Banquet F&B ───────────────────────────────────────────────────
// Banquet Menus
router.get('/banquet-menus', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { menuType, isActive } = req.query as Record<string, string>;
  let q = supabaseAdmin.from('fb_banquet_menus').select('*').order('name');
  if (menuType) q = q.eq('menu_type', menuType);
  if (isActive !== undefined) q = q.eq('is_active', isActive === 'true');
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

router.post('/banquet-menus', authenticate, requirePermission('fb:banquet:create'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { data, error } = await supabaseAdmin.from('fb_banquet_menus').insert(req.body).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.status(201).json(data);
});

router.put('/banquet-menus/:id', authenticate, requirePermission('fb:banquet:update'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { data, error } = await supabaseAdmin.from('fb_banquet_menus').update(req.body).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

router.delete('/banquet-menus/:id', authenticate, requirePermission('fb:banquet:update'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { error } = await supabaseAdmin.from('fb_banquet_menus').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ success: true });
});

// Banquet Menu Items
router.get('/banquet-menu-items', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { banquetMenuId, course } = req.query as Record<string, string>;
  let q = supabaseAdmin.from('fb_banquet_menu_items').select('*').order('sequence');
  if (banquetMenuId) q = q.eq('banquet_menu_id', banquetMenuId);
  if (course) q = q.eq('course', course);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

router.post('/banquet-menu-items', authenticate, requirePermission('fb:banquet:create'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { data, error } = await supabaseAdmin.from('fb_banquet_menu_items').insert(req.body).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.status(201).json(data);
});

router.put('/banquet-menu-items/:id', authenticate, requirePermission('fb:banquet:update'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { data, error } = await supabaseAdmin.from('fb_banquet_menu_items').update(req.body).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

router.delete('/banquet-menu-items/:id', authenticate, requirePermission('fb:banquet:update'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { error } = await supabaseAdmin.from('fb_banquet_menu_items').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ success: true });
});

// Banquet Packages
router.get('/banquet-packages', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { packageType, isActive } = req.query as Record<string, string>;
  let q = supabaseAdmin.from('fb_banquet_packages').select('*').order('name');
  if (packageType) q = q.eq('package_type', packageType);
  if (isActive !== undefined) q = q.eq('is_active', isActive === 'true');
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

router.post('/banquet-packages', authenticate, requirePermission('fb:banquet:create'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { data, error } = await supabaseAdmin.from('fb_banquet_packages').insert(req.body).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.status(201).json(data);
});

router.put('/banquet-packages/:id', authenticate, requirePermission('fb:banquet:update'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { data, error } = await supabaseAdmin.from('fb_banquet_packages').update(req.body).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

router.delete('/banquet-packages/:id', authenticate, requirePermission('fb:banquet:update'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { error } = await supabaseAdmin.from('fb_banquet_packages').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ success: true });
});

// Banquet Package Components
router.get('/banquet-package-components', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { packageId, componentType } = req.query as Record<string, string>;
  let q = supabaseAdmin.from('fb_banquet_package_components').select('*');
  if (packageId) q = q.eq('package_id', packageId);
  if (componentType) q = q.eq('component_type', componentType);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

router.post('/banquet-package-components', authenticate, requirePermission('fb:banquet:create'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { data, error } = await supabaseAdmin.from('fb_banquet_package_components').insert(req.body).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.status(201).json(data);
});

router.delete('/banquet-package-components/:id', authenticate, requirePermission('fb:banquet:update'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { error } = await supabaseAdmin.from('fb_banquet_package_components').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ success: true });
});

// Banquet Production Requirements
router.get('/banquet-production-requirements', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { banquetEventId, menuId } = req.query as Record<string, string>;
  let q = supabaseAdmin.from('fb_banquet_production_requirements').select('*');
  if (banquetEventId) q = q.eq('banquet_event_id', banquetEventId);
  if (menuId) q = q.eq('menu_id', menuId);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

router.post('/banquet-production-requirements', authenticate, requirePermission('fb:banquet:create'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { data, error } = await supabaseAdmin.from('fb_banquet_production_requirements').insert(req.body).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.status(201).json(data);
});

router.patch('/banquet-production-requirements/:id', authenticate, requirePermission('fb:banquet:update'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { data, error } = await supabaseAdmin.from('fb_banquet_production_requirements').update(req.body).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

router.delete('/banquet-production-requirements/:id', authenticate, requirePermission('fb:banquet:update'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { error } = await supabaseAdmin.from('fb_banquet_production_requirements').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ success: true });
});

// Banquet Beverage Requirements
router.get('/banquet-beverage-requirements', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { banquetEventId, beveragePackageId } = req.query as Record<string, string>;
  let q = supabaseAdmin.from('fb_banquet_beverage_requirements').select('*');
  if (banquetEventId) q = q.eq('banquet_event_id', banquetEventId);
  if (beveragePackageId) q = q.eq('beverage_package_id', beveragePackageId);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

router.post('/banquet-beverage-requirements', authenticate, requirePermission('fb:banquet:create'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { data, error } = await supabaseAdmin.from('fb_banquet_beverage_requirements').insert(req.body).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.status(201).json(data);
});

router.patch('/banquet-beverage-requirements/:id', authenticate, requirePermission('fb:banquet:update'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { data, error } = await supabaseAdmin.from('fb_banquet_beverage_requirements').update(req.body).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

router.delete('/banquet-beverage-requirements/:id', authenticate, requirePermission('fb:banquet:update'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { error } = await supabaseAdmin.from('fb_banquet_beverage_requirements').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ success: true });
});

// Banquet Production Menu Items (links a production requirement to specific menu items + quantities)
router.get('/banquet-production-menu-items', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { productionRequirementId } = req.query as Record<string, string>;
  let q = supabaseAdmin.from('fb_banquet_production_menu_items').select('*');
  if (productionRequirementId) q = q.eq('production_requirement_id', productionRequirementId);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

router.post('/banquet-production-menu-items', authenticate, requirePermission('fb:banquet:create'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { data, error } = await supabaseAdmin.from('fb_banquet_production_menu_items').insert(req.body).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.status(201).json(data);
});

router.patch('/banquet-production-menu-items/:id', authenticate, requirePermission('fb:banquet:update'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { data, error } = await supabaseAdmin.from('fb_banquet_production_menu_items').update(req.body).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

router.delete('/banquet-production-menu-items/:id', authenticate, requirePermission('fb:banquet:update'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { error } = await supabaseAdmin.from('fb_banquet_production_menu_items').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ success: true });
});

// ── Banquet ↔ Production Coordination bridge ────────────────────────
// Push a banquet production requirement into the kitchen Production Coordination
// module: creates a fb_production_plans row + linked fb_prep_items rows so the
// kitchen team picks up the banquet prep work in their Production Coordination tab.
router.post('/banquet-production-requirements/:id/push-to-production-plan', authenticate, requirePermission('fb:banquet:update'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { outletId, planDate, mealPeriod, forecastCovers } = req.body as {
    outletId?: string; planDate?: string; mealPeriod?: string; forecastCovers?: number;
  };
  // 1. Load the banquet production requirement
  const { data: reqRow, error: reqErr } = await supabaseAdmin
    .from('fb_banquet_production_requirements').select('*').eq('id', req.params.id).single();
  if (reqErr) return res.status(404).json({ error: reqErr.message });
  // 2. Resolve outlet — prefer body, then a sensible default (Grand Ballroom Banquet)
  let resolvedOutletId = outletId || '';
  if (!resolvedOutletId) {
    const { data: ballroom } = await supabaseAdmin
      .from('outlets').select('id').ilike('name', '%ballroom%').limit(1).single();
    resolvedOutletId = ballroom?.id || '';
  }
  if (!resolvedOutletId) return res.status(400).json({ error: 'No outletId provided and no Ballroom outlet found' });
  // 3. Create the production plan
  const planBody: Record<string, unknown> = {
    outlet_id: resolvedOutletId,
    plan_date: planDate || new Date().toISOString().slice(0, 10),
    meal_period: mealPeriod || 'Dinner',
    forecast_covers: forecastCovers ?? reqRow.staff_count ?? 0,
    status: 'Planned',
  };
  const { data: plan, error: planErr } = await supabaseAdmin
    .from('fb_production_plans').insert(planBody).select().single();
  if (planErr) return res.status(500).json({ error: planErr.message });
  // 4. Create a prep item representing the banquet prep work
  const dueBy = new Date(Date.now() + (reqRow.prep_start_hours_before || 0) * 3600 * 1000)
    .toISOString().slice(0, 16);
  const prepBody: Record<string, unknown> = {
    name: `Banquet prep — ${reqRow.preparation_area}`,
    outlet_id: resolvedOutletId,
    station: reqRow.preparation_area,
    qty: reqRow.prep_duration_minutes || 0,
    unit: 'min',
    assignee: 'Unassigned',
    due_by: dueBy,
    status: 'Pending',
    plan_id: plan.id,
  };
  const { data: prep, error: prepErr } = await supabaseAdmin
    .from('fb_prep_items').insert(prepBody).select().single();
  if (prepErr) return res.status(500).json({ error: prepErr.message });
  // 5. Load any linked banquet production menu items and create prep items for each
  const { data: prodMenuItems } = await supabaseAdmin
    .from('fb_banquet_production_menu_items').select('*').eq('production_requirement_id', req.params.id);
  const extraPreps: any[] = [];
  if (prodMenuItems && prodMenuItems.length > 0) {
    const rows = prodMenuItems.map((mi: any) => ({
      name: `Banquet — ${mi.menu_item_id || 'menu item'} (x${mi.total_quantity || mi.quantity_per_guest})`,
      outlet_id: resolvedOutletId,
      station: reqRow.preparation_area,
      qty: mi.total_quantity || mi.quantity_per_guest || 0,
      unit: 'portions',
      assignee: 'Unassigned',
      due_by: dueBy,
      status: 'Pending',
      plan_id: plan.id,
    }));
    const { data: inserted, error: ie } = await supabaseAdmin.from('fb_prep_items').insert(rows).select();
    if (ie) return res.status(500).json({ error: ie.message });
    extraPreps.push(...(inserted || []));
  }
  return res.json({
    success: true,
    production_plan: plan,
    prep_items: [prep, ...extraPreps],
    prep_count: 1 + extraPreps.length,
  });
});

// ── Banquet ↔ Pricing & Packages bridge ─────────────────────────────
// Push a banquet menu's per-person price into the F&B Pricing & Packages module
// as a price list + price list item, so banquet pricing is visible alongside
// regular outlet pricing.
router.post('/banquet-menus/:id/push-to-price-list', authenticate, requirePermission('fb:banquet:update'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { outletId, outletName, currency, effectiveFrom } = req.body as {
    outletId?: string; outletName?: string; currency?: string; effectiveFrom?: string;
  };
  const { data: menu, error: mErr } = await supabaseAdmin
    .from('fb_banquet_menus').select('*').eq('id', req.params.id).single();
  if (mErr) return res.status(404).json({ error: mErr.message });
  const listId = crypto.randomUUID();
  const listName = `Banquet Menu — ${menu.name}`;
  const { data: list, error: lErr } = await supabaseAdmin.from('fb_price_lists').insert({
    id: listId,
    name: listName,
    outlet_id: outletId || null,
    outlet_name: outletName || 'Banquet',
    currency: currency || 'USD',
    effective_from: effectiveFrom || new Date().toISOString().slice(0, 10),
    status: 'Active',
    description: `Auto-generated from banquet menu: ${menu.name} (${menu.menu_type})`,
  }).select().single();
  if (lErr) return res.status(500).json({ error: lErr.message });
  const { error: iErr } = await supabaseAdmin.from('fb_price_list_items').insert({
    id: crypto.randomUUID(),
    price_list_id: listId,
    menu_item_id: null,
    menu_item_name: `${menu.name} (per person)`,
    price: menu.price_per_person,
  });
  if (iErr) return res.status(500).json({ error: iErr.message });
  return res.json({ success: true, price_list: list });
});

// Push a banquet package's per-person price into the Pricing & Packages module.
router.post('/banquet-packages/:id/push-to-price-list', authenticate, requirePermission('fb:banquet:update'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { outletId, outletName, currency, effectiveFrom } = req.body as {
    outletId?: string; outletName?: string; currency?: string; effectiveFrom?: string;
  };
  const { data: pkg, error: pErr } = await supabaseAdmin
    .from('fb_banquet_packages').select('*').eq('id', req.params.id).single();
  if (pErr) return res.status(404).json({ error: pErr.message });
  const listId = crypto.randomUUID();
  const listName = `Banquet Package — ${pkg.name}`;
  const { data: list, error: lErr } = await supabaseAdmin.from('fb_price_lists').insert({
    id: listId,
    name: listName,
    outlet_id: outletId || null,
    outlet_name: outletName || 'Banquet',
    currency: currency || 'USD',
    effective_from: effectiveFrom || new Date().toISOString().slice(0, 10),
    status: 'Active',
    description: `Auto-generated from banquet package: ${pkg.name} (${pkg.package_type})`,
  }).select().single();
  if (lErr) return res.status(500).json({ error: lErr.message });
  const { error: iErr } = await supabaseAdmin.from('fb_price_list_items').insert({
    id: crypto.randomUUID(),
    price_list_id: listId,
    menu_item_id: null,
    menu_item_name: `${pkg.name} (per person)`,
    price: pkg.price_per_person,
  });
  if (iErr) return res.status(500).json({ error: iErr.message });
  return res.json({ success: true, price_list: list });
});

// ── Room Service ─────────────────────────────────────────────────────
// Room Service Menu Items
router.get('/room-service-menu-items', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { outletId, isActive } = req.query as Record<string, string>;
  let q = supabaseAdmin.from('fb_room_service_menu_items').select('*').order('created_at', { ascending: false });
  if (outletId) q = q.eq('outlet_id', outletId);
  if (isActive !== undefined) q = q.eq('is_active', isActive === 'true');
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });

  // Fetch menu items and outlets for name enrichment
  const [menuItems, outlets] = await Promise.all([
    supabaseAdmin.from('menu_items').select('id, name'),
    supabaseAdmin.from('outlets').select('id, name'),
  ]);

  const menuItemMap = new Map(menuItems?.data?.map(mi => [mi.id, mi.name]) || []);
  const outletMap = new Map(outlets?.data?.map(o => [o.id, o.name]) || []);

  const enrichedData = (data || []).map(item => ({
    ...item,
    menu_item_name: menuItemMap.get(item.menu_item_id) || item.menu_item_id,
    outlet_name: outletMap.get(item.outlet_id) || item.outlet_id,
  }));

  return res.json(enrichedData);
});

router.post('/room-service-menu-items', authenticate, requirePermission('fb:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { data, error } = await supabaseAdmin.from('fb_room_service_menu_items').insert(req.body).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.status(201).json(data);
});

router.patch('/room-service-menu-items/:id', authenticate, requirePermission('fb:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { data, error } = await supabaseAdmin.from('fb_room_service_menu_items').update(req.body).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

router.delete('/room-service-menu-items/:id', authenticate, requirePermission('fb:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { error } = await supabaseAdmin.from('fb_room_service_menu_items').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ success: true });
});

// Room Service Orders
router.get('/room-service-orders', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { roomNumber, status } = req.query as Record<string, string>;
  let q = supabaseAdmin.from('fb_room_service_orders').select('*').order('created_at', { ascending: false });
  if (roomNumber) q = q.eq('room_number', roomNumber);
  if (status) q = q.eq('status', status);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

router.post('/room-service-orders', authenticate, requirePermission('fb:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { data, error } = await supabaseAdmin.from('fb_room_service_orders').insert(req.body).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.status(201).json(data);
});

router.patch('/room-service-orders/:id', authenticate, requirePermission('fb:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { data, error } = await supabaseAdmin.from('fb_room_service_orders').update(req.body).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });

  // Notify the guest on status transitions (they watch their feed).
  if (data?.guest_id && req.body?.status) {
    try {
      const status = String(req.body.status);
      const label = status === 'Delivered' ? 'delivered — enjoy!'
        : status === 'Cancelled' ? 'cancelled'
        : status === 'In Progress' || status === 'Preparing' ? 'being prepared'
        : status === 'Out for Delivery' ? 'on its way to your room'
        : `updated to ${status}`;
      await supabaseAdmin.from('guest_notifications').insert({
        property_id: data.property_id || null,
        guest_id: data.guest_id,
        reservation_id: data.reservation_id || null,
        category: 'order',
        title: 'Room service update',
        message: `Order ${data.order_id || data.id} is ${label}.`,
      });
    } catch (e: any) {
      console.warn('room-service guest notification failed:', e?.message);
    }
  }
  return res.json(data);
});

router.delete('/room-service-orders/:id', authenticate, requirePermission('fb:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { error } = await supabaseAdmin.from('fb_room_service_orders').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ success: true });
});

// Room Service Deliveries
router.get('/room-service-deliveries', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { status } = req.query as Record<string, string>;
  let q = supabaseAdmin.from('fb_room_service_deliveries').select('*').order('created_at', { ascending: false });
  if (status) q = q.eq('status', status);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

router.post('/room-service-deliveries', authenticate, requirePermission('fb:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { data, error } = await supabaseAdmin.from('fb_room_service_deliveries').insert(req.body).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.status(201).json(data);
});

router.patch('/room-service-deliveries/:id', authenticate, requirePermission('fb:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { data, error } = await supabaseAdmin.from('fb_room_service_deliveries').update(req.body).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

router.delete('/room-service-deliveries/:id', authenticate, requirePermission('fb:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { error } = await supabaseAdmin.from('fb_room_service_deliveries').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ success: true });
});

// Room Service Guest Preferences
router.get('/room-service-guest-preferences', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { guestId, roomNumber } = req.query as Record<string, string>;
  let q = supabaseAdmin.from('fb_room_service_guest_preferences').select('*');
  if (guestId) q = q.eq('guest_id', guestId);
  if (roomNumber) q = q.eq('room_number', roomNumber);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

router.post('/room-service-guest-preferences', authenticate, requirePermission('fb:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { data, error } = await supabaseAdmin.from('fb_room_service_guest_preferences').insert(req.body).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.status(201).json(data);
});

router.put('/room-service-guest-preferences/:id', authenticate, requirePermission('fb:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { data, error } = await supabaseAdmin.from('fb_room_service_guest_preferences').update(req.body).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

router.delete('/room-service-guest-preferences/:id', authenticate, requirePermission('fb:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { error } = await supabaseAdmin.from('fb_room_service_guest_preferences').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ success: true });
});

// Minibar Inventory
router.get('/minibar-inventory', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { roomNumber } = req.query as Record<string, string>;
  let q = supabaseAdmin.from('fb_minibar_inventory').select('*');
  if (roomNumber) q = q.eq('room_number', roomNumber);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });

  // Fetch menu items for name enrichment
  const { data: menuItems } = await supabaseAdmin.from('menu_items').select('id, name');
  const menuItemMap = new Map(menuItems?.map(mi => [mi.id, mi.name]) || []);

  const enrichedData = (data || []).map(item => ({
    ...item,
    menu_item_name: menuItemMap.get(item.menu_item_id) || item.menu_item_id,
  }));

  return res.json(enrichedData);
});

router.post('/minibar-inventory', authenticate, requirePermission('fb:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { data, error } = await supabaseAdmin.from('fb_minibar_inventory').insert(req.body).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.status(201).json(data);
});

router.patch('/minibar-inventory/:id', authenticate, requirePermission('fb:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { data, error } = await supabaseAdmin.from('fb_minibar_inventory').update(req.body).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

router.delete('/minibar-inventory/:id', authenticate, requirePermission('fb:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { error } = await supabaseAdmin.from('fb_minibar_inventory').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ success: true });
});

// Minibar Consumption
router.get('/minibar-consumption', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { roomNumber, guestId } = req.query as Record<string, string>;
  let q = supabaseAdmin.from('fb_minibar_consumption').select('*').order('consumed_at', { ascending: false });
  if (roomNumber) q = q.eq('room_number', roomNumber);
  if (guestId) q = q.eq('guest_id', guestId);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

router.post('/minibar-consumption', authenticate, requirePermission('fb:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { data, error } = await supabaseAdmin.from('fb_minibar_consumption').insert(req.body).select().single();
  if (error) return res.status(500).json({ error: error.message });

  // Dual-write: debit the unified F&B beverage store so dynamic par sees minibar consumption.
  // The fb_minibar_consumption row carries item_name (or menu_item_id → menu_items.name).
  // Uses the shared unifiedInventoryBridge helper (no inline duplicate).
  let dualWriteOk = false;
  let dualWriteReason: string | null = null;
  try {
    const itemName = data.item_name || data.menu_item_name;
    let resolvedName = itemName;
    if (!resolvedName && data.menu_item_id) {
      const { data: mi } = await supabaseAdmin.from('menu_items').select('name').eq('id', data.menu_item_id).maybeSingle();
      resolvedName = mi?.name || null;
    }
    if (resolvedName) {
      const uinvItem = await resolveUinvItemByName(String(resolvedName));
      if (uinvItem) {
        const qty = Number(data.quantity || 1);
        const now = (data.consumed_at || new Date().toISOString());
        dualWriteOk = await uinvConsumeFromStore({
          propertyId: data.property_id || null,
          itemId: uinvItem.id,
          storeId: FB_BEV_STORE_ID,
          qty,
          reference: `Minibar-${data.room_number || 'N/A'}`,
          reason: `Minibar consumption: Room ${data.room_number || 'N/A'}`,
          performedBy: (req as any).user?.name || 'system',
          txDate: now,
        });
        if (!dualWriteOk) dualWriteReason = 'Unified ledger/balance write failed';
      } else {
        dualWriteReason = `No matching uinv_items row for "${resolvedName}"`;
      }
    } else {
      dualWriteReason = 'No item name resolvable from minibar consumption row';
    }
  } catch (e) {
    console.error('[fb] minibar consumption unified dual-write failed:', e);
    dualWriteReason = (e as Error)?.message || 'Dual-write threw';
  }

  return res.status(201).json({
    ...data,
    dual_write: { unified_ok: dualWriteOk, ...(dualWriteReason ? { warning: dualWriteReason } : {}) },
  });
});

// ── Beverage Management ───────────────────────────────────────────────
// Beverage List (expanded from Wine List to all beverages)
router.get('/beverage-list', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { beverageType, isActive } = req.query as Record<string, string>;
  let q = supabaseAdmin.from('fb_wine_list').select('*').order('created_at', { ascending: false });
  if (beverageType) q = q.eq('wine_type', beverageType);
  if (isActive !== undefined) q = q.eq('is_active', isActive === 'true');
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });

  // Fetch menu items for name enrichment
  const { data: menuItems } = await supabaseAdmin.from('menu_items').select('id, name');
  const menuItemMap = new Map(menuItems?.map(mi => [mi.id, mi.name]) || []);

  const enrichedData = (data || []).map(item => ({
    ...item,
    menu_item_name: menuItemMap.get(item.menu_item_id) || item.menu_item_id,
  }));

  return res.json(enrichedData);
});

router.post('/beverage-list', authenticate, requirePermission('fb:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { data, error } = await supabaseAdmin.from('fb_wine_list').insert(req.body).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.status(201).json(data);
});

router.put('/beverage-list/:id', authenticate, requirePermission('fb:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { data, error } = await supabaseAdmin.from('fb_wine_list').update(req.body).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

router.delete('/beverage-list/:id', authenticate, requirePermission('fb:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { error } = await supabaseAdmin.from('fb_wine_list').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ success: true });
});

// Beverage Categories
router.get('/beverage-categories', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { isActive } = req.query as Record<string, string>;
  let q = supabaseAdmin.from('fb_beverage_categories').select('*').order('display_order');
  if (isActive !== undefined) q = q.eq('is_active', isActive === 'true');
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

router.post('/beverage-categories', authenticate, requirePermission('fb:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { data, error } = await supabaseAdmin.from('fb_beverage_categories').insert(req.body).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.status(201).json(data);
});

router.put('/beverage-categories/:id', authenticate, requirePermission('fb:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { data, error } = await supabaseAdmin.from('fb_beverage_categories').update(req.body).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

// Beverage Menu Item Categories
router.get('/beverage-menu-item-categories', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { outletId, categoryId } = req.query as Record<string, string>;
  let q = supabaseAdmin.from('fb_beverage_menu_item_categories').select('*');
  if (outletId) q = q.eq('outlet_id', outletId);
  if (categoryId) q = q.eq('beverage_category_id', categoryId);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });

  // Fetch related data for name enrichment
  const [menuItems, categories, outlets] = await Promise.all([
    supabaseAdmin.from('menu_items').select('id, name'),
    supabaseAdmin.from('fb_beverage_categories').select('id, name'),
    supabaseAdmin.from('outlets').select('id, name'),
  ]);

  const menuItemMap = new Map(menuItems?.data?.map(mi => [mi.id, mi.name]) || []);
  const categoryMap = new Map(categories?.data?.map(c => [c.id, c.name]) || []);
  const outletMap = new Map(outlets?.data?.map(o => [o.id, o.name]) || []);

  const enrichedData = (data || []).map(item => ({
    ...item,
    menu_item_name: menuItemMap.get(item.menu_item_id) || item.menu_item_id,
    category_name: categoryMap.get(item.beverage_category_id) || item.beverage_category_id,
    outlet_name: outletMap.get(item.outlet_id) || item.outlet_id,
  }));

  return res.json(enrichedData);
});

router.post('/beverage-menu-item-categories', authenticate, requirePermission('fb:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { data, error } = await supabaseAdmin.from('fb_beverage_menu_item_categories').insert(req.body).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.status(201).json(data);
});

router.delete('/beverage-menu-item-categories/:id', authenticate, requirePermission('fb:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { error } = await supabaseAdmin.from('fb_beverage_menu_item_categories').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ success: true });
});

// ── Bar Recipes (cocktails, mocktails, spirits) ──────────────────────────
router.get('/bar-recipes', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { category, status } = req.query as Record<string, string>;
  let q = supabaseAdmin.from('bar_recipes').select('*').eq('is_deleted', false).order('name');
  if (category) q = q.eq('category', category);
  if (status) q = q.eq('status', status);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

router.post('/bar-recipes', authenticate, requirePermission('fb:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { data, error } = await supabaseAdmin.from('bar_recipes').insert(req.body).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.status(201).json(data);
});

router.put('/bar-recipes/:id', authenticate, requirePermission('fb:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { data, error } = await supabaseAdmin.from('bar_recipes').update(req.body).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

// ── Procurement Coordination (F&B Supplier & Procurement Coordination tab) ──
// Aggregated endpoints backing the /erp/fb/procurement-coordination screen.
// Maps F&B demand forecasts, purchase orders (treated as requisitions) and
// supplier master data into the shapes the UI expects.

// PO status → display status used by the UI
function poStatusToRequisitionStatus(poStatus: string): string {
  switch (poStatus) {
    case 'draft': return 'draft';
    case 'submitted': return 'submitted';
    case 'acknowledged': return 'approved';
    case 'partial': return 'processing';
    case 'received': return 'processing';
    case 'closed': return 'approved';
    default: return 'draft';
  }
}

function poStatusToSupplierOrderStatus(poStatus: string): string | null {
  // Only show a "supplier order" once the PO has been acknowledged by the supplier
  switch (poStatus) {
    case 'acknowledged': return 'ordered';
    case 'partial': return 'shipped';
    case 'received': return 'delivered';
    case 'closed': return 'delivered';
    default: return null;
  }
}

// GET /api/fb/procurement-coordination/forecast
// Aggregates fb_sales_forecasts with stock availability (stock_transactions)
// and linked purchase orders to produce demand-vs-supply rows.
router.get('/procurement-coordination/forecast', authenticate, async (_req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  try {
    const { data: forecasts, error: fErr } = await supabaseAdmin
      .from('fb_sales_forecasts')
      .select('*')
      .order('forecast_date', { ascending: false });
    if (fErr) return res.status(500).json({ error: fErr.message });

    const { data: outlets } = await supabaseAdmin.from('outlets').select('id, name, type');
    const outletName: Record<string, string> = {};
    (outlets || []).forEach((o: any) => { outletName[o.id] = o.name; });

    const { data: locations } = await supabaseAdmin.from('stock_locations').select('id, type, outlet_id');
    const locById: Record<string, any> = {};
    (locations || []).forEach((l: any) => { locById[l.id] = l; });

    const { data: txns } = await supabaseAdmin.from('stock_transactions').select('ingredient_id, location_id, quantity');
    // Build stock map: ingredient_id -> { main: number, byOutlet: { outletId: number } }
    const stockByIngredient: Record<string, { main: number; byOutlet: Record<string, number> }> = {};
    (txns || []).forEach((t: any) => {
      const loc = locById[t.location_id];
      if (!loc) return;
      const qty = Number(t.quantity || 0);
      const entry = stockByIngredient[t.ingredient_id] || { main: 0, byOutlet: {} };
      if (loc.type === 'MainStore') entry.main += qty;
      else if (loc.outlet_id) entry.byOutlet[loc.outlet_id] = (entry.byOutlet[loc.outlet_id] || 0) + qty;
      stockByIngredient[t.ingredient_id] = entry;
    });

    const { data: ingredients } = await supabaseAdmin.from('ingredients').select('id, name, unit_of_measure');
    const ingredientById: Record<string, any> = {};
    (ingredients || []).forEach((i: any) => { ingredientById[i.id] = i; });

    // Pick a representative ingredient per outlet: the one with the most stock at that outlet,
    // falling back to the ingredient with the most main-store stock.
    const representativeIngredientByOutlet: Record<string, string> = {};
    const outletIds = Object.keys(outletName);
    for (const outletId of outletIds) {
      let best: { id: string; qty: number } | null = null;
      for (const [ingId, entry] of Object.entries(stockByIngredient)) {
        const outletQty = entry.byOutlet[outletId] || 0;
        if (outletQty > (best?.qty || 0)) best = { id: ingId, qty: outletQty };
      }
      if (!best) {
        // fallback: highest main store stock
        for (const [ingId, entry] of Object.entries(stockByIngredient)) {
          if (entry.main > (best?.qty || 0)) best = { id: ingId, qty: entry.main };
        }
      }
      if (best) representativeIngredientByOutlet[outletId] = best.id;
    }

    // Linked POs per outlet
    const { data: pos } = await supabaseAdmin.from('fb_purchase_orders').select('id, po_number, outlet_id, status').order('order_date', { ascending: false });
    const poByOutlet: Record<string, any[]> = {};
    (pos || []).forEach((p: any) => {
      if (!p.outlet_id) return;
      (poByOutlet[p.outlet_id] = poByOutlet[p.outlet_id] || []).push(p);
    });

    const rows = (forecasts || []).map((f: any, idx: number) => {
      const outletId = f.outlet_id;
      const repIngId = representativeIngredientByOutlet[outletId];
      const repIng = repIngId ? ingredientById[repIngId] : null;
      const stock = repIngId ? stockByIngredient[repIngId] : null;
      const fbOutletStock = stock?.byOutlet[outletId] || 0;
      const mainStoreStock = stock?.main || 0;
      const totalAvailable = fbOutletStock + mainStoreStock;
      const predictedQuantity = Number(f.predicted_orders || 0);
      const shortage = Math.max(0, predictedQuantity - totalAvailable);

      const outletPos = poByOutlet[outletId] || [];
      const requisitionPo = outletPos.find((p: any) => ['draft', 'submitted'].includes(p.status));
      const supplierPo = outletPos.find((p: any) => ['acknowledged', 'partial', 'received', 'closed'].includes(p.status));

      return {
        id: f.id || String(idx + 1),
        period: f.forecast_date ? String(f.forecast_date).slice(0, 10) : '',
        outlet_id: outletName[outletId] || outletId,
        menu_item_id: repIng?.name || (outletName[outletId] || 'Service'),
        predicted_quantity: predictedQuantity,
        unit: repIng?.unit_of_measure || 'portions',
        confidence: Math.round(Number(f.confidence || 0) * 100),
        created_at: f.created_at ? String(f.created_at).slice(0, 10) : '',
        fb_outlet_stock: fbOutletStock,
        main_store_stock: mainStoreStock,
        total_available: totalAvailable,
        shortage,
        requisition_id: requisitionPo?.po_number || null,
        requisition_status: requisitionPo ? poStatusToRequisitionStatus(requisitionPo.status) : null,
        supplier_order_id: supplierPo?.po_number || null,
        supplier_order_status: supplierPo ? poStatusToSupplierOrderStatus(supplierPo.status) : null,
      };
    });

    return res.json(rows);
  } catch (err) {
    console.error('procurement-coordination/forecast error:', err);
    return res.status(500).json({ error: 'Failed to load forecast data' });
  }
});

// GET /api/fb/procurement-coordination/requisitions
// Returns purchase orders (draft/submitted/acknowledged/...) mapped to the
// PurchaseRequisition shape with their lines and supplier name.
router.get('/procurement-coordination/requisitions', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  try {
    const { status } = req.query as Record<string, string>;
    let q = supabaseAdmin.from('fb_purchase_orders').select('*').order('order_date', { ascending: false });
    if (status) q = q.eq('status', status);
    const { data: pos, error } = await q;
    if (error) return res.status(500).json({ error: error.message });

    const { data: suppliers } = await supabaseAdmin.from('fb_suppliers').select('id, name');
    const supplierName: Record<string, string> = {};
    (suppliers || []).forEach((s: any) => { supplierName[s.id] = s.name; });

    const { data: outlets } = await supabaseAdmin.from('outlets').select('id, name');
    const outletName: Record<string, string> = {};
    (outlets || []).forEach((o: any) => { outletName[o.id] = o.name; });

    const { data: ingredients } = await supabaseAdmin.from('ingredients').select('id, name, category, unit_of_measure, current_cost');
    const ingredientById: Record<string, any> = {};
    (ingredients || []).forEach((i: any) => { ingredientById[i.id] = i; });

    const poIds = (pos || []).map((p: any) => p.id);
    let linesByPo: Record<string, any[]> = {};
    if (poIds.length > 0) {
      const { data: lines } = await supabaseAdmin.from('fb_purchase_order_lines').select('*').in('po_id', poIds);
      (lines || []).forEach((l: any) => {
        (linesByPo[l.po_id] = linesByPo[l.po_id] || []).push(l);
      });
    }

    const rows = (pos || []).map((po: any) => {
      const lines = (linesByPo[po.id] || []).map((l: any) => {
        const ing = ingredientById[l.ingredient_id];
        const unitCost = Number(l.unit_price || ing?.current_cost || 0);
        const qty = Number(l.quantity_ordered || 0);
        return {
          id: l.id,
          item_name: ing?.name || l.description || 'Item',
          category: ing?.category || 'General',
          requested_quantity: qty,
          unit: l.unit_of_measure || ing?.unit_of_measure || 'pcs',
          estimated_unit_cost: unitCost,
          estimated_total: Number((qty * unitCost).toFixed(2)),
          // Prefer the per-line expected_date; fall back to the PO-level expected_delivery_date.
          required_by: (l.expected_date ? String(l.expected_date).slice(0, 10) : '')
            || (po.expected_delivery_date ? String(po.expected_delivery_date).slice(0, 10) : ''),
          // Prefer the per-line reason; fall back to the PO-level notes.
          reason: l.reason || po.notes || 'Stock replenishment',
        };
      });
      const totalCost = lines.reduce((sum: number, l: any) => sum + l.estimated_total, 0);
      const supplierOrderStatus = poStatusToSupplierOrderStatus(po.status);
      return {
        id: po.id,
        requisition_number: po.po_number,
        requested_by: po.submitted_by || 'F&B Manager',
        request_date: po.order_date ? String(po.order_date).slice(0, 10) : '',
        department: outletName[po.outlet_id] || po.outlet_id || 'F&B',
        priority: 'medium' as const,
        status: poStatusToRequisitionStatus(po.status) as any,
        items: lines,
        total_cost: Number(po.total_amount || totalCost),
        notes: po.notes || '',
        supplier_order_id: supplierOrderStatus ? po.po_number : null,
        supplier_order_number: supplierOrderStatus ? po.po_number : null,
        supplier_order_status: supplierOrderStatus,
        supplier_name: supplierName[po.supplier_id] || null,
      };
    });

    return res.json(rows);
  } catch (err) {
    console.error('procurement-coordination/requisitions error:', err);
    return res.status(500).json({ error: 'Failed to load requisitions' });
  }
});

// Returns the earliest (minimum) non-empty requiredBy date from requisition items,
// as an ISO string. Used to set the PO-level expected_delivery_date from per-item dates.
function earliestRequiredBy(items?: Array<{ requiredBy?: string }>): string | null {
  if (!items || items.length === 0) return null;
  const dates = items
    .map(it => it.requiredBy)
    .filter((d): d is string => !!d && !isNaN(new Date(d).getTime()))
    .map(d => new Date(d).getTime());
  if (dates.length === 0) return null;
  return new Date(Math.min(...dates)).toISOString();
}

// POST /api/fb/procurement-coordination/requisitions
// Creates a new purchase order (status 'draft') with lines from the F&B portal.
router.post('/procurement-coordination/requisitions', authenticate, requirePermission('fb:po:create'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  try {
    const { outletId, supplierId, priority, notes, items } = req.body as {
      outletId?: string;
      supplierId?: string;
      priority?: string;
      notes?: string;
      items?: Array<{ itemName: string; category: string; quantity: number; unit: string; estimatedCost: number; requiredBy: string; reason: string; ingredientId?: string }>;
    };

    if (!outletId) return res.status(400).json({ error: 'outletId is required' });
    // Generate a unique PO number
    const poNumber = `PO-${new Date().getFullYear()}-${Date.now().toString().slice(-6)}`;
    const subtotal = (items || []).reduce((sum, it) => sum + (Number(it.quantity) || 0) * (Number(it.estimatedCost) || 0), 0);

    const { data: po, error: poErr } = await supabaseAdmin.from('fb_purchase_orders').insert({
      po_number: poNumber,
      supplier_id: supplierId || null,
      outlet_id: outletId,
      status: 'draft',
      order_date: new Date().toISOString(),
      // Use the earliest non-empty per-item requiredBy as the PO-level expected delivery date.
      expected_delivery_date: earliestRequiredBy(items) || null,
      subtotal,
      tax_amount: 0,
      total_amount: subtotal,
      currency: 'ETB',
      payment_status: 'pending',
      notes: notes || (priority ? `Priority: ${priority}` : 'Created from F&B Procurement Coordination'),
      submitted_by: req.user?.name || req.user?.id || 'F&B',
    }).select().single();
    if (poErr) return res.status(500).json({ error: poErr.message });

    // Insert lines. Resolve ingredient by name when ingredientId not provided.
    const { data: ingredients } = await supabaseAdmin.from('ingredients').select('id, name');
    const ingredientByName: Record<string, string> = {};
    (ingredients || []).forEach((i: any) => { ingredientByName[i.name.toLowerCase()] = i.id; });

    const lineRows = (items || []).map((it) => {
      const ingredientId = it.ingredientId || ingredientByName[(it.itemName || '').toLowerCase()];
      const qty = Number(it.quantity) || 0;
      const unitCost = Number(it.estimatedCost) || 0;
      return {
        po_id: po.id,
        ingredient_id: ingredientId || null,
        description: it.itemName,
        quantity_ordered: qty,
        quantity_received: 0,
        unit_of_measure: it.unit || 'pcs',
        unit_price: unitCost,
        line_total: Number((qty * unitCost).toFixed(2)),
        // Per-line "required by" date and reason (backing the requisitions table columns).
        expected_date: it.requiredBy ? new Date(it.requiredBy).toISOString() : null,
        reason: it.reason || null,
      };
    }).filter((l) => l.ingredient_id); // only keep lines that resolve to a real ingredient

    if (lineRows.length > 0) {
      const { error: lineErr } = await supabaseAdmin.from('fb_purchase_order_lines').insert(lineRows);
      if (lineErr) return res.status(500).json({ error: lineErr.message });
    }

    // Twin-write into unified proc_requisitions so the Procurement portal sees this.
    // Resolve property_id from the outlet.
    let fbPropertyId: string | undefined;
    if (outletId) {
      const { data: outlet } = await supabaseAdmin.from('fb_outlets').select('property_id').eq('id', outletId).single();
      fbPropertyId = outlet?.property_id || undefined;
    }
    twinWriteProcRequisition({
      sourceSystem: 'food_beverage',
      sourceRef: po.id,
      sourcePoNumber: po.po_number,
      propertyId: fbPropertyId,
      department: 'Food & Beverage',
      requester: req.user?.name || req.user?.id || 'F&B',
      priority: priority || 'medium',
      notes: notes || 'Created from F&B Procurement Coordination',
      requiredDate: earliestRequiredBy(items),
      estimatedTotal: subtotal,
      items: (items || []).map(it => ({
        itemName: it.itemName,
        category: it.category,
        quantity: Number(it.quantity) || 0,
        unit: it.unit || 'pcs',
        estimatedCost: Number(it.estimatedCost) || 0,
        requiredBy: it.requiredBy || undefined,
        reason: it.reason,
      })),
      createdBy: req.user?.id,
    }).catch(() => { /* errors logged inside helper */ });

    return res.status(201).json({ id: po.id, po_number: po.po_number, status: po.status });
  } catch (err) {
    console.error('procurement-coordination/requisitions POST error:', err);
    return res.status(500).json({ error: 'Failed to create requisition' });
  }
});

// GET /api/fb/procurement-coordination/suppliers
// Returns suppliers with category, lead time (from latest performance),
// payment terms and last order date — the SupplierRequirement shape.
router.get('/procurement-coordination/suppliers', authenticate, async (_req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  try {
    const { data: suppliers, error } = await supabaseAdmin.from('fb_suppliers').select('*').order('name');
    if (error) return res.status(500).json({ error: error.message });

    const { data: assignments } = await supabaseAdmin.from('fb_supplier_category_assignments').select('supplier_id, category_id');
    const { data: categories } = await supabaseAdmin.from('fb_supplier_categories').select('id, name');
    const categoryName: Record<string, string> = {};
    (categories || []).forEach((c: any) => { categoryName[c.id] = c.name; });
    const categoryBySupplier: Record<string, string> = {};
    (assignments || []).forEach((a: any) => {
      if (!categoryBySupplier[a.supplier_id]) categoryBySupplier[a.supplier_id] = categoryName[a.category_id] || 'General';
    });

    const { data: performance } = await supabaseAdmin.from('fb_supplier_performance')
      .select('supplier_id, average_lead_time, period_start')
      .order('period_start', { ascending: false });
    const leadTimeBySupplier: Record<string, number> = {};
    (performance || []).forEach((p: any) => {
      if (leadTimeBySupplier[p.supplier_id] === undefined) leadTimeBySupplier[p.supplier_id] = Number(p.average_lead_time || 0);
    });

    const { data: pos } = await supabaseAdmin.from('fb_purchase_orders').select('supplier_id, order_date').order('order_date', { ascending: false });
    const lastOrderBySupplier: Record<string, string> = {};
    (pos || []).forEach((p: any) => {
      if (!p.supplier_id) return;
      if (!lastOrderBySupplier[p.supplier_id] && p.order_date) lastOrderBySupplier[p.supplier_id] = String(p.order_date).slice(0, 10);
    });

    const rows = (suppliers || []).map((s: any) => ({
      id: s.id,
      supplier_id: s.supplier_code,
      supplier_name: s.name,
      category: categoryBySupplier[s.id] || 'General',
      item_name: s.notes || categoryBySupplier[s.id] || 'Various',
      minimum_order_qty: 1,
      unit: 'pcs',
      lead_time_days: leadTimeBySupplier[s.id] ?? 0,
      payment_terms: s.payment_terms ? `Net ${s.payment_terms}` : 'Net 30',
      status: s.is_active ? 'active' : 'inactive',
      last_order_date: lastOrderBySupplier[s.id] || null,
    }));

    return res.json(rows);
  } catch (err) {
    console.error('procurement-coordination/suppliers error:', err);
    return res.status(500).json({ error: 'Failed to load suppliers' });
  }
});

// GET /api/fb/procurement-coordination/stats
// Stat cards for the procurement coordination header.
router.get('/procurement-coordination/stats', authenticate, async (_req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  try {
    const { count: openRequisitions } = await supabaseAdmin.from('fb_purchase_orders')
      .select('id', { count: 'exact', head: true })
      .in('status', ['draft', 'submitted']);
    const { count: pendingApproval } = await supabaseAdmin.from('fb_purchase_orders')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'submitted');
    const { count: activeSuppliers } = await supabaseAdmin.from('fb_suppliers')
      .select('id', { count: 'exact', head: true })
      .eq('is_active', true);

    const { data: performance } = await supabaseAdmin.from('fb_supplier_performance').select('supplier_id, average_lead_time, period_start').order('period_start', { ascending: false });
    const seen = new Set<string>();
    let leadSum = 0;
    let leadCount = 0;
    (performance || []).forEach((p: any) => {
      if (!seen.has(p.supplier_id)) {
        seen.add(p.supplier_id);
        leadSum += Number(p.average_lead_time || 0);
        leadCount += 1;
      }
    });
    const avgLeadTime = leadCount > 0 ? leadSum / leadCount : 0;

    return res.json({
      openRequisitions: openRequisitions || 0,
      pendingApproval: pendingApproval || 0,
      activeSuppliers: activeSuppliers || 0,
      avgLeadTimeDays: Number(avgLeadTime.toFixed(1)),
    });
  } catch (err) {
    console.error('procurement-coordination/stats error:', err);
    return res.status(500).json({ error: 'Failed to load stats' });
  }
});

export default router;
