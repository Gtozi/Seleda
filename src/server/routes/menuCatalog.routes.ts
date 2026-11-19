/**
 * Menu Catalog Enhancement Routes
 * Full CRUD for modifier groups/options, availability rules, and digital menus.
 * Linked to the F&B `menu_items` table (text IDs, migration 082).
 */
import { Router } from 'express';
import { authenticate, requirePermission } from '../middleware/auth';
import { hasSupabaseAdminConfig, supabaseAdmin } from '../supabaseAdmin';

const router = Router();

function dbNotConfigured(res: any) {
  return res.status(503).json({ error: 'Database not configured' });
}

// ════════════════════════════════════════════════════════════════════════
// MODIFIER GROUPS
// ════════════════════════════════════════════════════════════════════════
router.get('/modifier-groups', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { outlet_id } = req.query as Record<string, string>;
  let q = supabaseAdmin.from('menu_modifier_groups').select('*').order('sort_order', { ascending: true });
  if (outlet_id) q = q.eq('outlet_id', outlet_id);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

router.post('/modifier-groups', authenticate, requirePermission('fb:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { data, error } = await supabaseAdmin.from('menu_modifier_groups').insert(req.body).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.status(201).json(data);
});

router.put('/modifier-groups/:id', authenticate, requirePermission('fb:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { data, error } = await supabaseAdmin.from('menu_modifier_groups').update(req.body).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

router.delete('/modifier-groups/:id', authenticate, requirePermission('fb:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { error } = await supabaseAdmin.from('menu_modifier_groups').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ success: true });
});

// ════════════════════════════════════════════════════════════════════════
// MODIFIER OPTIONS
// ════════════════════════════════════════════════════════════════════════
router.get('/modifier-options', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { group_id } = req.query as Record<string, string>;
  let q = supabaseAdmin.from('menu_modifier_options').select('*').order('sort_order', { ascending: true });
  if (group_id) q = q.eq('modifier_group_id', group_id);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

router.post('/modifier-options', authenticate, requirePermission('fb:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { data, error } = await supabaseAdmin.from('menu_modifier_options').insert(req.body).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.status(201).json(data);
});

router.put('/modifier-options/:id', authenticate, requirePermission('fb:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { data, error } = await supabaseAdmin.from('menu_modifier_options').update(req.body).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

router.delete('/modifier-options/:id', authenticate, requirePermission('fb:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { error } = await supabaseAdmin.from('menu_modifier_options').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ success: true });
});

// ════════════════════════════════════════════════════════════════════════
// MENU ITEM ↔ MODIFIER GROUP LINKS
// ════════════════════════════════════════════════════════════════════════
router.get('/menu-item-modifiers', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { menu_item_id } = req.query as Record<string, string>;
  let q = supabaseAdmin.from('menu_item_modifier_groups').select('*, modifier_group:menu_modifier_groups(*)');
  if (menu_item_id) q = q.eq('menu_item_id', menu_item_id);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

router.post('/menu-item-modifiers', authenticate, requirePermission('fb:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { data, error } = await supabaseAdmin.from('menu_item_modifier_groups').insert(req.body).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.status(201).json(data);
});

router.delete('/menu-item-modifiers/:id', authenticate, requirePermission('fb:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { error } = await supabaseAdmin.from('menu_item_modifier_groups').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ success: true });
});

// ════════════════════════════════════════════════════════════════════════
// AVAILABILITY RULES
// ════════════════════════════════════════════════════════════════════════
router.get('/availability-rules', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { menu_item_id, outlet_id } = req.query as Record<string, string>;
  let q = supabaseAdmin.from('menu_availability_rules').select('*, menu_item:menu_items(id,name), outlet:outlets(id,name)').order('created_at', { ascending: false });
  if (menu_item_id) q = q.eq('menu_item_id', menu_item_id);
  if (outlet_id) q = q.eq('outlet_id', outlet_id);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

router.post('/availability-rules', authenticate, requirePermission('fb:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { data, error } = await supabaseAdmin.from('menu_availability_rules').insert(req.body).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.status(201).json(data);
});

router.put('/availability-rules/:id', authenticate, requirePermission('fb:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { data, error } = await supabaseAdmin.from('menu_availability_rules').update(req.body).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

router.delete('/availability-rules/:id', authenticate, requirePermission('fb:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { error } = await supabaseAdmin.from('menu_availability_rules').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ success: true });
});

// ════════════════════════════════════════════════════════════════════════
// DIGITAL MENUS
// ════════════════════════════════════════════════════════════════════════
router.get('/digital-menus', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { outlet_id } = req.query as Record<string, string>;
  let q = supabaseAdmin.from('digital_menus').select('*, outlet:outlets(id,name)').order('created_at', { ascending: false });
  if (outlet_id) q = q.eq('outlet_id', outlet_id);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

router.post('/digital-menus', authenticate, requirePermission('fb:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { data, error } = await supabaseAdmin.from('digital_menus').insert(req.body).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.status(201).json(data);
});

router.put('/digital-menus/:id', authenticate, requirePermission('fb:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { data, error } = await supabaseAdmin.from('digital_menus').update(req.body).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

router.delete('/digital-menus/:id', authenticate, requirePermission('fb:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { error } = await supabaseAdmin.from('digital_menus').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ success: true });
});

// ════════════════════════════════════════════════════════════════════════
// DIGITAL MENU ITEMS
// ════════════════════════════════════════════════════════════════════════
router.get('/digital-menu-items', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { digital_menu_id } = req.query as Record<string, string>;
  let q = supabaseAdmin.from('digital_menu_items').select('*, menu_item:menu_items(id,name,category,selling_price,is_active)').order('sort_order', { ascending: true });
  if (digital_menu_id) q = q.eq('digital_menu_id', digital_menu_id);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

router.post('/digital-menu-items', authenticate, requirePermission('fb:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { data, error } = await supabaseAdmin.from('digital_menu_items').insert(req.body).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.status(201).json(data);
});

router.put('/digital-menu-items/:id', authenticate, requirePermission('fb:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { data, error } = await supabaseAdmin.from('digital_menu_items').update(req.body).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

router.delete('/digital-menu-items/:id', authenticate, requirePermission('fb:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { error } = await supabaseAdmin.from('digital_menu_items').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ success: true });
});

// ════════════════════════════════════════════════════════════════════════
// MENU TYPES
// ════════════════════════════════════════════════════════════════════════
router.get('/menu-types', authenticate, async (_req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { data, error } = await supabaseAdmin.from('menu_types').select('*').order('sort_order', { ascending: true });
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

router.post('/menu-types', authenticate, requirePermission('fb:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { data, error } = await supabaseAdmin.from('menu_types').insert(req.body).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.status(201).json(data);
});

router.put('/menu-types/:id', authenticate, requirePermission('fb:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { data, error } = await supabaseAdmin.from('menu_types').update(req.body).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

router.delete('/menu-types/:id', authenticate, requirePermission('fb:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { error } = await supabaseAdmin.from('menu_types').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ success: true });
});

// ════════════════════════════════════════════════════════════════════════
// MENUS (menu collections)
// ════════════════════════════════════════════════════════════════════════
router.get('/menus', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { outlet_id, menu_type_id, is_published } = req.query as Record<string, string>;
  let q = supabaseAdmin.from('menus').select('*, menu_type:menu_types(*), outlet:outlets(*)').order('sort_order', { ascending: true });
  if (outlet_id) q = q.eq('outlet_id', outlet_id);
  if (menu_type_id) q = q.eq('menu_type_id', menu_type_id);
  if (is_published !== undefined) q = q.eq('is_published', is_published === 'true');
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

router.post('/menus', authenticate, requirePermission('fb:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { data, error } = await supabaseAdmin.from('menus').insert(req.body).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.status(201).json(data);
});

router.put('/menus/:id', authenticate, requirePermission('fb:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { data, error } = await supabaseAdmin.from('menus').update(req.body).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

router.patch('/menus/:id', authenticate, requirePermission('fb:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { data, error } = await supabaseAdmin.from('menus').update(req.body).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

router.delete('/menus/:id', authenticate, requirePermission('fb:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { error } = await supabaseAdmin.from('menus').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ success: true });
});

// ════════════════════════════════════════════════════════════════════════
// MENU ITEMS ↔ MENUS LINKS
// ════════════════════════════════════════════════════════════════════════
router.get('/menu-items-menus', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { menu_id, menu_item_id } = req.query as Record<string, string>;
  let q = supabaseAdmin.from('menu_items_menus').select('*, menu:menus(*), menu_item:menu_items(*)').order('display_order', { ascending: true });
  if (menu_id) q = q.eq('menu_id', menu_id);
  if (menu_item_id) q = q.eq('menu_item_id', menu_item_id);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

router.post('/menu-items-menus', authenticate, requirePermission('fb:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { data, error } = await supabaseAdmin.from('menu_items_menus').insert(req.body).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.status(201).json(data);
});

router.put('/menu-items-menus/:id', authenticate, requirePermission('fb:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { data, error } = await supabaseAdmin.from('menu_items_menus').update(req.body).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

router.delete('/menu-items-menus/:id', authenticate, requirePermission('fb:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { error } = await supabaseAdmin.from('menu_items_menus').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ success: true });
});

// Bulk add items to menu
router.post('/menus/:id/items', authenticate, requirePermission('fb:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { items } = req.body || {}; // items: [{menu_item_id, course_name, course_order, override_price, ...}, ...]
  if (!items || !Array.isArray(items)) return res.status(400).json({ error: 'items array required' });
  
  const rows = items.map((item: any) => ({
    menu_id: req.params.id,
    ...item
  }));
  
  const { data, error } = await supabaseAdmin.from('menu_items_menus').insert(rows).select();
  if (error) return res.status(500).json({ error: error.message });
  return res.status(201).json(data);
});

// ════════════════════════════════════════════════════════════════════════
// STATIONS (KDS preparation stations)
// ════════════════════════════════════════════════════════════════════════
router.get('/stations', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { outlet_id, station_type, is_active } = req.query as Record<string, string>;
  let q = supabaseAdmin.from('stations').select('*, outlet:outlets(*)').order('display_order', { ascending: true });
  if (outlet_id) q = q.eq('outlet_id', outlet_id);
  if (station_type) q = q.eq('station_type', station_type);
  if (is_active !== undefined) q = q.eq('is_active', is_active === 'true');
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

router.post('/stations', authenticate, requirePermission('fb:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { data, error } = await supabaseAdmin.from('stations').insert(req.body).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.status(201).json(data);
});

router.put('/stations/:id', authenticate, requirePermission('fb:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { data, error } = await supabaseAdmin.from('stations').update(req.body).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

router.delete('/stations/:id', authenticate, requirePermission('fb:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { error } = await supabaseAdmin.from('stations').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ success: true });
});

// ════════════════════════════════════════════════════════════════════════
// MENU ITEMS ↔ STATIONS LINKS
// ════════════════════════════════════════════════════════════════════════
router.get('/menu-item-stations', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { menu_item_id, station_id } = req.query as Record<string, string>;
  let q = supabaseAdmin.from('menu_item_stations').select('*, station:stations(*), menu_item:menu_items(*)').order('display_order', { ascending: true });
  if (menu_item_id) q = q.eq('menu_item_id', menu_item_id);
  if (station_id) q = q.eq('station_id', station_id);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

router.post('/menu-item-stations', authenticate, requirePermission('fb:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { data, error } = await supabaseAdmin.from('menu_item_stations').insert(req.body).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.status(201).json(data);
});

router.put('/menu-item-stations/:id', authenticate, requirePermission('fb:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { data, error } = await supabaseAdmin.from('menu_item_stations').update(req.body).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

router.delete('/menu-item-stations/:id', authenticate, requirePermission('fb:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { error } = await supabaseAdmin.from('menu_item_stations').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ success: true });
});

// Bulk set stations for a menu item
router.post('/menu-items/:id/stations', authenticate, requirePermission('fb:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { stations } = req.body || {}; // stations: [{station_id, is_primary, preparation_time_minutes, ...}, ...]
  if (!stations || !Array.isArray(stations)) return res.status(400).json({ error: 'stations array required' });
  
  // First, delete existing station links for this menu item
  await supabaseAdmin.from('menu_item_stations').delete().eq('menu_item_id', req.params.id);
  
  const rows = stations.map((item: any) => ({
    menu_item_id: req.params.id,
    ...item
  }));
  
  if (rows.length > 0) {
    const { data, error } = await supabaseAdmin.from('menu_item_stations').insert(rows).select();
    if (error) return res.status(500).json({ error: error.message });
    return res.status(201).json(data);
  }
  return res.json({ success: true });
});

// ════════════════════════════════════════════════════════════════════════
// MENU ITEMS ↔ OUTLETS LINKS (multiple outlets per item)
// ════════════════════════════════════════════════════════════════════════
router.get('/menu-item-outlets', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { menu_item_id, outlet_id } = req.query as Record<string, string>;
  let q = supabaseAdmin.from('menu_item_outlets').select('*');
  if (menu_item_id) q = q.eq('menu_item_id', menu_item_id);
  if (outlet_id) q = q.eq('outlet_id', outlet_id);
  const { data: links, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  // Fetch outlets separately and join in JS (schema cache is unreliable)
  const { data: outlets, error: oErr } = await supabaseAdmin.from('outlets').select('*');
  if (oErr) return res.status(500).json({ error: oErr.message });
  const outletMap = new Map((outlets || []).map((o: any) => [o.id, o]));
  const result = (links || []).map((link: any) => ({
    ...link,
    outlet: outletMap.get(link.outlet_id) || null,
  }));
  return res.json(result);
});

router.post('/menu-item-outlets', authenticate, requirePermission('fb:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { data, error } = await supabaseAdmin.from('menu_item_outlets').insert(req.body).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.status(201).json(data);
});

router.delete('/menu-item-outlets/:id', authenticate, requirePermission('fb:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { error } = await supabaseAdmin.from('menu_item_outlets').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ success: true });
});

// Bulk set outlets for a menu item
router.post('/menu-items/:id/outlets', authenticate, requirePermission('fb:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { outlets } = req.body || {}; // outlets: [{outlet_id, is_primary}, ...]
  if (!outlets || !Array.isArray(outlets)) return res.status(400).json({ error: 'outlets array required' });
  
  // First, delete existing outlet links for this menu item
  await supabaseAdmin.from('menu_item_outlets').delete().eq('menu_item_id', req.params.id);
  
  const rows = outlets.map((item: any) => ({
    menu_item_id: req.params.id,
    ...item
  }));
  
  if (rows.length > 0) {
    const { data, error } = await supabaseAdmin.from('menu_item_outlets').insert(rows).select();
    if (error) return res.status(500).json({ error: error.message });
    return res.status(201).json(data);
  }
  return res.json({ success: true });
});

export default router;
