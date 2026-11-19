import { Router } from 'express';
import { authenticate, requirePermission } from '../middleware/auth';
import { hasSupabaseAdminConfig, supabaseAdmin } from '../supabaseAdmin';
import { cacheService } from '../services/cacheService';
import { twinWriteProcRequisition } from '../services/procurementIntegration';
import { HK_STORE_ID, HK_LINEN_STORE_ID, MAIN_STORE_ID, FB_BEV_STORE_ID, FB_FOOD_STORE_ID } from '../config/storeIds';

const router = Router();

function dbNotConfigured(res: any) {
  return res.status(503).json({ error: 'Database not configured' });
}

// Canonical room statuses that are persisted to the rooms.status column.
// Housekeeping-specific statuses (Inspected, Ready, Pickup, Sleep-Out,
// Do Not Disturb, Maintenance Required, Out of Service) are persisted to
// housekeeping_room_extras.hk_status instead, since rooms.status has a
// CHECK constraint that only allows the canonical set.
const CANONICAL_ROOM_STATUSES = new Set([
  'Vacant Clean', 'Vacant Dirty', 'Occupied Clean', 'Occupied Dirty',
  'Out of Order', 'Maintenance', 'House Use', 'Blocked',
]);

// Map housekeeping-only statuses to the closest canonical rooms.status value
// so the rest of the ERP (front desk, dashboards) stays roughly in sync.
const HK_STATUS_TO_CANONICAL: Record<string, string> = {
  'Maintenance Required': 'Maintenance',
  'Out of Service': 'Out of Order',
};

// ── Rooms Board: real-time room matrix for the Housekeeping portal ─────
// Returns rooms merged with housekeeping extras (dnd, last cleaned, inspected,
// housekeeper, arrival/departure, hk_status), staff with their assigned rooms,
// and the priority queue — all in a single round-trip.
router.get('/rooms-board/:propertyId', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const { propertyId } = req.params;

  const cacheKey = `hk-rooms-board:${propertyId}`;
  const cached = cacheService.get(cacheKey);
  if (cached) return res.json(cached);

  // Fetch rooms for this property. If the property has no rooms (e.g. a new
  // branch without room data yet), fall back to ALL rooms — this mirrors the
  // front office's behavior where it shows mock/initial rooms when the DB
  // query returns empty, so both portals stay in sync.
  let roomsRes = await supabaseAdmin
    .from('rooms')
    .select('id, number, type, floor, status, rate, room_type_id')
    .eq('property_id', propertyId)
    .order('number');

  if (!roomsRes.error && (!roomsRes.data || roomsRes.data.length === 0)) {
    roomsRes = await supabaseAdmin
      .from('rooms')
      .select('id, number, type, floor, status, rate, room_type_id')
      .order('number');
  }

  // Determine which property_id to use for housekeeping extras/staff/assignments.
  // If we fell back to all rooms, use the property_id that actually has extras,
  // or the first property that has rooms.
  let effectivePropertyId = propertyId;
  if (!roomsRes.error && roomsRes.data && roomsRes.data.length > 0) {
    const firstRoom = roomsRes.data[0];
    if (firstRoom.property_id && firstRoom.property_id !== propertyId) {
      effectivePropertyId = firstRoom.property_id;
    }
  }

  const [extrasRes, staffRes, assignmentsRes, priorityRes] = await Promise.all([
    supabaseAdmin.from('housekeeping_room_extras').select('*').eq('property_id', effectivePropertyId),
    supabaseAdmin.from('housekeeping_staff').select('*').eq('property_id', effectivePropertyId).eq('is_active', true).order('name'),
    supabaseAdmin.from('housekeeping_assignments').select('staff_id, room_number').eq('property_id', effectivePropertyId),
    supabaseAdmin.from('housekeeping_priority_queue').select('room_number').eq('property_id', effectivePropertyId),
  ]);

  if (roomsRes.error) return res.status(500).json({ error: roomsRes.error.message });
  if (extrasRes.error) return res.status(500).json({ error: extrasRes.error.message });
  if (staffRes.error) return res.status(500).json({ error: staffRes.error.message });
  if (assignmentsRes.error) return res.status(500).json({ error: assignmentsRes.error.message });
  if (priorityRes.error) return res.status(500).json({ error: priorityRes.error.message });

  const extrasByRoom: Record<string, any> = {};
  (extrasRes.data || []).forEach((e: any) => {
    extrasByRoom[e.room_number] = {
      dnd: !!e.dnd,
      lastCleaned: e.last_cleaned || 'N/A',
      lastInspected: e.last_inspected || 'N/A',
      housekeeperId: e.housekeeper_id || null,
      arrival: e.arrival || null,
      departure: e.departure || null,
      hkStatus: e.hk_status || null,
    };
  });

  const assignedRoomsByStaff: Record<string, string[]> = {};
  (assignmentsRes.data || []).forEach((a: any) => {
    if (!assignedRoomsByStaff[a.staff_id]) assignedRoomsByStaff[a.staff_id] = [];
    assignedRoomsByStaff[a.staff_id].push(a.room_number);
  });

  const staff = (staffRes.data || []).map((s: any) => ({
    id: s.id,
    name: s.name,
    avatar: s.avatar || s.name.split(' ').map((p: string) => p[0]).join('').slice(0, 2).toUpperCase(),
    status: s.status,
    solvedToday: s.solved_today || 0,
    qualityScore: s.quality_score || 0,
    assignedRooms: assignedRoomsByStaff[s.id] || [],
  }));

  const rooms = (roomsRes.data || []).map((r: any) => {
    const ex = extrasByRoom[r.number] || {};
    return {
      id: r.id,
      number: r.number,
      type: r.type,
      floor: r.floor,
      rate: r.rate,
      // Housekeeping status override takes precedence over the canonical
      // rooms.status so the board reflects Inspected/Pickup/DND etc.
      status: ex.hkStatus || r.status,
      canonicalStatus: r.status,
      dnd: ex.dnd || false,
      lastCleaned: ex.lastCleaned || 'N/A',
      lastInspected: ex.lastInspected || 'N/A',
      housekeeperId: ex.housekeeperId || null,
      arrival: ex.arrival || null,
      departure: ex.departure || null,
    };
  });

  const priorityQueue = (priorityRes.data || []).map((p: any) => p.room_number);

  const result = {
    propertyId: effectivePropertyId,
    rooms,
    staff,
    priorityQueue,
    generatedAt: new Date().toISOString(),
  };

  cacheService.set(cacheKey, result, 30 * 1000); // short TTL — board is interactive
  return res.json(result);
});

// Toggle a room in/out of the housekeeping priority queue.
router.post('/rooms-board/priority', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const { propertyId, roomNumber, action } = req.body || {};
  if (!propertyId || !roomNumber || !action) {
    return res.status(400).json({ error: 'propertyId, roomNumber, and action are required' });
  }

  if (action === 'add') {
    const { error } = await supabaseAdmin
      .from('housekeeping_priority_queue')
      .upsert({ property_id: propertyId, room_number: roomNumber, created_by: req.user?.id }, { onConflict: 'property_id,room_number' });
    if (error) return res.status(500).json({ error: error.message });
  } else if (action === 'remove') {
    const { error } = await supabaseAdmin
      .from('housekeeping_priority_queue')
      .delete()
      .eq('property_id', propertyId)
      .eq('room_number', roomNumber);
    if (error) return res.status(500).json({ error: error.message });
  } else {
    return res.status(400).json({ error: 'action must be "add" or "remove"' });
  }

  cacheService.invalidatePattern('^hk-rooms-board:');
  return res.json({ success: true, roomNumber, action });
});

// Assign a room to a housekeeping staff member. Any other staff currently
// assigned to that room are removed first (a room has at most one
// housekeeper). Pass staffId = null to unassign.
router.post('/rooms-board/assign', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const { propertyId, staffId, roomNumber } = req.body || {};
  if (!propertyId || !roomNumber) {
    return res.status(400).json({ error: 'propertyId and roomNumber are required' });
  }

  // Remove existing assignments for this room.
  const { error: delError } = await supabaseAdmin
    .from('housekeeping_assignments')
    .delete()
    .eq('property_id', propertyId)
    .eq('room_number', roomNumber);
  if (delError) return res.status(500).json({ error: delError.message });

  if (staffId) {
    const { error: insError } = await supabaseAdmin
      .from('housekeeping_assignments')
      .insert({ property_id: propertyId, staff_id: staffId, room_number: roomNumber });
    if (insError) return res.status(500).json({ error: insError.message });

    // Reflect the assignment on the room extras record too.
    await supabaseAdmin
      .from('housekeeping_room_extras')
      .upsert({ property_id: propertyId, room_number: roomNumber, housekeeper_id: staffId, updated_at: new Date().toISOString() }, { onConflict: 'property_id,room_number' });
  } else {
    await supabaseAdmin
      .from('housekeeping_room_extras')
      .upsert({ property_id: propertyId, room_number: roomNumber, housekeeper_id: null, updated_at: new Date().toISOString() }, { onConflict: 'property_id,room_number' });
  }

  cacheService.invalidatePattern('^hk-rooms-board:');
  return res.json({ success: true, roomNumber, staffId });
});

// Update a room's housekeeping status. Persists hk_status to extras and, when
// the status is canonical (or maps to one), also updates rooms.status so the
// rest of the ERP stays in sync. Optionally stamps last_cleaned/last_inspected.
router.put('/rooms-board/room-status', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const { propertyId, roomNumber, status, lastCleaned, lastInspected, clearDnd } = req.body || {};
  if (!propertyId || !roomNumber || !status) {
    return res.status(400).json({ error: 'propertyId, roomNumber, and status are required' });
  }

  const now = new Date().toISOString();
  const extrasUpdate: any = { property_id: propertyId, room_number: roomNumber, hk_status: status, updated_at: now };
  if (lastCleaned !== undefined) extrasUpdate.last_cleaned = lastCleaned;
  if (lastInspected !== undefined) extrasUpdate.last_inspected = lastInspected;
  if (clearDnd) extrasUpdate.dnd = false;

  const { error: extrasError } = await supabaseAdmin
    .from('housekeeping_room_extras')
    .upsert(extrasUpdate, { onConflict: 'property_id,room_number' });
  if (extrasError) return res.status(500).json({ error: extrasError.message });

  // Sync canonical rooms.status when applicable.
  const canonical = CANONICAL_ROOM_STATUSES.has(status) ? status : HK_STATUS_TO_CANONICAL[status];
  if (canonical) {
    const { error: roomError } = await supabaseAdmin
      .from('rooms')
      .update({ status: canonical, updated_at: now })
      .eq('property_id', propertyId)
      .eq('number', roomNumber);
    if (roomError) return res.status(500).json({ error: roomError.message });
  }

  cacheService.invalidatePattern('^hk-rooms-board:');
  return res.json({ success: true, roomNumber, status });
});

// Dispatch a maintenance issue for a room: sets the housekeeping status to
// 'Maintenance Required' (and rooms.status to 'Maintenance') and records the
// report details on the extras row.
router.post('/rooms-board/maintenance', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const { propertyId, roomNumber, issueType, notes } = req.body || {};
  if (!propertyId || !roomNumber) {
    return res.status(400).json({ error: 'propertyId and roomNumber are required' });
  }

  const now = new Date().toISOString();
  const { error: extrasError } = await supabaseAdmin
    .from('housekeeping_room_extras')
    .upsert({
      property_id: propertyId,
      room_number: roomNumber,
      hk_status: 'Maintenance Required',
      updated_at: now,
    }, { onConflict: 'property_id,room_number' });
  if (extrasError) return res.status(500).json({ error: extrasError.message });

  const { error: roomError } = await supabaseAdmin
    .from('rooms')
    .update({ status: 'Maintenance', updated_at: now })
    .eq('property_id', propertyId)
    .eq('number', roomNumber);
  if (roomError) return res.status(500).json({ error: roomError.message });

  cacheService.invalidatePattern('^hk-rooms-board:');
  return res.json({ success: true, roomNumber, issueType, notes });
});

// ── Phase 1: Enhanced Task Management with Scheduling Optimization ─────
// Create or update housekeeping task
router.post('/tasks', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  
  const {
    propertyId,
    roomId,
    taskType,
    category,
    location,
    priority,
    scheduledTime,
    dueDate,
    assignedTo,
    estimatedDuration,
    notes,
  } = req.body || {};

  if (!propertyId || !taskType) {
    return res.status(400).json({ error: 'propertyId and taskType are required' });
  }

  const { data, error } = await supabaseAdmin.from('housekeeping_tasks').insert({
    property_id: propertyId,
    room_id: roomId || null,
    task_type: taskType,
    category: category || 'Manual',
    location: location || null,
    priority: priority || 'medium',
    scheduled_time: scheduledTime,
    due_date: dueDate || null,
    assigned_to: assignedTo || null,
    estimated_duration: estimatedDuration || 30,
    notes,
    status: 'pending',
    created_by: req.user?.id,
    created_at: new Date().toISOString(),
  }).select().single();

  if (error) return res.status(500).json({ error: error.message });

  cacheService.invalidate('hk-*');
  return res.status(201).json(data);
});

// Get tasks with filtering
router.get('/tasks/:propertyId', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  
  const { status, assignedTo, taskType, date } = req.query as Record<string, string>;
  
  const cacheKey = `hk-tasks:${req.params.propertyId}:${status || 'all'}:${assignedTo || 'all'}:${taskType || 'all'}:${date || 'all'}`;
  const cached = cacheService.get(cacheKey);
  if (cached) return res.json(cached);

  let q = supabaseAdmin
    .from('housekeeping_tasks')
    .select('*, rooms!housekeeping_tasks_room_id_fkey(number, floor), housekeeping_staff!housekeeping_tasks_assigned_to_fkey(id, name)')
    .eq('property_id', req.params.propertyId)
    .order('scheduled_time', { ascending: true });

  if (status) q = q.eq('status', status);
  if (assignedTo) q = q.eq('assigned_to', assignedTo);
  if (taskType) q = q.eq('task_type', taskType);
  if (date) q = q.like('scheduled_time', `${date}%`);

  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });

  const result = {
    propertyId: req.params.propertyId,
    tasks: data || [],
    summary: {
      total: (data || []).length,
      pending: (data || []).filter(t => t.status === 'pending').length,
      inProgress: (data || []).filter(t => t.status === 'in_progress').length,
      completed: (data || []).filter(t => t.status === 'completed').length,
    },
  };

  cacheService.set(cacheKey, result, 5 * 60 * 1000);
  return res.json(result);
});

// Update task status / progress / assignment
router.put('/tasks/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const { status, progress, assignedTo, priority, notes, actualDuration, completedAt } = req.body || {};

  const update: any = { updated_at: new Date().toISOString() };
  if (status !== undefined) {
    update.status = status;
    // Auto-stamp completed_at and progress when transitioning to completed/verified
    if (status === 'completed' || status === 'verified') {
      update.completed_at = completedAt || new Date().toISOString();
      if (progress === undefined) update.progress = 100;
    }
  }
  if (progress !== undefined) update.progress = progress;
  if (assignedTo !== undefined) update.assigned_to = assignedTo;
  if (priority !== undefined) update.priority = priority;
  if (notes !== undefined) update.notes = notes;
  if (actualDuration !== undefined) update.actual_duration = actualDuration;

  const { data, error } = await supabaseAdmin
    .from('housekeeping_tasks')
    .update(update)
    .eq('id', req.params.id)
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });

  cacheService.invalidate('hk-*');
  return res.json(data);
});

// ── AI-Powered Room Assignment Based on Location and Staff Skills ─────
// Get AI-powered room assignments
router.get('/assignments/ai/:propertyId', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  
  const { date } = req.query as Record<string, string>;
  
  const cacheKey = `hk-assignments-ai:${req.params.propertyId}:${date || new Date().toISOString().split('T')[0]}`;
  const cached = cacheService.get(cacheKey);
  if (cached) return res.json(cached);

  const targetDate = date || new Date().toISOString().split('T')[0];
  const assignments = await generateAIAssignments(req.params.propertyId, targetDate);

  const result = {
    propertyId: req.params.propertyId,
    date: targetDate,
    assignments,
    summary: {
      totalRooms: assignments.length,
      assignedStaff: [...new Set(assignments.map(a => a.assignedTo))].length,
      avgTasksPerStaff: assignments.length / ([...new Set(assignments.map(a => a.assignedTo))].length || 1),
    },
    generatedAt: new Date().toISOString(),
  };

  cacheService.set(cacheKey, result, 15 * 60 * 1000);
  return res.json(result);
});

async function generateAIAssignments(propertyId: string, date: string) {
  // Get pending tasks for the date
  const { data: tasks } = await supabaseAdmin
    .from('housekeeping_tasks')
    .select('*, rooms(room_number, floor, building)')
    .eq('property_id', propertyId)
    .like('scheduled_time', `${date}%`)
    .eq('status', 'pending');

  // Get available staff with their skills and location
  const { data: staff } = await supabaseAdmin
    .from('profiles')
    .select('*')
    .eq('property_id', propertyId)
    .eq('role', 'housekeeping')
    .eq('is_active', true);

  const assignments = [];

  // Simple AI assignment logic
  const staffByFloor = groupStaffByFloor(staff || []);
  const tasksByFloor = groupTasksByFloor(tasks || []);

  for (const [floor, floorTasks] of Object.entries(tasksByFloor)) {
    const floorStaff = staffByFloor[floor] || staffByFloor['default'] || [];
    const tasksPerStaff = Math.ceil(floorTasks.length / (floorStaff.length || 1));

    floorTasks.forEach((task, index) => {
      const assignedStaff = floorStaff[index % floorStaff.length];
      assignments.push({
        taskId: task.id,
        roomId: task.room_id,
        roomNumber: task.rooms?.room_number,
        floor: task.rooms?.floor,
        taskType: task.task_type,
        priority: task.priority,
        assignedTo: assignedStaff?.id,
        assignedStaffName: assignedStaff?.full_name,
        assignedStaffSkills: assignedStaff?.skills || [],
        reason: 'Location-based assignment',
        estimatedDuration: task.estimated_duration,
        scheduledTime: task.scheduled_time,
      });
    });
  }

  return assignments;
}

function groupStaffByFloor(staff: any[]) {
  const grouped: Record<string, any[]> = { default: staff };
  staff.forEach(s => {
    const floor = s.preferred_floor || 'default';
    if (!grouped[floor]) grouped[floor] = [];
    grouped[floor].push(s);
  });
  return grouped;
}

function groupTasksByFloor(tasks: any[]) {
  const grouped: Record<string, any[]> = {};
  tasks.forEach(t => {
    const floor = t.rooms?.floor || 'default';
    if (!grouped[floor]) grouped[floor] = [];
    grouped[floor].push(t);
  });
  return grouped;
}

// ── Route Planning for Attendants ───────────────────────────────────────
// Get optimized route for attendant
router.get('/routes/:propertyId/:attendantId', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  
  const { date } = req.query as Record<string, string>;
  
  const cacheKey = `hk-routes:${req.params.propertyId}:${req.params.attendantId}:${date || new Date().toISOString().split('T')[0]}`;
  const cached = cacheService.get(cacheKey);
  if (cached) return res.json(cached);

  const targetDate = date || new Date().toISOString().split('T')[0];
  const route = await generateOptimizedRoute(req.params.propertyId, req.params.attendantId, targetDate);

  const result = {
    propertyId: req.params.propertyId,
    attendantId: req.params.attendantId,
    date: targetDate,
    route,
    summary: {
      totalTasks: route.length,
      totalEstimatedTime: route.reduce((sum, r) => sum + r.estimatedDuration, 0),
      totalDistance: calculateTotalDistance(route),
    },
    generatedAt: new Date().toISOString(),
  };

  cacheService.set(cacheKey, result, 30 * 60 * 1000);
  return res.json(result);
});

async function generateOptimizedRoute(propertyId: string, attendantId: string, date: string) {
  const { data: tasks } = await supabaseAdmin
    .from('housekeeping_tasks')
    .select('*, rooms(room_number, floor, building, x_coordinate, y_coordinate)')
    .eq('property_id', propertyId)
    .eq('assigned_to', attendantId)
    .like('scheduled_time', `${date}%`)
    .eq('status', 'pending')
    .order('priority', { ascending: false });

  // Simple nearest-neighbor route optimization
  const route = [];
  const remaining = [...(tasks || [])];
  let current = null;

  while (remaining.length > 0) {
    let nearest = null;
    let minDist = Infinity;

    for (const task of remaining) {
      const dist = current ? calculateDistance(current, task) : 0;
      if (dist < minDist) {
        minDist = dist;
        nearest = task;
      }
    }

    if (nearest) {
      route.push({
        taskId: nearest.id,
        roomId: nearest.room_id,
        roomNumber: nearest.rooms?.room_number,
        floor: nearest.rooms?.floor,
        building: nearest.rooms?.building,
        taskType: nearest.task_type,
        priority: nearest.priority,
        estimatedDuration: nearest.estimatedDuration,
        scheduledTime: nearest.scheduled_time,
        sequence: route.length + 1,
        distanceFromPrevious: minDist,
      });
      current = nearest;
      remaining.splice(remaining.indexOf(nearest), 1);
    }
  }

  return route;
}

function calculateDistance(task1: any, task2: any) {
  const x1 = task1.rooms?.x_coordinate || 0;
  const y1 = task1.rooms?.y_coordinate || 0;
  const x2 = task2.rooms?.x_coordinate || 0;
  const y2 = task2.rooms?.y_coordinate || 0;
  return Math.sqrt(Math.pow(x2 - x1, 2) + Math.pow(y2 - y1, 2));
}

function calculateTotalDistance(route: any[]) {
  let total = 0;
  for (let i = 1; i < route.length; i++) {
    total += route[i].distanceFromPrevious || 0;
  }
  return total;
}

// ── Workload Balancing ─────────────────────────────────────────────────
// Get workload balance across staff
router.get('/workload/:propertyId', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  
  const { date } = req.query as Record<string, string>;
  
  const cacheKey = `hk-workload:${req.params.propertyId}:${date || new Date().toISOString().split('T')[0]}`;
  const cached = cacheService.get(cacheKey);
  if (cached) return res.json(cached);

  const targetDate = date || new Date().toISOString().split('T')[0];
  const workload = await calculateWorkloadBalance(req.params.propertyId, targetDate);

  const result = {
    propertyId: req.params.propertyId,
    date: targetDate,
    workload,
    summary: {
      avgTasksPerStaff: workload.reduce((sum, w) => sum + w.taskCount, 0) / (workload.length || 1),
      maxTasks: Math.max(...workload.map(w => w.taskCount)),
      minTasks: Math.min(...workload.map(w => w.taskCount)),
      imbalanceFactor: calculateImbalanceFactor(workload),
    },
    generatedAt: new Date().toISOString(),
  };

  cacheService.set(cacheKey, result, 10 * 60 * 1000);
  return res.json(result);
});

async function calculateWorkloadBalance(propertyId: string, date: string) {
  const { data: staff } = await supabaseAdmin
    .from('profiles')
    .select('*')
    .eq('property_id', propertyId)
    .eq('role', 'housekeeping')
    .eq('is_active', true);

  const workload = [];

  for (const attendant of staff || []) {
    const { data: tasks } = await supabaseAdmin
      .from('housekeeping_tasks')
      .select('*')
      .eq('property_id', propertyId)
      .eq('assigned_to', attendant.id)
      .like('scheduled_time', `${date}%`)
      .in('status', ['pending', 'in_progress']);

    workload.push({
      attendantId: attendant.id,
      attendantName: attendant.full_name,
      taskCount: (tasks || []).length,
      totalEstimatedTime: (tasks || []).reduce((sum, t) => sum + (t.estimated_duration || 0), 0),
      highPriorityTasks: (tasks || []).filter(t => t.priority === 'high').length,
      status: 'balanced',
    });
  }

  // Mark imbalanced workloads
  const avgTasks = workload.reduce((sum, w) => sum + w.taskCount, 0) / (workload.length || 1);
  workload.forEach(w => {
    if (w.taskCount > avgTasks * 1.3) w.status = 'overloaded';
    else if (w.taskCount < avgTasks * 0.7) w.status = 'underloaded';
  });

  return workload;
}

function calculateImbalanceFactor(workload: any[]): number {
  if (workload.length === 0) return 0;
  const avg = workload.reduce((sum, w) => sum + w.taskCount, 0) / workload.length;
  const variance = workload.reduce((sum, w) => sum + Math.pow(w.taskCount - avg, 2), 0) / workload.length;
  return Math.sqrt(variance) / (avg || 1);
}

// ── Priority-Based Task Queuing ────────────────────────────────────────
// Get prioritized task queue
router.get('/queue/:propertyId', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  
  const { taskType } = req.query as Record<string, string>;
  
  const cacheKey = `hk-queue:${req.params.propertyId}:${taskType || 'all'}`;
  const cached = cacheService.get(cacheKey);
  if (cached) return res.json(cached);

  let q = supabaseAdmin
    .from('housekeeping_tasks')
    .select('*, rooms!housekeeping_tasks_room_id_fkey(number, floor), housekeeping_staff!housekeeping_tasks_assigned_to_fkey(id, name)')
    .eq('property_id', req.params.propertyId)
    .in('status', ['pending', 'in_progress'])
    .order('priority', { ascending: false })
    .order('scheduled_time', { ascending: true });

  if (taskType) q = q.eq('task_type', taskType);

  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });

  const queue = (data || []).map((task, index) => ({
    ...task,
    queuePosition: index + 1,
    urgencyScore: calculateUrgencyScore(task),
  }));

  const result = {
    propertyId: req.params.propertyId,
    queue,
    summary: {
      total: queue.length,
      highPriority: queue.filter(t => t.priority === 'high').length,
      mediumPriority: queue.filter(t => t.priority === 'medium').length,
      lowPriority: queue.filter(t => t.priority === 'low').length,
    },
    generatedAt: new Date().toISOString(),
  };

  cacheService.set(cacheKey, result, 2 * 60 * 1000);
  return res.json(result);
});

function calculateUrgencyScore(task: any): number {
  let score = 0;
  
  // Priority points
  if (task.priority === 'high') score += 100;
  else if (task.priority === 'medium') score += 50;
  else score += 25;

  // Time-based urgency
  const now = new Date();
  const scheduled = new Date(task.scheduled_time);
  const hoursUntil = (scheduled.getTime() - now.getTime()) / (1000 * 60 * 60);
  
  if (hoursUntil < 2) score += 50;
  else if (hoursUntil < 4) score += 30;
  else if (hoursUntil < 8) score += 10;

  return score;
}

// ── Phase 2: Mobile Housekeeping App Endpoints ─────────────────────────
// Get mobile-optimized task list
router.get('/mobile/tasks/:attendantId', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  
  const cacheKey = `hk-mobile-tasks:${req.params.attendantId}`;
  const cached = cacheService.get(cacheKey);
  if (cached) return res.json(cached);

  const { data, error } = await supabaseAdmin
    .from('housekeeping_tasks')
    .select('*, rooms(room_number, floor, building, amenities)')
    .eq('assigned_to', req.params.attendantId)
    .in('status', ['pending', 'in_progress'])
    .order('priority', { ascending: false })
    .order('scheduled_time', { ascending: true });

  if (error) return res.status(500).json({ error: error.message });

  const result = {
    attendantId: req.params.attendantId,
    tasks: data || [],
    summary: {
      total: (data || []).length,
      pending: (data || []).filter(t => t.status === 'pending').length,
      inProgress: (data || []).filter(t => t.status === 'in_progress').length,
    },
  };

  cacheService.set(cacheKey, result, 1 * 60 * 1000);
  return res.json(result);
});

// Update room status from mobile
router.post('/mobile/room-status', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  
  const { roomId, status, attendantId, notes, photos } = req.body || {};
  
  if (!roomId || !status || !attendantId) {
    return res.status(400).json({ error: 'roomId, status, and attendantId are required' });
  }

  // Update room status
  const { data: room, error: roomError } = await supabaseAdmin
    .from('rooms')
    .update({ 
      status,
      updated_at: new Date().toISOString(),
    })
    .eq('id', roomId)
    .select()
    .single();

  if (roomError) return res.status(500).json({ error: roomError.message });

  // Update task status
  const { data: task, error: taskError } = await supabaseAdmin
    .from('housekeeping_tasks')
    .update({
      status: status === 'clean' ? 'completed' : 'in_progress',
      notes,
      completed_at: status === 'clean' ? new Date().toISOString() : null,
      photos,
      updated_at: new Date().toISOString(),
    })
    .eq('room_id', roomId)
    .eq('assigned_to', attendantId)
    .in('status', ['pending', 'in_progress'])
    .select()
    .single();

  cacheService.invalidate('hk-*');
  return res.json({ room, task });
});

// ── Quality Management System with Digital Checklists ─────────────────
// Get quality checklists
router.get('/quality/checklists/:propertyId', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  
  const { taskType } = req.query as Record<string, string>;
  
  let q = supabaseAdmin
    .from('quality_checklists')
    .select('*')
    .eq('property_id', req.params.propertyId)
    .eq('is_active', true);
  
  if (taskType) q = q.eq('task_type', taskType);
  
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });

  return res.json({
    propertyId: req.params.propertyId,
    checklists: data || [],
  });
});

// Submit quality inspection
router.post('/quality/inspections', authenticate, requirePermission('hk:quality:manage'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  
  const {
    propertyId,
    roomId,
    checklistId,
    inspectorId,
    items,
    photos,
    overallScore,
    notes,
  } = req.body || {};
  
  if (!propertyId || !roomId || !checklistId || !inspectorId || !items) {
    return res.status(400).json({ error: 'propertyId, roomId, checklistId, inspectorId, and items are required' });
  }

  const { data, error } = await supabaseAdmin.from('quality_inspections').insert({
    property_id: propertyId,
    room_id: roomId,
    checklist_id: checklistId,
    inspector_id: inspectorId,
    items,
    photos,
    overall_score: overallScore,
    notes,
    inspection_date: new Date().toISOString(),
    created_at: new Date().toISOString(),
  }).select().single();

  if (error) return res.status(500).json({ error: error.message });

  cacheService.invalidate('hk-*');
  return res.status(201).json(data);
});

// Get quality inspections
router.get('/quality/inspections/:propertyId', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  
  const { roomId, inspectorId, startDate, endDate } = req.query as Record<string, string>;
  
  let q = supabaseAdmin
    .from('quality_inspections')
    .select('*, rooms(room_number), profiles(full_name)')
    .eq('property_id', req.params.propertyId)
    .order('inspection_date', { ascending: false });

  if (roomId) q = q.eq('room_id', roomId);
  if (inspectorId) q = q.eq('inspector_id', inspectorId);
  if (startDate) q = q.gte('inspection_date', startDate);
  if (endDate) q = q.lte('inspection_date', endDate);

  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });

  return res.json({
    propertyId: req.params.propertyId,
    inspections: data || [],
  });
});

// ── Quality Scoring ─────────────────────────────────────────────────────
// Get quality scores summary
router.get('/quality/scores/:propertyId', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  
  const { period } = req.query as Record<string, string>;
  
  const cacheKey = `hk-quality-scores:${req.params.propertyId}:${period || 'month'}`;
  const cached = cacheService.get(cacheKey);
  if (cached) return res.json(cached);

  const days = period === 'quarter' ? 90 : period === 'year' ? 365 : 30;
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);

  const { data: inspections } = await supabaseAdmin
    .from('quality_inspections')
    .select('*')
    .eq('property_id', req.params.propertyId)
    .gte('inspection_date', startDate.toISOString());

  const scores = calculateQualityScores(inspections || []);

  const result = {
    propertyId: req.params.propertyId,
    period: days,
    scores,
    generatedAt: new Date().toISOString(),
  };

  cacheService.set(cacheKey, result, 30 * 60 * 1000);
  return res.json(result);
});

function calculateQualityScores(inspections: any[]) {
  if (inspections.length === 0) {
    return { averageScore: 0, totalInspections: 0, passingRate: 0 };
  }

  const averageScore = inspections.reduce((sum, i) => sum + (i.overall_score || 0), 0) / inspections.length;
  const passingInspections = inspections.filter(i => (i.overall_score || 0) >= 80).length;

  return {
    averageScore: Math.round(averageScore * 10) / 10,
    totalInspections: inspections.length,
    passingRate: (passingInspections / inspections.length) * 100,
    byInspector: groupScoresByInspector(inspections),
  };
}

function groupScoresByInspector(inspections: any[]) {
  const grouped: Record<string, any[]> = {};
  inspections.forEach(i => {
    const inspectorId = i.inspector_id;
    if (!grouped[inspectorId]) grouped[inspectorId] = [];
    grouped[inspectorId].push(i);
  });

  return Object.entries(grouped).map(([inspectorId, insp]) => ({
    inspectorId,
    averageScore: insp.reduce((sum, i) => sum + (i.overall_score || 0), 0) / insp.length,
    totalInspections: insp.length,
  }));
}

// ── Trend Analysis and Coaching ────────────────────────────────────────
// Get quality trends
router.get('/quality/trends/:propertyId', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  
  const { days } = req.query as Record<string, string>;
  
  const cacheKey = `hk-quality-trends:${req.params.propertyId}:${days || '30'}`;
  const cached = cacheService.get(cacheKey);
  if (cached) return res.json(cached);

  const dayCount = parseInt(days) || 30;
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - dayCount);

  const { data: inspections } = await supabaseAdmin
    .from('quality_inspections')
    .select('*')
    .eq('property_id', req.params.propertyId)
    .gte('inspection_date', startDate.toISOString());

  const trends = calculateQualityTrends(inspections || [], dayCount);

  const result = {
    propertyId: req.params.propertyId,
    days: dayCount,
    trends,
    generatedAt: new Date().toISOString(),
  };

  cacheService.set(cacheKey, result, 30 * 60 * 1000);
  return res.json(result);
});

function calculateQualityTrends(inspections: any[], days: number) {
  const trends = [];
  const currentDate = new Date();

  for (let i = days; i >= 0; i--) {
    const date = new Date(currentDate);
    date.setDate(date.getDate() - i);
    const dateStr = date.toISOString().split('T')[0];

    const dayInspections = inspections.filter(i => i.inspection_date.startsWith(dateStr));
    const avgScore = dayInspections.length > 0
      ? dayInspections.reduce((sum, i) => sum + (i.overall_score || 0), 0) / dayInspections.length
      : null;

    trends.push({
      date: dateStr,
      averageScore: avgScore,
      inspectionCount: dayInspections.length,
    });
  }

  return trends;
}

// Get coaching recommendations
router.get('/quality/coaching/:propertyId', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  
  const cacheKey = `hk-quality-coaching:${req.params.propertyId}`;
  const cached = cacheService.get(cacheKey);
  if (cached) return res.json(cached);

  const recommendations = await generateCoachingRecommendations(req.params.propertyId);

  const result = {
    propertyId: req.params.propertyId,
    recommendations,
    generatedAt: new Date().toISOString(),
  };

  cacheService.set(cacheKey, result, 60 * 60 * 1000);
  return res.json(result);
});

async function generateCoachingRecommendations(propertyId: string) {
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - 30);

  const { data: inspections } = await supabaseAdmin
    .from('quality_inspections')
    .select('*, profiles(full_name)')
    .eq('property_id', propertyId)
    .gte('inspection_date', startDate.toISOString());

  const recommendations = [];

  // Identify staff with low scores
  const byInspector = groupScoresByInspector(inspections || []);
  byInspector.forEach(insp => {
    if (insp.averageScore < 80) {
      recommendations.push({
        type: 'performance_improvement',
        priority: 'high',
        inspectorId: insp.inspectorId,
        inspectorName: inspections?.find(i => i.inspector_id === insp.inspectorId)?.profiles?.full_name,
        currentScore: insp.averageScore,
        targetScore: 85,
        recommendation: 'Schedule additional training and mentoring sessions',
        suggestedActions: [
          'Review cleaning procedures',
          'Shadow high-performing staff',
          'Focus on frequently failed checklist items',
        ],
      });
    }
  });

  return recommendations;
}

// ── Phase 3: Linen Inventory Management with Automated Reordering ─────
// Get linen inventory
router.get('/inventory/linen/:propertyId', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  
  const cacheKey = `hk-linen-inventory:${req.params.propertyId}`;
  const cached = cacheService.get(cacheKey);
  if (cached) return res.json(cached);

  const { data, error } = await supabaseAdmin
    .from('linen_inventory')
    .select('*')
    .eq('property_id', req.params.propertyId);

  if (error) return res.status(500).json({ error: error.message });

  const result = {
    propertyId: req.params.propertyId,
    inventory: data || [],
    summary: {
      totalItems: (data || []).length,
      lowStockItems: (data || []).filter(i => i.quantity <= i.reorder_level).length,
      totalValue: (data || []).reduce((sum, i) => sum + (i.quantity * i.unit_cost), 0),
    },
  };

  cacheService.set(cacheKey, result, 10 * 60 * 1000);
  return res.json(result);
});

// Update linen inventory
router.post('/inventory/linen', authenticate, requirePermission('hk:inventory:manage'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  
  const {
    propertyId,
    itemType,
    quantity,
    unitCost,
    reorderLevel,
    notes,
  } = req.body || {};
  
  if (!propertyId || !itemType || !quantity) {
    return res.status(400).json({ error: 'propertyId, itemType, and quantity are required' });
  }

  const { data, error } = await supabaseAdmin.from('linen_inventory').insert({
    property_id: propertyId,
    item_type: itemType,
    quantity,
    unit_cost,
    reorder_level: reorderLevel || 50,
    notes,
    updated_at: new Date().toISOString(),
  }).select().single();

  if (error) return res.status(500).json({ error: error.message });

  cacheService.invalidate('hk-*');
  return res.status(201).json(data);
});

// Check for reorder requirements
router.get('/inventory/linen/reorder-check/:propertyId', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  
  const { data, error } = await supabaseAdmin
    .from('linen_inventory')
    .select('*')
    .eq('property_id', req.params.propertyId);

  if (error) return res.status(500).json({ error: error.message });

  const reorderItems = (data || []).filter(i => i.quantity <= i.reorder_level);

  const result = {
    propertyId: req.params.propertyId,
    needsReorder: reorderItems.length > 0,
    items: reorderItems.map(i => ({
      itemType: i.item_type,
      currentQuantity: i.quantity,
      reorderLevel: i.reorder_level,
      suggestedOrderQuantity: i.reorder_level * 2 - i.quantity,
      estimatedCost: (i.reorder_level * 2 - i.quantity) * i.unit_cost,
    })),
    totalEstimatedCost: reorderItems.reduce((sum, i) => sum + ((i.reorder_level * 2 - i.quantity) * i.unit_cost), 0),
  };

  return res.json(result);
});

// ── Supply Tracking and Consumption Analytics ─────────────────────────
// Get supply consumption analytics
router.get('/inventory/consumption/:propertyId', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  
  const { period } = req.query as Record<string, string>;
  
  const cacheKey = `hk-consumption:${req.params.propertyId}:${period || 'month'}`;
  const cached = cacheService.get(cacheKey);
  if (cached) return res.json(cached);

  const days = period === 'quarter' ? 90 : period === 'year' ? 365 : 30;
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);

  const { data: consumption } = await supabaseAdmin
    .from('supply_consumption')
    .select('*')
    .eq('property_id', req.params.propertyId)
    .gte('consumption_date', startDate.toISOString());

  const analytics = calculateConsumptionAnalytics(consumption || []);

  const result = {
    propertyId: req.params.propertyId,
    period: days,
    analytics,
    generatedAt: new Date().toISOString(),
  };

  cacheService.set(cacheKey, result, 30 * 60 * 1000);
  return res.json(result);
});

function calculateConsumptionAnalytics(consumption: any[]) {
  const byItem: Record<string, number> = {};
  consumption.forEach(c => {
    byItem[c.item_type] = (byItem[c.item_type] || 0) + c.quantity;
  });

  return {
    totalConsumption: consumption.reduce((sum, c) => sum + c.quantity, 0),
    totalCost: consumption.reduce((sum, c) => sum + (c.quantity * c.unit_cost), 0),
    byItem: Object.entries(byItem).map(([item, quantity]) => ({ item, quantity })),
    trend: 'stable',
  };
}

// HK category string ↔ inventory_categories code mapping.
const HK_CATEGORY_TO_CODE: Record<string, string> = {
  cleaning_supplies: 'CLEAN',
  linens: 'LINENS',
  equipment: 'EQUIP',
  amenities: 'AMEN',
  other: 'OTHER',
};
const HK_CODE_TO_CATEGORY: Record<string, string> = Object.fromEntries(
  Object.entries(HK_CATEGORY_TO_CODE).map(([k, v]) => [v, k])
);
const HK_INVENTORY_CATEGORIES = new Set(Object.keys(HK_CATEGORY_TO_CODE));

// ── Central HK Inventory (full inventory) ──────────────────────────────
// Backs the /erp/housekeeping/inventory tab. Uses the unified uinv_items +
// uinv_stock_balances (HK store) as the single source of truth.
// Maps uinv_* data to the same response shape as the legacy inventory_items
// routes so the frontend doesn't need changes.

/** Map uinv subcategory → HK category string (for frontend compatibility). */
function uinvSubcategoryToHkCategory(sub: string | null): string {
  if (!sub) return 'other';
  const s = sub.toLowerCase();
  if (s.includes('clean')) return 'cleaning_supplies';
  if (s.includes('linen') || s.includes('laundry')) return 'linens';
  if (s.includes('amen')) return 'amenities';
  if (s.includes('equip') || s.includes('spare') || s.includes('tool')) return 'equipment';
  return 'other';
}

/** Shape a uinv_items + uinv_stock_balances row into the HK inventory item format. */
function shapeHkInventoryItemFromUinv(item: any, balance: any | null, linen?: any | null) {
  const category = uinvSubcategoryToHkCategory(item.subcategory);
  return {
    id: item.id,
    name: item.item_name,
    category,
    categoryCode: HK_CATEGORY_TO_CODE[category] || 'OTHER',
    categoryLabel: item.subcategory || 'Other',
    currentQuantity: Number(balance?.on_hand || 0),
    minimumQuantity: Number(item.min_stock || 0),
    maximumStock: item.max_stock ? Number(item.max_stock) : null,
    unitOfMeasure: item.unit_of_measure || 'PCS',
    reorderPoint: Number(item.reorder_point || 0),
    reorderQuantity: 0,
    parLevel: Number(item.par_level || 0),
    lastRestocked: balance?.last_movement_date || null,
    supplier: item.brand || '',
    costPerUnit: Number(item.last_cost || 0),
    location: 'HK Store',
    propertyId: item.property_id || null,
    updatedAt: item.updated_at,
    // Linen extended data (only present for items linked to hk_linen_stock)
    isLinen: !!(linen && (item.subcategory === 'Laundry Supplies' || item.subcategory === 'Linens' || linen)),
    linenInUse: linen ? Number(linen.in_use || 0) : 0,
    linenAtLaundry: linen ? Number(linen.at_laundry || 0) : 0,
    linenDamaged: linen ? Number(linen.damaged || 0) : 0,
    linenLost: linen ? Number(linen.lost || 0) : 0,
    linenType: linen ? linen.type : null,
  };
}
// table (filtered by property_id) as the central store and
// inventory_transactions as the movement log.

router.get('/inventory/central/:propertyId', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const cacheKey = `hk-inventory-central:${req.params.propertyId}`;
  const cached = cacheService.get(cacheKey);
  if (cached) return res.json(cached);

  // Fetch HK-scoped items from uinv_items (category = Housekeeping)
  const { data: items, error: itemsError } = await supabaseAdmin
    .from('uinv_items')
    .select('*')
    .eq('category', 'Housekeeping')
    .eq('is_active', true)
    .order('item_name');

  if (itemsError) return res.status(500).json({ error: itemsError.message });

  // Fetch stock balances for HK + Linen stores
  const { data: balances } = await supabaseAdmin
    .from('uinv_stock_balances')
    .select('item_id, on_hand, unit_cost, last_movement_date')
    .in('store_id', [HK_STORE_ID, HK_LINEN_STORE_ID]);

  // Build a map: itemId → balance (aggregate across HK + Linen stores)
  const balanceMap = new Map<string, { on_hand: number; unit_cost: number; last_movement_date: string }>();
  for (const b of (balances || [])) {
    const existing = balanceMap.get(b.item_id);
    if (existing) {
      existing.on_hand = Number(existing.on_hand) + Number(b.on_hand);
    } else {
      balanceMap.set(b.item_id, {
        on_hand: Number(b.on_hand),
        unit_cost: Number(b.unit_cost || 0),
        last_movement_date: b.last_movement_date,
      });
    }
  }

  // Fetch linen stock data (hk_linen_stock) for items linked via inventory_item_id
  const { data: linenStock } = await supabaseAdmin
    .from('hk_linen_stock')
    .select('id, type, in_stock, in_use, at_laundry, damaged, lost, par, inventory_item_id')
    .eq('property_id', req.params.propertyId);
  // Build map: inventory_item_id → linen stock row
  // Treat as unlinked if inventory_item_id is null OR points to a non-existent item
  const itemIds = new Set((items || []).map((i: any) => i.id));
  const linenMap = new Map<string, any>();
  const unlinkedLinen: any[] = [];
  for (const ls of (linenStock || [])) {
    if (ls.inventory_item_id && itemIds.has(ls.inventory_item_id)) {
      linenMap.set(ls.inventory_item_id, ls);
    } else {
      unlinkedLinen.push(ls);
    }
  }

  const shapedItems = (items || []).map((item: any) =>
    shapeHkInventoryItemFromUinv(item, balanceMap.get(item.id) || null, linenMap.get(item.id) || null)
  );

  // Append unlinked linen types as pseudo-items so they appear in the
  // inventory listing even before they're linked to uinv_items.
  for (const ls of unlinkedLinen) {
    shapedItems.push({
      id: `LINEN-${ls.id}`,
      name: ls.type,
      category: 'Linens',
      categoryCode: 'LINEN',
      categoryLabel: 'Laundry Supplies',
      currentQuantity: Number(ls.in_stock || 0),
      minimumQuantity: 0,
      maximumStock: null,
      unitOfMeasure: 'PCS',
      reorderPoint: 0,
      reorderQuantity: 0,
      parLevel: Number(ls.par || 0),
      lastRestocked: null,
      supplier: '',
      costPerUnit: 0,
      location: 'Linen Store',
      propertyId: req.params.propertyId,
      updatedAt: new Date().toISOString(),
      isLinen: true,
      linenInUse: Number(ls.in_use || 0),
      linenAtLaundry: Number(ls.at_laundry || 0),
      linenDamaged: Number(ls.damaged || 0),
      linenLost: Number(ls.lost || 0),
      linenType: ls.type,
    });
  }

  const lowStock = shapedItems.filter(i => i.reorderPoint > 0 && i.currentQuantity <= i.reorderPoint);
  const critical = shapedItems.filter(i => i.minimumQuantity > 0 && i.currentQuantity <= i.minimumQuantity);

  const result = {
    propertyId: req.params.propertyId,
    items: shapedItems,
    summary: {
      total: shapedItems.length,
      totalValue: shapedItems.reduce((sum, i) => sum + (i.currentQuantity * i.costPerUnit), 0),
      lowStock: lowStock.length,
      critical: critical.length,
    },
    lowStock,
    critical,
    generatedAt: new Date().toISOString(),
  };

  cacheService.set(cacheKey, result, 15 * 1000);
  return res.json(result);
});

// Linkable inventory items for the linen/amenity linkage pickers.
// Returns HK-scoped uinv_items, optionally filtered by subcategory.
router.get('/inventory/linkable/:propertyId', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { category } = req.query as Record<string, string>;
  let q = supabaseAdmin
    .from('uinv_items')
    .select('id, item_name, unit_of_measure, subcategory')
    .eq('category', 'Housekeeping')
    .eq('is_active', true)
    .order('item_name');
  if (category) {
    // Map legacy category code → subcategory filter
    const subcatMap: Record<string, string> = {
      LINENS: 'Laundry Supplies',
      AMEN: 'Guest Amenities',
      CLEAN: 'Cleaning Chemicals',
      EQUIP: 'Equipment',
    };
    if (subcatMap[category]) {
      q = q.eq('subcategory', subcatMap[category]);
    }
  }
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });

  // Fetch balances for these items in HK/Linen stores
  const itemIds = (data || []).map((r: any) => r.id);
  let balanceMap = new Map<string, number>();
  if (itemIds.length > 0) {
    const { data: balances } = await supabaseAdmin
      .from('uinv_stock_balances')
      .select('item_id, on_hand')
      .in('store_id', [HK_STORE_ID, HK_LINEN_STORE_ID])
      .in('item_id', itemIds);
    for (const b of (balances || [])) {
      balanceMap.set(b.item_id, (balanceMap.get(b.item_id) || 0) + Number(b.on_hand));
    }
  }

  return res.json({ items: (data || []).map((r: any) => ({
    id: r.id,
    name: r.item_name,
    currentQuantity: balanceMap.get(r.id) || 0,
    unitOfMeasure: r.unit_of_measure,
  }))});
});

// Movements / transfers log — reads from uinv_stock_ledger (HK + Linen stores).
router.get('/inventory/central/:propertyId/transfers', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const { data, error } = await supabaseAdmin
    .from('uinv_stock_ledger')
    .select('*, item:uinv_items(item_name, unit_of_measure)')
    .in('store_id', [HK_STORE_ID, HK_LINEN_STORE_ID])
    .order('transaction_date', { ascending: false })
    .limit(200);

  if (error) return res.status(500).json({ error: error.message });

  return res.json({
    propertyId: req.params.propertyId,
    transfers: (data || []).map((t: any) => ({
      id: t.id,
      propertyId: t.property_id,
      itemId: t.item_id,
      itemName: t.item?.item_name || '—',
      transactionType: t.transaction_type,
      quantity: Number(t.quantity_in || t.quantity_out || 0),
      unit: t.item?.unit_of_measure || 'PCS',
      unitCost: Number(t.unit_cost || 0),
      totalCost: Number(t.value || 0),
      reason: t.reason || '',
      performedBy: t.performed_by || 'system',
      transactionDate: t.transaction_date,
      createdAt: t.transaction_date,
      theoreticalQty: 0,
      actualQty: 0,
      varianceQty: 0,
      wasteType: null,
      referenceNumber: t.reference || null,
    })),
    generatedAt: new Date().toISOString(),
  });
});

router.post('/inventory/central', authenticate, requirePermission('hk:inventory:manage'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const {
    propertyId,
    name,
    category,
    currentQuantity,
    minimumQuantity,
    unitOfMeasure,
    reorderPoint,
    reorderQuantity,
    supplier,
    costPerUnit,
    parLevel,
  } = req.body || {};

  if (!propertyId || !name || !category) {
    return res.status(400).json({ error: 'propertyId, name, and category are required' });
  }
  if (!HK_INVENTORY_CATEGORIES.has(category)) {
    return res.status(400).json({ error: `Invalid category: ${category}` });
  }

  // Map HK category → uinv subcategory
  const subcatMap: Record<string, string> = {
    cleaning_supplies: 'Cleaning Chemicals',
    linens: 'Laundry Supplies',
    equipment: 'Equipment',
    amenities: 'Guest Amenities',
    other: 'Other',
  };
  const storeId = category === 'linens' ? HK_LINEN_STORE_ID : HK_STORE_ID;

  // Create the uinv_items row
  const { data: item, error: itemError } = await supabaseAdmin
    .from('uinv_items')
    .insert({
      property_id: propertyId,
      item_code: `HK-${Date.now()}`,
      item_name: String(name).trim().slice(0, 120),
      category: 'Housekeeping',
      subcategory: subcatMap[category] || 'Other',
      item_type: 'Consumable',
      brand: supplier ? String(supplier).trim().slice(0, 120) : null,
      unit_of_measure: unitOfMeasure ? String(unitOfMeasure).trim().slice(0, 20) : 'PCS',
      min_stock: Math.max(0, Number(minimumQuantity) || 0),
      max_stock: null,
      reorder_point: Math.max(0, Number(reorderPoint) || 0),
      safety_stock: 0,
      par_level: parLevel !== undefined ? Math.max(0, Number(parLevel) || 0) : Math.max(0, Number(reorderPoint) || 0) * 2,
      default_store_id: storeId,
      costing_method: 'Weighted Average',
      last_cost: Math.max(0, Number(costPerUnit) || 0),
      avg_cost: Math.max(0, Number(costPerUnit) || 0),
      standard_cost: Math.max(0, Number(costPerUnit) || 0),
      is_active: true,
    })
    .select('*')
    .single();

  if (itemError) return res.status(500).json({ error: itemError.message });

  // Create initial stock balance if currentQuantity > 0
  const initQty = Math.max(0, Number(currentQuantity) || 0);
  if (initQty > 0) {
    const balanceId = `UINV-SB-HK-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    await supabaseAdmin.from('uinv_stock_balances').insert({
      id: balanceId,
      property_id: propertyId,
      item_id: item.id,
      store_id: storeId,
      location_id: null,
      on_hand: initQty,
      reserved: 0, allocated: 0, on_order: 0, in_transit: 0,
      damaged: 0, quarantined: 0, expired: 0,
      status: 'Available',
      unit_cost: Math.max(0, Number(costPerUnit) || 0),
      last_movement_date: new Date().toISOString(),
    });
  }

  cacheService.invalidatePattern('^hk-inventory-central:');
  return res.status(201).json({ item: shapeHkInventoryItemFromUinv(item, { on_hand: initQty, unit_cost: item.last_cost, last_movement_date: null }) });
});

router.put('/inventory/central/:id', authenticate, requirePermission('hk:inventory:manage'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const { name, category, currentQuantity, minimumQuantity, unitOfMeasure, reorderPoint, reorderQuantity, supplier, costPerUnit, parLevel } = req.body || {};
  const updates: any = {};
  if (name !== undefined) updates.item_name = String(name).trim().slice(0, 120);
  if (category !== undefined) {
    if (!HK_INVENTORY_CATEGORIES.has(category)) return res.status(400).json({ error: `Invalid category: ${category}` });
    const subcatMap: Record<string, string> = {
      cleaning_supplies: 'Cleaning Chemicals',
      linens: 'Laundry Supplies',
      equipment: 'Equipment',
      amenities: 'Guest Amenities',
      other: 'Other',
    };
    updates.subcategory = subcatMap[category] || 'Other';
  }
  if (minimumQuantity !== undefined) updates.min_stock = Math.max(0, Number(minimumQuantity) || 0);
  if (unitOfMeasure !== undefined) updates.unit_of_measure = unitOfMeasure ? String(unitOfMeasure).trim().slice(0, 20) : 'PCS';
  if (reorderPoint !== undefined) {
    updates.reorder_point = Math.max(0, Number(reorderPoint) || 0);
    if (parLevel === undefined) updates.par_level = Math.max(0, Number(reorderPoint) || 0) * 2;
  }
  if (parLevel !== undefined) {
    updates.par_level = Math.max(0, Number(parLevel) || 0);
  }
  if (supplier !== undefined) updates.brand = supplier ? String(supplier).trim().slice(0, 120) : null;
  if (costPerUnit !== undefined) {
    updates.last_cost = Math.max(0, Number(costPerUnit) || 0);
    updates.avg_cost = Math.max(0, Number(costPerUnit) || 0);
    updates.standard_cost = Math.max(0, Number(costPerUnit) || 0);
  }

  if (Object.keys(updates).length === 0) {
    return res.status(400).json({ error: 'No fields to update' });
  }

  updates.updated_at = new Date().toISOString();

  const { data: item, error: itemError } = await supabaseAdmin
    .from('uinv_items')
    .update(updates)
    .eq('id', req.params.id)
    .select('*')
    .single();

  if (itemError) return res.status(500).json({ error: itemError.message });
  if (!item) return res.status(404).json({ error: 'Inventory item not found' });

  // If currentQuantity is provided, update the stock balance
  if (currentQuantity !== undefined) {
    const storeId = (item.subcategory === 'Laundry Supplies') ? HK_LINEN_STORE_ID : HK_STORE_ID;
    const { data: balance } = await supabaseAdmin
      .from('uinv_stock_balances')
      .select('id, on_hand, unit_cost, last_movement_date')
      .eq('item_id', item.id)
      .eq('store_id', storeId)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (balance) {
      await supabaseAdmin
        .from('uinv_stock_balances')
        .update({ on_hand: Math.max(0, Number(currentQuantity) || 0), updated_at: new Date().toISOString() })
        .eq('id', balance.id);
      cacheService.invalidatePattern('^hk-inventory-central:');
      return res.json({ item: shapeHkInventoryItemFromUinv(item, balance) });
    }
  }

  cacheService.invalidatePattern('^hk-inventory-central:');
  return res.json({ item: shapeHkInventoryItemFromUinv(item, null) });
});

router.delete('/inventory/central/:id', authenticate, requirePermission('hk:inventory:manage'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  // Soft-delete: mark as inactive instead of hard delete (preserves ledger history)
  const { error } = await supabaseAdmin
    .from('uinv_items')
    .update({ is_active: false, updated_at: new Date().toISOString() })
    .eq('id', req.params.id);

  if (error) return res.status(500).json({ error: error.message });

  cacheService.invalidatePattern('^hk-inventory-central:');
  return res.json({ success: true });
});

// Adjust stock — updates uinv_stock_balances.on_hand and logs to uinv_stock_ledger.
router.post('/inventory/central/:id/adjust', authenticate, requirePermission('hk:inventory:manage'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const { delta, notes, staff } = req.body || {};
  const deltaNum = Number(delta) || 0;
  if (!Number.isFinite(deltaNum) || deltaNum === 0) {
    return res.status(400).json({ error: 'delta is required and must be a non-zero number' });
  }

  const { data: item, error: fetchError } = await supabaseAdmin
    .from('uinv_items')
    .select('id, item_name, unit_of_measure, subcategory, property_id')
    .eq('id', req.params.id)
    .maybeSingle();

  if (fetchError) return res.status(500).json({ error: fetchError.message });
  if (!item) return res.status(404).json({ error: 'Inventory item not found' });

  const storeId = (item.subcategory === 'Laundry Supplies') ? HK_LINEN_STORE_ID : HK_STORE_ID;
  const { data: balance } = await supabaseAdmin
    .from('uinv_stock_balances')
    .select('id, on_hand, unit_cost')
    .eq('item_id', item.id)
    .eq('store_id', storeId)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!balance) return res.status(404).json({ error: 'No stock balance found for this item in the HK store' });

  const newQty = Math.max(0, (Number(balance.on_hand) || 0) + deltaNum);
  const now = new Date().toISOString();
  await supabaseAdmin
    .from('uinv_stock_balances')
    .update({ on_hand: newQty, last_movement_date: now, updated_at: now })
    .eq('id', balance.id);

  // Log to uinv_stock_ledger
  await supabaseAdmin.from('uinv_stock_ledger').insert({
    property_id: item.property_id,
    item_id: item.id,
    store_id: storeId,
    transaction_type: 'Adjustment',
    reference: 'HK Manual Adjust',
    quantity_in: deltaNum > 0 ? Math.abs(deltaNum) : 0,
    quantity_out: deltaNum < 0 ? Math.abs(deltaNum) : 0,
    balance: newQty,
    unit_cost: Number(balance.unit_cost || 0),
    value: Math.abs(deltaNum) * Number(balance.unit_cost || 0),
    performed_by: staff || (isUuid(req.user?.id) ? req.user!.id : 'system'),
    reason: notes || `Manual ${deltaNum > 0 ? 'restock' : 'consume'} of ${Math.abs(deltaNum)}`,
    transaction_date: now,
  });

  cacheService.invalidatePattern('^hk-inventory-central:');
  return res.json({ item: shapeHkInventoryItemFromUinv(item, { on_hand: newQty, unit_cost: balance.unit_cost, last_movement_date: now }) });
});

// ── Waste recording ─────────────────────────────────────────────────────
router.post('/inventory/waste', authenticate, requirePermission('hk:inventory:manage'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const { itemId, wasteType, quantity, reason, staff } = req.body || {};
  if (!itemId) return res.status(400).json({ error: 'itemId is required' });
  if (!quantity || Number(quantity) <= 0) return res.status(400).json({ error: 'quantity must be positive' });

  const validWasteTypes = ['damaged', 'stained', 'lost', 'expired', 'guest_taken', 'overstock', 'other'];
  if (wasteType && !validWasteTypes.includes(wasteType)) {
    return res.status(400).json({ error: `Invalid waste type: ${wasteType}` });
  }

  const { data: item, error: fetchError } = await supabaseAdmin
    .from('uinv_items')
    .select('id, item_name, unit_of_measure, subcategory, property_id')
    .eq('id', itemId)
    .maybeSingle();

  if (fetchError) return res.status(500).json({ error: fetchError.message });
  if (!item) return res.status(404).json({ error: 'Inventory item not found' });

  const storeId = (item.subcategory === 'Laundry Supplies') ? HK_LINEN_STORE_ID : HK_STORE_ID;
  const { data: balance } = await supabaseAdmin
    .from('uinv_stock_balances')
    .select('id, on_hand, unit_cost')
    .eq('item_id', item.id)
    .eq('store_id', storeId)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!balance) return res.status(404).json({ error: 'No stock balance found' });

  const wasteQty = Number(quantity);
  const newQty = Math.max(0, (Number(balance.on_hand) || 0) - wasteQty);
  const now = new Date().toISOString();

  await supabaseAdmin
    .from('uinv_stock_balances')
    .update({ on_hand: newQty, updated_at: now })
    .eq('id', balance.id);

  // Log to uinv_stock_ledger
  await supabaseAdmin.from('uinv_stock_ledger').insert({
    property_id: item.property_id,
    item_id: item.id,
    store_id: storeId,
    transaction_type: 'Waste',
    reference: `HK Waste — ${wasteType || 'other'}`,
    quantity_in: 0,
    quantity_out: wasteQty,
    balance: newQty,
    unit_cost: Number(balance.unit_cost || 0),
    value: wasteQty * Number(balance.unit_cost || 0),
    performed_by: staff || (isUuid(req.user?.id) ? req.user!.id : 'system'),
    reason: reason || `${wasteType || 'waste'} — ${wasteQty} ${item.unit_of_measure}`,
    transaction_date: now,
  });

  cacheService.invalidatePattern('^hk-inventory-central:');
  return res.json({ success: true, newQuantity: newQty });
});

// ── Stock Count / Cycle Count ───────────────────────────────────────────
// Accepts an array of { itemId, countedQty } and posts adjustments for any
// item where counted ≠ system. Returns a variance summary.
router.post('/inventory/stock-count', authenticate, requirePermission('hk:inventory:manage'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const { propertyId, countType, counts } = req.body || {};
  if (!propertyId) return res.status(400).json({ error: 'propertyId is required' });
  if (!Array.isArray(counts) || counts.length === 0) return res.status(400).json({ error: 'counts array is required' });

  const now = new Date().toISOString();
  const results: any[] = [];

  for (const c of counts) {
    const { itemId, countedQty } = c;
    if (!itemId || countedQty === undefined || countedQty === null) continue;

    const { data: item } = await supabaseAdmin
      .from('uinv_items')
      .select('id, item_name, unit_of_measure, subcategory')
      .eq('id', itemId)
      .maybeSingle();

    if (!item) continue;

    const storeId = (item.subcategory === 'Laundry Supplies') ? HK_LINEN_STORE_ID : HK_STORE_ID;
    const { data: balance } = await supabaseAdmin
      .from('uinv_stock_balances')
      .select('id, on_hand, unit_cost')
      .eq('item_id', item.id)
      .eq('store_id', storeId)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!balance) continue;

    const systemQty = Number(balance.on_hand) || 0;
    const counted = Number(countedQty) || 0;
    const variance = counted - systemQty;

    results.push({
      itemId: item.id,
      itemName: item.item_name,
      systemQty,
      countedQty: counted,
      variance,
      unit: item.unit_of_measure,
    });

    if (variance !== 0) {
      await supabaseAdmin
        .from('uinv_stock_balances')
        .update({ on_hand: Math.max(0, counted), updated_at: now })
        .eq('id', balance.id);

      await supabaseAdmin.from('uinv_stock_ledger').insert({
        property_id: propertyId,
        item_id: item.id,
        store_id: storeId,
        transaction_type: countType === 'cycle_count' ? 'Cycle Count' : 'Stock Count',
        reference: 'HK Stock Count',
        quantity_in: variance > 0 ? Math.abs(variance) : 0,
        quantity_out: variance < 0 ? Math.abs(variance) : 0,
        balance: Math.max(0, counted),
        unit_cost: Number(balance.unit_cost || 0),
        value: Math.abs(variance) * Number(balance.unit_cost || 0),
        reason: `Stock count adjustment: ${systemQty} → ${counted}`,
        performed_by: isUuid(req.user?.id) ? req.user!.id : 'system',
        transaction_date: now,
      });
    }
  }

  cacheService.invalidatePattern('^hk-inventory-central:');
  return res.json({
    countType: countType || 'stock_count',
    propertyId,
    results,
    summary: {
      total: results.length,
      variances: results.filter(r => r.variance !== 0).length,
      totalVarianceCost: results.reduce((sum, r) => sum + Math.abs(r.variance) * 0, 0),
    },
  });
});

// ── Variance Analysis ───────────────────────────────────────────────────
// Reads from uinv_stock_ledger for HK/Linen stores. Used by the Variance tab.
router.get('/inventory/variance/:propertyId', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const { data, error } = await supabaseAdmin
    .from('uinv_stock_ledger')
    .select('*, item:uinv_items(item_name, unit_of_measure, subcategory)')
    .in('store_id', [HK_STORE_ID, HK_LINEN_STORE_ID])
    .in('transaction_type', ['Cycle Count', 'Stock Count', 'Adjustment', 'Waste', 'Consumption', 'Count Adjustment'])
    .order('transaction_date', { ascending: false })
    .limit(500);

  if (error) return res.status(500).json({ error: error.message });

  const records = (data || []).map((t: any) => {
    // Prefer the explicit theoretical_qty/actual_qty columns (migration 374)
    // when present. Fall back to reconstruction from quantity_in/out + balance
    // for legacy rows that predate the columns.
    const qtyIn = Number(t.quantity_in || 0);
    const qtyOut = Number(t.quantity_out || 0);
    const balance = Number(t.balance || 0);
    const reconstructedVariance = qtyIn - qtyOut;

    const hasExplicit = t.theoretical_qty != null || t.actual_qty != null;
    const theoreticalQty = hasExplicit ? Number(t.theoretical_qty ?? 0) : balance + reconstructedVariance;
    const actualQty = hasExplicit ? Number(t.actual_qty ?? 0) : balance;
    const varianceQty = hasExplicit ? (actualQty - theoreticalQty) : reconstructedVariance;

    return {
      id: t.id,
      date: t.transaction_date ? String(t.transaction_date).slice(0, 10) : '',
      itemId: t.item_id,
      itemName: t.item?.item_name || '—',
      category: uinvSubcategoryToHkCategory(t.item?.subcategory),
      theoreticalQty,
      actualQty,
      varianceQty,
      variancePercent: theoreticalQty !== 0 ? (varianceQty / theoreticalQty) * 100 : 0,
      unit: t.item?.unit_of_measure || 'PCS',
      cost: Number(t.value || 0),
      transactionType: t.transaction_type,
    };
  });

  // Aggregate by item.
  const byItem: Record<string, any> = {};
  for (const r of records) {
    if (!byItem[r.itemId]) {
      byItem[r.itemId] = {
        itemId: r.itemId,
        itemName: r.itemName,
        category: r.category,
        theoretical: 0,
        actual: 0,
        records: 0,
        unit: r.unit,
      };
    }
    byItem[r.itemId].theoretical += r.theoreticalQty;
    byItem[r.itemId].actual += r.actualQty;
    byItem[r.itemId].records += 1;
  }

  const aggregated = Object.values(byItem).map((a: any) => {
    const varianceQty = a.actual - a.theoretical;
    const variancePct = a.theoretical !== 0 ? (varianceQty / a.theoretical) * 100 : null;
    const severity = Math.abs(variancePct ?? 0) >= 20 ? 'high' : Math.abs(variancePct ?? 0) >= 10 ? 'medium' : variancePct === null ? 'na' : 'low';
    return { ...a, varianceQty, variancePercent: variancePct, severity };
  });

  const summary = {
    high: aggregated.filter(a => a.severity === 'high').length,
    medium: aggregated.filter(a => a.severity === 'medium').length,
    low: aggregated.filter(a => a.severity === 'low').length,
    na: aggregated.filter(a => a.severity === 'na').length,
    total: aggregated.length,
  };

  return res.json({ records, aggregated, summary });
});

// ── Consumption recording (par × rooms cleaned model) ──────────────────
// Records actual consumption per item and computes theoretical from
// min_stock (par) × roomsCleaned. Posts to uinv_stock_ledger for tracking.
router.post('/inventory/consumption', authenticate, requirePermission('hk:inventory:manage'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const { propertyId, roomsCleaned, entries } = req.body || {};
  if (!propertyId) return res.status(400).json({ error: 'propertyId is required' });
  if (!roomsCleaned || Number(roomsCleaned) <= 0) return res.status(400).json({ error: 'roomsCleaned must be positive' });
  if (!Array.isArray(entries) || entries.length === 0) return res.status(400).json({ error: 'entries array is required' });

  const now = new Date().toISOString();
  const rooms = Number(roomsCleaned);
  let transactionsCreated = 0;

  for (const e of entries) {
    const { itemId, actualQty } = e;
    if (!itemId || actualQty === undefined) continue;

    const { data: item } = await supabaseAdmin
      .from('uinv_items')
      .select('id, item_name, unit_of_measure, subcategory, min_stock, property_id')
      .eq('id', itemId)
      .maybeSingle();

    if (!item) continue;

    const storeId = (item.subcategory === 'Laundry Supplies') ? HK_LINEN_STORE_ID : HK_STORE_ID;
    const { data: balance } = await supabaseAdmin
      .from('uinv_stock_balances')
      .select('id, on_hand, unit_cost')
      .eq('item_id', item.id)
      .eq('store_id', storeId)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!balance) continue;

    const actual = Number(actualQty) || 0;
    const theoretical = Number(item.min_stock || 0) * rooms;

    // Deduct actual consumption from stock.
    const newQty = Math.max(0, (Number(balance.on_hand) || 0) - actual);
    await supabaseAdmin
      .from('uinv_stock_balances')
      .update({ on_hand: newQty, last_movement_date: now, updated_at: now })
      .eq('id', balance.id);

    await supabaseAdmin.from('uinv_stock_ledger').insert({
      property_id: propertyId,
      item_id: item.id,
      store_id: storeId,
      transaction_type: 'Consumption',
      reference: `HK Consumption — ${rooms} rooms`,
      quantity_in: 0,
      quantity_out: actual,
      balance: newQty,
      unit_cost: Number(balance.unit_cost || 0),
      value: actual * Number(balance.unit_cost || 0),
      performed_by: isUuid(req.user?.id) ? req.user!.id : 'system',
      reason: `Consumption: ${actual} ${item.unit_of_measure} (par ${item.min_stock} × ${rooms} rooms)`,
      transaction_date: now,
      theoretical_qty: theoretical,
      actual_qty: actual,
    });

    transactionsCreated += 1;
  }

  cacheService.invalidatePattern('^hk-inventory-central:');
  return res.json({ transactionsCreated, roomsCleaned: rooms });
});

// ── HK Store & Secondary Locations (Floor Closets, Carts, Storage) ─────
router.get('/inventory/locations/:propertyId', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const { propertyId } = req.params;
  const { data: locations, error } = await supabaseAdmin
    .from('uinv_locations')
    .select('id, store_id, location_code, location_name, location_type, is_active')
    .in('store_id', [HK_STORE_ID, HK_LINEN_STORE_ID])
    .eq('is_active', true)
    .order('location_name');

  // 42P01 = table doesn't exist yet — fall through to defaults
  if (error && error.code !== '42P01') {
    return res.status(500).json({ error: error.message });
  }

  // Fallback defaults if no locations are seeded yet
  const defaultLocations = [
    { id: 'loc-hk-main', locationName: 'Main HK Store', locationType: 'Store' },
    { id: 'loc-hk-linen', locationName: 'Central Linen Room', locationType: 'Store' },
    { id: 'loc-floor-1', locationName: 'Floor 1 Linen Closet', locationType: 'Closet' },
    { id: 'loc-floor-2', locationName: 'Floor 2 Linen Closet', locationType: 'Closet' },
    { id: 'loc-floor-3', locationName: 'Floor 3 Linen Closet', locationType: 'Closet' },
    { id: 'loc-floor-4', locationName: 'Floor 4 Linen Closet', locationType: 'Closet' },
    { id: 'loc-cart-a', locationName: 'Housekeeper Cart A', locationType: 'Cart' },
    { id: 'loc-cart-b', locationName: 'Housekeeper Cart B', locationType: 'Cart' },
    { id: 'loc-laundry-drop', locationName: 'Laundry Drop Zone', locationType: 'Station' },
  ];

  const dbList = (locations || []).map((l: any) => ({
    id: l.id,
    locationName: l.location_name,
    locationCode: l.location_code,
    locationType: l.location_type || 'Closet',
  }));

  const merged = dbList.length > 0 ? dbList : defaultLocations;
  return res.json(merged);
});

// ── Create inter-location transfer ──────────────────────────────────────
router.post('/inventory/transfers', authenticate, requirePermission('hk:inventory:manage'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const { propertyId, itemId, fromLocation, toLocation, toLocationId, quantity, reason, staff } = req.body || {};
  if (!propertyId || !itemId || !fromLocation || !toLocation) {
    return res.status(400).json({ error: 'propertyId, itemId, fromLocation, toLocation are required' });
  }
  if (fromLocation === toLocation) return res.status(400).json({ error: 'Source and destination must be different' });
  if (!quantity || Number(quantity) <= 0) return res.status(400).json({ error: 'quantity must be positive' });

  const { data: item, error: fetchError } = await supabaseAdmin
    .from('uinv_items')
    .select('id, item_name, unit_of_measure, subcategory, property_id')
    .eq('id', itemId)
    .maybeSingle();

  if (fetchError) return res.status(500).json({ error: fetchError.message });
  if (!item) return res.status(404).json({ error: 'Inventory item not found' });

  const storeId = (item.subcategory === 'Laundry Supplies') ? HK_LINEN_STORE_ID : HK_STORE_ID;
  const { data: balance } = await supabaseAdmin
    .from('uinv_stock_balances')
    .select('id, on_hand, unit_cost')
    .eq('item_id', item.id)
    .eq('store_id', storeId)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!balance) return res.status(404).json({ error: 'No stock balance found' });

  const transferQty = Number(quantity);
  const newQty = Math.max(0, (Number(balance.on_hand) || 0) - transferQty);
  const now = new Date().toISOString();

  await supabaseAdmin
    .from('uinv_stock_balances')
    .update({ on_hand: newQty, last_movement_date: now, updated_at: now })
    .eq('id', balance.id);

  await supabaseAdmin.from('uinv_stock_ledger').insert({
    property_id: propertyId,
    item_id: item.id,
    store_id: storeId,
    location_id: toLocationId || null,
    transaction_type: 'Transfer Out',
    reference: `${fromLocation} → ${toLocation}`,
    quantity_in: 0,
    quantity_out: transferQty,
    balance: newQty,
    unit_cost: Number(balance.unit_cost || 0),
    value: transferQty * Number(balance.unit_cost || 0),
    performed_by: staff || (isUuid(req.user?.id) ? req.user!.id : 'system'),
    reason: reason || `Transfer: ${fromLocation} → ${toLocation}`,
    transaction_date: now,
  });

  cacheService.invalidatePattern('^hk-inventory-central:');
  return res.json({ success: true, newQuantity: newQty });
});

// ── HK Store Requisitions (request from Main Store) ────────────────────
// Lets HK request items from the central inventory (uinv_items with stock in
// UINV-ST-MAIN). Requisitions are created as uinv_issues with source='Requisition'
// and department='Housekeeping'. The inventory portal fulfills them from
// /erp/inventory/requisitions. Workflow: Pending → Approved → Issued.

// List items available in the main store for the request picker.
router.get('/inventory/main-store-items', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  // Fetch items that have stock in the Main Warehouse
  const { data: balances, error: balError } = await supabaseAdmin
    .from('uinv_stock_balances')
    .select('item_id, on_hand, unit_cost, item:uinv_items(id, item_name, unit_of_measure, is_active)')
    .eq('store_id', MAIN_STORE_ID)
    .gt('on_hand', 0)
    .limit(200);

  if (balError) return res.status(500).json({ error: balError.message });

  const items = (balances || [])
    .filter((b: any) => b.item && b.item.is_active)
    .map((b: any) => ({
      id: b.item.id,
      name: b.item.item_name,
      currentQuantity: Number(b.on_hand || 0),
      unitOfMeasure: b.item.unit_of_measure || '',
      unitCost: Number(b.unit_cost || 0),
    }));

  return res.json({ items });
});

// List HK requisitions for a property (reads from uinv_issues).
router.get('/inventory/requisitions/:propertyId', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const { data, error } = await supabaseAdmin
    .from('uinv_issues')
    .select('*, store:uinv_stores(*)')
    .eq('property_id', req.params.propertyId)
    .eq('department', 'Housekeeping')
    .order('created_at', { ascending: false })
    .limit(100);

  if (error) return res.status(500).json({ error: error.message });

  const result = (data || []).map((r: any) => ({
    id: r.id,
    number: r.issue_number,
    department: r.department,
    requestedBy: r.requester,
    requestDate: r.created_at ? String(r.created_at).slice(0, 10) : '',
    fromLocation: 'Main Store',
    toLocation: r.store?.store_name || 'HK Store',
    status: r.approval_status === 'Issued' ? 'completed' :
            r.approval_status === 'Rejected' ? 'rejected' :
            r.approval_status === 'Approved' ? 'approved' :
            r.approval_status?.toLowerCase() || 'pending',
    totalCost: (r.lines || []).reduce((sum: number, l: any) => sum + Number(l.issuedQty || l.requestedQty || 0) * Number(l.unitCost || l.cost || 0), 0),
    notes: r.notes,
    items: (r.lines || []).map((l: any, idx: number) => ({
      id: `${r.id}-line-${idx}`,
      itemId: l.itemId,
      itemName: l.itemName,
      requestedQuantity: Number(l.requestedQty || 0),
      approvedQuantity: l.approvedQty !== undefined ? Number(l.approvedQty) : null,
      unit: l.unit || 'PCS',
      unitCost: Number(l.unitCost || l.cost || 0),
      reason: l.notes || null,
    })),
  }));

  return res.json({ requisitions: result });
});

// Create a new HK requisition from the main store (creates a uinv_issues row).
router.post('/inventory/requisitions', authenticate, requirePermission('hk:inventory:manage'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const { propertyId, requestedBy, notes, items } = req.body || {};
  if (!propertyId || !requestedBy) {
    return res.status(400).json({ error: 'propertyId and requestedBy are required' });
  }
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'At least one item is required' });
  }

  // Generate issue number with REQ prefix (requisition)
  const { count } = await supabaseAdmin
    .from('uinv_issues')
    .select('id', { count: 'exact', head: true })
    .like('issue_number', 'REQ-%');
  const issueNumber = `REQ-${String((count || 0) + 1).padStart(6, '0')}`;

  const lines = items.map((it: any) => ({
    itemId: it.itemId,
    itemName: it.itemName,
    requestedQty: Number(it.requestedQuantity || 0),
    approvedQty: null,
    issuedQty: 0,
    unit: it.unit || 'PCS',
    unitCost: Number(it.unitCost || 0),
    cost: Number(it.unitCost || 0),
    notes: it.reason || null,
  }));

  const { data, error } = await supabaseAdmin
    .from('uinv_issues')
    .insert({
      property_id: propertyId,
      issue_number: issueNumber,
      department: 'Housekeeping',
      requester: requestedBy,
      priority: 'Normal',
      approval_status: 'Pending',
      source: 'Requisition',
      store_id: HK_STORE_ID,
      lines,
      notes: notes || null,
      created_by: isUuid(req.user?.id) ? req.user!.id : requestedBy,
    })
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });

  cacheService.invalidatePattern('^hk-inventory-central:');
  return res.status(201).json({
    id: data.id,
    number: data.issue_number,
    status: data.approval_status,
    totalCost: lines.reduce((sum: number, l: any) => sum + l.requestedQty * l.unitCost, 0),
  });
});

// Approve a requisition (optionally set approved quantities).
router.put('/inventory/requisitions/:id/approve', authenticate, requirePermission('hk:inventory:manage'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const { approvedQuantities } = req.body || {};

  // Fetch existing issue to update lines
  const { data: existing } = await supabaseAdmin
    .from('uinv_issues')
    .select('lines')
    .eq('id', req.params.id)
    .single();

  let updatedLines = existing?.lines || [];
  if (Array.isArray(approvedQuantities)) {
    updatedLines = updatedLines.map((line: any, idx: number) => {
      const aq = approvedQuantities.find((a: any) => a.id === `${req.params.id}-line-${idx}` || a.lineIndex === idx);
      if (aq) {
        return { ...line, approvedQty: Number(aq.approvedQuantity) };
      }
      return line;
    });
  }

  const { data, error } = await supabaseAdmin
    .from('uinv_issues')
    .update({ approval_status: 'Approved', lines: updatedLines, approved_by: req.user?.name || 'system', approved_at: new Date().toISOString() })
    .eq('id', req.params.id)
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });

  return res.json({ success: true, id: data.id, status: data.approval_status });
});

// Issue a requisition — moves stock from Main Warehouse to HK store via uinv_stock_balances.
router.put('/inventory/requisitions/:id/issue', authenticate, requirePermission('hk:inventory:manage'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const { data: reqRow, error: reqError } = await supabaseAdmin
    .from('uinv_issues')
    .select('*')
    .eq('id', req.params.id)
    .single();
  if (reqError) return res.status(500).json({ error: reqError.message });
  if (!reqRow) return res.status(404).json({ error: 'Requisition not found' });
  if (reqRow.approval_status !== 'Approved') {
    return res.status(400).json({ error: `Requisition must be approved first (current: ${reqRow.approval_status})` });
  }

  const propertyId = reqRow.property_id;
  if (!propertyId) return res.status(400).json({ error: 'Requisition has no property_id' });

  const now = new Date().toISOString();

  // For each line, move stock from Main Warehouse to HK/Linen store
  for (const line of (reqRow.lines || [])) {
    const issueQty = line.approvedQty !== null && line.approvedQty !== undefined
      ? Number(line.approvedQty)
      : Number(line.requestedQty || 0);
    if (issueQty <= 0) continue;

    const itemId = line.itemId;
    if (!itemId) continue;

    // Determine target store based on item subcategory
    const { data: itemInfo } = await supabaseAdmin
      .from('uinv_items')
      .select('subcategory')
      .eq('id', itemId)
      .maybeSingle();
    const targetStoreId = (itemInfo?.subcategory === 'Laundry Supplies') ? HK_LINEN_STORE_ID : HK_STORE_ID;

    // Deduct from Main Warehouse
    const { data: mainBalance } = await supabaseAdmin
      .from('uinv_stock_balances')
      .select('id, on_hand, unit_cost')
      .eq('item_id', itemId)
      .eq('store_id', MAIN_STORE_ID)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (mainBalance) {
      const newMainQty = Math.max(0, Number(mainBalance.on_hand) - issueQty);
      await supabaseAdmin
        .from('uinv_stock_balances')
        .update({ on_hand: newMainQty, last_movement_date: now, updated_at: now })
        .eq('id', mainBalance.id);

      // Log Main out
      await supabaseAdmin.from('uinv_stock_ledger').insert({
        property_id: propertyId,
        item_id: itemId,
        store_id: MAIN_STORE_ID,
        transaction_type: 'Transfer Out',
        reference: `Req ${reqRow.issue_number}: Main → HK`,
        quantity_in: 0,
        quantity_out: issueQty,
        balance: newMainQty,
        unit_cost: Number(mainBalance.unit_cost || 0),
        value: issueQty * Number(mainBalance.unit_cost || 0),
        performed_by: isUuid(req.user?.id) ? req.user!.id : 'system',
        reason: `Requisition ${reqRow.issue_number} issued to HK`,
        transaction_date: now,
      });
    }

    // Add to HK/Linen store
    const { data: hkBalance } = await supabaseAdmin
      .from('uinv_stock_balances')
      .select('id, on_hand, unit_cost')
      .eq('item_id', itemId)
      .eq('store_id', targetStoreId)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (hkBalance) {
      const newHkQty = Number(hkBalance.on_hand) + issueQty;
      await supabaseAdmin
        .from('uinv_stock_balances')
        .update({ on_hand: newHkQty, last_movement_date: now, updated_at: now })
        .eq('id', hkBalance.id);
    } else {
      // Create new balance row in HK store
      const newBalanceId = `UINV-SB-HK-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      await supabaseAdmin.from('uinv_stock_balances').insert({
        id: newBalanceId,
        property_id: propertyId,
        item_id: itemId,
        store_id: targetStoreId,
        location_id: null,
        on_hand: issueQty,
        reserved: 0, allocated: 0, on_order: 0, in_transit: 0,
        damaged: 0, quarantined: 0, expired: 0,
        status: 'Available',
        unit_cost: Number(mainBalance?.unit_cost || line.unitCost || 0),
        last_movement_date: now,
      });
    }

    // Log HK in
    await supabaseAdmin.from('uinv_stock_ledger').insert({
      property_id: propertyId,
      item_id: itemId,
      store_id: targetStoreId,
      transaction_type: 'Transfer In',
      reference: `Req ${reqRow.issue_number}: Main → HK`,
      quantity_in: issueQty,
      quantity_out: 0,
      balance: Number(hkBalance?.on_hand || 0) + issueQty,
      unit_cost: Number(mainBalance?.unit_cost || line.unitCost || 0),
      value: issueQty * Number(mainBalance?.unit_cost || line.unitCost || 0),
      performed_by: isUuid(req.user?.id) ? req.user!.id : 'system',
      reason: `Requisition ${reqRow.issue_number} received from Main`,
      transaction_date: now,
    });
  }

  // Mark requisition as Issued
  const { error: updateError } = await supabaseAdmin
    .from('uinv_issues')
    .update({ approval_status: 'Issued', issued_by: req.user?.name || 'system', issued_at: now })
    .eq('id', req.params.id);
  if (updateError) return res.status(500).json({ error: updateError.message });

  cacheService.invalidatePattern('^hk-inventory-central:');
  return res.json({ success: true, id: req.params.id, status: 'Issued' });
});

// Reject a requisition.
router.put('/inventory/requisitions/:id/reject', authenticate, requirePermission('hk:inventory:manage'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const { data, error } = await supabaseAdmin
    .from('uinv_issues')
    .update({ approval_status: 'Rejected' })
    .eq('id', req.params.id)
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });

  return res.json({ success: true, id: data.id, status: data.approval_status });
});

// ── Lost & Found Workflow Enhancement with Photo Upload ───────────────
// Create lost & found item
router.post('/lost-found', authenticate, requirePermission('hk:lostfound:manage'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const {
    propertyId,
    roomNumber,
    itemName,
    itemDescription,
    itemCategory,
    foundBy,
    foundByName,
    photoUrl,
    foundLocation,
    dateFound,
  } = req.body || {};

  if (!propertyId || !itemName || !foundBy || !foundLocation) {
    return res.status(400).json({ error: 'propertyId, itemName, foundBy, and foundLocation are required' });
  }

  const now = new Date();
  const foundDate = dateFound ? dateFound.slice(0, 10) : now.toISOString().slice(0, 10);
  const foundTime = now.toTimeString().slice(0, 8);

  const { data, error } = await supabaseAdmin.from('lost_found').insert({
    property_id: propertyId,
    item_name: itemName,
    item_description: itemDescription || undefined,
    item_category: itemCategory || undefined,
    found_location: foundLocation,
    found_date: foundDate,
    found_time: foundTime,
    found_by: foundBy,
    found_by_name: foundByName || undefined,
    room_number: roomNumber || undefined,
    photo_url: photoUrl || undefined,
    status: 'Found',
    created_at: now.toISOString(),
    updated_at: now.toISOString(),
  }).select().single();

  if (error) return res.status(500).json({ error: error.message });

  cacheService.invalidatePattern('^hk-supervisor-console:');
  return res.status(201).json(data);
});

// Get lost & found items
router.get('/lost-found/:propertyId', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const { status } = req.query as Record<string, string>;

  let q = supabaseAdmin
    .from('lost_found')
    .select('id, item_name, item_description, item_category, found_location, found_date, found_time, found_by, found_by_name, room_number, status, storage_location, photo_url, claimed_by, claimed_date, follow_up_required, property_id')
    .eq('property_id', req.params.propertyId)
    .order('found_date', { ascending: false });

  if (status) q = q.eq('status', status);

  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });

  return res.json({
    propertyId: req.params.propertyId,
    items: data || [],
  });
});

// Update lost & found item status
router.put('/lost-found/:id', authenticate, requirePermission('hk:lostfound:manage'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const { status, claimedBy, claimDate, notes, storageLocation } = req.body || {};

  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (status !== undefined) update.status = status;
  if (claimedBy !== undefined) update.claimed_by = claimedBy;
  if (claimDate !== undefined) update.claimed_date = claimDate;
  if (storageLocation !== undefined) update.storage_location = storageLocation;
  if (notes !== undefined) update.resolution_notes = notes;

  const { data, error } = await supabaseAdmin
    .from('lost_found')
    .update(update)
    .eq('id', req.params.id)
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });

  cacheService.invalidatePattern('^hk-supervisor-console:');
  return res.json(data);
});

// ── Phase 4: Performance Analytics and Productivity Tracking ───────────
// Get performance analytics
router.get('/performance/:propertyId', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  
  const { period, attendantId } = req.query as Record<string, string>;
  
  const cacheKey = `hk-performance:${req.params.propertyId}:${period || 'month'}:${attendantId || 'all'}`;
  const cached = cacheService.get(cacheKey);
  if (cached) return res.json(cached);

  const days = period === 'quarter' ? 90 : period === 'year' ? 365 : 30;
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);

  const analytics = await calculatePerformanceAnalytics(req.params.propertyId, startDate, attendantId);

  const result = {
    propertyId: req.params.propertyId,
    period: days,
    attendantId: attendantId || 'all',
    analytics,
    generatedAt: new Date().toISOString(),
  };

  cacheService.set(cacheKey, result, 30 * 60 * 1000);
  return res.json(result);
});

async function calculatePerformanceAnalytics(propertyId: string, startDate: Date, attendantId?: string) {
  let q = supabaseAdmin
    .from('housekeeping_tasks')
    .select('*, profiles(full_name)')
    .eq('property_id', propertyId)
    .gte('created_at', startDate.toISOString());

  if (attendantId) q = q.eq('assigned_to', attendantId);

  const { data: tasks } = await q;

  const completedTasks = (tasks || []).filter(t => t.status === 'completed');
  const avgCleaningTime = completedTasks.length > 0
    ? completedTasks.reduce((sum, t) => sum + (t.actual_duration || t.estimated_duration || 0), 0) / completedTasks.length
    : 0;

  return {
    totalTasks: (tasks || []).length,
    completedTasks: completedTasks.length,
    inProgressTasks: (tasks || []).filter(t => t.status === 'in_progress').length,
    pendingTasks: (tasks || []).filter(t => t.status === 'pending').length,
    completionRate: (tasks || []).length > 0 ? (completedTasks.length / (tasks || []).length) * 100 : 0,
    avgCleaningTime,
    byAttendant: attendantId ? null : groupPerformanceByAttendant(tasks || []),
  };
}

function groupPerformanceByAttendant(tasks: any[]) {
  const grouped: Record<string, any[]> = {};
  tasks.forEach(t => {
    const attendantId = t.assigned_to;
    if (!grouped[attendantId]) grouped[attendantId] = [];
    grouped[attendantId].push(t);
  });

  return Object.entries(grouped).map(([attendantId, attTasks]) => ({
    attendantId,
    attendantName: attTasks[0]?.profiles?.full_name,
    totalTasks: attTasks.length,
    completedTasks: attTasks.filter(t => t.status === 'completed').length,
    completionRate: attTasks.length > 0 ? (attTasks.filter(t => t.status === 'completed').length / attTasks.length) * 100 : 0,
    avgCleaningTime: attTasks.filter(t => t.status === 'completed').reduce((sum, t) => sum + (t.actual_duration || t.estimated_duration || 0), 0) / (attTasks.filter(t => t.status === 'completed').length || 1),
  }));
}

// ── Clean Room Rate Metrics ────────────────────────────────────────────
// Get clean room rate
router.get('/metrics/clean-room-rate/:propertyId', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  
  const { period } = req.query as Record<string, string>;
  
  const cacheKey = `hk-clean-rate:${req.params.propertyId}:${period || 'month'}`;
  const cached = cacheService.get(cacheKey);
  if (cached) return res.json(cached);

  const days = period === 'quarter' ? 90 : period === 'year' ? 365 : 30;
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);

  const { data: rooms } = await supabaseAdmin
    .from('rooms')
    .select('*')
    .eq('property_id', req.params.propertyId);

  const { data: tasks } = await supabaseAdmin
    .from('housekeeping_tasks')
    .select('*')
    .eq('property_id', req.params.propertyId)
    .gte('created_at', startDate.toISOString());

  const cleanRate = calculateCleanRoomRate(rooms || [], tasks || []);

  const result = {
    propertyId: req.params.propertyId,
    period: days,
    cleanRate,
    generatedAt: new Date().toISOString(),
  };

  cacheService.set(cacheKey, result, 30 * 60 * 1000);
  return res.json(result);
});

function calculateCleanRoomRate(rooms: any[], tasks: any[]) {
  const totalRooms = rooms.length;
  const cleanedRooms = tasks.filter(t => t.status === 'completed').length;

  return {
    totalRooms,
    cleanedRooms,
    cleanRoomRate: totalRooms > 0 ? (cleanedRooms / totalRooms) * 100 : 0,
    targetRate: 95,
    gap: totalRooms > 0 ? 95 - ((cleanedRooms / totalRooms) * 100) : 95,
  };
}

// ── Average Cleaning Time Tracking ─────────────────────────────────────
// Get average cleaning time
router.get('/metrics/cleaning-time/:propertyId', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  
  const { period } = req.query as Record<string, string>;
  
  const cacheKey = `hk-cleaning-time:${req.params.propertyId}:${period || 'month'}`;
  const cached = cacheService.get(cacheKey);
  if (cached) return res.json(cached);

  const days = period === 'quarter' ? 90 : period === 'year' ? 365 : 30;
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);

  const { data: tasks } = await supabaseAdmin
    .from('housekeeping_tasks')
    .select('*')
    .eq('property_id', req.params.propertyId)
    .eq('status', 'completed')
    .gte('created_at', startDate.toISOString());

  const cleaningTime = calculateAverageCleaningTime(tasks || []);

  const result = {
    propertyId: req.params.propertyId,
    period: days,
    cleaningTime,
    generatedAt: new Date().toISOString(),
  };

  cacheService.set(cacheKey, result, 30 * 60 * 1000);
  return res.json(result);
});

function calculateAverageCleaningTime(tasks: any[]) {
  if (tasks.length === 0) {
    return { averageTime: 0, targetTime: 30, variance: 0 };
  }

  const times = tasks.map(t => t.actual_duration || t.estimated_duration || 30);
  const averageTime = times.reduce((sum, t) => sum + t, 0) / times.length;
  const variance = times.reduce((sum, t) => sum + Math.pow(t - averageTime, 2), 0) / times.length;

  return {
    averageTime: Math.round(averageTime),
    targetTime: 30,
    variance: Math.round(Math.sqrt(variance)),
    withinTarget: averageTime <= 30,
    byTaskType: groupCleaningTimeByTaskType(tasks),
  };
}

function groupCleaningTimeByTaskType(tasks: any[]) {
  const grouped: Record<string, number[]> = {};
  tasks.forEach(t => {
    const type = t.task_type;
    if (!grouped[type]) grouped[type] = [];
    // Prefer actual_duration (from DB column), then compute from timestamps,
    // then fall back to estimated_duration, then 30 min default.
    let duration = t.actual_duration;
    if (!duration && t.started_at && t.completed_at) {
      const start = new Date(t.started_at).getTime();
      const end = new Date(t.completed_at).getTime();
      if (end > start) duration = Math.round((end - start) / 60000);
    }
    grouped[type].push(duration || t.estimated_duration || 30);
  });

  return Object.entries(grouped).map(([type, times]) => ({
    taskType: type,
    averageTime: Math.round(times.reduce((sum, t) => sum + t, 0) / times.length),
    count: times.length,
  }));
}

// ── Linen Cost Per Room Analysis ───────────────────────────────────────
// Get linen cost per room
router.get('/metrics/linen-cost/:propertyId', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  
  const { period } = req.query as Record<string, string>;
  
  const cacheKey = `hk-linen-cost:${req.params.propertyId}:${period || 'month'}`;
  const cached = cacheService.get(cacheKey);
  if (cached) return res.json(cached);

  const days = period === 'quarter' ? 90 : period === 'year' ? 365 : 30;
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);

  const { data: consumption } = await supabaseAdmin
    .from('supply_consumption')
    .select('*')
    .eq('property_id', req.params.propertyId)
    .eq('item_category', 'linen')
    .gte('consumption_date', startDate.toISOString());

  const { data: rooms } = await supabaseAdmin
    .from('rooms')
    .select('*')
    .eq('property_id', req.params.propertyId);

  const linenCost = calculateLinenCostPerRoom(consumption || [], rooms || []);

  const result = {
    propertyId: req.params.propertyId,
    period: days,
    linenCost,
    generatedAt: new Date().toISOString(),
  };

  cacheService.set(cacheKey, result, 30 * 60 * 1000);
  return res.json(result);
});

function calculateLinenCostPerRoom(consumption: any[], rooms: any[]) {
  const totalCost = consumption.reduce((sum, c) => sum + (c.quantity * c.unit_cost), 0);
  const totalRooms = rooms.length;

  return {
    totalCost,
    totalRooms,
    costPerRoom: totalRooms > 0 ? totalCost / totalRooms : 0,
    targetCostPerRoom: 5,
    variance: totalRooms > 0 ? (totalCost / totalRooms) - 5 : 0,
    byItemType: consumption.reduce((acc: any, c) => {
      acc[c.item_type] = (acc[c.item_type] || 0) + (c.quantity * c.unit_cost);
      return acc;
    }, {}),
  };
}

// ── Staff Performance Dashboards ────────────────────────────────────────
// Get staff performance dashboard
router.get('/dashboard/staff/:propertyId', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  
  const { period } = req.query as Record<string, string>;
  
  const cacheKey = `hk-staff-dashboard:${req.params.propertyId}:${period || 'month'}`;
  const cached = cacheService.get(cacheKey);
  if (cached) return res.json(cached);

  const days = period === 'quarter' ? 90 : period === 'year' ? 365 : 30;
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);

  const { data: staff } = await supabaseAdmin
    .from('profiles')
    .select('*')
    .eq('property_id', req.params.propertyId)
    .eq('role', 'housekeeping')
    .eq('is_active', true);

  const staffPerformance = await Promise.all(
    (staff || []).map(async (s) => {
      const analytics = await calculatePerformanceAnalytics(req.params.propertyId, startDate, s.id);
      const qualityScores = await getStaffQualityScores(req.params.propertyId, s.id, startDate);

      return {
        attendantId: s.id,
        attendantName: s.full_name,
        tasks: analytics,
        quality: qualityScores,
      };
    })
  );

  const result = {
    propertyId: req.params.propertyId,
    period: days,
    staffPerformance,
    summary: {
      totalStaff: staffPerformance.length,
      avgCompletionRate: staffPerformance.reduce((sum, s) => sum + s.tasks.completionRate, 0) / (staffPerformance.length || 1),
      avgQualityScore: staffPerformance.reduce((sum, s) => sum + s.quality.averageScore, 0) / (staffPerformance.length || 1),
    },
    generatedAt: new Date().toISOString(),
  };

  cacheService.set(cacheKey, result, 15 * 60 * 1000);
  return res.json(result);
});

async function getStaffQualityScores(propertyId: string, attendantId: string, startDate: Date) {
  const { data: inspections } = await supabaseAdmin
    .from('quality_inspections')
    .select('*')
    .eq('property_id', propertyId)
    .eq('inspector_id', attendantId)
    .gte('inspection_date', startDate.toISOString());

  if ((inspections || []).length === 0) {
    return { averageScore: 0, totalInspections: 0 };
  }

  return {
    averageScore: inspections.reduce((sum, i) => sum + (i.overall_score || 0), 0) / inspections.length,
    totalInspections: inspections.length,
  };
}

// ── Shared helpers for Task Management ──────────────────────────────────
// Service types for room-cleaning tasks (optional field on unified tasks).
const CLEANING_SERVICE_TYPES = new Set([
  'Full Service', 'Stayover Service', 'Express Service', 'Eco Service', 'Turndown Service',
]);

function nowTimeLabel(): string {
  // Returns an ISO 8601 timestamp. The started_at / completed_at columns are
  // TIMESTAMPTZ (migration 318); time-only labels broke date-based bucketing.
  return new Date().toISOString();
}

// ── Task Management (docs/Housekeeping Portal new.md §6) ────────────────
// Backs the Task Management module: automatic (8) + manual (5) housekeeping
// task types with category/location/priority/dueDate/status/progress.
// Persisted to housekeeping_task_mgmt (distinct from the legacy
// housekeeping_tasks table which models room-bound scheduled jobs).
const TASK_TYPES = new Set([
  'Checkout Cleaning', 'Stayover Service', 'VIP Preparation', 'Turndown Service',
  'Early Arrival Preparation', 'Deep Cleaning', 'Preventive Cleaning', 'Public Area Cleaning',
  'Special Cleaning', 'Emergency Cleaning', 'Biohazard Cleaning', 'Room Refresh',
  'Guest Complaint Follow-up',
]);
const TASK_CATEGORIES = new Set(['Automatic', 'Manual']);
const TASK_PRIORITIES = new Set(['Low', 'Medium', 'High', 'Critical']);
const TASK_STATUSES = new Set(['Pending', 'In Progress', 'Completed', 'Verified']);
const TASK_STATUS_ORDER: Record<string, number> = {
  'Pending': 0, 'In Progress': 1, 'Completed': 2, 'Verified': 3,
};

// Shape a DB row into the camelCase contract the frontend expects.
function shapeTask(row: any) {
  return {
    id: row.id,
    type: row.type,
    category: row.category,
    location: row.location,
    assignedTo: row.assigned_to || undefined,
    attendantId: row.attendant_id || null,
    priority: row.priority,
    dueDate: row.due_date,
    status: row.status,
    progress: row.progress,
    checklist: row.checklist || {},
    serviceType: row.service_type || undefined,
    floor: row.floor || undefined,
    startedAt: row.started_at || undefined,
    completedAt: row.completed_at || undefined,
    notes: row.notes || undefined,
    subtype: row.subtype || undefined,
    frequency: row.frequency || undefined,
    lastCleaned: row.last_cleaned || undefined,
    estimatedDuration: row.estimated_duration ?? undefined,
    actualDuration: row.actual_duration ?? undefined,
    propertyId: row.property_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function categoryForType(type: string): 'Automatic' | 'Manual' {
  // Mirrors AUTOMATIC_TYPES in TaskManagementModule.tsx
  const automatic = [
    'Checkout Cleaning', 'Stayover Service', 'VIP Preparation', 'Turndown Service',
    'Early Arrival Preparation', 'Deep Cleaning', 'Preventive Cleaning', 'Public Area Cleaning',
  ];
  return automatic.includes(type) ? 'Automatic' : 'Manual';
}

// Post inventory consumption for a completed task. Reads the
// hk_task_consumption_profiles table (migration 313) for the task's type
// (+ optional subtype), then calls adjustHkStore() for each profile line.
// Returns the list of warnings so the caller can surface them to the UI.
//
// This closes the gap where room cleaning, public area cleaning, deep
// cleaning, and preventive cleaning task completions posted ZERO inventory
// consumption — making the Consumption and Variance tabs unreliable.
async function postTaskConsumption(
  task: { id: string; type: string; subtype?: string | null; property_id?: string | null; location?: string },
  actorId?: string
): Promise<string[]> {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return [];
  if (!task.property_id) return [];

  const propertyId = task.property_id;
  const taskType = task.type;
  const subtype = task.subtype || null;

  // Look up profiles: prefer property-specific, fall back to system defaults
  // (property_id IS NULL). Match both the exact subtype and the generic
  // (subtype IS NULL) profile for the task type.
  const { data: profiles, error } = await supabaseAdmin
    .from('hk_task_consumption_profiles')
    .select('item_name, item_category, quantity, subtype')
    .or(`property_id.eq.${propertyId},property_id.is.null`)
    .eq('task_type', taskType)
    .order('property_id', { ascending: false, nullsFirst: false }); // property-specific first

  if (error || !profiles || profiles.length === 0) return [];

  // Deduplicate: if a property-specific profile and a system default both
  // match the same (item_name, subtype), keep the property-specific one.
  const seen = new Set<string>();
  const warnings: string[] = [];
  for (const p of profiles) {
    // Skip subtype-specific profiles that don't match the task's subtype.
    if (p.subtype && p.subtype !== subtype) continue;
    const key = `${p.item_name}|${p.subtype || ''}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const qty = Number(p.quantity);
    if (!qty || qty <= 0) continue;

    const result = await adjustHkStore(
      propertyId,
      p.item_name,
      p.item_category as any,
      qty,
      'consume',
      isUuid(actorId) ? actorId : undefined,
      undefined,
      `Task consumption: ${taskType}${subtype ? ` (${subtype})` : ''} — ${task.location || task.id}`
    );
    if (!result.ok && (result.reason === 'unlinked' || result.reason === 'ambiguous') && result.warning) {
      warnings.push(result.warning);
    } else if (result.ok && result.warning) {
      // Soft warning: name-match was used — surface for cleanup but don't fail.
      warnings.push(result.warning);
    }
  }
  return warnings;
}

// List tasks for a property (optional status / category filters).
router.get('/task-management/:propertyId', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const { status, category, type } = req.query as Record<string, string>;

  const cacheKey = `hk-task-mgmt:${req.params.propertyId}:${status || 'all'}:${category || 'all'}:${type || 'all'}`;
  const cached = cacheService.get(cacheKey);
  if (cached) return res.json(cached);

  let q = supabaseAdmin
    .from('housekeeping_task_mgmt')
    .select('*')
    .eq('property_id', req.params.propertyId)
    .order('due_date', { ascending: true });

  if (status && TASK_STATUSES.has(status)) q = q.eq('status', status);
  if (category && TASK_CATEGORIES.has(category)) q = q.eq('category', category);
  if (type && TASK_TYPES.has(type)) q = q.eq('type', type);

  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });

  const tasks = (data || []).map(shapeTask);
  const result = {
    propertyId: req.params.propertyId,
    tasks,
    summary: {
      total: tasks.length,
      automatic: tasks.filter(t => t.category === 'Automatic').length,
      manual: tasks.filter(t => t.category === 'Manual').length,
      pending: tasks.filter(t => t.status === 'Pending').length,
      inProgress: tasks.filter(t => t.status === 'In Progress').length,
      completed: tasks.filter(t => t.status === 'Completed' || t.status === 'Verified').length,
    },
    generatedAt: new Date().toISOString(),
  };

  cacheService.set(cacheKey, result, 30 * 1000);
  return res.json(result);
});

// Housekeeping staff for the property — used by the assignee dropdown.
router.get('/task-management/staff/:propertyId', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const { data, error } = await supabaseAdmin
    .from('housekeeping_staff')
    .select('id, name, status')
    .eq('property_id', req.params.propertyId)
    .eq('is_active', true)
    .order('name');

  if (error) return res.status(500).json({ error: error.message });

  return res.json({ propertyId: req.params.propertyId, staff: data || [] });
});

// Task counts per staff member for a property — used by Staff Management
// to show how many tasks each staff member is assigned, broken down by status.
router.get('/task-management/staff-counts/:propertyId', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { data, error } = await supabaseAdmin
    .from('housekeeping_task_mgmt')
    .select('attendant_id, status')
    .eq('property_id', req.params.propertyId)
    .not('attendant_id', 'is', null);
  if (error) return res.status(500).json({ error: error.message });

  const counts: Record<string, { total: number; pending: number; inProgress: number; completed: number }> = {};
  for (const row of data || []) {
    const id = row.attendant_id;
    if (!id) continue;
    if (!counts[id]) counts[id] = { total: 0, pending: 0, inProgress: 0, completed: 0 };
    counts[id].total++;
    if (row.status === 'Pending') counts[id].pending++;
    else if (row.status === 'In Progress') counts[id].inProgress++;
    else if (row.status === 'Completed' || row.status === 'Verified') counts[id].completed++;
  }
  return res.json({ propertyId: req.params.propertyId, counts });
});

// Tasks assigned to a specific staff member — used by Staff Management
// to show a per-staff task list in a detail modal.
router.get('/task-management/staff-tasks/:propertyId/:staffId', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { data, error } = await supabaseAdmin
    .from('housekeeping_task_mgmt')
    .select('*')
    .eq('property_id', req.params.propertyId)
    .eq('attendant_id', req.params.staffId)
    .order('due_date', { ascending: true });
  if (error) return res.status(500).json({ error: error.message });
  const tasks = (data || []).map(shapeTask);
  return res.json({ staffId: req.params.staffId, tasks });
});

// Batch-create tasks. Accepts a `tasks` array (each: type, location, and
// optional overrides) plus shared fields (assignedTo, priority, dueDate).
router.post('/task-management', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const { propertyId, assignedTo, priority, dueDate, tasks } = req.body || {};
  if (!propertyId || !Array.isArray(tasks) || tasks.length === 0) {
    return res.status(400).json({ error: 'propertyId and a non-empty tasks array are required' });
  }

  const sharedPriority = priority && TASK_PRIORITIES.has(priority) ? priority : 'Medium';
  const fallbackDue = dueDate || new Date().toISOString().slice(0, 16).replace('T', ' ');

  const rows = tasks.map((t: any, i: number) => {
    const type = t.type;
    if (!type || !TASK_TYPES.has(type)) {
      throw new Error(`Invalid task type: ${type}`);
    }
    if (!t.location || !String(t.location).trim()) {
      throw new Error(`Row ${i + 1} is missing a location`);
    }
    if (t.serviceType !== undefined && t.serviceType !== null && !CLEANING_SERVICE_TYPES.has(t.serviceType)) {
      throw new Error(`Invalid serviceType: ${t.serviceType}`);
    }
    return {
      id: `TSK-${Date.now()}-${i + 1}`,
      property_id: propertyId,
      type,
      category: categoryForType(type),
      location: String(t.location).trim(),
      assigned_to: (t.assignedTo ?? assignedTo)?.trim() || null,
      attendant_id: t.attendantId?.trim() || null,
      priority: (t.priority && TASK_PRIORITIES.has(t.priority)) ? t.priority : sharedPriority,
      due_date: (t.dueDate ?? dueDate) || fallbackDue,
      status: 'Pending',
      progress: 0,
      service_type: t.serviceType || null,
      floor: t.floor?.trim() || null,
      notes: t.notes?.trim() || null,
      subtype: t.subtype?.trim() || null,
      frequency: t.frequency?.trim() || null,
      estimated_duration: Number(t.estimatedDuration) || null,
    };
  });

  let parsed: any[];
  try {
    parsed = rows;
  } catch (e: any) {
    return res.status(400).json({ error: e?.message || 'Invalid task payload' });
  }

  const { data, error } = await supabaseAdmin
    .from('housekeeping_task_mgmt')
    .insert(parsed)
    .select('*');

  if (error) return res.status(500).json({ error: error.message });

  cacheService.invalidatePattern('^hk-task-mgmt:');
  return res.status(201).json({ tasks: (data || []).map(shapeTask) });
});

// Advance a task's status one step: Pending → In Progress → Completed → Verified.
// Progress is bumped to 30 when started, and to 100 when completed/verified.
// When a room-bound cleaning task completes, the room status is auto-advanced
// per docs §2 (Cleaning Performed → Inspection → Room Ready): Completed cleaning
// → 'Inspected' (ready for inspection), Verified → 'Vacant Clean' (ready for PMS).
router.put('/task-management/:id/advance', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const { data: current, error: fetchError } = await supabaseAdmin
    .from('housekeeping_task_mgmt')
    .select('status, progress, completed_at, started_at, actual_duration, type, location, property_id')
    .eq('id', req.params.id)
    .single();
  if (fetchError) return res.status(500).json({ error: fetchError.message });
  if (!current) return res.status(404).json({ error: 'Task not found' });

  const order = TASK_STATUS_ORDER[current.status] ?? 0;
  const nextStatus = (Object.keys(TASK_STATUS_ORDER).find(
    k => TASK_STATUS_ORDER[k] === order + 1
  ) || current.status) as string;
  if (!TASK_STATUSES.has(nextStatus)) {
    return res.status(400).json({ error: `No next status from ${current.status}` });
  }

  const update: any = { status: nextStatus };
  if (nextStatus === 'In Progress') {
    update.progress = current.progress === 0 ? 30 : current.progress;
  } else if (nextStatus === 'Completed' || nextStatus === 'Verified') {
    update.progress = 100;
    if (!current.completed_at) update.completed_at = nowTimeLabel();
    // Compute actual_duration from started_at → completed_at if possible.
    if (current.started_at && !current.actual_duration) {
      const start = new Date(current.started_at).getTime();
      const end = Date.now();
      if (end > start) update.actual_duration = Math.round((end - start) / 60000);
    }
  }

  const { data, error } = await supabaseAdmin
    .from('housekeeping_task_mgmt')
    .update(update)
    .eq('id', req.params.id)
    .select('*')
    .single();

  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Task not found' });

  // Post inventory consumption when the task FIRST transitions to Completed.
  // Skip if the task was already Completed (re-advancing to Verified).
  let consumptionWarnings: string[] = [];
  if (nextStatus === 'Completed' && current.status !== 'Completed') {
    consumptionWarnings = await postTaskConsumption(data, req.user?.id);
  }

  // Auto-advance room status for room-bound cleaning tasks (docs §2 workflow).
  // Only applies to tasks whose location is a room number (numeric or room-like)
  // and whose type is a room cleaning type. Public area tasks don't touch rooms.
  const ROOM_TASK_TYPES = new Set([
    'Checkout Cleaning', 'Stayover Service', 'VIP Preparation', 'Turndown Service',
    'Early Arrival Preparation', 'Deep Cleaning', 'Preventive Cleaning',
    'Special Cleaning', 'Emergency Cleaning', 'Biohazard Cleaning', 'Room Refresh',
    'Guest Complaint Follow-up',
  ]);
  if (ROOM_TASK_TYPES.has(current.type) && current.location && current.property_id) {
    try {
      // Verify the location corresponds to a real room before updating.
      const { data: roomRow } = await supabaseAdmin
        .from('rooms')
        .select('id, status')
        .eq('property_id', current.property_id)
        .eq('number', current.location)
        .maybeSingle();
      if (roomRow) {
        let newRoomStatus: string | null = null;
        if (nextStatus === 'Completed') {
          // Cleaning done → mark Inspected (ready for supervisor inspection).
          newRoomStatus = 'Inspected';
        } else if (nextStatus === 'Verified') {
          // Verified → Vacant Clean (ready for release to PMS / next arrival).
          newRoomStatus = 'Vacant Clean';
        }
        if (newRoomStatus && roomRow.status !== newRoomStatus) {
          await supabaseAdmin
            .from('rooms')
            .update({ status: newRoomStatus, updated_at: new Date().toISOString() })
            .eq('id', roomRow.id);
        }
      }
    } catch (roomErr: any) {
      // Non-fatal: the task still advanced; log and continue.
      console.warn('[hk-task-mgmt] room status auto-advance failed:', roomErr?.message);
    }
  }

  cacheService.invalidatePattern('^hk-task-mgmt:');
  return res.json({
    ...shapeTask(data),
    ...(consumptionWarnings.length > 0 ? { consumptionWarnings } : {}),
  });
});

// Start a pending task (Pending → In Progress, stamp startedAt).
router.put('/task-management/:id/start', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const { data: current } = await supabaseAdmin
    .from('housekeeping_task_mgmt')
    .select('status, started_at')
    .eq('id', req.params.id)
    .single();

  const update: any = { status: 'In Progress' };
  if (!current?.started_at) update.started_at = nowTimeLabel();
  if (current && current.status === 'Pending') update.progress = 30;

  const { data, error } = await supabaseAdmin
    .from('housekeeping_task_mgmt')
    .update(update)
    .eq('id', req.params.id)
    .select('*')
    .single();

  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Task not found' });

  cacheService.invalidatePattern('^hk-task-mgmt:');
  return res.json(shapeTask(data));
});

// Toggle a single checklist step. The checklist is a free-form
// Record<string, boolean> — the client owns the step definitions via
// getChecklistForType(). The client may also send a `status` override
// (e.g. Completed when all steps are done) since only the client knows
// the total step count for the task type.
router.put('/task-management/:id/checklist', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const { step, value, status } = req.body || {};
  if (!step || typeof step !== 'string') {
    return res.status(400).json({ error: 'step is required' });
  }

  const { data: current, error: fetchError } = await supabaseAdmin
    .from('housekeeping_task_mgmt')
    .select('checklist, status, started_at')
    .eq('id', req.params.id)
    .single();
  if (fetchError) return res.status(500).json({ error: fetchError.message });
  if (!current) return res.status(404).json({ error: 'Task not found' });

  const checklist: Record<string, boolean> =
    (current.checklist && typeof current.checklist === 'object') ? { ...current.checklist } : {};
  const nextValue = typeof value === 'boolean' ? value : !checklist[step];
  checklist[step] = nextValue;

  const update: any = { checklist };
  // Auto-promote Pending → In Progress when first step is checked.
  if (current.status === 'Pending' && nextValue) {
    update.status = 'In Progress';
    if (!current.started_at) update.started_at = nowTimeLabel();
  }
  // Client-computed status override (e.g. Completed when all done).
  if (status && TASK_STATUSES.has(status)) {
    update.status = status;
    if (status === 'Completed' || status === 'Verified') {
      update.progress = 100;
      update.completed_at = nowTimeLabel();
    }
  }

  const { data, error } = await supabaseAdmin
    .from('housekeeping_task_mgmt')
    .update(update)
    .eq('id', req.params.id)
    .select('*')
    .single();

  if (error) return res.status(500).json({ error: error.message });

  cacheService.invalidatePattern('^hk-task-mgmt:');
  return res.json(shapeTask(data));
});

// General update: reassign, change priority/dueDate/status/progress.
router.put('/task-management/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const { assignedTo, attendantId, priority, dueDate, status, progress,
          checklist, serviceType, floor, notes, subtype, frequency, lastCleaned } = req.body || {};

  // Fetch current state to detect transition to Completed (for consumption).
  const { data: before } = await supabaseAdmin
    .from('housekeeping_task_mgmt')
    .select('status, completed_at')
    .eq('id', req.params.id)
    .maybeSingle();

  const update: any = {};
  if (assignedTo !== undefined) update.assigned_to = assignedTo?.trim() || null;
  if (attendantId !== undefined) update.attendant_id = attendantId || null;
  if (priority !== undefined) {
    if (!TASK_PRIORITIES.has(priority)) return res.status(400).json({ error: `Invalid priority: ${priority}` });
    update.priority = priority;
  }
  if (dueDate !== undefined) update.due_date = dueDate;
  if (status !== undefined) {
    if (!TASK_STATUSES.has(status)) return res.status(400).json({ error: `Invalid status: ${status}` });
    update.status = status;
    if (status === 'Completed' || status === 'Verified') {
      update.progress = 100;
      if (!before?.completed_at) update.completed_at = nowTimeLabel();
    }
  }
  if (progress !== undefined) {
    const p = Number(progress);
    if (Number.isNaN(p) || p < 0 || p > 100) return res.status(400).json({ error: 'progress must be 0–100' });
    update.progress = p;
  }
  if (checklist !== undefined) update.checklist = checklist;
  if (serviceType !== undefined) {
    if (serviceType && !CLEANING_SERVICE_TYPES.has(serviceType)) {
      return res.status(400).json({ error: `Invalid serviceType: ${serviceType}` });
    }
    update.service_type = serviceType || null;
  }
  if (floor !== undefined) update.floor = floor || null;
  if (notes !== undefined) update.notes = notes || null;
  if (subtype !== undefined) update.subtype = subtype || null;
  if (frequency !== undefined) update.frequency = frequency || null;
  if (lastCleaned !== undefined) update.last_cleaned = lastCleaned || null;

  const { data, error } = await supabaseAdmin
    .from('housekeeping_task_mgmt')
    .update(update)
    .eq('id', req.params.id)
    .select('*')
    .single();

  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Task not found' });

  // Post inventory consumption when the task FIRST transitions to Completed.
  let consumptionWarnings: string[] = [];
  if (status === 'Completed' && before && before.status !== 'Completed') {
    consumptionWarnings = await postTaskConsumption(data, req.user?.id);
  }

  cacheService.invalidatePattern('^hk-task-mgmt:');
  return res.json({
    ...shapeTask(data),
    ...(consumptionWarnings.length > 0 ? { consumptionWarnings } : {}),
  });
});

// Delete a task.
router.delete('/task-management/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const { error } = await supabaseAdmin
    .from('housekeeping_task_mgmt')
    .delete()
    .eq('id', req.params.id);

  if (error) return res.status(500).json({ error: error.message });

  cacheService.invalidatePattern('^hk-task-mgmt:');
  return res.json({ success: true, id: req.params.id });
});

// Get consumption profiles for a property (property-specific + system defaults).
router.get('/task-consumption-profiles/:propertyId', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { data, error } = await supabaseAdmin
    .from('hk_task_consumption_profiles')
    .select('*')
    .or(`property_id.eq.${req.params.propertyId},property_id.is.null`)
    .order('task_type')
    .order('subtype', { ascending: true, nullsFirst: true })
    .order('item_name');
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ profiles: (data || []).map((p: any) => ({
    id: p.id,
    propertyId: p.property_id,
    taskType: p.task_type,
    subtype: p.subtype || null,
    itemName: p.item_name,
    itemCategory: p.item_category,
    quantity: Number(p.quantity),
  }))});
});

// Create a consumption profile (property-specific).
router.post('/task-consumption-profiles', authenticate, requirePermission('hk:inventory:manage'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { propertyId, taskType, subtype, itemName, itemCategory, quantity } = req.body || {};
  if (!taskType || !itemName) return res.status(400).json({ error: 'taskType and itemName are required' });
  if (!TASK_TYPES.has(taskType)) return res.status(400).json({ error: `Invalid taskType: ${taskType}` });
  const qty = Number(quantity);
  if (!Number.isFinite(qty) || qty <= 0) return res.status(400).json({ error: 'quantity must be > 0' });
  const validCats = ['cleaning_supplies','linens','equipment','amenities','other'];
  if (!validCats.includes(itemCategory)) return res.status(400).json({ error: `Invalid itemCategory` });

  const id = `TCP-${Date.now().toString(36).toUpperCase()}`;
  const { data, error } = await supabaseAdmin
    .from('hk_task_consumption_profiles')
    .insert({
      id,
      property_id: propertyId || null,
      task_type: taskType,
      subtype: subtype || null,
      item_name: String(itemName).trim().slice(0, 120),
      item_category: itemCategory,
      quantity: qty,
    })
    .select('*')
    .single();
  if (error) return res.status(500).json({ error: error.message });
  return res.status(201).json({ profile: {
    id: data.id,
    propertyId: data.property_id,
    taskType: data.task_type,
    subtype: data.subtype || null,
    itemName: data.item_name,
    itemCategory: data.item_category,
    quantity: Number(data.quantity),
  }});
});

// Batch-create multiple consumption profiles in one request. All lines share
// the same taskType + subtype; each line has its own itemName, itemCategory,
// and quantity. Returns the count of created profiles.
router.post('/task-consumption-profiles/batch', authenticate, requirePermission('hk:inventory:manage'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { propertyId, taskType, subtype, items } = req.body || {};
  if (!taskType || !TASK_TYPES.has(taskType)) return res.status(400).json({ error: `Invalid taskType: ${taskType}` });
  if (!Array.isArray(items) || items.length === 0) return res.status(400).json({ error: 'items array is required' });

  const validCats = ['cleaning_supplies','linens','equipment','amenities','other'];
  const rows: any[] = [];
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    const name = String(it.itemName || '').trim().slice(0, 120);
    const qty = Number(it.quantity);
    const cat = String(it.itemCategory || 'cleaning_supplies');
    if (!name) return res.status(400).json({ error: `items[${i}].itemName is required` });
    if (!Number.isFinite(qty) || qty <= 0) return res.status(400).json({ error: `items[${i}].quantity must be > 0` });
    if (!validCats.includes(cat)) return res.status(400).json({ error: `items[${i}].itemCategory is invalid` });
    rows.push({
      id: `TCP-${Date.now().toString(36).toUpperCase()}-${i}`,
      property_id: propertyId || null,
      task_type: taskType,
      subtype: subtype || null,
      item_name: name,
      item_category: cat,
      quantity: qty,
    });
  }

  const { data, error } = await supabaseAdmin
    .from('hk_task_consumption_profiles')
    .insert(rows)
    .select('id');
  if (error) return res.status(500).json({ error: error.message });
  return res.status(201).json({ created: (data || []).length, ids: (data || []).map((r: any) => r.id) });
});

// Update a consumption profile.
router.put('/task-consumption-profiles/:id', authenticate, requirePermission('hk:inventory:manage'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { taskType, subtype, itemName, itemCategory, quantity } = req.body || {};
  const update: any = {};
  if (taskType !== undefined) {
    if (!TASK_TYPES.has(taskType)) return res.status(400).json({ error: `Invalid taskType: ${taskType}` });
    update.task_type = taskType;
  }
  if (subtype !== undefined) update.subtype = subtype || null;
  if (itemName !== undefined) update.item_name = String(itemName).trim().slice(0, 120);
  if (itemCategory !== undefined) {
    const validCats = ['cleaning_supplies','linens','equipment','amenities','other'];
    if (!validCats.includes(itemCategory)) return res.status(400).json({ error: `Invalid itemCategory` });
    update.item_category = itemCategory;
  }
  if (quantity !== undefined) {
    const qty = Number(quantity);
    if (!Number.isFinite(qty) || qty <= 0) return res.status(400).json({ error: 'quantity must be > 0' });
    update.quantity = qty;
  }

  const { data, error } = await supabaseAdmin
    .from('hk_task_consumption_profiles')
    .update(update)
    .eq('id', req.params.id)
    .select('*')
    .single();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Profile not found' });
  return res.json({ profile: {
    id: data.id,
    propertyId: data.property_id,
    taskType: data.task_type,
    subtype: data.subtype || null,
    itemName: data.item_name,
    itemCategory: data.item_category,
    quantity: Number(data.quantity),
  }});
});

// Delete a consumption profile. Prevents deleting system defaults
// (property_id IS NULL) — those can only be overridden, not removed.
router.delete('/task-consumption-profiles/:id', authenticate, requirePermission('hk:inventory:manage'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { data: existing } = await supabaseAdmin
    .from('hk_task_consumption_profiles')
    .select('property_id')
    .eq('id', req.params.id)
    .maybeSingle();
  if (!existing) return res.status(404).json({ error: 'Profile not found' });
  if (!existing.property_id) return res.status(403).json({ error: 'Cannot delete system default profiles. Override them with a property-specific profile instead.' });

  const { error } = await supabaseAdmin
    .from('hk_task_consumption_profiles')
    .delete()
    .eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ success: true, id: req.params.id });
});

// ── Property Setup (docs/Housekeeping Portal new.md §24) ────────────────
// Buildings, floors, zones, public areas. Persisted to hk_property_setup
// (migration 320). Public areas are seeded with the 14 doc §8 entries.

// GET /api/hk-portal/property-setup/:propertyId — list all setup entities.
router.get('/property-setup/:propertyId', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { data, error } = await supabaseAdmin
    .from('hk_property_setup')
    .select('*')
    .eq('property_id', req.params.propertyId)
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true });
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ entities: data || [] });
});

// POST /api/hk-portal/property-setup — create a building/floor/zone/public_area.
router.post('/property-setup', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { propertyId, entityType, name, parentId, metadata, sortOrder } = req.body || {};
  if (!propertyId) return res.status(400).json({ error: 'propertyId is required' });
  if (!['building', 'floor', 'zone', 'public_area'].includes(entityType)) {
    return res.status(400).json({ error: `Invalid entityType: ${entityType}` });
  }
  if (!name || !String(name).trim()) return res.status(400).json({ error: 'name is required' });
  const id = `hk-ps-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
  const { data, error } = await supabaseAdmin
    .from('hk_property_setup')
    .insert({
      id,
      property_id: propertyId,
      entity_type: entityType,
      name: String(name).trim(),
      parent_id: parentId || null,
      metadata: metadata || {},
      sort_order: Number(sortOrder) || 0,
    })
    .select('*')
    .single();
  if (error) return res.status(500).json({ error: error.message });
  return res.status(201).json(data);
});

// PUT /api/hk-portal/property-setup/:id — update name/parent/metadata/sortOrder.
router.put('/property-setup/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { name, parentId, metadata, sortOrder } = req.body || {};
  const update: any = {};
  if (name !== undefined) update.name = String(name).trim();
  if (parentId !== undefined) update.parent_id = parentId || null;
  if (metadata !== undefined) update.metadata = metadata;
  if (sortOrder !== undefined) update.sort_order = Number(sortOrder) || 0;
  if (Object.keys(update).length === 0) return res.status(400).json({ error: 'No valid fields' });
  const { data, error } = await supabaseAdmin
    .from('hk_property_setup')
    .update(update)
    .eq('id', req.params.id)
    .select('*')
    .maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Entity not found' });
  return res.json(data);
});

// DELETE /api/hk-portal/property-setup/:id — remove an entity.
router.delete('/property-setup/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { error } = await supabaseAdmin
    .from('hk_property_setup')
    .delete()
    .eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ success: true });
});

// ── Section Config (docs/Housekeeping Portal new.md §24) ────────────────
// JSON-blob config per property per section. Backs the status codes,
// priorities, inspection rules, task types, service levels, standards,
// teams, shifts, skills, certifications tabs.

// GET /api/hk-portal/config/:propertyId/:section — fetch a section's config.
router.get('/config/:propertyId/:section', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { propertyId, section } = req.params;
  if (!['room_status', 'task', 'staff', 'docs', 'consumption'].includes(section)) {
    return res.status(400).json({ error: `Invalid section: ${section}` });
  }
  const { data, error } = await supabaseAdmin
    .from('hk_config')
    .select('data')
    .eq('property_id', propertyId)
    .eq('section', section)
    .maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data?.data || {});
});

// PUT /api/hk-portal/config/:propertyId/:section — upsert a section's config.
router.put('/config/:propertyId/:section', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { propertyId, section } = req.params;
  if (!['room_status', 'task', 'staff', 'docs', 'consumption'].includes(section)) {
    return res.status(400).json({ error: `Invalid section: ${section}` });
  }
  const data = req.body || {};
  const id = `hk-cfg-${propertyId}-${section}`;
  const { data: result, error } = await supabaseAdmin
    .from('hk_config')
    .upsert({
      id,
      property_id: propertyId,
      section,
      data,
    }, { onConflict: 'id' })
    .select('data')
    .single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(result.data || {});
});

// ── Room Inspections (docs/Housekeeping Portal new.md §9) ───────────────
// Backs the Room Inspections module: a 12-item digital checklist with a
// computed result of Pass / Fail / Rework Required / Pending. Persisted to
// the room_inspections table (created in migration 279_room_inspections.sql).
const INSPECTION_RESULTS = new Set(['Pass', 'Fail', 'Rework Required', 'Pending']);
const INSPECTION_ITEM_STATES = new Set(['Pass', 'Fail', 'Pending']);

// The 12 canonical checklist keys (docs §9). Used to recompute the result
// when a single item changes — the frontend owns the same list.
const INSPECTION_CHECK_ITEMS = [
  'Bed Quality', 'Bathroom', 'Floors', 'Windows', 'Furniture', 'Lighting',
  'Air Conditioning', 'Television', 'Internet', 'Amenities', 'Safety Equipment',
  'Overall Presentation',
];

// Recompute the overall result from a full items map. Mirrors the
// computeResult() helper in RoomInspectionsModule.tsx:
//   all Pass → 'Pass'
//   any Fail → 'Fail'
//   any Pending → 'Pending'
//   otherwise (all Pass/Fail with at least one Fail already handled above)
//   → 'Rework Required'
function computeInspectionResult(items: Record<string, string>): string {
  const vals = INSPECTION_CHECK_ITEMS.map(k => items[k]).filter(v => v != null);
  if (vals.length === 0) return 'Pending';
  if (vals.every(v => v === 'Pass')) return 'Pass';
  if (vals.some(v => v === 'Fail')) return 'Fail';
  if (vals.some(v => v === 'Pending')) return 'Pending';
  return 'Rework Required';
}

// Shape a DB row into the camelCase contract the frontend expects.
function shapeInspection(row: any) {
  return {
    id: row.id,
    room: row.room_number,
    floor: row.floor || '',
    inspector: row.inspector || '',
    date: row.inspection_date,
    result: row.result,
    items: row.items || {},
    notes: row.notes || undefined,
    recommendedAction: row.recommended_action || undefined,
    propertyId: row.property_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// List inspections for a property (optional result filter).
router.get('/room-inspections/:propertyId', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const { result } = req.query as Record<string, string>;

  const cacheKey = `hk-room-inspections:${req.params.propertyId}:${result || 'all'}`;
  const cached = cacheService.get(cacheKey);
  if (cached) return res.json(cached);

  let q = supabaseAdmin
    .from('room_inspections')
    .select('*')
    .eq('property_id', req.params.propertyId)
    .order('inspection_date', { ascending: false });

  if (result && INSPECTION_RESULTS.has(result)) q = q.eq('result', result);

  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });

  const inspections = (data || []).map(shapeInspection);
  const resultObj = {
    propertyId: req.params.propertyId,
    inspections,
    summary: {
      total: inspections.length,
      pass: inspections.filter(i => i.result === 'Pass').length,
      fail: inspections.filter(i => i.result === 'Fail').length,
      rework: inspections.filter(i => i.result === 'Rework Required').length,
      pending: inspections.filter(i => i.result === 'Pending').length,
    },
    generatedAt: new Date().toISOString(),
  };

  cacheService.set(cacheKey, resultObj, 30 * 1000);
  return res.json(resultObj);
});

// Create a new inspection. The result is recomputed from the supplied items
// so the client cannot store an inconsistent result.
router.post('/room-inspections', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const { propertyId, room, floor, inspector, date, items, notes } = req.body || {};
  if (!propertyId || !room || !date) {
    return res.status(400).json({ error: 'propertyId, room, and date are required' });
  }

  const itemMap: Record<string, string> = {};
  if (items && typeof items === 'object') {
    for (const [k, v] of Object.entries(items)) {
      if (INSPECTION_ITEM_STATES.has(String(v))) itemMap[k] = String(v);
    }
  }

  const id = `INS-${Date.now()}`;
  const row = {
    id,
    property_id: propertyId,
    room_number: String(room).trim(),
    floor: floor?.trim() || null,
    inspector: inspector?.trim() || null,
    inspection_date: String(date).trim(),
    result: computeInspectionResult(itemMap),
    items: itemMap,
    notes: notes?.trim() || null,
  };

  const { data, error } = await supabaseAdmin
    .from('room_inspections')
    .insert(row)
    .select('*')
    .single();

  if (error) return res.status(500).json({ error: error.message });

  cacheService.invalidatePattern('^hk-room-inspections:');
  return res.status(201).json(shapeInspection(data));
});

// Update a single checklist item. The result is recomputed and persisted
// alongside the item so the list view stays consistent.
router.put('/room-inspections/:id/item', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const { item, state } = req.body || {};
  if (!item || !INSPECTION_ITEM_STATES.has(state)) {
    return res.status(400).json({ error: 'item and a valid state (Pass/Fail/Pending) are required' });
  }

  const { data: current, error: fetchError } = await supabaseAdmin
    .from('room_inspections')
    .select('items')
    .eq('id', req.params.id)
    .single();
  if (fetchError) return res.status(500).json({ error: fetchError.message });
  if (!current) return res.status(404).json({ error: 'Inspection not found' });

  const items = { ...(current.items || {}), [item]: state };
  const result = computeInspectionResult(items);

  const { data, error } = await supabaseAdmin
    .from('room_inspections')
    .update({ items, result })
    .eq('id', req.params.id)
    .select('*')
    .single();

  if (error) return res.status(500).json({ error: error.message });

  cacheService.invalidatePattern('^hk-room-inspections:');
  return res.json(shapeInspection(data));
});

// Update an inspection's notes, recommended action, and/or inspector.
router.put('/room-inspections/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const { notes, recommendedAction, inspector } = req.body || {};
  const patch: Record<string, any> = {};
  if (notes !== undefined) patch.notes = notes?.trim() || null;
  if (recommendedAction !== undefined) patch.recommended_action = recommendedAction?.trim() || null;
  if (inspector !== undefined) patch.inspector = inspector?.trim() || null;

  if (Object.keys(patch).length === 0) {
    return res.status(400).json({ error: 'Nothing to update' });
  }

  const { data, error } = await supabaseAdmin
    .from('room_inspections')
    .update(patch)
    .eq('id', req.params.id)
    .select('*')
    .single();

  if (error) return res.status(500).json({ error: error.message });

  cacheService.invalidatePattern('^hk-room-inspections:');
  return res.json(shapeInspection(data));
});

// Delete an inspection.
router.delete('/room-inspections/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const { error } = await supabaseAdmin
    .from('room_inspections')
    .delete()
    .eq('id', req.params.id);

  if (error) return res.status(500).json({ error: error.message });

  cacheService.invalidatePattern('^hk-room-inspections:');
  return res.json({ success: true, id: req.params.id });
});

// ── Inspection Schedules ────────────────────────────────────────────────

// Build a cron expression from interval settings.
function buildCronExpression(intervalType: string, timeOfDay: string, dayOfWeek?: number | null, dayOfMonth?: number | null, intervalDays?: number | null): string {
  const [hh, mm] = (timeOfDay || '09:00').split(':').map(Number);
  const minute = String(mm || 0).padStart(2, '0');
  const hour = String(hh || 9).padStart(2, '0');
  switch (intervalType) {
    case 'weekly':
      return `${minute} ${hour} * * ${dayOfWeek ?? 1}`;
    case 'monthly':
      return `${minute} ${hour} ${dayOfMonth ?? 1} * *`;
    case 'quarterly':
      return `${minute} ${hour} ${dayOfMonth ?? 1} */3 *`;
    case 'days':
      return `${minute} ${hour} */${Math.max(1, Math.min(365, intervalDays || 2))} * *`;
    case 'daily':
    default:
      return `${minute} ${hour} * * *`;
  }
}

// Shape a schedule row for the frontend.
function shapeSchedule(row: any) {
  return {
    id: row.id,
    name: row.name,
    propertyId: row.property_id,
    roomNumbers: Array.isArray(row.room_number) ? row.room_number : (row.room_number ? [row.room_number] : []),
    floor: row.floor || undefined,
    inspector: row.inspector || undefined,
    intervalType: row.interval_type,
    timeOfDay: row.time_of_day,
    dayOfWeek: row.day_of_week,
    dayOfMonth: row.day_of_month,
    intervalDays: row.interval_days,
    cronExpression: row.cron_expression,
    enabled: row.enabled,
    lastRun: row.last_run || undefined,
    nextRun: row.next_run || undefined,
    notes: row.notes || undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// List schedules for a property.
router.get('/inspection-schedules/:propertyId', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { data, error } = await supabaseAdmin
    .from('inspection_schedules')
    .select('*')
    .eq('property_id', req.params.propertyId)
    .order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ schedules: (data || []).map(shapeSchedule) });
});

// Create a schedule.
router.post('/inspection-schedules', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { propertyId, name, roomNumbers, floor, inspector, intervalType, timeOfDay, dayOfWeek, dayOfMonth, intervalDays, notes } = req.body || {};
  if (!name?.trim()) return res.status(400).json({ error: 'Schedule name is required' });
  const interval = intervalType || 'daily';
  const time = timeOfDay || '09:00';
  const cronExpr = buildCronExpression(interval, time, dayOfWeek, dayOfMonth, intervalDays);
  const id = `SCH-INS-${Date.now()}`;
  // roomNumbers is an array of room number strings; empty array = all rooms
  const roomNumArray = Array.isArray(roomNumbers) ? roomNumbers.filter(Boolean) : [];
  const { data, error } = await supabaseAdmin
    .from('inspection_schedules')
    .insert({
      id,
      property_id: propertyId,
      name: name.trim(),
      room_number: roomNumArray.length > 0 ? roomNumArray : [],
      floor: floor?.trim() || null,
      inspector: inspector?.trim() || null,
      interval_type: interval,
      time_of_day: time,
      day_of_week: dayOfWeek ?? null,
      day_of_month: dayOfMonth ?? null,
      interval_days: interval === 'days' ? (intervalDays || 2) : null,
      cron_expression: cronExpr,
      enabled: true,
      notes: notes?.trim() || null,
    })
    .select('*')
    .single();
  if (error) return res.status(500).json({ error: error.message });
  return res.status(201).json(shapeSchedule(data));
});

// Update a schedule (toggle enabled, edit fields).
router.put('/inspection-schedules/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { name, roomNumbers, floor, inspector, intervalType, timeOfDay, dayOfWeek, dayOfMonth, intervalDays, enabled, notes } = req.body || {};
  const patch: Record<string, any> = {};
  if (name !== undefined) patch.name = name.trim();
  if (roomNumbers !== undefined) patch.room_number = Array.isArray(roomNumbers) ? roomNumbers.filter(Boolean) : [];
  if (floor !== undefined) patch.floor = floor?.trim() || null;
  if (inspector !== undefined) patch.inspector = inspector?.trim() || null;
  if (intervalType !== undefined) patch.interval_type = intervalType;
  if (timeOfDay !== undefined) patch.time_of_day = timeOfDay;
  if (dayOfWeek !== undefined) patch.day_of_week = dayOfWeek ?? null;
  if (dayOfMonth !== undefined) patch.day_of_month = dayOfMonth ?? null;
  if (intervalDays !== undefined) patch.interval_days = intervalDays ?? null;
  if (enabled !== undefined) patch.enabled = enabled;
  if (notes !== undefined) patch.notes = notes?.trim() || null;
  // Recompute cron if interval/time changed
  if (patch.interval_type || patch.time_of_day || patch.day_of_week !== undefined || patch.day_of_month !== undefined || patch.interval_days !== undefined) {
    patch.cron_expression = buildCronExpression(
      patch.interval_type || intervalType || 'daily',
      patch.time_of_day || timeOfDay || '09:00',
      patch.day_of_week !== undefined ? patch.day_of_week : dayOfWeek,
      patch.day_of_month !== undefined ? patch.day_of_month : dayOfMonth,
      patch.interval_days !== undefined ? patch.interval_days : intervalDays,
    );
  }
  if (Object.keys(patch).length === 0) return res.status(400).json({ error: 'Nothing to update' });
  const { data, error } = await supabaseAdmin
    .from('inspection_schedules')
    .update(patch)
    .eq('id', req.params.id)
    .select('*')
    .single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(shapeSchedule(data));
});

// Delete a schedule.
router.delete('/inspection-schedules/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { error } = await supabaseAdmin
    .from('inspection_schedules')
    .delete()
    .eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ success: true, id: req.params.id });
});

// Manually trigger a schedule now (creates inspections immediately).
router.post('/inspection-schedules/:id/trigger', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { data: sched, error } = await supabaseAdmin
    .from('inspection_schedules')
    .select('*')
    .eq('id', req.params.id)
    .single();
  if (error || !sched) return res.status(404).json({ error: 'Schedule not found' });

  const now = new Date();
  const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const inspectionDate = `${dateStr} ${sched.time_of_day || '09:00'}`;

  let targetRooms: { number: string; floor: string | null }[] = [];
  const roomNums: string[] = Array.isArray(sched.room_number) ? sched.room_number : (sched.room_number ? [sched.room_number] : []);
  if (roomNums.length > 0) {
    targetRooms = roomNums.map(n => ({ number: String(n), floor: sched.floor }));
  } else {
    const { data: rooms } = await supabaseAdmin
      .from('rooms')
      .select('number, floor')
      .eq('property_id', sched.property_id);
    targetRooms = (rooms || []).map((r: any) => ({ number: r.number, floor: r.floor }));
  }

  // When the schedule has no inspector set, auto-assign from available
  // housekeeping staff (round-robin across rooms).
  let roundRobinStaff: string[] = [];
  if (!sched.inspector) {
    const { data: staffRows } = await supabaseAdmin
      .from('housekeeping_staff')
      .select('name')
      .eq('property_id', sched.property_id)
      .eq('is_active', true);
    roundRobinStaff = (staffRows || []).map((s: any) => s.name).filter(Boolean);
  }

  let created = 0;
  for (let idx = 0; idx < targetRooms.length; idx++) {
    const room = targetRooms[idx];
    const inspId = `INS-${Date.now()}${Math.floor(Math.random() * 1000)}`;
    const emptyItems: Record<string, string> = {
      'Bed Quality': 'Pending', 'Bathroom': 'Pending', 'Floors': 'Pending',
      'Windows': 'Pending', 'Furniture': 'Pending', 'Lighting': 'Pending',
      'Air Conditioning': 'Pending', 'Television': 'Pending', 'Internet': 'Pending',
      'Amenities': 'Pending', 'Safety Equipment': 'Pending', 'Overall Presentation': 'Pending',
    };
    // Use schedule's inspector, or round-robin from active staff, or null
    const inspectorName = sched.inspector
      || (roundRobinStaff.length > 0 ? roundRobinStaff[idx % roundRobinStaff.length] : null);
    await supabaseAdmin.from('room_inspections').insert({
      id: inspId,
      property_id: sched.property_id,
      room_number: room.number,
      floor: room.floor ? String(room.floor) : null,
      inspector: inspectorName,
      inspection_date: inspectionDate,
      result: 'Pending',
      items: emptyItems,
      notes: sched.notes || null,
    });
    created++;
  }

  await supabaseAdmin.from('inspection_schedules')
    .update({ last_run: new Date().toISOString() })
    .eq('id', sched.id);

  cacheService.invalidatePattern('^hk-room-inspections:');
  return res.json({ success: true, created, scheduleId: sched.id });
});

// ── Staff Management ───────────────────────────────────────────────────
// Backs the Staff Management module (docs/Housekeeping Portal new.md §10).
// The housekeeping_staff table holds role/shift/floor/zone/productivity
// metrics; assigned rooms are derived from housekeeping_assignments.

const STAFF_ROLES = new Set([
  'Room Attendant', 'Public Area Attendant', 'Laundry Attendant',
  'Supervisor', 'Houseperson',
]);
const STAFF_SHIFTS = new Set(['Morning', 'Evening', 'Night']);

function shapeStaff(row: any, assignedRooms: string[] = [], employee: any = null) {
  return {
    id: row.id,
    name: row.name,
    avatar: row.avatar || (row.name || '').split(' ').map((p: string) => p[0]).join('').slice(0, 2).toUpperCase(),
    role: row.role,
    shift: row.shift,
    assignedRooms,
    floor: row.floor,
    zone: row.zone,
    roomsCompleted: row.rooms_completed ?? 0,
    cleaningTimeMin: row.cleaning_time_min ?? 0,
    inspectionScore: row.inspection_score ?? 0,
    workload: row.workload ?? 0,
    status: row.status,
    isActive: row.is_active,
    // HR integration — linked employee record
    employeeId: row.employee_id || null,
    email: employee?.email || null,
    phone: employee?.phone || null,
    hireDate: employee?.hire_date || null,
    salary: employee?.salary ?? null,
    department: employee?.department || 'Housekeeping',
    position: employee?.position || row.role,
  };
}

// List all housekeeping staff for a property, with their assigned rooms.
router.get('/staff/:propertyId', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const cacheKey = `hk-staff:${req.params.propertyId}`;
  const cached = cacheService.get(cacheKey);
  if (cached) return res.json(cached);

  const [staffRes, assignmentsRes] = await Promise.all([
    supabaseAdmin
      .from('housekeeping_staff')
      .select('*')
      .eq('property_id', req.params.propertyId)
      .eq('is_active', true)
      .order('name'),
    supabaseAdmin
      .from('housekeeping_assignments')
      .select('staff_id, room_number')
      .eq('property_id', req.params.propertyId),
  ]);

  if (staffRes.error) return res.status(500).json({ error: staffRes.error.message });
  if (assignmentsRes.error) return res.status(500).json({ error: assignmentsRes.error.message });

  const roomsByStaff: Record<string, string[]> = {};
  (assignmentsRes.data || []).forEach((a: any) => {
    if (!roomsByStaff[a.staff_id]) roomsByStaff[a.staff_id] = [];
    roomsByStaff[a.staff_id].push(a.room_number);
  });

  // Fetch linked HR employee records for all staff that have an employee_id.
  const employeeIds = (staffRes.data || []).map((s: any) => s.employee_id).filter(Boolean);
  let employeesById: Record<string, any> = {};
  if (employeeIds.length > 0) {
    const { data: empRows } = await supabaseAdmin
      .from('employees')
      .select('id, email, phone, hire_date, salary, department, position')
      .in('id', employeeIds);
    (empRows || []).forEach((e: any) => { employeesById[e.id] = e; });
  }

  const staff = (staffRes.data || []).map((s: any) =>
    shapeStaff(s, roomsByStaff[s.id] || [], s.employee_id ? employeesById[s.employee_id] : null)
  );

  const result = {
    propertyId: req.params.propertyId,
    staff,
    summary: {
      total: staff.length,
      roomsCompleted: staff.reduce((sum: number, s: any) => sum + s.roomsCompleted, 0),
      avgClean: staff.length ? Math.round(staff.reduce((sum: number, s: any) => sum + s.cleaningTimeMin, 0) / staff.length) : 0,
      avgInspection: staff.length ? Math.round(staff.reduce((sum: number, s: any) => sum + s.inspectionScore, 0) / staff.length) : 0,
    },
    generatedAt: new Date().toISOString(),
  };

  cacheService.set(cacheKey, result, 30 * 1000);
  return res.json(result);
});

// Create a new housekeeping staff member. Optionally accepts employeeId to
// link to an existing HR employee, or email/phone/hireDate/salary to create
// a new HR employee record at the same time.
router.post('/staff', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const {
    propertyId, name, role, shift, floor, zone,
    roomsCompleted, cleaningTimeMin, inspectionScore, workload, status,
    employeeId, email, phone, hireDate, salary,
  } = req.body || {};

  if (!propertyId || !name?.trim()) {
    return res.status(400).json({ error: 'propertyId and name are required' });
  }
  if (role && !STAFF_ROLES.has(role)) {
    return res.status(400).json({ error: `role must be one of: ${[...STAFF_ROLES].join(', ')}` });
  }
  if (shift && !STAFF_SHIFTS.has(shift)) {
    return res.status(400).json({ error: `shift must be one of: ${[...STAFF_SHIFTS].join(', ')}` });
  }

  const id = `HK-${Date.now()}`;
  const avatar = name.trim().split(' ').map((p: string) => p[0]).join('').slice(0, 2).toUpperCase();
  const resolvedRole = role || 'Room Attendant';

  // If an existing HR employee is being linked, verify it exists.
  let linkedEmployeeId = employeeId || null;
  let employeeRecord: any = null;

  if (linkedEmployeeId) {
    const { data: emp } = await supabaseAdmin
      .from('employees')
      .select('id, email, phone, hire_date, salary, department, position')
      .eq('id', linkedEmployeeId)
      .single();
    if (emp) employeeRecord = emp;
    else linkedEmployeeId = null; // invalid link — ignore
  } else if (email || phone || hireDate || salary) {
    // Create a new HR employee record for this housekeeping staff member.
    const empId = `EMP-HK-${Date.now()}`;
    const { data: newEmp, error: empError } = await supabaseAdmin
      .from('employees')
      .insert({
        id: empId,
        name: name.trim(),
        email: email || null,
        phone: phone || null,
        department: 'Housekeeping',
        position: resolvedRole,
        status: 'Active',
        hire_date: hireDate || new Date().toISOString().split('T')[0],
        salary: salary ?? 0,
        avatar_initials: avatar,
        property_id: propertyId,
      })
      .select('id, email, phone, hire_date, salary, department, position')
      .single();
    if (!empError && newEmp) {
      linkedEmployeeId = empId;
      employeeRecord = newEmp;
    }
  }

  const { data, error } = await supabaseAdmin
    .from('housekeeping_staff')
    .insert({
      id,
      property_id: propertyId,
      name: name.trim(),
      avatar,
      status: status || 'Active Duty',
      is_active: true,
      role: resolvedRole,
      shift: shift || 'Morning',
      floor: floor ?? 1,
      zone: zone || 'Zone A',
      rooms_completed: roomsCompleted ?? 0,
      cleaning_time_min: cleaningTimeMin ?? 0,
      inspection_score: inspectionScore ?? 0,
      workload: workload ?? 0,
      employee_id: linkedEmployeeId,
    })
    .select('*')
    .single();

  if (error) return res.status(500).json({ error: error.message });

  cacheService.invalidatePattern('^hk-staff:');
  cacheService.invalidatePattern('^hr-');
  return res.status(201).json(shapeStaff(data, [], employeeRecord));
});

// List available HR employees in the Housekeeping department that are not yet
// linked to a housekeeping_staff row — for the "Link Employee" dropdown.
router.get('/staff/available-employees/:propertyId', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  // Get all employee_ids already linked to housekeeping staff.
  const { data: linkedRows } = await supabaseAdmin
    .from('housekeeping_staff')
    .select('employee_id')
    .not('employee_id', 'is', null);

  const linkedIds = (linkedRows || []).map((r: any) => r.employee_id);

  let q = supabaseAdmin
    .from('employees')
    .select('id, name, email, phone, position, hire_date, salary, department')
    .eq('status', 'Active')
    .eq('department', 'Housekeeping')
    .order('name');

  // Exclude employees already linked to housekeeping staff.
  if (linkedIds.length > 0) {
    q = q.filter('id', 'not.in', `(${linkedIds.join(',')})`);
  }

  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });

  return res.json({ employees: data || [] });
});

// Update a staff member (reassign floor/zone/shift, update metrics, etc.).
router.put('/staff/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const {
    name, role, shift, floor, zone,
    roomsCompleted, cleaningTimeMin, inspectionScore, workload, status, isActive,
    employeeId,
  } = req.body || {};

  if (role !== undefined && !STAFF_ROLES.has(role)) {
    return res.status(400).json({ error: `role must be one of: ${[...STAFF_ROLES].join(', ')}` });
  }
  if (shift !== undefined && !STAFF_SHIFTS.has(shift)) {
    return res.status(400).json({ error: `shift must be one of: ${[...STAFF_SHIFTS].join(', ')}` });
  }

  const patch: Record<string, any> = { updated_at: new Date().toISOString() };
  if (name !== undefined) patch.name = name.trim();
  if (role !== undefined) patch.role = role;
  if (shift !== undefined) patch.shift = shift;
  if (floor !== undefined) patch.floor = Number(floor);
  if (zone !== undefined) patch.zone = zone;
  if (roomsCompleted !== undefined) patch.rooms_completed = Number(roomsCompleted);
  if (cleaningTimeMin !== undefined) patch.cleaning_time_min = Number(cleaningTimeMin);
  if (inspectionScore !== undefined) patch.inspection_score = Number(inspectionScore);
  if (workload !== undefined) patch.workload = Number(workload);
  if (status !== undefined) patch.status = status;
  if (isActive !== undefined) patch.is_active = isActive;
  if (employeeId !== undefined) patch.employee_id = employeeId || null;

  if (Object.keys(patch).length === 1) {
    return res.status(400).json({ error: 'Nothing to update' });
  }

  const { data, error } = await supabaseAdmin
    .from('housekeeping_staff')
    .update(patch)
    .eq('id', req.params.id)
    .select('*')
    .single();

  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Staff not found' });

  cacheService.invalidatePattern('^hk-staff:');
  // Also invalidate the rooms-board since it embeds staff.
  cacheService.invalidatePattern('^hk-rooms-board:');

  // Fetch assigned rooms for the response.
  const { data: assignRows } = await supabaseAdmin
    .from('housekeeping_assignments')
    .select('room_number')
    .eq('staff_id', req.params.id);

  // Fetch the linked HR employee record for the response.
  let employeeRecord: any = null;
  if (data.employee_id) {
    const { data: emp } = await supabaseAdmin
      .from('employees')
      .select('id, email, phone, hire_date, salary, department, position')
      .eq('id', data.employee_id)
      .single();
    if (emp) employeeRecord = emp;
  }

  return res.json(shapeStaff(data, (assignRows || []).map((a: any) => a.room_number), employeeRecord));
});

// Delete (deactivate) a staff member. We soft-delete by setting is_active =
// false so historical assignments remain intact. Pass hard=true to remove.
router.delete('/staff/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const { hard } = req.query as Record<string, string>;

  if (hard === 'true') {
    // Remove assignments first (no FK from assignments -> staff, so manual).
    await supabaseAdmin
      .from('housekeeping_assignments')
      .delete()
      .eq('staff_id', req.params.id);

    const { error } = await supabaseAdmin
      .from('housekeeping_staff')
      .delete()
      .eq('id', req.params.id);
    if (error) return res.status(500).json({ error: error.message });
  } else {
    const { error } = await supabaseAdmin
      .from('housekeeping_staff')
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq('id', req.params.id);
    if (error) return res.status(500).json({ error: error.message });
  }

  cacheService.invalidatePattern('^hk-staff:');
  cacheService.invalidatePattern('^hk-rooms-board:');
  return res.json({ success: true, id: req.params.id });
});

// ── Staff Operations: Shift Requirements, Staffing, Training, Productivity ──
// Mirrors the F&B staff operations CRUD pattern, adapted for Housekeeping.

// ── Shift Requirements ────────────────────────────────────────────────
router.get('/staff/shifts/:propertyId', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { data, error } = await supabaseAdmin
    .from('hk_shift_requirements')
    .select('*')
    .eq('property_id', req.params.propertyId)
    .order('start_time');
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

router.post('/staff/shifts', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { propertyId, name, startTime, endTime, assignedStaff, requiredStaff } = req.body || {};
  if (!name?.trim()) return res.status(400).json({ error: 'name is required' });
  const { data, error } = await supabaseAdmin
    .from('hk_shift_requirements')
    .insert({
      name: name.trim(), start_time: startTime || '08:00', end_time: endTime || '16:00',
      assigned_staff: assignedStaff ?? 0, required_staff: requiredStaff ?? 1,
      property_id: propertyId || null,
    })
    .select('*').single();
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidatePattern('^hk-staff:');
  return res.status(201).json(data);
});

router.put('/staff/shifts/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const patch: Record<string, any> = { updated_at: new Date().toISOString() };
  const { name, startTime, endTime, assignedStaff, requiredStaff } = req.body || {};
  if (name !== undefined) patch.name = name;
  if (startTime !== undefined) patch.start_time = startTime;
  if (endTime !== undefined) patch.end_time = endTime;
  if (assignedStaff !== undefined) patch.assigned_staff = Number(assignedStaff);
  if (requiredStaff !== undefined) patch.required_staff = Number(requiredStaff);
  const { data, error } = await supabaseAdmin
    .from('hk_shift_requirements').update(patch).eq('id', req.params.id).select('*').single();
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidatePattern('^hk-staff:');
  return res.json(data);
});

router.delete('/staff/shifts/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { error } = await supabaseAdmin.from('hk_shift_requirements').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidatePattern('^hk-staff:');
  return res.json({ success: true });
});

// ── Staffing Requirements ─────────────────────────────────────────────
router.get('/staff/staffing/:propertyId', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { data, error } = await supabaseAdmin
    .from('hk_staffing_requirements')
    .select('*')
    .eq('property_id', req.params.propertyId)
    .order('floor', { ascending: true });
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

router.post('/staff/staffing', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { propertyId, floor, zone, role, requiredCount, assignedCount, shift } = req.body || {};
  if (!role) return res.status(400).json({ error: 'role is required' });
  if (role && !STAFF_ROLES.has(role)) {
    return res.status(400).json({ error: `role must be one of: ${[...STAFF_ROLES].join(', ')}` });
  }
  const { data, error } = await supabaseAdmin
    .from('hk_staffing_requirements')
    .insert({
      floor: floor ?? null, zone: zone ?? null, role,
      required_count: requiredCount ?? 1, assigned_count: assignedCount ?? 0,
      shift: shift || 'Morning', property_id: propertyId || null,
    })
    .select('*').single();
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidatePattern('^hk-staff:');
  return res.status(201).json(data);
});

router.put('/staff/staffing/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const patch: Record<string, any> = { updated_at: new Date().toISOString() };
  const { floor, zone, role, requiredCount, assignedCount, shift } = req.body || {};
  if (floor !== undefined) patch.floor = floor ? Number(floor) : null;
  if (zone !== undefined) patch.zone = zone;
  if (role !== undefined) patch.role = role;
  if (requiredCount !== undefined) patch.required_count = Number(requiredCount);
  if (assignedCount !== undefined) patch.assigned_count = Number(assignedCount);
  if (shift !== undefined) patch.shift = shift;
  const { data, error } = await supabaseAdmin
    .from('hk_staffing_requirements').update(patch).eq('id', req.params.id).select('*').single();
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidatePattern('^hk-staff:');
  return res.json(data);
});

router.delete('/staff/staffing/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { error } = await supabaseAdmin.from('hk_staffing_requirements').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidatePattern('^hk-staff:');
  return res.json({ success: true });
});

// ── Training ──────────────────────────────────────────────────────────
router.get('/staff/training/:propertyId', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { data, error } = await supabaseAdmin
    .from('hk_staff_training')
    .select('*')
    .eq('property_id', req.params.propertyId)
    .order('due_date', { ascending: true });
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

router.post('/staff/training', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { propertyId, course, employeeId, staffId, dueDate, status } = req.body || {};
  if (!course?.trim()) return res.status(400).json({ error: 'course is required' });
  const { data, error } = await supabaseAdmin
    .from('hk_staff_training')
    .insert({
      course: course.trim(), employee_id: employeeId || null, staff_id: staffId || null,
      due_date: dueDate || null, status: status || 'Not Started',
      property_id: propertyId || null,
    })
    .select('*').single();
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidatePattern('^hk-staff:');
  return res.status(201).json(data);
});

router.put('/staff/training/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const patch: Record<string, any> = { updated_at: new Date().toISOString() };
  const { course, employeeId, staffId, dueDate, status } = req.body || {};
  if (course !== undefined) patch.course = course;
  if (employeeId !== undefined) patch.employee_id = employeeId || null;
  if (staffId !== undefined) patch.staff_id = staffId || null;
  if (dueDate !== undefined) patch.due_date = dueDate || null;
  if (status !== undefined) patch.status = status;
  const { data, error } = await supabaseAdmin
    .from('hk_staff_training').update(patch).eq('id', req.params.id).select('*').single();
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidatePattern('^hk-staff:');
  return res.json(data);
});

router.delete('/staff/training/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { error } = await supabaseAdmin.from('hk_staff_training').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidatePattern('^hk-staff:');
  return res.json({ success: true });
});

// ── Productivity ──────────────────────────────────────────────────────
router.get('/staff/productivity/:propertyId', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { data, error } = await supabaseAdmin
    .from('hk_staff_productivity')
    .select('*')
    .eq('property_id', req.params.propertyId)
    .order('period_date', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

router.post('/staff/productivity', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { propertyId, employeeId, staffId, roomsCleaned, hours, inspectionScore, productivityScore, periodDate } = req.body || {};
  const { data, error } = await supabaseAdmin
    .from('hk_staff_productivity')
    .insert({
      employee_id: employeeId || null, staff_id: staffId || null,
      rooms_cleaned: roomsCleaned ?? 0, hours: hours ?? 8,
      inspection_score: inspectionScore ?? 0, productivity_score: productivityScore ?? 0,
      period_date: periodDate || null, property_id: propertyId || null,
    })
    .select('*').single();
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidatePattern('^hk-staff:');
  return res.status(201).json(data);
});

router.put('/staff/productivity/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const patch: Record<string, any> = { updated_at: new Date().toISOString() };
  const { employeeId, staffId, roomsCleaned, hours, inspectionScore, productivityScore, periodDate } = req.body || {};
  if (employeeId !== undefined) patch.employee_id = employeeId || null;
  if (staffId !== undefined) patch.staff_id = staffId || null;
  if (roomsCleaned !== undefined) patch.rooms_cleaned = Number(roomsCleaned);
  if (hours !== undefined) patch.hours = Number(hours);
  if (inspectionScore !== undefined) patch.inspection_score = Number(inspectionScore);
  if (productivityScore !== undefined) patch.productivity_score = Number(productivityScore);
  if (periodDate !== undefined) patch.period_date = periodDate || null;
  const { data, error } = await supabaseAdmin
    .from('hk_staff_productivity').update(patch).eq('id', req.params.id).select('*').single();
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidatePattern('^hk-staff:');
  return res.json(data);
});

router.delete('/staff/productivity/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { error } = await supabaseAdmin.from('hk_staff_productivity').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidatePattern('^hk-staff:');
  return res.json({ success: true });
});

// ── Attendance (Housekeeping) ──────────────────────────────────────────
const ATT_SHIFTS = new Set(['Morning', 'Evening', 'Night']);
const ATT_STATUSES = new Set(['Present', 'Late', 'Absent', 'On Leave', 'Sick', 'Half Day', 'Day Off', 'Public Holiday', 'Work From Home', 'Mission', 'Training Day']);

function shapeAttendance(row: any) {
  return {
    id: row.id,
    staffId: row.staff_id,
    staffName: row.staff_name,
    departmentScope: row.department_scope,
    employeeId: row.employee_id || null,
    attendanceDate: row.attendance_date,
    shift: row.shift,
    checkIn: row.check_in || null,
    checkOut: row.check_out || null,
    status: row.status,
    hoursWorked: Number(row.hours_worked) || 0,
    overtimeHours: Number(row.overtime_hours) || 0,
    notes: row.notes || null,
    email: null as string | null,
    phone: null as string | null,
    department: null as string | null,
    position: null as string | null,
  };
}

// Attendance summary grouped per staff member (one row per staff).
router.get('/attendance/summary/:propertyId', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { data, error } = await supabaseAdmin
    .from('staff_attendance').select('*')
    .eq('property_id', req.params.propertyId)
    .eq('department_scope', 'HK')
    .order('staff_name')
    .order('attendance_date', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });

  // Group by staff_id
  const byStaff: Record<string, any> = {};
  for (const row of data || []) {
    if (!byStaff[row.staff_id]) {
      byStaff[row.staff_id] = {
        staffId: row.staff_id,
        staffName: row.staff_name,
        employeeId: row.employee_id || null,
        records: [],
        present: 0, late: 0, absent: 0, onLeave: 0, sick: 0, halfDay: 0,
        dayOff: 0, publicHoliday: 0, workFromHome: 0, mission: 0, trainingDay: 0,
        totalHours: 0, totalOvertime: 0, totalDays: 0,
      };
    }
    const s = byStaff[row.staff_id];
    s.totalDays++;
    s.totalHours += Number(row.hours_worked) || 0;
    s.totalOvertime += Number(row.overtime_hours) || 0;
    s.records.push(shapeAttendance(row));
    switch (row.status) {
      case 'Present': s.present++; break;
      case 'Late': s.late++; break;
      case 'Absent': s.absent++; break;
      case 'On Leave': s.onLeave++; break;
      case 'Sick': s.sick++; break;
      case 'Half Day': s.halfDay++; break;
      case 'Day Off': s.dayOff++; break;
      case 'Public Holiday': s.publicHoliday++; break;
      case 'Work From Home': s.workFromHome++; break;
      case 'Mission': s.mission++; break;
      case 'Training Day': s.trainingDay++; break;
    }
  }

  // Join HR employee data
  const empIds = Object.values(byStaff).map((s: any) => s.employeeId).filter(Boolean);
  let employeesById: Record<string, any> = {};
  if (empIds.length > 0) {
    const { data: empRows } = await supabaseAdmin
      .from('employees').select('id, email, phone, department, position')
      .in('id', empIds);
    (empRows || []).forEach((e: any) => { employeesById[e.id] = e; });
  }

  const summary = Object.values(byStaff).map((s: any) => {
    const emp = s.employeeId ? employeesById[s.employeeId] : null;
    return {
      ...s,
      email: emp?.email || null,
      phone: emp?.phone || null,
      department: emp?.department || null,
      position: emp?.position || null,
      attendanceRate: s.totalDays > 0
        ? Math.round(((s.present + s.late) / s.totalDays) * 100) : 0,
    };
  });

  return res.json({
    propertyId: req.params.propertyId,
    summary,
    totals: {
      staffCount: summary.length,
      totalHours: summary.reduce((sum: number, s: any) => sum + s.totalHours, 0),
      totalOvertime: summary.reduce((sum: number, s: any) => sum + s.totalOvertime, 0),
      avgAttendanceRate: summary.length > 0
        ? Math.round(summary.reduce((sum: number, s: any) => sum + s.attendanceRate, 0) / summary.length) : 0,
    },
  });
});

// List attendance for a property (HK scope), optional date filter.
router.get('/attendance/:propertyId', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { date } = req.query as Record<string, string>;
  let q = supabaseAdmin
    .from('staff_attendance').select('*')
    .eq('property_id', req.params.propertyId)
    .eq('department_scope', 'HK')
    .order('attendance_date', { ascending: false })
    .order('staff_name');
  if (date) q = q.eq('attendance_date', date);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });

  // Join HR employee data
  const empIds = (data || []).map((r: any) => r.employee_id).filter(Boolean);
  let employeesById: Record<string, any> = {};
  if (empIds.length > 0) {
    const { data: empRows } = await supabaseAdmin
      .from('employees').select('id, email, phone, department, position')
      .in('id', empIds);
    (empRows || []).forEach((e: any) => { employeesById[e.id] = e; });
  }

  const records = (data || []).map((row: any) => {
    const shaped = shapeAttendance(row);
    const emp = row.employee_id ? employeesById[row.employee_id] : null;
    if (emp) {
      shaped.email = emp.email || null;
      shaped.phone = emp.phone || null;
      shaped.department = emp.department || null;
      shaped.position = emp.position || null;
    }
    return shaped;
  });

  return res.json({
    propertyId: req.params.propertyId,
    attendance: records,
    summary: {
      total: records.length,
      present: records.filter(r => r.status === 'Present').length,
      late: records.filter(r => r.status === 'Late').length,
      absent: records.filter(r => r.status === 'Absent').length,
      onLeave: records.filter(r => r.status === 'On Leave' || r.status === 'Sick').length,
      totalHours: records.reduce((s, r) => s + r.hoursWorked, 0),
      totalOvertime: records.reduce((s, r) => s + r.overtimeHours, 0),
    },
  });
});

// Create / check-in a staff member for today.
router.post('/attendance', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { propertyId, staffId, staffName, shift, status, checkIn, notes } = req.body || {};
  if (!propertyId || !staffId || !staffName) return res.status(400).json({ error: 'propertyId, staffId, staffName are required' });
  if (shift && !ATT_SHIFTS.has(shift)) return res.status(400).json({ error: 'Invalid shift' });
  if (status && !ATT_STATUSES.has(status)) return res.status(400).json({ error: 'Invalid status' });

  const today = new Date().toISOString().split('T')[0];
  const id = `ATT-HK-${staffId}-${today}`;

  // Look up the staff member's HR employee_id
  let employeeId: string | null = null;
  const { data: staffRow } = await supabaseAdmin
    .from('housekeeping_staff').select('employee_id').eq('id', staffId).single();
  if (staffRow?.employee_id) employeeId = staffRow.employee_id;

  const { data, error } = await supabaseAdmin
    .from('staff_attendance').upsert({
      id, property_id: propertyId, staff_id: staffId, staff_name: staffName,
      department_scope: 'HK', attendance_date: today,
      shift: shift || 'Morning', status: status || 'Present',
      check_in: checkIn || new Date().toISOString(),
      hours_worked: 0, overtime_hours: 0, notes: notes || null,
      employee_id: employeeId,
    }, { onConflict: 'staff_id,attendance_date' }).select('*').single();
  if (error) return res.status(500).json({ error: error.message });
  return res.status(201).json(shapeAttendance(data));
});

// Update attendance (check-out, status change, hours, notes).
router.put('/attendance/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { status, checkIn, checkOut, hoursWorked, overtimeHours, shift, notes } = req.body || {};
  if (status && !ATT_STATUSES.has(status)) return res.status(400).json({ error: 'Invalid status' });
  if (shift && !ATT_SHIFTS.has(shift)) return res.status(400).json({ error: 'Invalid shift' });

  const patch: Record<string, any> = { updated_at: new Date().toISOString() };
  if (status !== undefined) patch.status = status;
  if (checkIn !== undefined) patch.check_in = checkIn;
  if (checkOut !== undefined) patch.check_out = checkOut;
  if (hoursWorked !== undefined) patch.hours_worked = Number(hoursWorked);
  if (overtimeHours !== undefined) patch.overtime_hours = Number(overtimeHours);
  if (shift !== undefined) patch.shift = shift;
  if (notes !== undefined) patch.notes = notes;

  const { data, error } = await supabaseAdmin
    .from('staff_attendance').update(patch).eq('id', req.params.id).select('*').single();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Attendance record not found' });
  return res.json(shapeAttendance(data));
});

// Delete an attendance record.
router.delete('/attendance/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { error } = await supabaseAdmin.from('staff_attendance').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ success: true, id: req.params.id });
});

// ── Supervisor Console (docs/Housekeeping Portal new.md §11) ────────────
// Aggregation endpoint that returns everything the Supervisor Console needs
// in a single round-trip:
//   - liveRooms:   active HK tasks (Pending/In Progress) whose location is a
//                  room, enriched with floor + inspection-fail status
//   - escalations: open rows from hk_escalations
//   - approvals:   room_inspections with result = 'Pending'
//   - staffPerf:   active housekeeping_staff with rooms_completed + inspection_score
//   - shiftSummary: counts computed from the above

const ESCALATION_LEVELS = new Set(['Low', 'Medium', 'High', 'Critical']);

// Parse "Room 101" → "101"; returns null if the location is not a room.
function parseRoomNumber(location: string): string | null {
  const m = /^Room\s+(\S+)$/i.exec((location || '').trim());
  return m ? m[1] : null;
}

// Estimate an ETA string from task progress.
function estimateEta(progress: number, status: string): string {
  if (status === 'Completed' || status === 'Verified' || progress >= 100) return 'Done';
  if (progress <= 0) return '30 min';
  const remaining = Math.round((100 - progress) / 100 * 30);
  return `${remaining} min`;
}

// Map a task to a live-room display status.
function liveRoomStatus(taskType: string, taskStatus: string, hasFailedInspection: boolean): string {
  if (hasFailedInspection) return 'Failed Inspection';
  if (taskStatus === 'In Progress') return taskType === 'VIP Preparation' ? 'VIP Cleaning' : 'Cleaning';
  if (taskStatus === 'Pending') return taskType === 'VIP Preparation' ? 'VIP Pending' : 'Pending';
  return taskStatus;
}

router.get('/supervisor/console/:propertyId', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const cacheKey = `hk-supervisor-console:${req.params.propertyId}`;
  const cached = cacheService.get(cacheKey);
  if (cached) return res.json(cached);

  const propertyId = req.params.propertyId;

  const today = new Date().toISOString().slice(0, 10);

  const [tasksRes, roomsRes, escalationsRes, inspectionsRes, staffRes,
         attRes, shiftRes, staffingRes, trainingRes,
         lostFoundRes, roomExtrasRes, priorityQRes, productivityRes, guestReqRes,
         // ── Additional queries (previously sequential — now batched) ────
         failedInspsRes, allTasksRes, allInspsRes, staffTimesRes] = await Promise.all([
    supabaseAdmin
      .from('housekeeping_task_mgmt')
      .select('id, type, location, assigned_to, priority, status, progress')
      .eq('property_id', propertyId)
      .in('status', ['Pending', 'In Progress']),
    supabaseAdmin
      .from('rooms')
      .select('number, floor')
      .eq('property_id', propertyId),
    supabaseAdmin
      .from('hk_escalations')
      .select('*')
      .eq('property_id', propertyId)
      .eq('status', 'Open')
      .order('created_at', { ascending: false }),
    supabaseAdmin
      .from('room_inspections')
      .select('id, room_number, floor, inspector, inspection_date, result, items')
      .eq('property_id', propertyId)
      .eq('result', 'Pending')
      .order('inspection_date', { ascending: false }),
    supabaseAdmin
      .from('housekeeping_staff')
      .select('id, name, role, rooms_completed, inspection_score, is_active')
      .eq('property_id', propertyId)
      .eq('is_active', true)
      .order('rooms_completed', { ascending: false }),
    // ── Attendance for today (HK scope) ──────────────────────────────
    supabaseAdmin
      .from('staff_attendance')
      .select('id, staff_id, staff_name, status, shift, check_in, check_out, hours_worked, overtime_hours')
      .eq('property_id', propertyId)
      .eq('department_scope', 'HK')
      .eq('attendance_date', today)
      .order('staff_name'),
    // ── Shift requirements ───────────────────────────────────────────
    supabaseAdmin
      .from('hk_shift_requirements')
      .select('id, name, start_time, end_time, assigned_staff, required_staff')
      .eq('property_id', propertyId)
      .order('start_time'),
    // ── Staffing requirements (per floor/zone) ───────────────────────
    supabaseAdmin
      .from('hk_staffing_requirements')
      .select('id, floor, zone, role, required_count, assigned_count, shift')
      .eq('property_id', propertyId)
      .order('shift')
      .order('floor', { ascending: true }),
    // ── Training (overdue + in-progress) ─────────────────────────────
    supabaseAdmin
      .from('hk_staff_training')
      .select('id, course, staff_id, employee_id, due_date, status')
      .eq('property_id', propertyId)
      .in('status', ['Overdue', 'In Progress', 'Not Started'])
      .order('due_date', { ascending: true }),
    // ── Lost & Found (unclaimed items, property-scoped) ──────────────
    // Filter by property_id to prevent cross-property data leakage in
    // multi-property deployments (property_id added in migration 303).
    supabaseAdmin
      .from('lost_found')
      .select('id, item_name, item_category, status, room_number, found_date, storage_location, follow_up_required')
      .eq('property_id', propertyId)
      .in('status', ['Found', 'Stored'])
      .order('found_date', { ascending: false })
      .limit(20),
    // ── Room extras (DND, hk_status, last cleaned/inspected) ─────────
    supabaseAdmin
      .from('housekeeping_room_extras')
      .select('id, room_number, dnd, hk_status, last_cleaned, last_inspected, housekeeper_id')
      .eq('property_id', propertyId)
      .order('room_number', { ascending: true }),
    // ── Priority queue (rooms needing immediate attention) ───────────
    supabaseAdmin
      .from('housekeeping_priority_queue')
      .select('id, room_number, created_at')
      .eq('property_id', propertyId)
      .order('created_at', { ascending: false })
      .limit(20),
    // ── Staff productivity (multiple periods for trend computation) ─
    supabaseAdmin
      .from('hk_staff_productivity')
      .select('id, employee_id, staff_id, rooms_cleaned, hours, inspection_score, productivity_score, period_date')
      .eq('property_id', propertyId)
      .order('period_date', { ascending: false })
      .limit(100),
    // ── Guest requests assigned to HK ────────────────────────────────
    supabaseAdmin
      .from('guest_requests')
      .select('id, request_number, room_number, guest_name, request_type, priority, status, assigned_to, submitted_at')
      .eq('property_id', propertyId)
      .eq('assigned_department', 'HK')
      .in('status', ['Pending', 'In Progress', 'Acknowledged'])
      .order('submitted_at', { ascending: false })
      .limit(20),
    // ── Failed inspections (for live-room rework flags) ──────────────
    supabaseAdmin
      .from('room_inspections')
      .select('room_number')
      .eq('property_id', propertyId)
      .eq('result', 'Fail'),
    // ── All tasks (for shift summary completed count) ────────────────
    supabaseAdmin
      .from('housekeeping_task_mgmt')
      .select('id, status')
      .eq('property_id', propertyId),
    // ── All inspections (for shift summary inspected/failed counts) ──
    supabaseAdmin
      .from('room_inspections')
      .select('id, result')
      .eq('property_id', propertyId),
    // ── Staff cleaning times (for avg clean time KPI) ────────────────
    supabaseAdmin
      .from('housekeeping_staff')
      .select('cleaning_time_min')
      .eq('property_id', propertyId)
      .eq('is_active', true),
  ]);

  if (tasksRes.error) return res.status(500).json({ error: tasksRes.error.message });
  if (roomsRes.error) return res.status(500).json({ error: roomsRes.error.message });
  if (escalationsRes.error) return res.status(500).json({ error: escalationsRes.error.message });
  if (inspectionsRes.error) return res.status(500).json({ error: inspectionsRes.error.message });
  if (staffRes.error) return res.status(500).json({ error: staffRes.error.message });
  // Non-fatal modules — degrade gracefully.
  if (attRes.error) console.warn('[hk-supervisor] attendance query failed:', attRes.error.message);
  if (shiftRes.error) console.warn('[hk-supervisor] shifts query failed:', shiftRes.error.message);
  if (staffingRes.error) console.warn('[hk-supervisor] staffing query failed:', staffingRes.error.message);
  if (trainingRes.error) console.warn('[hk-supervisor] training query failed:', trainingRes.error.message);
  if (lostFoundRes.error) console.warn('[hk-supervisor] lost_found query failed:', lostFoundRes.error.message);
  if (roomExtrasRes.error) console.warn('[hk-supervisor] room_extras query failed:', roomExtrasRes.error.message);
  if (priorityQRes.error) console.warn('[hk-supervisor] priority_queue query failed:', priorityQRes.error.message);
  if (productivityRes.error) console.warn('[hk-supervisor] productivity query failed:', productivityRes.error.message);
  if (guestReqRes.error) console.warn('[hk-supervisor] guest_requests query failed:', guestReqRes.error.message);

  // Build a room→floor lookup.
  const floorByRoom: Record<string, number | string> = {};
  (roomsRes.data || []).forEach((r: any) => { floorByRoom[r.number] = r.floor; });

  // Build a set of room numbers that have a failed inspection.
  const failedInspectionRooms = new Set<string>();
  (failedInspsRes.data || []).forEach((i: any) => failedInspectionRooms.add(i.room_number));

  // ── Live rooms from active tasks ──────────────────────────────────────
  const liveRooms = (tasksRes.data || [])
    .map((t: any) => {
      const room = parseRoomNumber(t.location);
      if (!room) return null;
      const hasFail = failedInspectionRooms.has(room);
      return {
        taskId: t.id,
        room,
        floor: floorByRoom[room] ?? 0,
        status: liveRoomStatus(t.type, t.status, hasFail),
        attendant: t.assigned_to || undefined,
        priority: t.priority as 'Normal' | 'High' | 'Critical',
        eta: hasFail ? 'Rework' : estimateEta(t.progress || 0, t.status),
      };
    })
    .filter((r: any) => r !== null)
    // Sort: Critical → High → Normal, then by room number.
    .sort((a: any, b: any) => {
      const order: Record<string, number> = { Critical: 0, High: 1, Normal: 2 };
      const pd = (order[a.priority] ?? 3) - (order[b.priority] ?? 3);
      if (pd !== 0) return pd;
      return a.room.localeCompare(b.room, undefined, { numeric: true });
    });

  // ── Escalations ───────────────────────────────────────────────────────
  const escalations = (escalationsRes.data || []).map((e: any) => ({
    id: e.id,
    room: e.room_number || '',
    issue: e.issue,
    level: e.level as 'Low' | 'Medium' | 'High' | 'Critical',
    raisedAt: e.raised_at || new Date(e.created_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
  }));

  // ── Inspection approvals (pending inspections) ────────────────────────
  const approvals = (inspectionsRes.data || []).map((i: any) => {
    const items = i.items || {};
    const itemValues = Object.values(items) as string[];
    const passCount = itemValues.filter(v => v === 'Pass').length;
    const total = itemValues.length || 12;
    const score = Math.round((passCount / total) * 100);
    return {
      id: i.id,
      room: i.room_number,
      inspector: i.inspector || 'Unassigned',
      score,
      status: 'Pending Approval' as const,
    };
  });

  // ── Staff performance (trend computed from productivity history) ──────
  // Group productivity records by staff_id, sorted by period_date desc.
  // Trend = delta between the latest two inspection_scores. Falls back to
  // '0%' if only one period exists, or '—' if no productivity data at all.
  const productivityByStaff: Record<string, any[]> = {};
  (productivityRes.data || []).forEach((p: any) => {
    const key = p.staff_id || p.employee_id;
    if (!key) return;
    if (!productivityByStaff[key]) productivityByStaff[key] = [];
    productivityByStaff[key].push(p);
  });

  function computeTrend(staffId: string): string {
    const records = productivityByStaff[staffId];
    if (!records || records.length < 2) return records && records.length === 1 ? '0%' : '—';
    const delta = (records[0].inspection_score || 0) - (records[1].inspection_score || 0);
    if (delta > 0) return `+${delta}%`;
    if (delta < 0) return `${delta}%`;
    return '0%';
  }

  const staffPerf = (staffRes.data || [])
    .filter((s: any) => s.role !== 'Supervisor')
    .slice(0, 8)
    .map((s: any) => ({
      id: s.id,
      name: s.name,
      rooms: s.rooms_completed || 0,
      score: s.inspection_score || 0,
      trend: computeTrend(s.id),
    }));

  // ── Shift summary (computed from batched queries) ─────────────────────
  const allTasks = allTasksRes.data || [];
  const roomsCompleted = allTasks.filter((t: any) => t.status === 'Completed' || t.status === 'Verified').length;

  const allInsps = allInspsRes.data || [];
  const roomsInspected = allInsps.filter((i: any) => i.result !== 'Pending').length;
  const failedInspections = allInsps.filter((i: any) => i.result === 'Fail').length;

  // Average clean time from staff cleaning_time_min.
  const validTimes = (staffTimesRes.data || []).map((s: any) => s.cleaning_time_min || 0).filter((v: number) => v > 0);
  const avgCleanTime = validTimes.length > 0
    ? `${Math.round(validTimes.reduce((a: number, b: number) => a + b, 0) / validTimes.length)}m`
    : 'N/A';

  // Guest requests — from the guest_requests table (HK department).
  const guestRequestCount = (guestReqRes.data || []).length;

  const shiftSummary = {
    roomsCompleted,
    roomsInspected,
    failedInspections,
    avgCleanTime,
    guestRequests: guestRequestCount,
    escalations: escalations.length,
  };

  // ── Attendance (today) ────────────────────────────────────────────────
  const todayAttendance = (attRes.data || []).map((a: any) => ({
    id: a.id,
    staffId: a.staff_id,
    staffName: a.staff_name,
    status: a.status,
    shift: a.shift,
    checkIn: a.check_in || null,
    checkOut: a.check_out || null,
    hoursWorked: Number(a.hours_worked) || 0,
    overtimeHours: Number(a.overtime_hours) || 0,
  }));
  const attPresent = todayAttendance.filter((a: any) => a.status === 'Present' || a.status === 'Late').length;
  const attAbsent = todayAttendance.filter((a: any) => a.status === 'Absent').length;
  const attOnLeave = todayAttendance.filter((a: any) => a.status === 'On Leave' || a.status === 'Sick').length;

  // ── Shift requirements (with gap = required - assigned) ───────────────
  const shiftGaps = (shiftRes.data || []).map((s: any) => ({
    id: s.id,
    name: s.name,
    startTime: s.start_time,
    endTime: s.end_time,
    assigned: s.assigned_staff || 0,
    required: s.required_staff || 0,
    gap: (s.required_staff || 0) - (s.assigned_staff || 0),
  }));

  // ── Staffing requirements (per floor/zone, with gap) ──────────────────
  const staffingGaps = (staffingRes.data || [])
    .map((s: any) => ({
      id: s.id,
      floor: s.floor,
      zone: s.zone,
      role: s.role,
      required: s.required_count || 0,
      assigned: s.assigned_count || 0,
      gap: (s.required_count || 0) - (s.assigned_count || 0),
      shift: s.shift,
    }))
    .filter((s: any) => s.gap > 0); // only show understaffed

  // ── Training alerts (overdue + upcoming) ───────────────────────────────
  const trainingAlerts = (trainingRes.data || []).map((t: any) => ({
    id: t.id,
    course: t.course,
    staffId: t.staff_id,
    dueDate: t.due_date,
    status: t.status,
  }));

  // ── Lost & Found (unclaimed items) ─────────────────────────────────────
  const lostFound = (lostFoundRes.data || []).map((l: any) => ({
    id: l.id,
    itemName: l.item_name,
    category: l.item_category,
    status: l.status,
    roomNumber: l.room_number || '',
    foundDate: l.found_date,
    storageLocation: l.storage_location || '',
    followUpRequired: !!l.follow_up_required,
  }));

  // ── Room extras (DND + HK status overview) ─────────────────────────────
  const roomExtras = (roomExtrasRes.data || []).map((r: any) => ({
    id: r.id,
    roomNumber: r.room_number,
    dnd: !!r.dnd,
    hkStatus: r.hk_status || 'Unknown',
    lastCleaned: r.last_cleaned || '',
    lastInspected: r.last_inspected || '',
    housekeeperId: r.housekeeper_id || '',
  }));
  const dndRooms = roomExtras.filter((r: any) => r.dnd);

  // ── Priority queue ─────────────────────────────────────────────────────
  const priorityQueue = (priorityQRes.data || []).map((p: any) => ({
    id: p.id,
    roomNumber: p.room_number,
    createdAt: p.created_at,
  }));

  // ── Staff productivity (latest period) ─────────────────────────────────
  const productivity = (productivityRes.data || []).map((p: any) => ({
    id: p.id,
    employeeId: p.employee_id,
    staffId: p.staff_id,
    roomsCleaned: p.rooms_cleaned || 0,
    hours: Number(p.hours) || 0,
    inspectionScore: p.inspection_score || 0,
    productivityScore: Number(p.productivity_score) || 0,
    periodDate: p.period_date,
  }));

  // ── Guest requests (HK department) ─────────────────────────────────────
  const guestRequests = (guestReqRes.data || []).map((g: any) => ({
    id: g.id,
    requestNumber: g.request_number,
    roomNumber: g.room_number || '',
    guestName: g.guest_name || '',
    requestType: g.request_type || '',
    priority: g.priority || 'Normal',
    status: g.status || 'Pending',
    assignedTo: g.assigned_to || '',
    submittedAt: g.submitted_at,
  }));

  const result = {
    propertyId,
    liveRooms,
    escalations,
    approvals,
    staffPerf,
    shiftSummary,
    // ── Integrated module data ────────────────────────────────────────
    attendance: {
      today: todayAttendance,
      present: attPresent,
      absent: attAbsent,
      onLeave: attOnLeave,
      total: todayAttendance.length,
    },
    shiftGaps,
    staffingGaps,
    trainingAlerts,
    lostFound,
    roomExtras: {
      all: roomExtras,
      dndCount: dndRooms.length,
      dndRooms,
    },
    priorityQueue,
    productivity,
    guestRequests,
    generatedAt: new Date().toISOString(),
  };

  cacheService.set(cacheKey, result, 15 * 1000); // short TTL — console is interactive
  return res.json(result);
});

// Resolve an escalation (set status → Resolved).
router.put('/supervisor/escalations/:id/resolve', authenticate, requirePermission('hk:supervisor:manage'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const { data, error } = await supabaseAdmin
    .from('hk_escalations')
    .update({ status: 'Resolved', resolved_at: new Date().toISOString() })
    .eq('id', req.params.id)
    .select('*')
    .single();

  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Escalation not found' });

  cacheService.invalidatePattern('^hk-supervisor-console:');
  return res.json({ success: true, id: req.params.id });
});

// Create a new escalation.
router.post('/supervisor/escalations', authenticate, requirePermission('hk:supervisor:manage'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const { propertyId, room, issue, level } = req.body || {};
  if (!propertyId || !issue) {
    return res.status(400).json({ error: 'propertyId and issue are required' });
  }
  const lvl = ESCALATION_LEVELS.has(level) ? level : 'Medium';

  const id = `ESC-${Date.now()}`;
  const { data, error } = await supabaseAdmin
    .from('hk_escalations')
    .insert({
      id,
      property_id: propertyId,
      room_number: room?.trim() || null,
      issue: issue.trim(),
      level: lvl,
      status: 'Open',
      raised_at: new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
      created_by: req.user?.id,
    })
    .select('*')
    .single();

  if (error) return res.status(500).json({ error: error.message });

  cacheService.invalidatePattern('^hk-supervisor-console:');
  return res.status(201).json({
    id: data.id,
    room: data.room_number || '',
    issue: data.issue,
    level: data.level,
    raisedAt: data.raised_at,
  });
});

// Reassign a task (update assigned_to on housekeeping_task_mgmt).
router.put('/supervisor/tasks/:id/reassign', authenticate, requirePermission('hk:supervisor:manage'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const { assignedTo } = req.body || {};
  if (!assignedTo) return res.status(400).json({ error: 'assignedTo is required' });

  const { data, error } = await supabaseAdmin
    .from('housekeeping_task_mgmt')
    .update({ assigned_to: assignedTo })
    .eq('id', req.params.id)
    .select('id, assigned_to')
    .single();

  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Task not found' });

  cacheService.invalidatePattern('^hk-supervisor-console:');
  cacheService.invalidatePattern('^hk-task-management:');
  return res.json({ success: true, id: data.id, assignedTo: data.assigned_to });
});

// Override priority on a task.
router.put('/supervisor/tasks/:id/priority', authenticate, requirePermission('hk:supervisor:manage'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const { priority } = req.body || {};
  const valid = new Set(['Low', 'Medium', 'High', 'Critical']);
  if (!valid.has(priority)) return res.status(400).json({ error: 'Invalid priority' });

  const { data, error } = await supabaseAdmin
    .from('housekeeping_task_mgmt')
    .update({ priority })
    .eq('id', req.params.id)
    .select('id, priority')
    .single();

  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Task not found' });

  cacheService.invalidatePattern('^hk-supervisor-console:');
  cacheService.invalidatePattern('^hk-task-management:');
  return res.json({ success: true, id: data.id, priority: data.priority });
});

// Approve a pending inspection (set result → Pass, mark all pending items as Pass).
// Blocks approval if any item is 'Fail' — failed items require rework before
// the supervisor can approve the inspection overall.
router.put('/supervisor/inspections/:id/approve', authenticate, requirePermission('hk:supervisor:manage'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const { data: current, error: fetchError } = await supabaseAdmin
    .from('room_inspections')
    .select('items')
    .eq('id', req.params.id)
    .single();
  if (fetchError) return res.status(500).json({ error: fetchError.message });
  if (!current) return res.status(404).json({ error: 'Inspection not found' });

  // Block approval if any item is 'Fail' — failed items require rework
  // before the supervisor can approve the inspection overall. Approving an
  // inspection with unresolved failures would mark it 'Pass' while leaving
  // the failed items unaddressed, which is inconsistent.
  const itemValues = Object.values(current.items || {}) as string[];
  const failedItems = itemValues.filter(v => v === 'Fail');
  if (failedItems.length > 0) {
    return res.status(400).json({
      error: `Cannot approve inspection: ${failedItems.length} item(s) failed and require rework. Reject the inspection to send it back for cleaning, or re-inspect after rework.`,
    });
  }

  // Mark all pending items as Pass.
  const items: Record<string, string> = {};
  for (const [k, v] of Object.entries(current.items || {})) {
    items[k] = v === 'Pending' ? 'Pass' : String(v);
  }

  const { data, error } = await supabaseAdmin
    .from('room_inspections')
    .update({ result: 'Pass', items })
    .eq('id', req.params.id)
    .select('id, result')
    .single();

  if (error) return res.status(500).json({ error: error.message });

  cacheService.invalidatePattern('^hk-supervisor-console:');
  cacheService.invalidatePattern('^hk-room-inspections:');
  return res.json({ success: true, id: data.id, result: data.result });
});

// Reject a pending inspection (set result → Fail).
router.put('/supervisor/inspections/:id/reject', authenticate, requirePermission('hk:supervisor:manage'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const { data, error } = await supabaseAdmin
    .from('room_inspections')
    .update({ result: 'Fail' })
    .eq('id', req.params.id)
    .select('id, result')
    .single();

  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Inspection not found' });

  cacheService.invalidatePattern('^hk-supervisor-console:');
  cacheService.invalidatePattern('^hk-room-inspections:');
  return res.json({ success: true, id: data.id, result: data.result });
});

// ── Linen Management (docs/Housekeeping Portal new.md §12) ──────────────
// Backs the Linen Management module: linen types with par/in_stock/in_use/
// at_laundry/damaged/lost counters and the Issue / Return / Damaged / Lost /
// ── HK Store side effects (UNIFIED INVENTORY) ─────────────────────────
// Best-effort helper that keeps uinv_stock_balances (HK store) in sync when
// items flow in or out of the housekeeping sub-modules (Linen, Laundry,
// Amenities, Minibar). Resolves the uinv_items row by explicit itemId when
// provided, otherwise by case-insensitive name match.
//
// Uses the unified uinv_* tables exclusively:
//   - uinv_items for item lookup
//   - uinv_stock_balances (store_id = UINV-ST-HK) for stock
//   - uinv_stock_ledger for movement logging
//
// IMPORTANT: when no matching uinv_items row exists AND no itemId is
// provided, the side-effect is SKIPPED (with a console warning) rather than
// creating a phantom negative-stock row. Callers that want auto-creation
// should pass `autoCreate: true` (used only by goods receipt).
type HkStoreResult =
  | { ok: true; itemId: string; newQuantity: number; warning?: string }
  | { ok: false; reason: 'unlinked' | 'ambiguous' | 'skipped'; warning?: string };

async function adjustHkStore(
  propertyId: string,
  itemName: string,
  itemCategory: 'cleaning_supplies' | 'linens' | 'equipment' | 'amenities' | 'other',
  deltaQty: number,
  action: 'restock' | 'consume',
  actorId?: string,
  staff?: string,
  notes?: string,
  opts?: { itemId?: string; autoCreate?: boolean }
): Promise<HkStoreResult> {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return { ok: false, reason: 'skipped' };
  if (!Number.isFinite(deltaQty) || deltaQty <= 0) return { ok: false, reason: 'skipped' };

  const qty = Math.max(0, Number(deltaQty));
  const name = String(itemName).trim().slice(0, 120);
  if (!name && !opts?.itemId) return { ok: false, reason: 'skipped' };

  // Determine which uinv store to use based on category.
  const storeId = itemCategory === 'linens' ? HK_LINEN_STORE_ID : HK_STORE_ID;

  // Find the uinv_items row: prefer explicit itemId, else name match.
  // The name match is scoped to the Housekeeping category to avoid
  // cross-department collisions (e.g. an F&B item with the same name).
  // If multiple matches are found, the match is ambiguous and we refuse
  // to adjust rather than silently picking the first one.
  let item: { id: string; item_name: string; unit_of_measure: string } | null = null;
  let matchedByName = false;
  if (opts?.itemId) {
    const { data, error } = await supabaseAdmin
      .from('uinv_items')
      .select('id, item_name, unit_of_measure')
      .eq('id', opts.itemId)
      .maybeSingle();
    if (error) return { ok: false, reason: 'skipped' };
    item = data as any;
  } else {
    // Scope to Housekeeping category + active items to reduce collision risk.
    const { data: matches, error } = await supabaseAdmin
      .from('uinv_items')
      .select('id, item_name, unit_of_measure')
      .ilike('item_name', name)
      .eq('category', 'Housekeeping')
      .eq('is_active', true)
      .limit(5);
    if (error) return { ok: false, reason: 'skipped' };
    if (matches && matches.length === 1) {
      item = matches[0] as any;
      matchedByName = true;
    } else if (matches && matches.length > 1) {
      // Ambiguous — multiple items share the same name. Refuse and surface
      // a warning listing the candidates so the user can link explicitly.
      const candidates = matches.map((m: any) => `"${m.item_name}" (${m.id})`).join(', ');
      const warning = `"${name}" matched ${matches.length} Housekeeping items (${candidates}). Stock was not adjusted — link the linen/amenity row to a specific inventory_item_id to disambiguate.`;
      console.warn(`[adjustHkStore] ${warning}`);
      return { ok: false, reason: 'ambiguous', warning };
    }
    // 0 matches → item stays null, falls through to the unlinked/autoCreate path below.
  }

  const now = new Date().toISOString();
  const signedDelta = action === 'restock' ? qty : -qty;
  let itemId: string;
  let resultQty: number;

  if (item) {
    // Find the stock balance row for this item in the HK/Linen store.
    const { data: balance } = await supabaseAdmin
      .from('uinv_stock_balances')
      .select('id, on_hand, unit_cost')
      .eq('item_id', item.id)
      .eq('store_id', storeId)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (balance) {
      const newQty = Math.max(0, (Number(balance.on_hand) || 0) + signedDelta);
      await supabaseAdmin
        .from('uinv_stock_balances')
        .update({ on_hand: newQty, last_movement_date: now, updated_at: now })
        .eq('id', balance.id);
      itemId = item.id;
      resultQty = newQty;

      // Log to uinv_stock_ledger
      await supabaseAdmin.from('uinv_stock_ledger').insert({
        property_id: propertyId,
        item_id: item.id,
        store_id: storeId,
        transaction_type: action === 'restock' ? 'Goods Receipt' : 'Consumption',
        reference: `HK ${action} — ${itemCategory}`,
        quantity_in: action === 'restock' ? qty : 0,
        quantity_out: action === 'consume' ? qty : 0,
        balance: newQty,
        unit_cost: Number(balance.unit_cost || 0),
        value: qty * Number(balance.unit_cost || 0),
        performed_by: staff || (isUuid(actorId) ? actorId : 'system'),
        reason: notes || `${action} side effect from ${itemCategory}`,
        transaction_date: now,
      });
    } else {
      // Item exists in uinv_items but no balance row in HK store — create one on restock.
      if (action === 'restock' || opts?.autoCreate) {
        const newBalanceId = `UINV-SB-HK-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        await supabaseAdmin.from('uinv_stock_balances').insert({
          id: newBalanceId,
          property_id: propertyId,
          item_id: item.id,
          store_id: storeId,
          location_id: null,
          on_hand: Math.max(0, signedDelta),
          reserved: 0, allocated: 0, on_order: 0, in_transit: 0,
          damaged: 0, quarantined: 0, expired: 0,
          status: 'Available',
          unit_cost: 0,
          last_movement_date: now,
        });
        itemId = item.id;
        resultQty = Math.max(0, signedDelta);
      } else {
        const warning = `"${name}" has no stock balance in the HK store — stock was not adjusted.`;
        console.warn(`[adjustHkStore] ${warning}`);
        return { ok: false, reason: 'unlinked', warning };
      }
    }
  } else if (opts?.autoCreate && action === 'restock') {
    // Auto-create the item in uinv_items + a balance row in the HK store.
    const { data: newItem } = await supabaseAdmin.from('uinv_items').insert({
      property_id: propertyId,
      item_code: `HK-AUTO-${Date.now()}`,
      item_name: name || 'Unnamed Item',
      category: 'Housekeeping',
      subcategory: itemCategory,
      item_type: 'Consumable',
      unit_of_measure: 'PCS',
      min_stock: 0, max_stock: null, reorder_point: 0, safety_stock: 0, par_level: 0,
      default_store_id: storeId,
      costing_method: 'Weighted Average',
      last_cost: 0, avg_cost: 0, standard_cost: 0,
      is_active: true,
    }).select('id, item_name, unit_of_measure').single();
    if (!newItem) return { ok: false, reason: 'skipped' };

    const newBalanceId = `UINV-SB-HK-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    await supabaseAdmin.from('uinv_stock_balances').insert({
      id: newBalanceId,
      property_id: propertyId,
      item_id: newItem.id,
      store_id: storeId,
      location_id: null,
      on_hand: Math.max(0, signedDelta),
      reserved: 0, allocated: 0, on_order: 0, in_transit: 0,
      damaged: 0, quarantined: 0, expired: 0,
      status: 'Available',
      unit_cost: 0,
      last_movement_date: now,
    });
    itemId = newItem.id;
    resultQty = Math.max(0, signedDelta);
  } else {
    const warning = `"${name}" is not linked to a unified inventory item — stock was not adjusted. Add it in the Inventory tab to enable stock tracking.`;
    console.warn(`[adjustHkStore] ${warning} (property ${propertyId}, action ${action})`);
    return { ok: false, reason: 'unlinked', warning };
  }

  // If we matched by name (not explicit itemId), surface a soft warning so
  // the UI can flag the row for explicit linking. Name matching is fragile
  // (typos, renames) and should be replaced with an explicit inventory_item_id.
  if (matchedByName) {
    const warning = `"${name}" was matched to uinv_items by name ("${item?.item_name}"). This is fragile — link the linen/amenity row to inventory_item_id "${itemId}" for reliable stock tracking.`;
    return { ok: true, itemId, newQuantity: resultQty, warning };
  }

  return { ok: true, itemId, newQuantity: resultQty };
}

// Dedicated Minibar stock adjuster. Routes minibar items to the Beverage Store
// (UINV-ST-BEV) or Food Store (UINV-ST-FOOD) based on category / explicit linkage,
// preserving clean separation between revenue minibar goods and HK amenities.
async function adjustMinibarStore(
  propertyId: string,
  catalogItem: { id?: string; name: string; inventory_item_id?: string | null },
  deltaQty: number,
  action: 'consume' | 'restock',
  actorId?: string,
  staff?: string,
  notes?: string
): Promise<HkStoreResult> {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return { ok: false, reason: 'skipped' };
  if (!Number.isFinite(deltaQty) || deltaQty <= 0) return { ok: false, reason: 'skipped' };

  const qty = Math.max(0, Number(deltaQty));
  const name = String(catalogItem.name).trim().slice(0, 120);

  // 1. Resolve unified item
  let item: { id: string; item_name: string; unit_of_measure: string; category?: string; subcategory?: string; default_store_id?: string } | null = null;
  if (catalogItem.inventory_item_id) {
    const { data } = await supabaseAdmin
      .from('uinv_items')
      .select('id, item_name, unit_of_measure, category, subcategory, default_store_id')
      .eq('id', catalogItem.inventory_item_id)
      .maybeSingle();
    item = data as any;
  }
  if (!item) {
    const { data } = await supabaseAdmin
      .from('uinv_items')
      .select('id, item_name, unit_of_measure, category, subcategory, default_store_id')
      .ilike('item_name', name)
      .limit(1)
      .maybeSingle();
    item = data as any;
  }

  // 2. Determine target store: default to Beverage Store or Food Store
  let storeId = FB_BEV_STORE_ID;
  if (item?.default_store_id) {
    storeId = item.default_store_id;
  } else if (item?.category === 'Food') {
    storeId = FB_FOOD_STORE_ID;
  } else if (item?.category === 'Housekeeping') {
    storeId = HK_STORE_ID;
  }

  const now = new Date().toISOString();
  const signedDelta = action === 'restock' ? qty : -qty;

  if (item) {
    const { data: balance } = await supabaseAdmin
      .from('uinv_stock_balances')
      .select('id, on_hand, unit_cost')
      .eq('item_id', item.id)
      .eq('store_id', storeId)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (balance) {
      const newQty = Math.max(0, (Number(balance.on_hand) || 0) + signedDelta);
      await supabaseAdmin
        .from('uinv_stock_balances')
        .update({ on_hand: newQty, last_movement_date: now, updated_at: now })
        .eq('id', balance.id);

      await supabaseAdmin.from('uinv_stock_ledger').insert({
        property_id: propertyId,
        item_id: item.id,
        store_id: storeId,
        transaction_type: action === 'restock' ? 'Goods Receipt' : 'Consumption',
        reference: `Minibar ${action === 'restock' ? 'Refill' : 'Consumption'}`,
        quantity_in: action === 'restock' ? qty : 0,
        quantity_out: action === 'consume' ? qty : 0,
        balance: newQty,
        unit_cost: Number(balance.unit_cost || 0),
        value: qty * Number(balance.unit_cost || 0),
        performed_by: staff || (isUuid(actorId) ? actorId : 'system'),
        reason: notes || `Minibar ${action}: ${catalogItem.name}`,
        transaction_date: now,
      });

      return { ok: true, itemId: item.id, newQuantity: newQty };
    }
  }

  // Fallback to adjustHkStore if no beverage balance row exists
  return adjustHkStore(propertyId, name, 'other', qty, action, actorId, staff, notes, {
    itemId: catalogItem.inventory_item_id || undefined,
  });
}

// Linen Count operations log. Persisted to hk_linen_stock + hk_linen_log.
// Linen types are user-defined (any non-empty string up to 80 chars) — the
// fixed whitelist was removed in migration 305 so admins can add new types
// through the Par Catalog UI.
const isLinenType = (v: unknown): boolean =>
  typeof v === 'string' && v.trim().length > 0 && v.length <= 80;
const LINEN_OPERATIONS = new Set([
  'Issue Linen', 'Return Linen', 'Damaged Linen', 'Lost Linen', 'Linen Count',
]);

// system_users ids are strings like "U-1721568085-7", not UUIDs. Only
// set created_by when the id is a valid UUID to avoid Postgres cast errors.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (v: unknown): boolean => typeof v === 'string' && UUID_RE.test(v);

function shapeLinenStock(row: any) {
  return {
    id: row.id,
    type: row.type,
    par: row.par,
    inStock: row.in_stock,
    inUse: row.in_use,
    atLaundry: row.at_laundry,
    damaged: row.damaged,
    lost: row.lost,
    inventoryItemId: row.inventory_item_id || null,
    updatedAt: row.updated_at,
  };
}

function shapeLinenLog(row: any) {
  return {
    id: row.id,
    operation: row.operation,
    type: row.type,
    quantity: row.quantity,
    location: row.location || '',
    staff: row.staff || '',
    notes: row.notes || undefined,
    createdAt: row.created_at,
  };
}

// Get linen stock + operations log + catalog for a property in a single round-trip.
router.get('/linen/:propertyId', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const cacheKey = `hk-linen:${req.params.propertyId}`;
  const cached = cacheService.get(cacheKey);
  if (cached) return res.json(cached);

  const [stockRes, logRes, catalogRes] = await Promise.all([
    supabaseAdmin
      .from('hk_linen_stock')
      .select('*')
      .eq('property_id', req.params.propertyId)
      .order('type'),
    supabaseAdmin
      .from('hk_linen_log')
      .select('*')
      .eq('property_id', req.params.propertyId)
      .order('created_at', { ascending: false })
      .limit(200),
    supabaseAdmin
      .from('hk_linen_catalog')
      .select('*')
      .eq('property_id', req.params.propertyId)
      .order('type'),
  ]);

  if (stockRes.error) return res.status(500).json({ error: stockRes.error.message });
  if (logRes.error) return res.status(500).json({ error: logRes.error.message });
  // Tolerate a missing hk_linen_catalog table (migration 301 not yet applied):
  // treat it as an empty catalog and fall back to stock.par.
  const catalogError = catalogRes.error && catalogRes.error.code !== '42P01' ? catalogRes.error : null;
  if (catalogError) return res.status(500).json({ error: catalogError.message });
  const catalogRows = catalogRes.data || [];

  // Catalog is the source of truth for par; override stock.par with catalog
  // par_level where a catalog row exists so the UI always shows the editable value.
  const catalogByType = new Map(catalogRows.map((c: any) => [c.type, c]));
  const stock = (stockRes.data || []).map((row: any) => {
    const cat = catalogByType.get(row.type);
    return shapeLinenStock(cat ? { ...row, par: cat.par_level } : row);
  });
  const log = (logRes.data || []).map(shapeLinenLog);
  const catalog = catalogRows.map((c: any) => ({
    id: c.id,
    type: c.type,
    parLevel: c.par_level,
    active: c.active,
    updatedAt: c.updated_at,
  }));

  const totals = stock.reduce(
    (acc, s) => ({
      par: acc.par + s.par,
      inStock: acc.inStock + s.inStock,
      inUse: acc.inUse + s.inUse,
      atLaundry: acc.atLaundry + s.atLaundry,
      damaged: acc.damaged + s.damaged,
      lost: acc.lost + s.lost,
    }),
    { par: 0, inStock: 0, inUse: 0, atLaundry: 0, damaged: 0, lost: 0 }
  );

  const result = {
    propertyId: req.params.propertyId,
    stock,
    log,
    catalog,
    totals,
    generatedAt: new Date().toISOString(),
  };

  cacheService.set(cacheKey, result, 15 * 1000); // short TTL — interactive
  return res.json(result);
});

// Apply a linen operation (Issue / Return / Damaged / Lost / Linen Count).
// Updates the stock counters atomically and appends a log entry.
router.post('/linen/operation', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const { propertyId, operation, type, quantity, location, staff, notes } = req.body || {};
  if (!propertyId || !operation || !type) {
    return res.status(400).json({ error: 'propertyId, operation, and type are required' });
  }
  if (!LINEN_OPERATIONS.has(operation)) {
    return res.status(400).json({ error: `Invalid operation: ${operation}` });
  }
  if (!isLinenType(type)) {
    return res.status(400).json({ error: 'A valid linen type (non-empty, ≤80 chars) is required' });
  }
  const qty = Math.max(0, Math.floor(Number(quantity) || 0));

  // Fetch the current stock row for this type.
  const { data: current, error: fetchError } = await supabaseAdmin
    .from('hk_linen_stock')
    .select('*')
    .eq('property_id', propertyId)
    .eq('type', type)
    .maybeSingle();

  if (fetchError) return res.status(500).json({ error: fetchError.message });
  if (!current) return res.status(404).json({ error: `No stock row for ${type}` });

  // Compute the new counters based on the operation.
  let inStock = current.in_stock;
  let inUse = current.in_use;
  let atLaundry = current.at_laundry;
  let damaged = current.damaged;
  let lost = current.lost;

  switch (operation) {
    case 'Issue Linen':
      inStock = Math.max(0, inStock - qty);
      inUse = inUse + qty;
      break;
    case 'Return Linen':
      inUse = Math.max(0, inUse - qty);
      atLaundry = atLaundry + qty;
      break;
    case 'Damaged Linen':
      inUse = Math.max(0, inUse - qty);
      damaged = damaged + qty;
      break;
    case 'Lost Linen':
      inUse = Math.max(0, inUse - qty);
      lost = lost + qty;
      break;
    case 'Linen Count':
      // Linen Count resets the in-stock to the counted quantity.
      inStock = qty;
      break;
  }

  const { error: updateError } = await supabaseAdmin
    .from('hk_linen_stock')
    .update({
      in_stock: inStock,
      in_use: inUse,
      at_laundry: atLaundry,
      damaged,
      lost,
      updated_at: new Date().toISOString(),
    })
    .eq('id', current.id);

  if (updateError) return res.status(500).json({ error: updateError.message });

  // Append the log entry.
  const logId = `LN-${Date.now()}`;
  const { data: logRow, error: logError } = await supabaseAdmin
    .from('hk_linen_log')
    .insert({
      id: logId,
      property_id: propertyId,
      operation,
      type,
      quantity: qty,
      location: location || null,
      staff: staff || null,
      notes: notes || null,
      created_by: isUuid(req.user?.id) ? req.user?.id : null,
    })
    .select('*')
    .single();

  if (logError) return res.status(500).json({ error: logError.message });

  let inventoryWarning: string | undefined;
  const linenItemId = current.inventory_item_id as string | undefined;
  if (operation === 'Issue Linen') {
    const storeResult = await adjustHkStore(
      propertyId,
      type,
      'linens',
      qty,
      'consume',
      isUuid(req.user?.id) ? req.user?.id : undefined,
      staff,
      `Issue Linen to ${location || 'room'}`,
      { itemId: linenItemId }
    );
    if (!storeResult.ok && (storeResult.reason === 'unlinked' || storeResult.reason === 'ambiguous')) inventoryWarning = storeResult.warning;
    else if (storeResult.ok && storeResult.warning) inventoryWarning = storeResult.warning;
  } else if (operation === 'Damaged Linen' || operation === 'Lost Linen') {
    // Post a waste transaction to uinv_stock_ledger so the Inventory → Waste
    // tab reflects linen losses. Resolve the unified item by explicit linkage
    // first, then fall back to name matching. Never auto-create a phantom row.
    const wasteType = operation === 'Damaged Linen' ? 'damaged' : 'lost';
    let linenItem: { id: string; item_name: string; unit_of_measure: string; subcategory: string; property_id: string } | null = null;
    if (linenItemId) {
      const { data } = await supabaseAdmin
        .from('uinv_items')
        .select('id, item_name, unit_of_measure, subcategory, property_id')
        .eq('id', linenItemId)
        .maybeSingle();
      linenItem = data as any;
    }
    if (!linenItem) {
      const { data } = await supabaseAdmin
        .from('uinv_items')
        .select('id, item_name, unit_of_measure, subcategory, property_id')
        .ilike('item_name', type)
        .eq('category', 'Housekeeping')
        .maybeSingle();
      linenItem = data as any;
    }
    if (linenItem) {
      const storeId = (linenItem.subcategory === 'Laundry Supplies') ? HK_LINEN_STORE_ID : HK_STORE_ID;
      const { data: balance } = await supabaseAdmin
        .from('uinv_stock_balances')
        .select('id, on_hand, unit_cost')
        .eq('item_id', linenItem.id)
        .eq('store_id', storeId)
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (balance) {
        const newQty = Math.max(0, (Number(balance.on_hand) || 0) - qty);
        const now = new Date().toISOString();
        await supabaseAdmin.from('uinv_stock_balances').update({
          on_hand: newQty, updated_at: now,
        }).eq('id', balance.id);
        await supabaseAdmin.from('uinv_stock_ledger').insert({
          property_id: linenItem.property_id || propertyId,
          item_id: linenItem.id,
          store_id: storeId,
          transaction_type: 'Waste',
          reference: `HK Linen — ${wasteType}`,
          quantity_in: 0,
          quantity_out: qty,
          balance: newQty,
          unit_cost: Number(balance.unit_cost || 0),
          value: qty * Number(balance.unit_cost || 0),
          performed_by: staff || (isUuid(req.user?.id) ? req.user!.id : 'system'),
          reason: `${operation} — ${qty} ${linenItem.unit_of_measure || 'pcs'}${location ? ` (${location})` : ''}`,
          transaction_date: now,
        });
      }
    } else {
      // Consistent with adjustHkStore: never auto-create a phantom negative
      // row on a loss. hk_linen_stock.damaged/lost already recorded it —
      // surface a warning so the operator links the item for cost tracking.
      inventoryWarning = `"${type}" is not linked to a unified inventory item — the ${wasteType} loss was recorded against linen counters but not costed. Add it in the Inventory tab to enable waste costing.`;
      console.warn(`[hk-linen] ${inventoryWarning} (property ${propertyId})`);
    }
  } else if (operation === 'Return Linen' || operation === 'Linen Count') {
    // Post a transfer/adjustment transaction to uinv_stock_ledger so the
    // Inventory → Transfers and Stock Movements tabs reflect linen returns
    // and counts. Resolve the unified item by explicit linkage first, then
    // fall back to name matching.
    let linenItem: { id: string; item_name: string; unit_of_measure: string; subcategory: string; property_id: string } | null = null;
    if (linenItemId) {
      const { data } = await supabaseAdmin
        .from('uinv_items')
        .select('id, item_name, unit_of_measure, subcategory, property_id')
        .eq('id', linenItemId)
        .maybeSingle();
      linenItem = data as any;
    }
    if (!linenItem) {
      const { data } = await supabaseAdmin
        .from('uinv_items')
        .select('id, item_name, unit_of_measure, subcategory, property_id')
        .ilike('item_name', type)
        .eq('category', 'Housekeeping')
        .maybeSingle();
      linenItem = data as any;
    }
    if (linenItem) {
      const storeId = (linenItem.subcategory === 'Laundry Supplies') ? HK_LINEN_STORE_ID : HK_STORE_ID;
      const { data: balance } = await supabaseAdmin
        .from('uinv_stock_balances')
        .select('id, on_hand, unit_cost')
        .eq('item_id', linenItem.id)
        .eq('store_id', storeId)
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (balance) {
        const now = new Date().toISOString();
        if (operation === 'Return Linen') {
          // Return from use → stock increases (Transfer In from in-use)
          const newQty = (Number(balance.on_hand) || 0) + qty;
          await supabaseAdmin.from('uinv_stock_balances').update({
            on_hand: newQty, updated_at: now,
          }).eq('id', balance.id);
          await supabaseAdmin.from('uinv_stock_ledger').insert({
            property_id: linenItem.property_id || propertyId,
            item_id: linenItem.id,
            store_id: storeId,
            transaction_type: 'Transfer In',
            reference: 'HK Linen — Return',
            quantity_in: qty,
            quantity_out: 0,
            balance: newQty,
            unit_cost: Number(balance.unit_cost || 0),
            value: qty * Number(balance.unit_cost || 0),
            performed_by: staff || (isUuid(req.user?.id) ? req.user!.id : 'system'),
            reason: `Return Linen — ${qty} ${linenItem.unit_of_measure || 'pcs'}${location ? ` (${location})` : ''}`,
            transaction_date: now,
          });
        } else if (operation === 'Linen Count') {
          // Linen Count adjusts on_hand to the counted quantity
          const countedQty = qty;
          const currentQty = Number(balance.on_hand) || 0;
          const diff = countedQty - currentQty;
          await supabaseAdmin.from('uinv_stock_balances').update({
            on_hand: countedQty, updated_at: now,
          }).eq('id', balance.id);
          await supabaseAdmin.from('uinv_stock_ledger').insert({
            property_id: linenItem.property_id || propertyId,
            item_id: linenItem.id,
            store_id: storeId,
            transaction_type: 'Stock Count',
            reference: 'HK Linen — Count',
            quantity_in: diff > 0 ? diff : 0,
            quantity_out: diff < 0 ? Math.abs(diff) : 0,
            balance: countedQty,
            unit_cost: Number(balance.unit_cost || 0),
            value: Math.abs(diff) * Number(balance.unit_cost || 0),
            performed_by: staff || (isUuid(req.user?.id) ? req.user!.id : 'system'),
            reason: `Linen Count — counted ${countedQty} ${linenItem.unit_of_measure || 'pcs'}${location ? ` (${location})` : ''}`,
            transaction_date: now,
          });
        }
      } else {
        inventoryWarning = `"${type}" is not linked to a unified inventory balance — the ${operation.toLowerCase()} was recorded against linen counters but not reflected in stock movements. Add it in the Inventory tab to enable movement tracking.`;
      }
    } else {
      inventoryWarning = `"${type}" is not linked to a unified inventory item — the ${operation.toLowerCase()} was recorded against linen counters but not reflected in stock movements. Add it in the Inventory tab to enable movement tracking.`;
    }
  }

  cacheService.invalidatePattern('^hk-linen:');
  return res.status(201).json({
    stock: shapeLinenStock({
      ...current,
      in_stock: inStock,
      in_use: inUse,
      at_laundry: atLaundry,
      damaged,
      lost,
      updated_at: new Date().toISOString(),
    }),
    log: shapeLinenLog(logRow),
    ...(inventoryWarning ? { inventoryWarning } : {}),
  });
});

// ── Linen Catalog CRUD (editable par levels) ───────────────────────────
// Backs the Catalog sub-tab in the Linen Management module. The catalog is
// the source of truth for par_level per linen type; hk_linen_stock.par is
// kept in sync whenever a catalog row is created/updated.
// All mutations require the 'hk:linen:manage' permission (granted to
// hk_supervisor + hk_manager roles via migration 306; full-access roles
// bypass via isFullAccessRole()).

// Add a catalog entry (sets par_level for a linen type).
router.post('/linen/catalog', authenticate, requirePermission('hk:linen:manage'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const { propertyId, type, parLevel } = req.body || {};
  if (!propertyId || !type) {
    return res.status(400).json({ error: 'propertyId and type are required' });
  }
  if (!isLinenType(type)) {
    return res.status(400).json({ error: 'A valid linen type (non-empty, ≤80 chars) is required' });
  }
  const parNum = Math.max(0, Math.floor(Number(parLevel) || 0));

  const { data, error } = await supabaseAdmin
    .from('hk_linen_catalog')
    .insert({
      property_id: propertyId,
      type: String(type),
      par_level: parNum,
      active: true,
    })
    .select('*')
    .single();

  if (error) {
    if (error.code === '23505') {
      return res.status(409).json({ error: `Catalog entry for "${type}" already exists` });
    }
    return res.status(500).json({ error: error.message });
  }

  // Sync par into the matching hk_linen_stock row if it exists.
  await supabaseAdmin
    .from('hk_linen_stock')
    .update({ par: parNum })
    .eq('property_id', propertyId)
    .eq('type', type);

  cacheService.invalidatePattern('^hk-linen:');
  return res.status(201).json({
    item: { id: data.id, type: data.type, parLevel: data.par_level, active: data.active, updatedAt: data.updated_at },
  });
});

// Update a catalog entry (par_level and/or active).
router.put('/linen/catalog/:id', authenticate, requirePermission('hk:linen:manage'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const { id } = req.params;
  const { parLevel, active } = req.body || {};
  const updates: any = {};
  if (parLevel !== undefined) updates.par_level = Math.max(0, Math.floor(Number(parLevel) || 0));
  if (active !== undefined) updates.active = Boolean(active);

  const { data, error } = await supabaseAdmin
    .from('hk_linen_catalog')
    .update(updates)
    .eq('id', id)
    .select('*')
    .single();

  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Catalog entry not found' });

  // Sync par into the matching hk_linen_stock row.
  if (parLevel !== undefined) {
    await supabaseAdmin
      .from('hk_linen_stock')
      .update({ par: Math.max(0, Math.floor(Number(parLevel) || 0)) })
      .eq('property_id', data.property_id)
      .eq('type', data.type);
  }

  cacheService.invalidatePattern('^hk-linen:');
  return res.json({
    item: { id: data.id, type: data.type, parLevel: data.par_level, active: data.active, updatedAt: data.updated_at },
  });
});

// Delete a catalog entry.
router.delete('/linen/catalog/:id', authenticate, requirePermission('hk:linen:manage'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const { id } = req.params;
  const { error } = await supabaseAdmin
    .from('hk_linen_catalog')
    .delete()
    .eq('id', id);

  if (error) return res.status(500).json({ error: error.message });

  cacheService.invalidatePattern('^hk-linen:');
  return res.json({ success: true });
});

// Link a linen stock row to a unified uinv_items row.
// When set, linen operations pass the itemId to adjustHkStore() directly,
// bypassing fragile name matching. Pass null to unlink.
router.put('/linen/stock/:id/link', authenticate, requirePermission('hk:linen:manage'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { inventoryItemId } = req.body || {};
  // Validate the unified item exists if provided.
  if (inventoryItemId) {
    const { data: item, error: ie } = await supabaseAdmin
      .from('uinv_items')
      .select('id, property_id')
      .eq('id', inventoryItemId)
      .maybeSingle();
    if (ie) return res.status(500).json({ error: ie.message });
    if (!item) return res.status(404).json({ error: 'Unified inventory item not found' });
  }
  const { data, error } = await supabaseAdmin
    .from('hk_linen_stock')
    .update({ inventory_item_id: inventoryItemId || null, updated_at: new Date().toISOString() })
    .eq('id', req.params.id)
    .select('*')
    .single();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Linen stock row not found' });
  cacheService.invalidatePattern('^hk-linen:');
  return res.json({ stock: shapeLinenStock(data) });
});

// ── Laundry Interface (docs/Housekeeping Portal new.md §13) ─────────────
// Backs the Laundry Interface module: the wash/dry/iron production cycle for
// Guest / Uniform / Linen laundry. Persisted to hk_laundry_jobs.
const LAUNDRY_CATEGORIES = new Set(['Guest', 'Uniform', 'Linen']);
const LAUNDRY_SERVICE_TYPES = new Set(['Wash', 'Dry Clean', 'Iron', 'Express Service']);
const LAUNDRY_STATUSES = new Set([
  'Pickup Requested', 'Collected', 'Washing', 'Drying', 'Ironing', 'Ready', 'Delivered',
]);
const LAUNDRY_STATUS_FLOW = [
  'Pickup Requested', 'Collected', 'Washing', 'Drying', 'Ironing', 'Ready', 'Delivered',
];

function shapeLaundryJob(row: any) {
  return {
    id: row.id,
    category: row.category,
    serviceType: row.service_type,
    pieces: row.pieces,
    status: row.status,
    guestName: row.guest_name || undefined,
    roomNumber: row.room_number || undefined,
    staff: row.staff || undefined,
    requestedAt: row.requested_at || '',
    eta: row.eta || undefined,
    exception: row.exception || undefined,
    updatedAt: row.updated_at,
  };
}

// Get all laundry jobs for a property (newest first).
router.get('/laundry/:propertyId', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const cacheKey = `hk-laundry:${req.params.propertyId}`;
  const cached = cacheService.get(cacheKey);
  if (cached) return res.json(cached);

  const { data, error } = await supabaseAdmin
    .from('hk_laundry_jobs')
    .select('*')
    .eq('property_id', req.params.propertyId)
    .order('created_at', { ascending: false })
    .limit(200);

  if (error) return res.status(500).json({ error: error.message });

  const jobs = (data || []).map(shapeLaundryJob);
  const result = {
    propertyId: req.params.propertyId,
    jobs,
    summary: {
      pickupRequests: jobs.filter(j => j.status === 'Pickup Requested').length,
      inDelivery: jobs.filter(j => j.status === 'Ready' || j.status === 'Delivered').length,
      guest: jobs.filter(j => j.category === 'Guest').length,
      uniform: jobs.filter(j => j.category === 'Uniform').length,
      linen: jobs.filter(j => j.category === 'Linen').length,
      exceptions: jobs.filter(j => j.exception).length,
    },
    generatedAt: new Date().toISOString(),
  };

  cacheService.set(cacheKey, result, 15 * 1000);
  return res.json(result);
});

// Create a new laundry job (pickup request).
// Requires hk:laundry:manage (granted to hk_supervisor / hk_manager via
// migration 307; full-access roles bypass via isFullAccessRole()).
router.post('/laundry', authenticate, requirePermission('hk:laundry:manage'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const { propertyId, category, serviceType, pieces, guestName, roomNumber, staff, eta, exception } = req.body || {};
  if (!propertyId || !category || !serviceType) {
    return res.status(400).json({ error: 'propertyId, category, and serviceType are required' });
  }
  if (!LAUNDRY_CATEGORIES.has(category)) return res.status(400).json({ error: `Invalid category: ${category}` });
  if (!LAUNDRY_SERVICE_TYPES.has(serviceType)) return res.status(400).json({ error: `Invalid service type: ${serviceType}` });

  // Suffix a short random component to avoid PK collisions on same-ms inserts.
  const id = `LA-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const now = new Date();
  const requestedAt = now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

  const { data, error } = await supabaseAdmin
    .from('hk_laundry_jobs')
    .insert({
      id,
      property_id: propertyId,
      category,
      service_type: serviceType,
      pieces: Math.max(0, Math.floor(Number(pieces) || 0)),
      status: 'Pickup Requested',
      guest_name: guestName || null,
      room_number: roomNumber || null,
      staff: staff || null,
      requested_at: requestedAt,
      eta: eta || null,
      exception: exception || null,
      created_by: isUuid(req.user?.id) ? req.user?.id : null,
    })
    .select('*')
    .single();

  if (error) return res.status(500).json({ error: error.message });

  cacheService.invalidatePattern('^hk-laundry:');
  return res.status(201).json({ job: shapeLaundryJob(data) });
});

// Advance a laundry job to the next status in the production flow.
// Requires hk:laundry:manage. Appends a row to hk_laundry_log so every
// transition is auditable (who / when / from → to).
router.put('/laundry/:id/advance', authenticate, requirePermission('hk:laundry:manage'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const { data: current, error: fetchError } = await supabaseAdmin
    .from('hk_laundry_jobs')
    .select('*')
    .eq('id', req.params.id)
    .maybeSingle();

  if (fetchError) return res.status(500).json({ error: fetchError.message });
  if (!current) return res.status(404).json({ error: 'Laundry job not found' });

  const idx = LAUNDRY_STATUS_FLOW.indexOf(current.status);
  if (idx < 0) return res.status(400).json({ error: `Unknown status: ${current.status}` });
  if (idx >= LAUNDRY_STATUS_FLOW.length - 1) {
    return res.status(400).json({ error: 'Job is already at the final status (Delivered)' });
  }
  const next = LAUNDRY_STATUS_FLOW[idx + 1];

  const { data, error } = await supabaseAdmin
    .from('hk_laundry_jobs')
    .update({ status: next, updated_at: new Date().toISOString() })
    .eq('id', req.params.id)
    .select('*')
    .single();

  if (error) return res.status(500).json({ error: error.message });

  // Append audit row (best-effort — a log failure should not roll back the
  // status update the user already sees as successful).
  await supabaseAdmin
    .from('hk_laundry_log')
    .insert({
      id: `LL-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      property_id: current.property_id,
      job_id: current.id,
      from_status: current.status,
      to_status: next,
      actor_id: isUuid(req.user?.id) ? req.user?.id : null,
      actor_name: (req.user as any)?.name || (req.user as any)?.email || null,
      note: null,
    });

  cacheService.invalidatePattern('^hk-laundry:');
  return res.json({ job: shapeLaundryJob(data) });
});

// Resolve (clear) the exception note on a laundry job.
// Requires hk:laundry:manage. Uses .maybeSingle() so a missing row returns
// a clean 404 instead of a 500 (the previous .single() threw PGRST116).
router.put('/laundry/:id/resolve-exception', authenticate, requirePermission('hk:laundry:manage'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const { data, error } = await supabaseAdmin
    .from('hk_laundry_jobs')
    .update({ exception: null, updated_at: new Date().toISOString() })
    .eq('id', req.params.id)
    .select('*')
    .maybeSingle();

  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Laundry job not found' });

  cacheService.invalidatePattern('^hk-laundry:');
  return res.json({ job: shapeLaundryJob(data) });
});

// ── Laundry Consumption (docs/Housekeeping Portal new.md §13 + §23) ────
// Tracks consumable supplies used by the laundry operation (detergent,
// softener, bleach, water, electricity, …). Optionally linked to a job.
// Backs the "Consumption" sub-tab and the "Chemical Consumption" report.
// Persisted to hk_laundry_consumption (migration 307).
const LAUNDRY_SUPPLY_CATEGORIES = new Set(['Chemical', 'Utility', 'Supply']);

function shapeLaundryConsumption(row: any) {
  return {
    id: row.id,
    propertyId: row.property_id,
    jobId: row.job_id || undefined,
    supplyName: row.supply_name,
    category: row.category,
    unit: row.unit,
    quantity: Number(row.quantity),
    recordedBy: row.recorded_by || undefined,
    note: row.note || undefined,
    recordedAt: row.recorded_at,
  };
}

// Get all consumption entries for a property (newest first) + a per-supply
// summary. Cached under hk-laundry-consumption:<id>.
router.get('/laundry/consumption/:propertyId', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const cacheKey = `hk-laundry-consumption:${req.params.propertyId}`;
  const cached = cacheService.get(cacheKey);
  if (cached) return res.json(cached);

  const { data, error } = await supabaseAdmin
    .from('hk_laundry_consumption')
    .select('*')
    .eq('property_id', req.params.propertyId)
    .order('recorded_at', { ascending: false })
    .limit(200);

  if (error) return res.status(500).json({ error: error.message });

  const entries = (data || []).map(shapeLaundryConsumption);

  // Aggregate quantity per supply (and per category) for the summary tiles.
  const bySupply = new Map<string, { supplyName: string; category: string; unit: string; total: number }>();
  const byCategory = new Map<string, number>();
  for (const e of entries) {
    const key = `${e.supplyName}|${e.unit}`;
    const agg = bySupply.get(key);
    if (agg) {
      agg.total += e.quantity;
    } else {
      bySupply.set(key, { supplyName: e.supplyName, category: e.category, unit: e.unit, total: e.quantity });
    }
    byCategory.set(e.category, (byCategory.get(e.category) || 0) + e.quantity);
  }

  const result = {
    propertyId: req.params.propertyId,
    entries,
    summary: {
      totalEntries: entries.length,
      bySupply: Array.from(bySupply.values()).sort((a, b) => b.total - a.total),
      byCategory: Array.from(byCategory.entries()).map(([category, total]) => ({ category, total })),
    },
    generatedAt: new Date().toISOString(),
  };

  cacheService.set(cacheKey, result, 15 * 1000);
  return res.json(result);
});

// Log a new consumption entry. Requires hk:laundry:manage.
router.post('/laundry/consumption', authenticate, requirePermission('hk:laundry:manage'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const { propertyId, jobId, supplyName, category, unit, quantity, note } = req.body || {};
  if (!propertyId || !supplyName || !unit) {
    return res.status(400).json({ error: 'propertyId, supplyName, and unit are required' });
  }
  const cat = category || 'Chemical';
  if (!LAUNDRY_SUPPLY_CATEGORIES.has(cat)) {
    return res.status(400).json({ error: `Invalid category: ${cat}` });
  }
  const qty = Number(quantity);
  if (!Number.isFinite(qty) || qty < 0) {
    return res.status(400).json({ error: 'quantity must be a non-negative number' });
  }

  // If a jobId is supplied, verify it belongs to the same property so a
  // user can't silently attach consumption to another property's job.
  if (jobId) {
    const { data: job, error: jobErr } = await supabaseAdmin
      .from('hk_laundry_jobs')
      .select('property_id')
      .eq('id', jobId)
      .maybeSingle();
    if (jobErr) return res.status(500).json({ error: jobErr.message });
    if (!job) return res.status(400).json({ error: `Laundry job not found: ${jobId}` });
    if (job.property_id !== propertyId) {
      return res.status(400).json({ error: 'Laundry job does not belong to this property' });
    }
  }

  const id = `LC-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const { data, error } = await supabaseAdmin
    .from('hk_laundry_consumption')
    .insert({
      id,
      property_id: propertyId,
      job_id: jobId || null,
      supply_name: String(supplyName).trim().slice(0, 80),
      category: cat,
      unit: String(unit).trim().slice(0, 20),
      quantity: qty,
      recorded_by: isUuid(req.user?.id) ? req.user?.id : null,
      note: note || null,
    })
    .select('*')
    .single();

  if (error) return res.status(500).json({ error: error.message });

  const hkItemCategory = cat === 'Chemical' ? 'cleaning_supplies' : cat === 'Utility' ? 'other' : 'amenities';
  const laundryStoreResult = await adjustHkStore(
    propertyId,
    supplyName,
    hkItemCategory,
    qty,
    'consume',
    isUuid(req.user?.id) ? req.user?.id : undefined,
    undefined,
    `Laundry consumption: ${cat}`
  );

  cacheService.invalidatePattern('^hk-laundry-consumption:');
  return res.status(201).json({
    entry: shapeLaundryConsumption(data),
    ...(laundryStoreResult.warning ? { inventoryWarning: laundryStoreResult.warning } : {}),
  });
});

// Delete a consumption entry (correction / mis-entry). Requires hk:laundry:manage.
router.delete('/laundry/consumption/:id', authenticate, requirePermission('hk:laundry:manage'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const { error } = await supabaseAdmin
    .from('hk_laundry_consumption')
    .delete()
    .eq('id', req.params.id);

  if (error) return res.status(500).json({ error: error.message });

  cacheService.invalidatePattern('^hk-laundry-consumption:');
  return res.json({ success: true });
});

// ── Amenities Management (docs/Housekeeping Portal new.md §14) ──────────
// Backs the Amenities Management module: 12 guest amenity types with par /
// in_stock / consumed_today counters and a consumption + replenishment log.
// Persisted to hk_amenity_stock + hk_amenity_log.
const AMENITY_TYPES = new Set([
  'Soap', 'Shampoo', 'Conditioner', 'Body Wash', 'Lotion',
  'Toothbrush Kit', 'Shaving Kit', 'Sewing Kit', 'Slippers',
  'Water Bottles', 'Tea & Coffee', 'Stationery',
]);

function shapeAmenityStock(row: any) {
  return {
    id: row.id,
    type: row.type,
    par: row.par,
    inStock: row.in_stock,
    consumedToday: row.consumed_today,
    inventoryItemId: row.inventory_item_id || null,
    updatedAt: row.updated_at,
  };
}

function shapeAmenityLog(row: any) {
  return {
    id: row.id,
    action: row.action,
    type: row.type,
    quantity: row.quantity,
    room: row.room || '',
    staff: row.staff || '',
    createdAt: row.created_at,
  };
}

// Get amenity stock + consumption log for a property in a single round-trip.
router.get('/amenities/:propertyId', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const cacheKey = `hk-amenities:${req.params.propertyId}`;
  const cached = cacheService.get(cacheKey);
  if (cached) return res.json(cached);

  const [stockRes, logRes] = await Promise.all([
    supabaseAdmin
      .from('hk_amenity_stock')
      .select('*')
      .eq('property_id', req.params.propertyId)
      .order('type'),
    supabaseAdmin
      .from('hk_amenity_log')
      .select('*')
      .eq('property_id', req.params.propertyId)
      .order('created_at', { ascending: false })
      .limit(200),
  ]);

  if (stockRes.error) return res.status(500).json({ error: stockRes.error.message });
  if (logRes.error) return res.status(500).json({ error: logRes.error.message });

  const stock = (stockRes.data || []).map(shapeAmenityStock);
  const log = (logRes.data || []).map(shapeAmenityLog);

  const shortages = stock.filter(s => s.par > 0 && s.inStock < s.par * 0.5);
  const totals = stock.reduce(
    (acc, s) => ({
      par: acc.par + s.par,
      inStock: acc.inStock + s.inStock,
      consumedToday: acc.consumedToday + s.consumedToday,
    }),
    { par: 0, inStock: 0, consumedToday: 0 }
  );

  const result = {
    propertyId: req.params.propertyId,
    stock,
    log,
    totals,
    shortages: shortages.length,
    generatedAt: new Date().toISOString(),
  };

  cacheService.set(cacheKey, result, 15 * 1000);
  return res.json(result);
});

// Record consumption of an amenity (decrement in_stock, increment consumed_today).
router.post('/amenities/consume', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const { propertyId, type, quantity, room, staff } = req.body || {};
  if (!propertyId || !type) {
    return res.status(400).json({ error: 'propertyId and type are required' });
  }
  if (!AMENITY_TYPES.has(type)) {
    return res.status(400).json({ error: `Invalid amenity type: ${type}` });
  }
  const qty = Math.max(0, Math.floor(Number(quantity) || 0));

  const { data: current, error: fetchError } = await supabaseAdmin
    .from('hk_amenity_stock')
    .select('*')
    .eq('property_id', propertyId)
    .eq('type', type)
    .maybeSingle();

  if (fetchError) return res.status(500).json({ error: fetchError.message });
  if (!current) return res.status(404).json({ error: `No stock row for ${type}` });

  const newInStock = Math.max(0, current.in_stock - qty);
  const newConsumed = current.consumed_today + qty;

  const { error: updateError } = await supabaseAdmin
    .from('hk_amenity_stock')
    .update({
      in_stock: newInStock,
      consumed_today: newConsumed,
      updated_at: new Date().toISOString(),
    })
    .eq('id', current.id);

  if (updateError) return res.status(500).json({ error: updateError.message });

  const logId = `AM-${Date.now()}`;
  const { data: logRow, error: logError } = await supabaseAdmin
    .from('hk_amenity_log')
    .insert({
      id: logId,
      property_id: propertyId,
      action: 'Consumption',
      type,
      quantity: qty,
      room: room || null,
      staff: staff || null,
      created_by: isUuid(req.user?.id) ? req.user?.id : null,
    })
    .select('*')
    .single();

  if (logError) return res.status(500).json({ error: logError.message });

  const storeResult = await adjustHkStore(
    propertyId,
    type,
    'amenities',
    qty,
    'consume',
    isUuid(req.user?.id) ? req.user?.id : undefined,
    staff,
    `Amenity consumption: ${room || 'stock'}`,
    { itemId: current.inventory_item_id as string | undefined }
  );

  cacheService.invalidatePattern('^hk-amenities:');
  return res.status(201).json({
    stock: shapeAmenityStock({
      ...current,
      in_stock: newInStock,
      consumed_today: newConsumed,
      updated_at: new Date().toISOString(),
    }),
    log: shapeAmenityLog(logRow),
    ...(storeResult.warning ? { inventoryWarning: storeResult.warning } : {}),
  });
});

// Replenish an amenity back to par level.
router.post('/amenities/replenish', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const { propertyId, type, staff } = req.body || {};
  if (!propertyId || !type) {
    return res.status(400).json({ error: 'propertyId and type are required' });
  }
  if (!AMENITY_TYPES.has(type)) {
    return res.status(400).json({ error: `Invalid amenity type: ${type}` });
  }

  const { data: current, error: fetchError } = await supabaseAdmin
    .from('hk_amenity_stock')
    .select('*')
    .eq('property_id', propertyId)
    .eq('type', type)
    .maybeSingle();

  if (fetchError) return res.status(500).json({ error: fetchError.message });
  if (!current) return res.status(404).json({ error: `No stock row for ${type}` });

  const replenishedQty = Math.max(0, current.par - current.in_stock);

  const { error: updateError } = await supabaseAdmin
    .from('hk_amenity_stock')
    .update({
      in_stock: current.par,
      updated_at: new Date().toISOString(),
    })
    .eq('id', current.id);

  if (updateError) return res.status(500).json({ error: updateError.message });

  const logId = `AM-${Date.now()}`;
  const { data: logRow, error: logError } = await supabaseAdmin
    .from('hk_amenity_log')
    .insert({
      id: logId,
      property_id: propertyId,
      action: 'Replenishment',
      type,
      quantity: replenishedQty,
      room: null,
      staff: staff || null,
      created_by: isUuid(req.user?.id) ? req.user?.id : null,
    })
    .select('*')
    .single();

  if (logError) return res.status(500).json({ error: logError.message });

  const storeResult = await adjustHkStore(
    propertyId,
    type,
    'amenities',
    replenishedQty,
    'restock',
    isUuid(req.user?.id) ? req.user?.id : undefined,
    staff,
    'Amenity replenish from HK Store',
    { itemId: current.inventory_item_id as string | undefined }
  );

  cacheService.invalidatePattern('^hk-amenities:');
  return res.status(201).json({
    stock: shapeAmenityStock({
      ...current,
      in_stock: current.par,
      updated_at: new Date().toISOString(),
    }),
    log: shapeAmenityLog(logRow),
    ...(storeResult.warning ? { inventoryWarning: storeResult.warning } : {}),
  });
});

// Link an amenity stock row to a unified uinv_items row.
// Pass null to unlink.
router.put('/amenities/stock/:id/link', authenticate, requirePermission('hk:inventory:manage'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { inventoryItemId } = req.body || {};
  if (inventoryItemId) {
    const { data: item, error: ie } = await supabaseAdmin
      .from('uinv_items')
      .select('id')
      .eq('id', inventoryItemId)
      .maybeSingle();
    if (ie) return res.status(500).json({ error: ie.message });
    if (!item) return res.status(404).json({ error: 'Unified inventory item not found' });
  }
  const { data, error } = await supabaseAdmin
    .from('hk_amenity_stock')
    .update({ inventory_item_id: inventoryItemId || null, updated_at: new Date().toISOString() })
    .eq('id', req.params.id)
    .select('*')
    .single();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Amenity stock row not found' });
  cacheService.invalidatePattern('^hk-amenities:');
  return res.json({ stock: shapeAmenityStock(data) });
});

// ── Minibar Operations (docs/Housekeeping Portal new.md §15) ───────────
// Backs the Minibar Operations module: per-room minibar status, consumed
// items, missing items, PMS charge posting, and a full audit log.
// Persisted to hk_minibar_room + hk_minibar_item + hk_minibar_log.

// Valid status transitions enforced by the API.
const MINIBAR_TRANSITIONS: Record<string, string[]> = {
  'Pending Refill':        ['Refilled', 'Missing Items'],
  'Refilled':              ['Consumption Recorded', 'Missing Items', 'Stock Verified'],
  'Consumption Recorded':  ['Stock Verified', 'Missing Items', 'Charge Posted'],
  'Stock Verified':        ['Charge Posted', 'Missing Items'],
  'Missing Items':         ['Pending Refill', 'Stock Verified'],
  'Charge Posted':         [], // terminal state
};

const MINIBAR_ACTION_STATUS: Record<string, string> = {
  refill: 'Refilled',
  record: 'Consumption Recorded',
  verify: 'Stock Verified',
  'post-charge': 'Charge Posted',
};

const MINIBAR_ACTION_LOG: Record<string, string> = {
  refill: 'Refill',
  record: 'Consumption Recorded',
  verify: 'Stock Verified',
  'post-charge': 'Charge Posted',
};

function shapeMinibarRoom(row: any, items: any[] = [], inventory: any[] = []) {
  return {
    id: row.id,
    room: row.room,
    floor: row.floor,
    status: row.status,
    posted: row.posted,
    totalCharge: Number(row.total_charge) || 0,
    missingItems: row.missing_items || [],
    consumedItems: items.map(it => ({
      id: it.id,
      name: it.name,
      qty: it.qty,
      price: Number(it.price) || 0,
    })),
    inventory: inventory.map(inv => ({
      catalogId: inv.catalog_id,
      name: inv.catalog_name || inv.name || '',
      qty: inv.qty,
      parLevel: inv.par_level || 0,
      price: Number(inv.price) || 0,
    })),
    updatedAt: row.updated_at,
  };
}

function shapeMinibarLog(row: any) {
  return {
    id: row.id,
    roomId: row.room_id,
    room: row.room || '',
    action: row.action,
    detail: row.detail || '',
    staff: row.staff || '',
    createdAt: row.created_at,
  };
}

// Helper: recalculate total_charge for a room from its items.
async function recalcRoomTotal(roomId: string): Promise<number> {
  const { data: items, error } = await supabaseAdmin!
    .from('hk_minibar_item')
    .select('qty, price')
    .eq('room_id', roomId);
  if (error || !items) return 0;
  return items.reduce((sum, it) => sum + (it.qty * (Number(it.price) || 0)), 0);
}

// Helper: insert a log entry.
async function insertMinibarLog(entry: {
  propertyId: string;
  roomId: string;
  room: string;
  action: string;
  detail?: string;
  staff?: string;
  userId?: string;
}): Promise<void> {
  const logId = `MBL-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  await supabaseAdmin!
    .from('hk_minibar_log')
    .insert({
      id: logId,
      property_id: entry.propertyId,
      room_id: entry.roomId,
      room: entry.room,
      action: entry.action,
      detail: entry.detail || null,
      staff: entry.staff || null,
      created_by: entry.userId && isUuid(entry.userId) ? entry.userId : null,
    });
}

// Get all minibar rooms + items + inventory + catalog + log + summary for a property.
router.get('/minibar/:propertyId', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const cacheKey = `hk-minibar:${req.params.propertyId}`;
  const cached = cacheService.get(cacheKey);
  if (cached) return res.json(cached);

  const [roomsRes, itemsRes, logRes, catalogRes, inventoryRes] = await Promise.all([
    supabaseAdmin
      .from('hk_minibar_room')
      .select('*')
      .eq('property_id', req.params.propertyId)
      .order('room'),
    supabaseAdmin
      .from('hk_minibar_item')
      .select('*')
      .eq('property_id', req.params.propertyId)
      .order('created_at'),
    supabaseAdmin
      .from('hk_minibar_log')
      .select('*')
      .eq('property_id', req.params.propertyId)
      .order('created_at', { ascending: false })
      .limit(100),
    supabaseAdmin
      .from('hk_minibar_catalog')
      .select('*')
      .eq('property_id', req.params.propertyId)
      .eq('active', true)
      .order('name'),
    supabaseAdmin
      .from('hk_minibar_inventory')
      .select(`
        *,
        catalog:hk_minibar_catalog!inner(name, par_level, price)
      `)
      .eq('property_id', req.params.propertyId),
  ]);

  if (roomsRes.error) return res.status(500).json({ error: roomsRes.error.message });
  if (itemsRes.error) return res.status(500).json({ error: itemsRes.error.message });
  if (logRes.error) return res.status(500).json({ error: logRes.error.message });
  if (catalogRes.error) return res.status(500).json({ error: catalogRes.error.message });
  if (inventoryRes.error) return res.status(500).json({ error: inventoryRes.error.message });

  const itemsByRoom = (itemsRes.data || []).reduce((acc, it) => {
    (acc[it.room_id] = acc[it.room_id] || []).push(it);
    return acc;
  }, {} as Record<string, any[]>);

  // Flatten inventory with catalog info for each room.
  const inventoryByRoom = (inventoryRes.data || []).reduce((acc, inv) => {
    const entry = {
      catalog_id: inv.catalog_id,
      catalog_name: inv.catalog?.name || '',
      qty: inv.qty,
      par_level: inv.catalog?.par_level || 0,
      price: inv.catalog?.price || 0,
    };
    (acc[inv.room_id] = acc[inv.room_id] || []).push(entry);
    return acc;
  }, {} as Record<string, any[]>);

  const rooms = (roomsRes.data || []).map(r =>
    shapeMinibarRoom(r, itemsByRoom[r.id] || [], inventoryByRoom[r.id] || [])
  );
  const log = (logRes.data || []).map(shapeMinibarLog);
  const catalog = (catalogRes.data || []).map(c => ({
    id: c.id,
    name: c.name,
    price: Number(c.price) || 0,
    parLevel: c.par_level,
    inventoryItemId: c.inventory_item_id || null,
    active: c.active,
  }));

  const summary = {
    pending: rooms.filter(r => r.status === 'Pending Refill').length,
    missing: rooms.filter(r => r.status === 'Missing Items').length,
    verified: rooms.filter(r => r.status === 'Stock Verified').length,
    posted: rooms.filter(r => r.posted).length,
    revenue: rooms.filter(r => r.posted).reduce((s, r) => s + r.totalCharge, 0),
    lowStock: rooms.reduce((s, r) => s + (r.inventory || []).filter(i => i.qty < i.parLevel).length, 0),
  };

  const result = {
    propertyId: req.params.propertyId,
    rooms,
    log,
    catalog,
    summary,
    generatedAt: new Date().toISOString(),
  };

  cacheService.set(cacheKey, result, 15 * 1000);
  return res.json(result);
});

// Create a new minibar room task.
router.post('/minibar', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const { propertyId, room, floor, staff } = req.body || {};
  if (!propertyId || !room) {
    return res.status(400).json({ error: 'propertyId and room are required' });
  }
  const floorNum = Math.max(0, Math.floor(Number(floor) || 1));

  const roomId = `MB-${Date.now()}`;
  const { data, error } = await supabaseAdmin
    .from('hk_minibar_room')
    .insert({
      id: roomId,
      property_id: propertyId,
      room: String(room),
      floor: floorNum,
      status: 'Pending Refill',
      posted: false,
      total_charge: 0,
      missing_items: '{}',
    })
    .select('*')
    .single();

  if (error) {
    if (error.code === '23505') {
      return res.status(409).json({ error: `Room ${room} already has a minibar task` });
    }
    return res.status(500).json({ error: error.message });
  }

  await insertMinibarLog({
    propertyId,
    roomId,
    room: String(room),
    action: 'Created',
    detail: `Floor ${floorNum}`,
    staff,
    userId: req.user?.id,
  });

  // Auto-populate inventory from active catalog items at par_level.
  const { data: catalogItems } = await supabaseAdmin
    .from('hk_minibar_catalog')
    .select('id, par_level')
    .eq('property_id', propertyId)
    .eq('active', true);

  if (catalogItems && catalogItems.length > 0) {
    const invRows = catalogItems.map(c => ({
      room_id: roomId,
      catalog_id: c.id,
      property_id: propertyId,
      qty: c.par_level,
    }));
    await supabaseAdmin.from('hk_minibar_inventory').insert(invRows);
  }

  cacheService.invalidatePattern('^hk-minibar:');
  return res.status(201).json({ room: shapeMinibarRoom(data, [], []) });
});

// Advance a minibar room to a new status (refill / record / verify / post-charge).
// For post-charge, also posts the minibar total as a charge to the guest's
// open folio in the Front Office system via post_folio_charge_with_routing.
router.post('/minibar/:id/advance', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const { id } = req.params;
  const { action, staff } = req.body || {};
  if (!action) return res.status(400).json({ error: 'action is required' });

  const newStatus = MINIBAR_ACTION_STATUS[action];
  if (!newStatus) {
    return res.status(400).json({ error: `Invalid action: ${action}. Expected one of refill, record, verify, post-charge.` });
  }

  const { data: current, error: fetchError } = await supabaseAdmin
    .from('hk_minibar_room')
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (fetchError) return res.status(500).json({ error: fetchError.message });
  if (!current) return res.status(404).json({ error: `Minibar room ${id} not found` });

  // Enforce valid status transitions.
  const allowed = MINIBAR_TRANSITIONS[current.status] || [];
  if (!allowed.includes(newStatus)) {
    return res.status(409).json({
      error: `Cannot ${action} a room in "${current.status}" state. Valid transitions: ${allowed.length ? allowed.join(', ') : 'none (terminal state)'}.`,
    });
  }

  // ── Folio integration for post-charge ──────────────────────────────
  let folioResult: { folioId: string; folioLineId: string; reservationId: string; guestName: string; newBalance: number; isRouted: boolean } | null = null;
  if (action === 'post-charge') {
    const chargeAmount = Number(current.total_charge) || 0;
    if (chargeAmount <= 0) {
      return res.status(400).json({ error: 'Cannot post a zero charge. Add consumed items first.' });
    }

    // 1. Find the CheckedIn reservation for this room number.
    //    Normalize by trimming whitespace on both sides for a robust match.
    const roomNorm = String(current.room).trim();
    const { data: reservation, error: resError } = await supabaseAdmin
      .from('reservations')
      .select('id, guest_name, room_number, status, property_id')
      .ilike('room_number', roomNorm)
      .eq('status', 'CheckedIn')
      .order('check_in_date', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (resError) return res.status(500).json({ error: `Reservation lookup failed: ${resError.message}` });
    if (!reservation) {
      return res.status(404).json({
        error: `No checked-in guest found for Room ${current.room}. Cannot post charge to PMS — ensure the guest is checked in and the room number matches the reservation.`,
      });
    }

    // 2. Find the open Guest folio for that reservation.
    const { data: folio, error: folioError } = await supabaseAdmin
      .from('folios')
      .select('id, status, folio_type, reservation_id')
      .eq('reservation_id', reservation.id)
      .eq('folio_type', 'Guest')
      .eq('status', 'Open')
      .maybeSingle();

    if (folioError) return res.status(500).json({ error: `Folio lookup failed: ${folioError.message}` });
    if (!folio) {
      return res.status(404).json({
        error: `No open Guest folio found for reservation ${reservation.id} (${reservation.guest_name}). The folio may be closed or not yet created.`,
      });
    }

    // 3. Build a description listing the consumed items.
    const { data: items } = await supabaseAdmin
      .from('hk_minibar_item')
      .select('name, qty, price')
      .eq('room_id', id)
      .order('created_at');

    const itemSummary = (items || []).map(it => `${it.qty}× ${it.name}`).join(', ');
    const description = `Minibar — Room ${current.room}${itemSummary ? ` (${itemSummary})` : ''}`;

    // 4. Post the charge via the routing-enabled RPC.
    const { data: chargeResult, error: chargeError } = await supabaseAdmin.rpc('post_folio_charge_with_routing', {
      p_origin_folio_id: folio.id,
      p_description: description,
      p_amount: chargeAmount,
      p_quantity: 1,
      p_line_type: 'Minibar',
      p_revenue_account_code: null,
      p_user_id: req.user?.id || 'system',
      p_source_reference: id,
      p_discount_percent: 0,
      p_reservation_id: reservation.id,
      p_source_module: 'housekeeping',
    });

    if (chargeError) {
      return res.status(500).json({ error: `Folio charge posting failed: ${chargeError.message}` });
    }

    // The RPC returns a jsonb object (possibly wrapped in an array by PostgREST).
    const rpcResult: any = Array.isArray(chargeResult) ? chargeResult[0] : chargeResult;

    // 5. Inspect business-level success flag — the RPC returns {success:false, error:'...'}
    //    for folio-not-found / folio-closed cases without raising a PostgREST error.
    if (!rpcResult || rpcResult.success === false) {
      const rpcErr = rpcResult?.error || 'Folio charge rejected by routing engine';
      return res.status(400).json({ error: `Folio charge rejected: ${rpcErr}` });
    }

    // 6. Fetch the actual folio balance after the charge was applied.
    //    The RPC recomputes totals internally but does not return the new balance.
    const { data: folioAfter } = await supabaseAdmin
      .from('folios')
      .select('balance')
      .eq('id', folio.id)
      .maybeSingle();

    folioResult = {
      folioId: folio.id,
      folioLineId: rpcResult?.lineId || '',
      reservationId: reservation.id,
      guestName: reservation.guest_name || '',
      newBalance: Number(folioAfter?.balance) || 0,
      isRouted: Boolean(rpcResult?.isRouted),
    };
  }

  const updates: any = { status: newStatus, updated_at: new Date().toISOString() };
  if (action === 'post-charge') updates.posted = true;

  // On refill: reset all inventory items to their par_level.
  if (action === 'refill') {
    const { data: catalogItems } = await supabaseAdmin
      .from('hk_minibar_catalog')
      .select('id, name, par_level')
      .eq('property_id', current.property_id)
      .eq('active', true);

    if (catalogItems && catalogItems.length > 0) {
      const { data: existingInv } = await supabaseAdmin
        .from('hk_minibar_inventory')
        .select('catalog_id, qty')
        .eq('room_id', id);

      const currentByCatalog = new Map<string, number>();
      (existingInv || []).forEach((inv: any) => currentByCatalog.set(inv.catalog_id, inv.qty || 0));

      // Upsert each inventory row to par_level.
      const invRows = catalogItems.map(c => ({
        room_id: id,
        catalog_id: c.id,
        property_id: current.property_id,
        qty: c.par_level,
      }));
      await supabaseAdmin
        .from('hk_minibar_inventory')
        .upsert(invRows, { onConflict: 'room_id,catalog_id' });

      // Deduct the amount actually added from the beverage / minibar store.
      // Minibar items are revenue stock (resold to guests), not complimentary
      // amenities — route to Beverage store or linked SKU.
      for (const c of catalogItems) {
        const added = Math.max(0, c.par_level - (currentByCatalog.get(c.id) || 0));
        if (added > 0) {
          await adjustMinibarStore(
            current.property_id,
            c,
            added,
            'restock',
            isUuid(req.user?.id) ? req.user?.id : undefined,
            staff,
            `Minibar refill: Room ${current.room}`
          );
        }
      }
    }
  }

  const { data: updated, error: updateError } = await supabaseAdmin
    .from('hk_minibar_room')
    .update(updates)
    .eq('id', id)
    .select('*')
    .single();

  if (updateError) return res.status(500).json({ error: updateError.message });

  const { data: items } = await supabaseAdmin
    .from('hk_minibar_item')
    .select('*')
    .eq('room_id', id)
    .order('created_at');

  // Fetch updated inventory for the response.
  const { data: invData } = await supabaseAdmin
    .from('hk_minibar_inventory')
    .select(`
      *,
      catalog:hk_minibar_catalog!inner(name, par_level, price)
    `)
    .eq('room_id', id);

  const inventory = (invData || []).map(inv => ({
    catalog_id: inv.catalog_id,
    catalog_name: inv.catalog?.name || '',
    qty: inv.qty,
    par_level: inv.catalog?.par_level || 0,
    price: inv.catalog?.price || 0,
  }));

  // Log with folio reference for post-charge.
  const logDetail = folioResult
    ? `Folio ${folioResult.folioId.slice(0, 8)}… · Guest: ${folioResult.guestName} · New balance: $${folioResult.newBalance.toFixed(2)}`
    : action === 'refill'
    ? 'Inventory reset to par levels'
    : undefined;

  await insertMinibarLog({
    propertyId: current.property_id,
    roomId: id,
    room: current.room,
    action: MINIBAR_ACTION_LOG[action],
    detail: logDetail,
    staff,
    userId: req.user?.id,
  });

  cacheService.invalidatePattern('^hk-minibar:');
  // Also invalidate folio cache since we posted a charge.
  if (action === 'post-charge') cacheService.invalidatePattern('^folios:');
  return res.json({
    room: shapeMinibarRoom(updated, items || [], inventory),
    folio: folioResult,
  });
});

// Add a consumed item to a room (recalculates total_charge, deducts from inventory).
router.post('/minibar/:id/items', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const { id } = req.params;
  const { name, qty, price, staff, catalogId } = req.body || {};
  if (!name) return res.status(400).json({ error: 'name is required' });
  const qtyNum = Math.max(1, Math.floor(Number(qty) || 1));
  const priceNum = Math.max(0, Number(price) || 0);

  const { data: room, error: roomError } = await supabaseAdmin
    .from('hk_minibar_room')
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (roomError) return res.status(500).json({ error: roomError.message });
  if (!room) return res.status(404).json({ error: `Minibar room ${id} not found` });
  if (room.status === 'Charge Posted') {
    return res.status(409).json({ error: 'Cannot add items to a room with posted charges' });
  }

  const { data: item, error: itemError } = await supabaseAdmin
    .from('hk_minibar_item')
    .insert({
      room_id: id,
      property_id: room.property_id,
      name: String(name),
      qty: qtyNum,
      price: priceNum,
    })
    .select('*')
    .single();

  if (itemError) return res.status(500).json({ error: itemError.message });

  // Deduct from inventory if a catalogId is provided (or match by name).
  let resolvedCatalogId = catalogId;
  let matchedCatalog: any = null;
  if (!resolvedCatalogId) {
    const { data: catMatch } = await supabaseAdmin
      .from('hk_minibar_catalog')
      .select('id, name, inventory_item_id')
      .eq('property_id', room.property_id)
      .ilike('name', String(name))
      .maybeSingle();
    resolvedCatalogId = catMatch?.id;
    matchedCatalog = catMatch;
  } else {
    const { data: catData } = await supabaseAdmin
      .from('hk_minibar_catalog')
      .select('id, name, inventory_item_id')
      .eq('id', resolvedCatalogId)
      .maybeSingle();
    matchedCatalog = catData;
  }

  if (resolvedCatalogId) {
    // Deduct qty from inventory, not below 0.
    const { data: inv } = await supabaseAdmin
      .from('hk_minibar_inventory')
      .select('id, qty')
      .eq('room_id', id)
      .eq('catalog_id', resolvedCatalogId)
      .maybeSingle();

    if (inv) {
      const newQty = Math.max(0, (inv.qty || 0) - qtyNum);
      await supabaseAdmin
        .from('hk_minibar_inventory')
        .update({ qty: newQty, updated_at: new Date().toISOString() })
        .eq('id', inv.id);
    }
  }

  // Deduct the consumed item from the Beverage / Minibar store in unified inventory.
  await adjustMinibarStore(
    room.property_id,
    matchedCatalog || { name: String(name) },
    qtyNum,
    'consume',
    isUuid(req.user?.id) ? req.user?.id : undefined,
    staff,
    `Minibar consumption: Room ${room.room}`
  );

  // Recalculate total_charge.
  const newTotal = await recalcRoomTotal(id);
  await supabaseAdmin
    .from('hk_minibar_room')
    .update({ total_charge: newTotal, updated_at: new Date().toISOString() })
    .eq('id', id);

  await insertMinibarLog({
    propertyId: room.property_id,
    roomId: id,
    room: room.room,
    action: 'Item Added',
    detail: `${qtyNum}× ${name} @ $${priceNum.toFixed(2)}`,
    staff,
    userId: req.user?.id,
  });

  cacheService.invalidatePattern('^hk-minibar:');
  return res.status(201).json({
    item: { id: item.id, name: item.name, qty: item.qty, price: Number(item.price) || 0 },
    totalCharge: newTotal,
  });
});

// Remove a consumed item from a room (recalculates total_charge).
router.delete('/minibar/:id/items/:itemId', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const { id, itemId } = req.params;
  const { staff } = req.body || {};

  const { data: room, error: roomError } = await supabaseAdmin
    .from('hk_minibar_room')
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (roomError) return res.status(500).json({ error: roomError.message });
  if (!room) return res.status(404).json({ error: `Minibar room ${id} not found` });
  if (room.status === 'Charge Posted') {
    return res.status(409).json({ error: 'Cannot remove items from a room with posted charges' });
  }

  const { data: item } = await supabaseAdmin
    .from('hk_minibar_item')
    .select('name, qty, price')
    .eq('id', itemId)
    .eq('room_id', id)
    .maybeSingle();

  const { error: delError } = await supabaseAdmin
    .from('hk_minibar_item')
    .delete()
    .eq('id', itemId)
    .eq('room_id', id);

  if (delError) return res.status(500).json({ error: delError.message });

  const newTotal = await recalcRoomTotal(id);
  await supabaseAdmin
    .from('hk_minibar_room')
    .update({ total_charge: newTotal, updated_at: new Date().toISOString() })
    .eq('id', id);

  if (item) {
    await insertMinibarLog({
      propertyId: room.property_id,
      roomId: id,
      room: room.room,
      action: 'Item Removed',
      detail: `${item.qty}× ${item.name}`,
      staff,
      userId: req.user?.id,
    });
  }

  cacheService.invalidatePattern('^hk-minibar:');
  return res.json({ totalCharge: newTotal });
});

// Set missing items on a room (marks status as Missing Items if non-empty).
router.put('/minibar/:id/missing-items', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const { id } = req.params;
  const { items, staff } = req.body || {};
  if (!Array.isArray(items)) {
    return res.status(400).json({ error: 'items must be an array of strings' });
  }
  const cleanItems = items.map(String).filter(Boolean);

  const { data: current, error: fetchError } = await supabaseAdmin
    .from('hk_minibar_room')
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (fetchError) return res.status(500).json({ error: fetchError.message });
  if (!current) return res.status(404).json({ error: `Minibar room ${id} not found` });
  if (current.status === 'Charge Posted') {
    return res.status(409).json({ error: 'Cannot modify missing items on a room with posted charges' });
  }

  const newStatus = cleanItems.length > 0 ? 'Missing Items' : (current.status === 'Missing Items' ? 'Pending Refill' : current.status);
  const { data: updated, error: updateError } = await supabaseAdmin
    .from('hk_minibar_room')
    .update({
      missing_items: cleanItems,
      status: newStatus,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .select('*')
    .single();

  if (updateError) return res.status(500).json({ error: updateError.message });

  const { data: itemsData } = await supabaseAdmin
    .from('hk_minibar_item')
    .select('*')
    .eq('room_id', id)
    .order('created_at');

  await insertMinibarLog({
    propertyId: current.property_id,
    roomId: id,
    room: current.room,
    action: cleanItems.length > 0 ? 'Missing Items Set' : 'Missing Items Cleared',
    detail: cleanItems.length > 0 ? cleanItems.join(', ') : undefined,
    staff,
    userId: req.user?.id,
  });

  cacheService.invalidatePattern('^hk-minibar:');
  return res.json({ room: shapeMinibarRoom(updated, itemsData || [], []) });
});

// ── Minibar Catalog CRUD ──────────────────────────────────────────────

// Add a catalog item.
router.post('/minibar/catalog', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const { propertyId, name, price, parLevel, inventoryItemId } = req.body || {};
  if (!propertyId || !name) {
    return res.status(400).json({ error: 'propertyId and name are required' });
  }
  const priceNum = Math.max(0, Number(price) || 0);
  const parNum = Math.max(0, Math.floor(Number(parLevel) || 2));

  const { data, error } = await supabaseAdmin
    .from('hk_minibar_catalog')
    .insert({
      property_id: propertyId,
      name: String(name),
      price: priceNum,
      par_level: parNum,
      inventory_item_id: inventoryItemId || null,
      active: true,
    })
    .select('*')
    .single();

  if (error) {
    if (error.code === '23505') {
      return res.status(409).json({ error: `Catalog item "${name}" already exists` });
    }
    return res.status(500).json({ error: error.message });
  }

  cacheService.invalidatePattern('^hk-minibar:');
  return res.status(201).json({
    item: {
      id: data.id,
      name: data.name,
      price: Number(data.price) || 0,
      parLevel: data.par_level,
      inventoryItemId: data.inventory_item_id || null,
      active: data.active,
    },
  });
});

// Update a catalog item.
router.put('/minibar/catalog/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const { id } = req.params;
  const { name, price, parLevel, active, inventoryItemId } = req.body || {};
  const updates: any = {};
  if (name !== undefined) updates.name = String(name);
  if (price !== undefined) updates.price = Math.max(0, Number(price) || 0);
  if (parLevel !== undefined) updates.par_level = Math.max(0, Math.floor(Number(parLevel) || 0));
  if (active !== undefined) updates.active = Boolean(active);
  if (inventoryItemId !== undefined) updates.inventory_item_id = inventoryItemId || null;

  const { data, error } = await supabaseAdmin
    .from('hk_minibar_catalog')
    .update(updates)
    .eq('id', id)
    .select('*')
    .single();

  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Catalog item not found' });

  cacheService.invalidatePattern('^hk-minibar:');
  return res.json({
    item: {
      id: data.id,
      name: data.name,
      price: Number(data.price) || 0,
      parLevel: data.par_level,
      inventoryItemId: data.inventory_item_id || null,
      active: data.active,
    },
  });
});

// Delete a catalog item (also removes inventory rows via CASCADE).
router.delete('/minibar/catalog/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const { id } = req.params;
  const { error } = await supabaseAdmin
    .from('hk_minibar_catalog')
    .delete()
    .eq('id', id);

  if (error) return res.status(500).json({ error: error.message });

  cacheService.invalidatePattern('^hk-minibar:');
  return res.json({ success: true });
});

// ── Supply & Procurement Coordination (Housekeeping) ───────────────────
// Mirrors the F&B /api/fb/procurement-coordination/* endpoints but for the
// Housekeeping department. Backs the /erp/housekeeping/supply-procurement
// screen. HK "demand" is derived from inventory_items whose current_quantity
// is at/below their reorder_point (replenishment demand), and purchase
// requisitions are stored as hk_purchase_orders (created here, fulfilled by
// the Procurement department). Supplier master data is shared with F&B via
// fb_suppliers.

// PO status → display status used by the UI (requisition lifecycle)
function hkPoStatusToRequisitionStatus(poStatus: string): string {
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

function hkPoStatusToSupplierOrderStatus(poStatus: string): string | null {
  switch (poStatus) {
    case 'acknowledged': return 'ordered';
    case 'partial': return 'shipped';
    case 'received': return 'delivered';
    case 'closed': return 'delivered';
    default: return null;
  }
}

// GET /api/hk-portal/supply-procurement/forecast
// Returns HK unified inventory items at/below reorder point as replenishment
// demand rows, enriched with on-hand stock and any linked HK purchase orders.
// Scoped to the caller's active property via ?propertyId=.
router.get('/supply-procurement/forecast', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  try {
    const { propertyId } = req.query as Record<string, string>;
    // Fetch HK-scoped unified items
    let itemsQuery = supabaseAdmin
      .from('uinv_items')
      .select('id, item_name, subcategory, unit_of_measure, last_cost, reorder_point, par_level, property_id')
      .eq('category', 'Housekeeping')
      .eq('is_active', true);
    if (propertyId) itemsQuery = itemsQuery.eq('property_id', propertyId);
    const { data: items, error: itemsErr } = await itemsQuery.order('item_name');
    if (itemsErr) return res.status(500).json({ error: itemsErr.message });

    // Fetch stock balances for HK + Linen stores
    const itemIds = (items || []).map((i: any) => i.id);
    let balanceMap = new Map<string, number>();
    if (itemIds.length > 0) {
      const { data: balances } = await supabaseAdmin
        .from('uinv_stock_balances')
        .select('item_id, on_hand')
        .in('store_id', [HK_STORE_ID, HK_LINEN_STORE_ID])
        .in('item_id', itemIds);
      for (const b of (balances || [])) {
        balanceMap.set(b.item_id, (balanceMap.get(b.item_id) || 0) + Number(b.on_hand));
      }
    }

    // Linked HK POs per item
    let linesByItem: Record<string, any[]> = {};
    let lines: any[] = [];
    if (itemIds.length > 0) {
      const { data: lineRows } = await supabaseAdmin
        .from('hk_purchase_order_lines')
        .select('id, item_id, po_id, quantity_ordered, unit_of_measure, unit_price')
        .in('item_id', itemIds);
      lines = lineRows || [];
      lines.forEach((l: any) => {
        if (l.item_id) (linesByItem[l.item_id] = linesByItem[l.item_id] || []).push(l);
      });
    }
    const poIds = [...new Set(lines.map((l: any) => l.po_id))] as string[];
    let poById: Record<string, any> = {};
    if (poIds.length > 0) {
      const { data: pos } = await supabaseAdmin.from('hk_purchase_orders')
        .select('id, po_number, status')
        .in('id', poIds);
      (pos || []).forEach((p: any) => { poById[p.id] = p; });
    }

    const rows = (items || [])
      .filter((i: any) => Number(i.reorder_point || 0) > 0 && (balanceMap.get(i.id) || 0) <= Number(i.reorder_point || 0))
      .map((i: any, idx: number) => {
        const currentQty = balanceMap.get(i.id) || 0;
        const reorderQty = Math.max(0, Number(i.reorder_point || 0) - currentQty);
        const shortage = Math.max(0, reorderQty);
        const linkedLines = linesByItem[i.id] || [];
        const linkedPos = linkedLines.map((l) => poById[l.po_id]).filter(Boolean);
        const requisitionPo = linkedPos.find((p: any) => ['draft', 'submitted'].includes(p.status));
        const supplierPo = linkedPos.find((p: any) => ['acknowledged', 'partial', 'received', 'closed'].includes(p.status));

        return {
          id: i.id || String(idx + 1),
          period: new Date().toISOString().slice(0, 10),
          outlet_id: 'HK Store',
          menu_item_id: i.item_name,
          predicted_quantity: reorderQty,
          unit: i.unit_of_measure || 'pcs',
          confidence: 100,
          created_at: '',
          fb_outlet_stock: currentQty,
          main_store_stock: 0,
          total_available: currentQty,
          shortage,
          requisition_id: requisitionPo?.po_number || null,
          requisition_status: requisitionPo ? hkPoStatusToRequisitionStatus(requisitionPo.status) : null,
          supplier_order_id: supplierPo?.po_number || null,
          supplier_order_status: supplierPo ? hkPoStatusToSupplierOrderStatus(supplierPo.status) : null,
        };
      });

    return res.json(rows);
  } catch (err) {
    console.error('supply-procurement/forecast error:', err);
    return res.status(500).json({ error: 'Failed to load replenishment demand' });
  }
});

// GET /api/hk-portal/supply-procurement/requisitions
// Returns hk_purchase_orders mapped to the PurchaseRequisition shape with
// their lines and supplier name.
router.get('/supply-procurement/requisitions', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  try {
    const { status, propertyId } = req.query as Record<string, string>;
    let q = supabaseAdmin.from('hk_purchase_orders').select('*').order('order_date', { ascending: false });
    if (status) q = q.eq('status', status);
    if (propertyId) q = q.eq('property_id', propertyId);
    const { data: pos, error } = await q;
    if (error) return res.status(500).json({ error: error.message });

    const { data: suppliers } = await supabaseAdmin.from('fb_suppliers').select('id, name');
    const supplierName: Record<string, string> = {};
    (suppliers || []).forEach((s: any) => { supplierName[s.id] = s.name; });

    const poIds = (pos || []).map((p: any) => p.id);
    let linesByPo: Record<string, any[]> = {};
    if (poIds.length > 0) {
      const { data: lines } = await supabaseAdmin.from('hk_purchase_order_lines').select('*').in('po_id', poIds);
      (lines || []).forEach((l: any) => {
        (linesByPo[l.po_id] = linesByPo[l.po_id] || []).push(l);
      });
    }

    const rows = (pos || []).map((po: any) => {
      const lines = (linesByPo[po.id] || []).map((l: any) => {
        const qty = Number(l.quantity_ordered || 0);
        const unitCost = Number(l.unit_price || 0);
        return {
          id: l.id,
          item_name: l.description || 'Item',
          category: 'General',
          requested_quantity: qty,
          unit: l.unit_of_measure || 'pcs',
          estimated_unit_cost: unitCost,
          estimated_total: Number((qty * unitCost).toFixed(2)),
          required_by: (l.expected_date ? String(l.expected_date).slice(0, 10) : '')
            || (po.expected_delivery_date ? String(po.expected_delivery_date).slice(0, 10) : ''),
          reason: l.reason || po.notes || 'Stock replenishment',
        };
      });
      const totalCost = lines.reduce((sum: number, l: any) => sum + l.estimated_total, 0);
      const supplierOrderStatus = hkPoStatusToSupplierOrderStatus(po.status);
      return {
        id: po.id,
        requisition_number: po.po_number,
        requested_by: po.submitted_by || 'HK Manager',
        request_date: po.order_date ? String(po.order_date).slice(0, 10) : '',
        department: 'Housekeeping',
        priority: po.priority || 'medium',
        status: hkPoStatusToRequisitionStatus(po.status) as any,
        po_status: po.status,
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
    console.error('supply-procurement/requisitions error:', err);
    return res.status(500).json({ error: 'Failed to load requisitions' });
  }
});

// Returns the earliest non-empty requiredBy date from requisition items.
function hkEarliestRequiredBy(items?: Array<{ requiredBy?: string }>): string | null {
  if (!items || items.length === 0) return null;
  const dates = items
    .map(it => it.requiredBy)
    .filter((d): d is string => !!d && !isNaN(new Date(d).getTime()))
    .map(d => new Date(d).getTime());
  if (dates.length === 0) return null;
  return new Date(Math.min(...dates)).toISOString();
}

// POST /api/hk-portal/supply-procurement/requisitions
// Creates a new hk_purchase_order (status 'draft') with lines from the HK portal.
router.post('/supply-procurement/requisitions', authenticate, requirePermission('hk:po:create'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  try {
    const { propertyId, supplierId, priority, notes, items } = req.body as {
      propertyId?: string;
      supplierId?: string;
      priority?: string;
      notes?: string;
      items?: Array<{ itemName: string; category: string; quantity: number; unit: string; estimatedCost: number; requiredBy: string; reason: string; itemId?: string }>;
    };

    if (!propertyId) return res.status(400).json({ error: 'propertyId is required' });
    const poNumber = `HK-PO-${new Date().getFullYear()}-${Date.now().toString().slice(-6)}`;
    const subtotal = (items || []).reduce((sum, it) => sum + (Number(it.quantity) || 0) * (Number(it.estimatedCost) || 0), 0);

    const { data: po, error: poErr } = await supabaseAdmin.from('hk_purchase_orders').insert({
      po_number: poNumber,
      supplier_id: supplierId || null,
      property_id: propertyId,
      status: 'draft',
      priority: priority || 'medium',
      order_date: new Date().toISOString(),
      expected_delivery_date: hkEarliestRequiredBy(items) || null,
      subtotal,
      tax_amount: 0,
      total_amount: subtotal,
      currency: 'ETB',
      payment_status: 'pending',
      notes: notes || (priority ? `Priority: ${priority}` : 'Created from HK Supply & Procurement'),
      submitted_by: req.user?.name || req.user?.id || 'Housekeeping',
    }).select().single();
    if (poErr) return res.status(500).json({ error: poErr.message });

    // Resolve item_id by name from uinv_items when not provided.
    const { data: invItems } = await supabaseAdmin.from('uinv_items').select('id, item_name').eq('category', 'Housekeeping').eq('is_active', true);
    const itemByName: Record<string, string> = {};
    (invItems || []).forEach((i: any) => { itemByName[(i.item_name || '').toLowerCase()] = i.id; });

    const lineRows = (items || []).map((it) => {
      const itemId = it.itemId || itemByName[(it.itemName || '').toLowerCase()];
      const qty = Number(it.quantity) || 0;
      const unitCost = Number(it.estimatedCost) || 0;
      return {
        po_id: po.id,
        item_id: itemId || null,
        description: it.itemName,
        quantity_ordered: qty,
        quantity_received: 0,
        unit_of_measure: it.unit || 'pcs',
        unit_price: unitCost,
        line_total: Number((qty * unitCost).toFixed(2)),
        expected_date: it.requiredBy ? new Date(it.requiredBy).toISOString() : null,
        reason: it.reason || null,
      };
    });

    if (lineRows.length > 0) {
      const { error: lineErr } = await supabaseAdmin.from('hk_purchase_order_lines').insert(lineRows);
      if (lineErr) return res.status(500).json({ error: lineErr.message });
    }

    // Twin-write into unified proc_requisitions so the Procurement portal sees this.
    twinWriteProcRequisition({
      sourceSystem: 'housekeeping',
      sourceRef: po.id,
      sourcePoNumber: po.po_number,
      propertyId,
      department: 'Housekeeping',
      requester: req.user?.name || req.user?.id || 'Housekeeping',
      priority: priority || 'medium',
      notes: notes || 'Created from HK Supply & Procurement',
      requiredDate: hkEarliestRequiredBy(items),
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
    console.error('supply-procurement/requisitions POST error:', err);
    return res.status(500).json({ error: 'Failed to create requisition' });
  }
});

// GET /api/hk-portal/supply-procurement/suppliers
// Returns the shared supplier master (fb_suppliers) with category, lead time
// and last order date — the SupplierRequirement shape, filtered to suppliers
// relevant to Housekeeping (cleaning supplies, linens, amenities, equipment).
router.get('/supply-procurement/suppliers', authenticate, async (_req, res) => {
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

    const { data: pos } = await supabaseAdmin.from('hk_purchase_orders').select('supplier_id, order_date').order('order_date', { ascending: false });
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
    console.error('supply-procurement/suppliers error:', err);
    return res.status(500).json({ error: 'Failed to load suppliers' });
  }
});

// GET /api/hk-portal/supply-procurement/stats
// Stat cards for the supply & procurement header. Scoped to the caller's
// active property via ?propertyId= when provided.
router.get('/supply-procurement/stats', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  try {
    const { propertyId } = req.query as Record<string, string>;
    let openReqQ = supabaseAdmin.from('hk_purchase_orders')
      .select('id', { count: 'exact', head: true })
      .in('status', ['draft', 'submitted']);
    if (propertyId) openReqQ = openReqQ.eq('property_id', propertyId);
    const { count: openRequisitions } = await openReqQ;
    let pendingQ = supabaseAdmin.from('hk_purchase_orders')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'submitted');
    if (propertyId) pendingQ = pendingQ.eq('property_id', propertyId);
    const { count: pendingApproval } = await pendingQ;
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
    console.error('supply-procurement/stats error:', err);
    return res.status(500).json({ error: 'Failed to load stats' });
  }
});

// ── PO status transitions + goods receipt (close the procurement loop) ──
// These endpoints let a PO flow draft → submitted → acknowledged → partial →
// received → closed, and a goods receipt credits inventory_items (HK store)
// and logs inventory_transactions for auditability. Without these, every PO
// was permanently stuck at 'draft' and received goods never hit stock.

// Allowed forward transitions for hk_purchase_orders.status.
const HK_PO_TRANSITIONS: Record<string, string[]> = {
  draft: ['submitted', 'cancelled'],
  submitted: ['acknowledged', 'cancelled'],
  acknowledged: ['partial', 'received', 'cancelled'],
  partial: ['received', 'cancelled'],
  received: ['closed'],
  closed: [],
  cancelled: [],
};

// PUT /api/hk-portal/supply-procurement/requisitions/:id/status
// Advance a PO to the next status. Validates the transition is allowed.
router.put('/supply-procurement/requisitions/:id/status', authenticate, requirePermission('hk:po:create'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  try {
    const { status: nextStatus } = req.body as { status?: string };
    if (!nextStatus) return res.status(400).json({ error: 'status is required' });

    const { data: po, error: poErr } = await supabaseAdmin
      .from('hk_purchase_orders').select('id, status, po_number').eq('id', req.params.id).single();
    if (poErr) return res.status(404).json({ error: 'Purchase order not found' });
    if (!po) return res.status(404).json({ error: 'Purchase order not found' });

    const allowed = HK_PO_TRANSITIONS[po.status] || [];
    if (!allowed.includes(nextStatus)) {
      return res.status(400).json({ error: `Cannot transition from '${po.status}' to '${nextStatus}'. Allowed: ${allowed.join(', ') || 'none'}` });
    }

    const update: Record<string, unknown> = { status: nextStatus, updated_at: new Date().toISOString() };
    if (nextStatus === 'received' || nextStatus === 'closed') {
      update.actual_delivery_date = new Date().toISOString();
    }

    const { error: updErr } = await supabaseAdmin
      .from('hk_purchase_orders').update(update).eq('id', po.id);
    if (updErr) return res.status(500).json({ error: updErr.message });

    cacheService.invalidatePattern('^hk-supply-procurement:');
    return res.json({ id: po.id, po_number: po.po_number, status: nextStatus });
  } catch (err) {
    console.error('supply-procurement/requisitions/:id/status error:', err);
    return res.status(500).json({ error: 'Failed to update PO status' });
  }
});

// POST /api/hk-portal/supply-procurement/requisitions/:id/receive
// Goods receipt: marks the PO as received (or partial), increments
// quantity_received on each line, and credits the HK inventory_items store
// for the received quantity. Logs an inventory_transactions row per line.
//
// Body: { lines: [{ lineId, receivedQty }] }  — when omitted, all lines are
// fully received (quantity_received = quantity_ordered).
router.post('/supply-procurement/requisitions/:id/receive', authenticate, requirePermission('hk:inventory:manage'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  try {
    const { lines } = (req.body || {}) as { lines?: Array<{ lineId: string; receivedQty: number }> };

    const { data: po, error: poErr } = await supabaseAdmin
      .from('hk_purchase_orders').select('id, status, po_number, property_id').eq('id', req.params.id).single();
    if (poErr || !po) return res.status(404).json({ error: 'Purchase order not found' });
    if (!['acknowledged', 'partial', 'received'].includes(po.status)) {
      return res.status(400).json({ error: `PO must be acknowledged or partial to receive (current: ${po.status})` });
    }
    const propertyId = po.property_id;
    if (!propertyId) return res.status(400).json({ error: 'PO has no property_id' });

    const { data: poLines, error: linesErr } = await supabaseAdmin
      .from('hk_purchase_order_lines').select('*').eq('po_id', po.id);
    if (linesErr) return res.status(500).json({ error: linesErr.message });

    const receivedMap = new Map<string, number>();
    if (lines && lines.length > 0) {
      for (const l of lines) {
        if (l.lineId && Number.isFinite(l.receivedQty)) receivedMap.set(l.lineId, Math.max(0, Number(l.receivedQty)));
      }
    }

    const now = new Date().toISOString();
    let allFullyReceived = true;

    for (const line of poLines || []) {
      const ordered = Number(line.quantity_ordered || 0);
      const alreadyReceived = Number(line.quantity_received || 0);
      const thisReceipt = receivedMap.has(line.id)
        ? Math.min(ordered - alreadyReceived, receivedMap.get(line.id)!)
        : Math.max(0, ordered - alreadyReceived);
      if (thisReceipt <= 0) {
        if (alreadyReceived < ordered) allFullyReceived = false;
        continue;
      }

      const newReceivedQty = alreadyReceived + thisReceipt;
      const { error: lineUpdErr } = await supabaseAdmin
        .from('hk_purchase_order_lines')
        .update({ quantity_received: newReceivedQty })
        .eq('id', line.id);
      if (lineUpdErr) console.warn(`[hk-po-receive] failed to update line ${line.id}:`, lineUpdErr.message);

      if (newReceivedQty < ordered) allFullyReceived = false;

      // Credit the unified uinv_stock_balances for the HK store.
      const itemId = line.item_id;
      const itemName = (line.description || '').trim();
      const unitCost = Number(line.unit_price || 0);

      // Resolve a unified item — by explicit ID, or by name match
      let resolvedItemId: string | null = itemId;
      let resolvedSubcategory = 'Other';
      if (!resolvedItemId && itemName) {
        const { data: matchItem } = await supabaseAdmin
          .from('uinv_items')
          .select('id, subcategory')
          .ilike('item_name', itemName)
          .eq('category', 'Housekeeping')
          .maybeSingle();
        if (matchItem) {
          resolvedItemId = matchItem.id;
          resolvedSubcategory = matchItem.subcategory || 'Other';
        }
      } else if (resolvedItemId) {
        const { data: itemInfo } = await supabaseAdmin
          .from('uinv_items')
          .select('subcategory')
          .eq('id', resolvedItemId)
          .maybeSingle();
        resolvedSubcategory = itemInfo?.subcategory || 'Other';
      }

      if (resolvedItemId) {
        const storeId = (resolvedSubcategory === 'Laundry Supplies') ? HK_LINEN_STORE_ID : HK_STORE_ID;
        const { data: balance } = await supabaseAdmin
          .from('uinv_stock_balances')
          .select('id, on_hand, unit_cost')
          .eq('item_id', resolvedItemId)
          .eq('store_id', storeId)
          .order('updated_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (balance) {
          const newQty = Number(balance.on_hand) + thisReceipt;
          await supabaseAdmin.from('uinv_stock_balances').update({
            on_hand: newQty,
            unit_cost: unitCost || Number(balance.unit_cost || 0),
            last_movement_date: now,
            updated_at: now,
          }).eq('id', balance.id);
        } else {
          // Create new balance row
          const newBalanceId = `UINV-SB-HK-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
          await supabaseAdmin.from('uinv_stock_balances').insert({
            id: newBalanceId,
            property_id: propertyId,
            item_id: resolvedItemId,
            store_id: storeId,
            location_id: null,
            on_hand: thisReceipt,
            reserved: 0, allocated: 0, on_order: 0, in_transit: 0,
            damaged: 0, quarantined: 0, expired: 0,
            status: 'Available',
            unit_cost: unitCost,
            last_movement_date: now,
          });
        }

        // Log to uinv_stock_ledger
        await supabaseAdmin.from('uinv_stock_ledger').insert({
          property_id: propertyId,
          item_id: resolvedItemId,
          store_id: storeId,
          transaction_type: 'Goods Receipt',
          reference: po.po_number,
          quantity_in: thisReceipt,
          quantity_out: 0,
          balance: Number(balance?.on_hand || 0) + thisReceipt,
          unit_cost: unitCost,
          value: thisReceipt * unitCost,
          performed_by: req.user?.name || req.user?.id || 'system',
          reason: `Goods receipt for ${po.po_number}`,
          transaction_date: now,
        });
      }
    }

    const nextPoStatus = allFullyReceived ? 'received' : 'partial';
    await supabaseAdmin.from('hk_purchase_orders').update({
      status: nextPoStatus,
      actual_delivery_date: allFullyReceived ? now : null,
      updated_at: now,
    }).eq('id', po.id);

    cacheService.invalidatePattern('^hk-inventory-central:');
    cacheService.invalidatePattern('^hk-supply-procurement:');
    return res.json({ id: po.id, po_number: po.po_number, status: nextPoStatus, fullyReceived: allFullyReceived });
  } catch (err) {
    console.error('supply-procurement/requisitions/:id/receive error:', err);
    return res.status(500).json({ error: 'Failed to process goods receipt' });
  }
});

// ── Maintenance Coordination (docs/Housekeeping Portal new.md §20) ──────
// Backs the Maintenance Coordination module: Issue Reporting (8 categories)
// and workflow: Report Issue → Assign Engineering → Track Status → Verify
// Completion → Release Room. Persisted to housekeeping_maintenance_issues
// (migration 314). Previously the module rendered hardcoded `seed` data.

const MAINT_ISSUE_TYPES = new Set([
  'Plumbing', 'Electrical', 'HVAC', 'Furniture Damage',
  'Lock Problems', 'Lighting', 'TV', 'Internet',
]);
const MAINT_STAGES = new Set([
  'Reported', 'Assigned to Engineering', 'In Progress',
  'Completed', 'Verified', 'Room Released',
]);
const MAINT_STAGE_FLOW: string[] = [
  'Reported', 'Assigned to Engineering', 'In Progress',
  'Completed', 'Verified', 'Room Released',
];

// Shape a DB row into the camelCase contract the frontend expects.
function shapeMaintIssue(row: any) {
  return {
    id: row.id,
    type: row.type,
    room: row.room,
    reportedBy: row.reported_by,
    reportedAt: row.reported_at,
    stage: row.stage,
    assignedTo: row.assigned_to || undefined,
    notes: row.notes || undefined,
    propertyId: row.property_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// GET /api/hk-portal/maintenance/:propertyId
// Returns all maintenance issues for a property, optionally filtered by
// stage (?stage=) and/or type (?type=).
router.get('/maintenance/:propertyId', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const { stage, type } = req.query as Record<string, string>;

  const cacheKey = `hk-maintenance:${req.params.propertyId}:${stage || 'all'}:${type || 'all'}`;
  const cached = cacheService.get(cacheKey);
  if (cached) return res.json(cached);

  let q = supabaseAdmin
    .from('housekeeping_maintenance_issues')
    .select('*')
    .eq('property_id', req.params.propertyId)
    .order('created_at', { ascending: false });

  if (stage && MAINT_STAGES.has(stage)) q = q.eq('stage', stage);
  if (type && MAINT_ISSUE_TYPES.has(type)) q = q.eq('type', type);

  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });

  const issues = (data || []).map(shapeMaintIssue);
  const result = {
    propertyId: req.params.propertyId,
    issues,
    summary: {
      total: issues.length,
      reported: issues.filter(i => i.stage === 'Reported').length,
      assigned: issues.filter(i => i.stage === 'Assigned to Engineering').length,
      inProgress: issues.filter(i => i.stage === 'In Progress').length,
      completed: issues.filter(i => i.stage === 'Completed' || i.stage === 'Verified').length,
      released: issues.filter(i => i.stage === 'Room Released').length,
    },
    generatedAt: new Date().toISOString(),
  };

  cacheService.set(cacheKey, result, 30 * 1000);
  return res.json(result);
});

// POST /api/hk-portal/maintenance
// Report a new maintenance issue. Body: { propertyId, type, room, reportedBy,
// reportedAt?, notes?, assignedTo? }. Defaults reportedAt to the current
// time label and stage to 'Reported'.
router.post('/maintenance', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const { propertyId, type, room, reportedBy, reportedAt, notes, assignedTo } = req.body || {};
  if (!propertyId) return res.status(400).json({ error: 'propertyId is required' });
  if (!type || !MAINT_ISSUE_TYPES.has(type)) {
    return res.status(400).json({ error: `Invalid issue type: ${type}` });
  }
  if (!room || !String(room).trim()) return res.status(400).json({ error: 'room is required' });
  if (!reportedBy || !String(reportedBy).trim()) {
    return res.status(400).json({ error: 'reportedBy is required' });
  }

  const id = `MC-${Date.now()}`;
  const row = {
    id,
    property_id: propertyId,
    type,
    room: String(room).trim(),
    reported_by: String(reportedBy).trim(),
    reported_at: reportedAt?.trim() || new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    stage: 'Reported',
    assigned_to: assignedTo?.trim() || null,
    notes: notes?.trim() || null,
  };

  const { data, error } = await supabaseAdmin
    .from('housekeeping_maintenance_issues')
    .insert(row)
    .select('*')
    .single();

  if (error) return res.status(500).json({ error: error.message });

  cacheService.invalidatePattern('^hk-maintenance:');
  return res.status(201).json(shapeMaintIssue(data));
});

// PUT /api/hk-portal/maintenance/:id/advance
// Advance an issue one step along the workflow:
// Reported → Assigned to Engineering → In Progress → Completed → Verified → Room Released.
// When advancing out of 'Reported', assigns a default engineering team if none set
// AND creates a real work_orders row in the Engineering portal so the issue is
// visible to engineers. When reaching 'Room Released', writes rooms.status back
// to 'Vacant Dirty' so the room re-enters the housekeeping workflow.
router.put('/maintenance/:id/advance', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const { data: current, error: fetchError } = await supabaseAdmin
    .from('housekeeping_maintenance_issues')
    .select('stage, assigned_to, type, room, property_id, notes')
    .eq('id', req.params.id)
    .single();
  if (fetchError) return res.status(500).json({ error: fetchError.message });
  if (!current) return res.status(404).json({ error: 'Maintenance issue not found' });

  const idx = MAINT_STAGE_FLOW.indexOf(current.stage);
  if (idx < 0) return res.status(400).json({ error: `Unknown stage: ${current.stage}` });
  if (idx >= MAINT_STAGE_FLOW.length - 1) {
    return res.status(400).json({ error: 'Issue is already at the final stage (Room Released)' });
  }
  const nextStage = MAINT_STAGE_FLOW[idx + 1];

  const update: any = { stage: nextStage };
  // Auto-assign a default engineering team when first advancing out of Reported.
  if (current.stage === 'Reported' && !current.assigned_to) {
    update.assigned_to = 'Eng. Team A';
  }

  const { data, error } = await supabaseAdmin
    .from('housekeeping_maintenance_issues')
    .update(update)
    .eq('id', req.params.id)
    .select('*')
    .single();

  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Maintenance issue not found' });

  // Cross-portal integration: create an Engineering work_order when assigning.
  if (nextStage === 'Assigned to Engineering') {
    try {
      const woId = `WO-${Date.now()}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
      const woNumber = `WO-${Date.now().toString().slice(-6)}`;
      await supabaseAdmin.from('work_orders').insert({
        id: woId,
        wo_number: woNumber,
        title: `HK: ${current.type} — Room ${current.room}`,
        description: current.notes || `Housekeeping-reported ${current.type} issue in room ${current.room}.`,
        type: 'Corrective',
        priority: 'Medium',
        status: 'Open',
        assigned_to: data.assigned_to || null,
        room_number: current.room,
        checklist: [],
        created_by: req.user?.id || null,
      });
    } catch (woErr: any) {
      // Non-fatal: the HK issue still advanced; log and continue.
      console.warn('[hk-maintenance] work_orders insert failed:', woErr?.message);
    }
  }

  // Cross-portal integration: release the room back to housekeeping on 'Room Released'.
  if (nextStage === 'Room Released' && current.room && current.property_id) {
    try {
      await supabaseAdmin
        .from('rooms')
        .update({ status: 'Vacant Dirty', updated_at: new Date().toISOString() })
        .eq('property_id', current.property_id)
        .eq('number', current.room);
    } catch (roomErr: any) {
      console.warn('[hk-maintenance] room status release failed:', roomErr?.message);
    }
  }

  cacheService.invalidatePattern('^hk-maintenance:');
  return res.json(shapeMaintIssue(data));
});

// PUT /api/hk-portal/maintenance/:id — edit an issue's type/room/notes/assignedTo.
router.put('/maintenance/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { type, room, notes, assignedTo } = req.body || {};
  const update: any = {};
  if (type && MAINT_ISSUE_TYPES.has(type)) update.type = type;
  if (room && String(room).trim()) update.room = String(room).trim();
  if (notes !== undefined) update.notes = notes?.trim() || null;
  if (assignedTo !== undefined) update.assigned_to = assignedTo?.trim() || null;
  if (Object.keys(update).length === 0) {
    return res.status(400).json({ error: 'No valid fields to update' });
  }
  const { data, error } = await supabaseAdmin
    .from('housekeeping_maintenance_issues')
    .update(update)
    .eq('id', req.params.id)
    .select('*')
    .maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Maintenance issue not found' });
  cacheService.invalidatePattern('^hk-maintenance:');
  return res.json(shapeMaintIssue(data));
});

// DELETE /api/hk-portal/maintenance/:id — remove an issue.
router.delete('/maintenance/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { error } = await supabaseAdmin
    .from('housekeeping_maintenance_issues')
    .delete()
    .eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidatePattern('^hk-maintenance:');
  return res.json({ success: true });
});

// ── Communication Center (docs/Housekeeping Portal new.md §22) ──────────
// Backs the Communication Center module: Internal Chat, Task Notifications,
// Escalations, Shift Announcements, Guest Service Notifications. Persisted
// to housekeeping_communication_messages (migration 315). Previously the
// module rendered hardcoded `seed` data.

const COMM_CHANNELS = new Set([
  'Internal Chat', 'Task Notifications', 'Escalations',
  'Shift Announcements', 'Guest Service Notifications',
]);

// Shape a DB row into the camelCase contract the frontend expects.
function shapeCommMessage(row: any) {
  return {
    id: row.id,
    channel: row.channel,
    from: row.from_name,
    text: row.body,
    timestamp: row.timestamp,
    unread: !!row.unread,
    propertyId: row.property_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// GET /api/hk-portal/communication/:propertyId
// Returns all communication messages for a property, optionally filtered by
// channel (?channel=). Ordered newest-first by created_at.
router.get('/communication/:propertyId', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const { channel } = req.query as Record<string, string>;

  const cacheKey = `hk-communication:${req.params.propertyId}:${channel || 'all'}`;
  const cached = cacheService.get(cacheKey);
  if (cached) return res.json(cached);

  let q = supabaseAdmin
    .from('housekeeping_communication_messages')
    .select('*')
    .eq('property_id', req.params.propertyId)
    .order('created_at', { ascending: false });

  if (channel && COMM_CHANNELS.has(channel)) q = q.eq('channel', channel);

  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });

  const messages = (data || []).map(shapeCommMessage);
  const result = {
    propertyId: req.params.propertyId,
    messages,
    summary: {
      total: messages.length,
      unread: messages.filter(m => m.unread).length,
    },
    generatedAt: new Date().toISOString(),
  };

  cacheService.set(cacheKey, result, 15 * 1000);
  return res.json(result);
});

// POST /api/hk-portal/communication
// Send a new message. Body: { propertyId, channel, from, text }.
router.post('/communication', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const { propertyId, channel, from, text } = req.body || {};
  if (!propertyId) return res.status(400).json({ error: 'propertyId is required' });
  if (!channel || !COMM_CHANNELS.has(channel)) {
    return res.status(400).json({ error: `Invalid channel: ${channel}` });
  }
  if (!from || !String(from).trim()) return res.status(400).json({ error: 'from is required' });
  if (!text || !String(text).trim()) return res.status(400).json({ error: 'text is required' });

  const id = `CM-${Date.now()}`;
  const row = {
    id,
    property_id: propertyId,
    channel,
    from_name: String(from).trim(),
    body: String(text).trim(),
    timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    unread: false,
  };

  const { data, error } = await supabaseAdmin
    .from('housekeeping_communication_messages')
    .insert(row)
    .select('*')
    .single();

  if (error) return res.status(500).json({ error: error.message });

  cacheService.invalidatePattern('^hk-communication:');
  return res.status(201).json(shapeCommMessage(data));
});

// PUT /api/hk-portal/communication/:id/read
// Mark a single message as read.
router.put('/communication/:id/read', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const { data, error } = await supabaseAdmin
    .from('housekeeping_communication_messages')
    .update({ unread: false })
    .eq('id', req.params.id)
    .select('*')
    .single();

  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Message not found' });

  cacheService.invalidatePattern('^hk-communication:');
  return res.json(shapeCommMessage(data));
});

// PUT /api/hk-portal/communication/:propertyId/read-all
// Mark all messages in a channel (or all channels) as read for a property.
// Body: { channel?: string } — when omitted, marks all channels.
router.put('/communication/:propertyId/read-all', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const { channel } = req.body || {};
  let q = supabaseAdmin
    .from('housekeeping_communication_messages')
    .update({ unread: false })
    .eq('property_id', req.params.propertyId)
    .eq('unread', true);

  if (channel && COMM_CHANNELS.has(channel)) q = q.eq('channel', channel);

  const { data, error } = await q.select('*');
  if (error) return res.status(500).json({ error: error.message });

  cacheService.invalidatePattern('^hk-communication:');
  return res.json({ updated: (data || []).length, messages: (data || []).map(shapeCommMessage) });
});

// ── Housekeeping Reports Registry (docs/Housekeeping Portal new.md §23) ─
// Backs the /erp/housekeeping/reports screen. Mimics the F&B reports pattern
// (fb_reports / fbReports.routes.ts). Read/write over the `hk_reports`
// registry table (migration 316).
//   - GET  /reports           list reports (optional ?category=)
//   - GET  /reports/stats     aggregated KPI counts
//   - GET  /reports/:id       fetch a single report
//   - POST /reports/:id/run   re-run a single report (status Ready + last_run = now)
//   - POST /reports/run-all   queue all reports for refresh
//   - PATCH /reports/:id      update frequency / format / status

const HK_REPORT_CATEGORIES = ['operational', 'staff', 'inventory', 'quality'] as const;
const HK_REPORT_STATUSES = ['Ready', 'Scheduled', 'Generating', 'Failed'] as const;
const HK_REPORT_FORMATS = ['PDF', 'Excel', 'CSV'] as const;

const HK_REPORT_SELECT = 'id, category, name, description, last_run, status, format, frequency, updated_at';

// GET /api/hk-portal/reports  — list reports (optional ?category=)
router.get('/reports', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const category = req.query.category as string;
  let q = supabaseAdmin.from('hk_reports').select(HK_REPORT_SELECT).order('id', { ascending: true });
  if (category && (HK_REPORT_CATEGORIES as readonly string[]).includes(category)) q = q.eq('category', category);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

// GET /api/hk-portal/reports/stats — aggregated KPI counts
router.get('/reports/stats', authenticate, async (_req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { data, error } = await supabaseAdmin.from('hk_reports').select('category, status');
  if (error) return res.status(500).json({ error: error.message });
  const rows = data || [];
  const total = rows.length;
  const ready = rows.filter((r: any) => r.status === 'Ready').length;
  const scheduled = rows.filter((r: any) => r.status === 'Scheduled').length;
  const failed = rows.filter((r: any) => r.status === 'Failed').length;
  const byCategory: Record<string, number> = { operational: 0, staff: 0, inventory: 0, quality: 0 };
  for (const r of rows) byCategory[r.category] = (byCategory[r.category] || 0) + 1;
  return res.json({ total, ready, scheduled, failed, byCategory });
});

// GET /api/hk-portal/reports/:id — fetch a single report
router.get('/reports/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { data, error } = await supabaseAdmin
    .from('hk_reports').select(HK_REPORT_SELECT).eq('id', req.params.id).maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Report not found' });
  return res.json(data);
});

// POST /api/hk-portal/reports/:id/run — re-run a single report
router.post('/reports/:id/run', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { data, error } = await supabaseAdmin
    .from('hk_reports')
    .update({ status: 'Ready', last_run: new Date().toISOString() })
    .eq('id', req.params.id)
    .select(HK_REPORT_SELECT)
    .maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Report not found' });
  return res.json(data);
});

// POST /api/hk-portal/reports/run-all — queue all reports for refresh
router.post('/reports/run-all', authenticate, async (_req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { data, error } = await supabaseAdmin
    .from('hk_reports')
    .update({ status: 'Ready', last_run: new Date().toISOString() })
    .neq('status', 'Ready')
    .select(HK_REPORT_SELECT);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ refreshed: data?.length || 0, reports: data || [] });
});

// PATCH /api/hk-portal/reports/:id — update frequency / format / status
router.patch('/reports/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const body = req.body || {};
  const updates: Record<string, any> = {};
  if (typeof body.frequency === 'string' && body.frequency.trim()) updates.frequency = body.frequency.trim();
  if (typeof body.format === 'string' && (HK_REPORT_FORMATS as readonly string[]).includes(body.format)) updates.format = body.format;
  if (typeof body.status === 'string' && (HK_REPORT_STATUSES as readonly string[]).includes(body.status)) updates.status = body.status;
  if (Object.keys(updates).length === 0) {
    return res.status(400).json({ error: 'No valid fields to update (frequency, format, status)' });
  }
  const { data, error } = await supabaseAdmin
    .from('hk_reports').update(updates).eq('id', req.params.id).select(HK_REPORT_SELECT).maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Report not found' });
  return res.json(data);
});

// ─────────────────────────────────────────────────────────────────────
// Housekeeping Dashboard (docs/Housekeeping Portal new.md §4)
//   - GET  /dashboard/kpis          room status + task + maintenance KPIs
//   - GET  /dashboard/alerts        smart alert engine list (regenerates)
//   - POST /dashboard/alerts/:id/acknowledge
//   - POST /dashboard/alerts/:id/snooze
//   - GET  /dashboard/productivity  7-day productivity trend
//
// All endpoints accept an optional ?propertyId= query param. When provided,
// KPIs and alerts are scoped to that property (multi-property support, §27).
// ─────────────────────────────────────────────────────────────────────

// Scan live data and upsert alerts into hk_dashboard_alerts. Called by
// GET /dashboard/alerts so the list is always fresh. Resolves alerts whose
// trigger condition has cleared (sets status='Resolved') so they drop out
// of the active list on the next fetch.
async function regenerateAlerts(propertyId: string | undefined): Promise<void> {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return;

  // Fetch the source data for alert detection.
  const roomsQ = supabaseAdmin.from('rooms').select('id, number, status, property_id');
  const tasksQ = supabaseAdmin.from('housekeeping_task_mgmt')
    .select('id, type, status, location, due_date, property_id');
  const maintQ = supabaseAdmin.from('housekeeping_maintenance_issues')
    .select('id, stage, room, property_id');
  const inspQ = supabaseAdmin.from('room_inspections')
    .select('id, room_number, result, property_id');
  const linenQ = supabaseAdmin.from('hk_linen_stock')
    .select('id, name, quantity, reorder_point, property_id');
  const minibarQ = supabaseAdmin.from('housekeeping_minibar')
    .select('id, status, room_number, property_id');

  const [roomsR, tasksR, maintR, inspR, linenR, minibarR] = await Promise.all([
    roomsQ, tasksQ, maintQ, inspQ, linenQ, minibarQ,
  ]);

  // Non-fatal: if a table is missing, just skip that alert type.
  const rooms = (roomsR.data || []).filter((r: any) => !propertyId || r.property_id === propertyId);
  const tasks = (tasksR.data || []).filter((t: any) => !propertyId || t.property_id === propertyId);
  const maint = (maintR.data || []).filter((m: any) => !propertyId || m.property_id === propertyId);
  const insp = (inspR.data || []).filter((i: any) => !propertyId || i.property_id === propertyId);
  const linen = (linenR.data || []).filter((l: any) => !propertyId || l.property_id === propertyId);
  const minibar = (minibarR.data || []).filter((m: any) => !propertyId || m.property_id === propertyId);

  const now = new Date();
  type AlertDraft = {
    id: string;
    type: string;
    message: string;
    priority: 'Critical' | 'High' | 'Medium' | 'Low';
    room: string | null;
  };
  const drafts: AlertDraft[] = [];

  // 1. VIP Arrival Pending — VIP Preparation tasks not yet completed.
  const vipTasks = tasks.filter((t: any) => t.type === 'VIP Preparation' && t.status !== 'Completed' && t.status !== 'Verified');
  for (const t of vipTasks) {
    drafts.push({
      id: `alert-vip-${t.id}`,
      type: 'VIP Arrival',
      message: `VIP room ${t.location} preparation ${t.status.toLowerCase()}.`,
      priority: 'Critical',
      room: t.location || null,
    });
  }

  // 2. Early Arrival Priority — Early Arrival Preparation tasks pending/in-progress.
  const earlyTasks = tasks.filter((t: any) => t.type === 'Early Arrival Preparation' && (t.status === 'Pending' || t.status === 'In Progress'));
  for (const t of earlyTasks) {
    drafts.push({
      id: `alert-early-${t.id}`,
      type: 'Early Arrival',
      message: `Early arrival prep for ${t.location} still ${t.status.toLowerCase()}.`,
      priority: 'High',
      room: t.location || null,
    });
  }

  // 3. Late Check-out Delay — checkout cleaning tasks overdue (due_date in past, not completed).
  for (const t of tasks) {
    if (t.type === 'Checkout Cleaning' && t.status !== 'Completed' && t.status !== 'Verified' && t.due_date) {
      const due = new Date(t.due_date);
      if (!isNaN(due.getTime()) && due < now) {
        drafts.push({
          id: `alert-lateco-${t.id}`,
          type: 'Late Check-out',
          message: `Checkout cleaning for ${t.location} overdue (was due ${t.due_date}).`,
          priority: 'High',
          room: t.location || null,
        });
      }
    }
  }

  // 4. Failed Inspection — rooms with a failed inspection not yet re-inspected.
  const failedRooms = new Set<string>();
  for (const i of insp) {
    if (i.result === 'Fail') failedRooms.add(i.room_number);
  }
  for (const room of failedRooms) {
    drafts.push({
      id: `alert-failinsp-${room}`,
      type: 'Failed Inspection',
      message: `Room ${room} failed inspection and needs rework.`,
      priority: 'High',
      room: room,
    });
  }

  // 5. Linen Shortage — any linen stock at/below reorder point.
  for (const l of linen) {
    const qty = Number(l.quantity) || 0;
    const reorder = Number(l.reorder_point) || 0;
    if (reorder > 0 && qty <= reorder) {
      drafts.push({
        id: `alert-linen-${l.id}`,
        type: 'Linen Shortage',
        message: `${l.name} stock at ${qty} (reorder point ${reorder}).`,
        priority: 'Medium',
        room: null,
      });
    }
  }

  // 6. Minibar Pending — minibar jobs not yet completed.
  const pendingMinibar = minibar.filter((m: any) => m.status && m.status !== 'Completed' && m.status !== 'Delivered');
  for (const m of pendingMinibar) {
    drafts.push({
      id: `alert-minibar-${m.id}`,
      type: 'Minibar Pending',
      message: `Minibar servicing pending for room ${m.room_number || '?'}.`,
      priority: 'Low',
      room: m.room_number || null,
    });
  }

  // 7. Deep Cleaning Due — Deep Cleaning tasks pending/in-progress.
  const deepTasks = tasks.filter((t: any) => t.type === 'Deep Cleaning' && (t.status === 'Pending' || t.status === 'In Progress'));
  for (const t of deepTasks) {
    drafts.push({
      id: `alert-deep-${t.id}`,
      type: 'Deep Cleaning Due',
      message: `Deep cleaning for ${t.location} is ${t.status.toLowerCase()}.`,
      priority: 'Medium',
      room: t.location || null,
    });
  }

  // 8. Maintenance Awaiting — maintenance issues waiting for engineering access.
  const awaitingMaint = maint.filter((m: any) =>
    m.stage === 'Reported' || m.stage === 'Assigned to Engineering');
  for (const m of awaitingMaint) {
    drafts.push({
      id: `alert-maint-${m.id}`,
      type: 'Maintenance Awaiting',
      message: `Maintenance issue in room ${m.room} awaiting engineering (${m.stage}).`,
      priority: 'Medium',
      room: m.room || null,
    });
  }

  // Fetch existing active alerts to decide upsert vs. resolve.
  let existingQ = supabaseAdmin.from('hk_dashboard_alerts')
    .select('id, status')
    .in('status', ['Active', 'Acknowledged', 'Snoozed']);
  if (propertyId) existingQ = (existingQ as any).eq('property_id', propertyId);
  const { data: existing } = await existingQ;
  const existingMap = new Map((existing || []).map((e: any) => [e.id, e.status]));
  const draftIds = new Set(drafts.map(d => d.id));

  // Upsert new/changed drafts (only insert if not already present with same type).
  const toUpsert = drafts.filter(d => !existingMap.has(d.id));
  if (toUpsert.length > 0) {
    const rows = toUpsert.map(d => ({
      id: d.id,
      property_id: propertyId || null,
      type: d.type,
      message: d.message,
      priority: d.priority,
      status: 'Active',
      room: d.room,
    }));
    await supabaseAdmin.from('hk_dashboard_alerts').upsert(rows, { onConflict: 'id' }).eq('status', 'Active');
  }

  // Resolve alerts whose trigger condition has cleared.
  const toResolve = [...existingMap.keys()].filter(id => !draftIds.has(id));
  if (toResolve.length > 0) {
    await supabaseAdmin.from('hk_dashboard_alerts')
      .update({ status: 'Resolved' })
      .in('id', toResolve)
      .in('status', ['Active', 'Acknowledged', 'Snoozed']);
  }
}

// GET /api/hk-portal/dashboard/kpis — computed KPIs from rooms + tasks + maintenance
router.get('/dashboard/kpis', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const propertyId = (req.query as Record<string, string>).propertyId;
  try {
    let roomsQ = supabaseAdmin.from('rooms').select('id, number, status');
    let tasksQ = supabaseAdmin.from('housekeeping_task_mgmt').select('id, status, type, completed_at');
    let maintQ = supabaseAdmin.from('housekeeping_maintenance_issues').select('id, stage');
    let guestReqQ = supabaseAdmin.from('guest_requests')
      .select('id, status, assigned_department')
      .in('status', ['Open', 'Pending', 'In Progress', 'Acknowledged']);

    if (propertyId) {
      roomsQ = roomsQ.eq('property_id', propertyId);
      tasksQ = tasksQ.eq('property_id', propertyId);
      maintQ = maintQ.eq('property_id', propertyId);
      guestReqQ = (guestReqQ as any).eq('property_id', propertyId);
    }

    const [roomsRes, tasksRes, maintRes, guestReqRes] = await Promise.all([
      roomsQ, tasksQ, maintQ, guestReqQ,
    ]);

    if (roomsRes.error) return res.status(500).json({ error: roomsRes.error.message });
    if (tasksRes.error) return res.status(500).json({ error: tasksRes.error.message });
    if (maintRes.error) return res.status(500).json({ error: maintRes.error.message });
    // Guest requests is non-fatal (column may be absent on older schemas).
    if (guestReqRes.error) console.warn('[hk-dashboard] guest_requests query failed:', guestReqRes.error.message);

    const rooms = roomsRes.data || [];
    const tasks = tasksRes.data || [];
    const maint = maintRes.data || [];
    const guestReqs = guestReqRes.data || [];

    const dirty = rooms.filter(r => typeof r.status === 'string' && r.status.includes('Dirty')).length;
    const clean = rooms.filter(r => r.status === 'Vacant Clean' || r.status === 'Occupied Clean').length;
    const ready = rooms.filter(r => r.status === 'Ready' || r.status === 'Vacant Clean').length;
    const inspected = rooms.filter(r => r.status === 'Inspected').length;
    const occupied = rooms.filter(r => typeof r.status === 'string' && r.status.startsWith('Occupied')).length;
    const vacant = rooms.filter(r => typeof r.status === 'string' && r.status.startsWith('Vacant')).length;
    const ooo = rooms.filter(r => r.status === 'Out of Order').length;
    const oos = rooms.filter(r => r.status === 'Out of Service' || r.status === 'Maintenance Required').length;
    const totalRooms = rooms.length;

    const taskPending = tasks.filter(t => t.status === 'Pending').length;
    const taskInProgress = tasks.filter(t => t.status === 'In Progress').length;
    const taskCompleted = tasks.filter(t => t.status === 'Completed').length;
    const taskVerified = tasks.filter(t => t.status === 'Verified').length;
    const totalTasks = tasks.length;
    const cleaningProgress = totalTasks > 0 ? Math.round(((taskCompleted + taskVerified) / totalTasks) * 100) : 0;

    const openMaintenance = maint.filter(m => m.stage !== 'Completed' && m.stage !== 'Verified' && m.stage !== 'Room Released').length;

    // Outstanding guest requests assigned to HK (§4 KPI).
    const outstandingGuestRequests = guestReqs.filter(
      (g: any) => !g.assigned_department || g.assigned_department === 'HK' || g.assigned_department === 'Housekeeping'
    ).length;

    // Room status distribution for pie chart
    const roomStatusDist = [
      { name: 'Vacant Clean', value: rooms.filter(r => r.status === 'Vacant Clean').length, color: '#10b981' },
      { name: 'Vacant Dirty', value: rooms.filter(r => r.status === 'Vacant Dirty').length, color: '#f59e0b' },
      { name: 'Occupied Clean', value: rooms.filter(r => r.status === 'Occupied Clean').length, color: '#6366f1' },
      { name: 'Occupied Dirty', value: rooms.filter(r => r.status === 'Occupied Dirty').length, color: '#f43f5e' },
      { name: 'Inspected', value: inspected, color: '#8b5cf6' },
      { name: 'Out of Order', value: ooo, color: '#dc2626' },
    ];

    return res.json({
      roomStats: { dirty, clean, ready, inspected, occupied, vacant, ooo, oos, totalRooms },
      taskStats: { pending: taskPending, inProgress: taskInProgress, completed: taskCompleted, verified: taskVerified, total: totalTasks, cleaningProgress },
      maintenanceStats: { openIssues: openMaintenance, total: maint.length },
      guestRequestStats: { outstanding: outstandingGuestRequests },
      roomStatusDist,
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Failed to fetch dashboard KPIs' });
  }
});

// GET /api/hk-portal/dashboard/alerts — regenerate then list.
router.get('/dashboard/alerts', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const propertyId = (req.query as Record<string, string>).propertyId;
  try {
    await regenerateAlerts(propertyId);
    let q = supabaseAdmin
      .from('hk_dashboard_alerts')
      .select('id, type, message, priority, status, room, snoozed_until, created_at, updated_at')
      .neq('status', 'Resolved')
      .order('priority', { ascending: true })
      .order('created_at', { ascending: true });
    if (propertyId) q = q.eq('property_id', propertyId);
    const { data, error } = await q;
    if (error) return res.status(500).json({ error: error.message });
    return res.json(data || []);
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Failed to fetch alerts' });
  }
});

// POST /api/hk-portal/dashboard/alerts/:id/acknowledge
router.post('/dashboard/alerts/:id/acknowledge', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { data, error } = await supabaseAdmin
    .from('hk_dashboard_alerts')
    .update({ status: 'Acknowledged' })
    .eq('id', req.params.id)
    .select('id, type, message, priority, status, room, snoozed_until, created_at, updated_at')
    .maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Alert not found' });
  return res.json(data);
});

// POST /api/hk-portal/dashboard/alerts/:id/snooze
router.post('/dashboard/alerts/:id/snooze', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const hours = Number(req.body?.hours) || 1;
  const snoozedUntil = new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabaseAdmin
    .from('hk_dashboard_alerts')
    .update({ status: 'Snoozed', snoozed_until: snoozedUntil })
    .eq('id', req.params.id)
    .select('id, type, message, priority, status, room, snoozed_until, created_at, updated_at')
    .maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Alert not found' });
  return res.json(data);
});

// GET /api/hk-portal/dashboard/productivity — 7-day productivity trend
router.get('/dashboard/productivity', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const propertyId = (req.query as Record<string, string>).propertyId;
  try {
    // Compute last 7 days from housekeeping_task_mgmt completed_at
    let tasksQ = supabaseAdmin
      .from('housekeeping_task_mgmt')
      .select('id, status, completed_at, type')
      .in('status', ['Completed', 'Verified']);
    if (propertyId) tasksQ = tasksQ.eq('property_id', propertyId);
    const { data: tasks, error } = await tasksQ;
    if (error) return res.status(500).json({ error: error.message });

    const days: { name: string; completed: number; inspected: number }[] = [];
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().split('T')[0];
      const dayName = dayNames[d.getDay()];
      const dayTasks = (tasks || []).filter(t => {
        if (!t.completed_at) return false;
        // completed_at is now TIMESTAMPTZ (migration 318) — split on 'T'.
        const taskDate = String(t.completed_at).split('T')[0];
        return taskDate === dateStr;
      });
      days.push({
        name: dayName,
        completed: dayTasks.filter(t => t.status === 'Completed').length,
        inspected: dayTasks.filter(t => t.status === 'Verified').length,
      });
    }

    // Also fetch staff productivity scores for avg cleaning time
    let prodQ = supabaseAdmin
      .from('hk_staff_productivity')
      .select('rooms_cleaned, hours, inspection_score, productivity_score')
      .order('updated_at', { ascending: false })
      .limit(50);
    if (propertyId) prodQ = prodQ.eq('property_id', propertyId);
    const { data: prodData } = await prodQ;

    let avgCleaningTime = 0;
    if (prodData && prodData.length > 0) {
      const totalRooms = prodData.reduce((s, p) => s + (p.rooms_cleaned || 0), 0);
      const totalHours = prodData.reduce((s, p) => s + Number(p.hours || 0), 0);
      if (totalRooms > 0 && totalHours > 0) {
        avgCleaningTime = Math.round((totalHours / totalRooms) * 60); // minutes per room
      }
    }

    return res.json({ days, avgCleaningTime });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Failed to fetch productivity data' });
  }
});

export default router;
