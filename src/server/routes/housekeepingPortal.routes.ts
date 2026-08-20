import { Router } from 'express';
import { authenticate, requirePermission } from '../middleware/auth';
import { hasSupabaseAdminConfig, supabaseAdmin } from '../supabaseAdmin';
import { cacheService } from '../services/cacheService';

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

// ── Lost & Found Workflow Enhancement with Photo Upload ───────────────
// Create lost & found item
router.post('/lost-found', authenticate, requirePermission('hk:lostfound:manage'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  
  const {
    propertyId,
    roomId,
    itemType,
    description,
    foundBy,
    photos,
    location,
    dateFound,
  } = req.body || {};
  
  if (!propertyId || !itemType || !foundBy) {
    return res.status(400).json({ error: 'propertyId, itemType, and foundBy are required' });
  }

  const { data, error } = await supabaseAdmin.from('lost_found_items').insert({
    property_id: propertyId,
    room_id: roomId,
    item_type: itemType,
    description,
    found_by: foundBy,
    photos,
    location,
    date_found: dateFound || new Date().toISOString(),
    status: 'found',
    created_at: new Date().toISOString(),
  }).select().single();

  if (error) return res.status(500).json({ error: error.message });

  cacheService.invalidate('hk-*');
  return res.status(201).json(data);
});

// Get lost & found items
router.get('/lost-found/:propertyId', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  
  const { status } = req.query as Record<string, string>;
  
  let q = supabaseAdmin
    .from('lost_found_items')
    .select('*, rooms(room_number), profiles(full_name)')
    .eq('property_id', req.params.propertyId)
    .order('date_found', { ascending: false });

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
  
  const { status, claimedBy, claimDate, notes } = req.body || {};

  const { data, error } = await supabaseAdmin
    .from('lost_found_items')
    .update({
      status,
      claimed_by: claimedBy,
      claim_date: claimDate,
      notes,
      updated_at: new Date().toISOString(),
    })
    .eq('id', req.params.id)
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });

  cacheService.invalidate('hk-*');
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
    grouped[type].push(t.actual_duration || t.estimated_duration || 30);
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

// ── Room Cleaning Jobs (docs/Housekeeping Portal new.md §7) ─────────────
// Backs the Room Cleaning module: standard cleaning checklist + service-type
// workflows for individual rooms. Persisted to housekeeping_cleaning_jobs.
const CLEANING_SERVICE_TYPES = new Set([
  'Full Service', 'Stayover Service', 'Express Service', 'Eco Service', 'Turndown Service',
]);
const CLEANING_JOB_STATUSES = new Set(['Pending', 'In Progress', 'Completed']);
const STANDARD_CLEANING_STEPS = [
  'Bed Making', 'Bathroom Cleaning', 'Vacuuming', 'Dusting',
  'Trash Removal', 'Surface Sanitization', 'Amenity Refill', 'Towel Replacement',
] as const;

function emptyCleaningChecklist(): Record<string, boolean> {
  return STANDARD_CLEANING_STEPS.reduce((acc, s) => ({ ...acc, [s]: false }), {} as Record<string, boolean>);
}

function normalizeChecklist(raw: any): Record<string, boolean> {
  const base = emptyCleaningChecklist();
  if (raw && typeof raw === 'object') {
    for (const key of Object.keys(base)) {
      if (typeof raw[key] === 'boolean') base[key] = raw[key];
    }
  }
  return base;
}

function checklistDoneCount(checklist: Record<string, boolean>): number {
  return STANDARD_CLEANING_STEPS.filter(s => checklist[s]).length;
}

function nowTimeLabel(): string {
  return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// Shape a DB row into the camelCase contract the frontend expects.
function shapeCleaningJob(row: any) {
  const checklist = normalizeChecklist(row.checklist);
  return {
    id: row.id,
    room: row.room_number,
    floor: String(row.floor),
    serviceType: row.service_type,
    attendantId: row.attendant_id || null,
    attendant: row.attendant_name || 'Unassigned',
    status: row.status,
    startedAt: row.started_at || undefined,
    completedAt: row.completed_at || undefined,
    checklist,
    notes: row.notes || undefined,
    propertyId: row.property_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// List cleaning jobs for a property (optional status / serviceType filters).
router.get('/room-cleaning/:propertyId', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const { status, serviceType } = req.query as Record<string, string>;

  const cacheKey = `hk-room-cleaning:${req.params.propertyId}:${status || 'all'}:${serviceType || 'all'}`;
  const cached = cacheService.get(cacheKey);
  if (cached) return res.json(cached);

  let q = supabaseAdmin
    .from('housekeeping_cleaning_jobs')
    .select('*')
    .eq('property_id', req.params.propertyId)
    .order('id', { ascending: true });

  if (status && CLEANING_JOB_STATUSES.has(status)) q = q.eq('status', status);
  if (serviceType && CLEANING_SERVICE_TYPES.has(serviceType)) q = q.eq('service_type', serviceType);

  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });

  const jobs = (data || []).map(shapeCleaningJob);
  const result = {
    propertyId: req.params.propertyId,
    jobs,
    summary: {
      total: jobs.length,
      pending: jobs.filter(j => j.status === 'Pending').length,
      inProgress: jobs.filter(j => j.status === 'In Progress').length,
      completed: jobs.filter(j => j.status === 'Completed').length,
    },
    generatedAt: new Date().toISOString(),
  };

  cacheService.set(cacheKey, result, 30 * 1000);
  return res.json(result);
});

// Housekeeping staff for the property — used by the attendant dropdown.
router.get('/room-cleaning/staff/:propertyId', authenticate, async (req, res) => {
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

// Create a new cleaning job.
router.post('/room-cleaning', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const { propertyId, roomNumber, floor, serviceType, attendantId, attendantName, notes } = req.body || {};
  if (!propertyId || !roomNumber || !serviceType) {
    return res.status(400).json({ error: 'propertyId, roomNumber, and serviceType are required' });
  }
  if (!CLEANING_SERVICE_TYPES.has(serviceType)) {
    return res.status(400).json({ error: `Invalid serviceType: ${serviceType}` });
  }

  // Generate a sequential id: RC-<unix-ms>
  const id = `RC-${Date.now()}`;
  const floorVal = floor != null ? Number(floor) : 1;

  const { data, error } = await supabaseAdmin
    .from('housekeeping_cleaning_jobs')
    .insert({
      id,
      property_id: propertyId,
      room_number: String(roomNumber),
      floor: floorVal,
      service_type: serviceType,
      attendant_id: attendantId || null,
      attendant_name: attendantName || null,
      status: 'Pending',
      checklist: emptyCleaningChecklist(),
      notes: notes || null,
    })
    .select('*')
    .single();

  if (error) return res.status(500).json({ error: error.message });

  cacheService.invalidatePattern('^hk-room-cleaning:');
  return res.status(201).json(shapeCleaningJob(data));
});

// Start a pending job (Pending → In Progress, stamp startedAt).
router.put('/room-cleaning/:id/start', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const { data, error } = await supabaseAdmin
    .from('housekeeping_cleaning_jobs')
    .update({ status: 'In Progress', started_at: nowTimeLabel() })
    .eq('id', req.params.id)
    .select('*')
    .single();

  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Cleaning job not found' });

  cacheService.invalidatePattern('^hk-room-cleaning:');
  return res.json(shapeCleaningJob(data));
});

// Toggle a single checklist step. Server is the source of truth: it reads the
// current checklist, flips the step, and derives the new status:
//   - all steps done  → Completed (stamp completedAt)
//   - any step done & was Pending → In Progress
router.put('/room-cleaning/:id/checklist', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const { step, value } = req.body || {};
  if (!step || !STANDARD_CLEANING_STEPS.includes(step)) {
    return res.status(400).json({ error: `Invalid step: ${step}` });
  }

  // Fetch current row to compute the next checklist atomically.
  const { data: current, error: fetchError } = await supabaseAdmin
    .from('housekeeping_cleaning_jobs')
    .select('*')
    .eq('id', req.params.id)
    .single();
  if (fetchError) return res.status(500).json({ error: fetchError.message });
  if (!current) return res.status(404).json({ error: 'Cleaning job not found' });

  const checklist = normalizeChecklist(current.checklist);
  const nextValue = typeof value === 'boolean' ? value : !checklist[step];
  checklist[step] = nextValue;

  const doneCount = checklistDoneCount(checklist);
  const allDone = doneCount === STANDARD_CLEANING_STEPS.length;

  const update: any = { checklist };
  if (allDone) {
    update.status = 'Completed';
    update.completed_at = nowTimeLabel();
  } else if (current.status === 'Pending' && doneCount > 0) {
    update.status = 'In Progress';
  } else if (!allDone && current.status === 'Completed') {
    // Reopened a completed job — clear the completed stamp and move back to In Progress.
    update.status = 'In Progress';
    update.completed_at = null;
  }

  const { data, error } = await supabaseAdmin
    .from('housekeeping_cleaning_jobs')
    .update(update)
    .eq('id', req.params.id)
    .select('*')
    .single();

  if (error) return res.status(500).json({ error: error.message });

  cacheService.invalidatePattern('^hk-room-cleaning:');
  return res.json(shapeCleaningJob(data));
});

// Mark every checklist step complete and set status to Completed.
router.put('/room-cleaning/:id/complete', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const fullChecklist = STANDARD_CLEANING_STEPS.reduce(
    (acc, s) => ({ ...acc, [s]: true }),
    {} as Record<string, boolean>
  );

  const update: any = { checklist: fullChecklist, status: 'Completed', completed_at: nowTimeLabel() };
  // Stamp started_at if the job was still Pending.
  const { data: current } = await supabaseAdmin
    .from('housekeeping_cleaning_jobs')
    .select('status, started_at')
    .eq('id', req.params.id)
    .single();
  if (current && current.status === 'Pending' && !current.started_at) {
    update.started_at = nowTimeLabel();
  }

  const { data, error } = await supabaseAdmin
    .from('housekeeping_cleaning_jobs')
    .update(update)
    .eq('id', req.params.id)
    .select('*')
    .single();

  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Cleaning job not found' });

  cacheService.invalidatePattern('^hk-room-cleaning:');
  return res.json(shapeCleaningJob(data));
});

// General update: reassign attendant, change service type, or edit notes.
router.put('/room-cleaning/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const { attendantId, attendantName, serviceType, notes } = req.body || {};
  const update: any = {};
  if (attendantId !== undefined) {
    update.attendant_id = attendantId || null;
    update.attendant_name = attendantName || null;
  }
  if (serviceType !== undefined) {
    if (!CLEANING_SERVICE_TYPES.has(serviceType)) {
      return res.status(400).json({ error: `Invalid serviceType: ${serviceType}` });
    }
    update.service_type = serviceType;
  }
  if (notes !== undefined) update.notes = notes || null;

  const { data, error } = await supabaseAdmin
    .from('housekeeping_cleaning_jobs')
    .update(update)
    .eq('id', req.params.id)
    .select('*')
    .single();

  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Cleaning job not found' });

  cacheService.invalidatePattern('^hk-room-cleaning:');
  return res.json(shapeCleaningJob(data));
});

// Delete a cleaning job.
router.delete('/room-cleaning/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const { error } = await supabaseAdmin
    .from('housekeeping_cleaning_jobs')
    .delete()
    .eq('id', req.params.id);

  if (error) return res.status(500).json({ error: error.message });

  cacheService.invalidatePattern('^hk-room-cleaning:');
  return res.json({ success: true, id: req.params.id });
});

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
    priority: row.priority,
    dueDate: row.due_date,
    status: row.status,
    progress: row.progress,
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

// List tasks for a property (optional status / category filters).
router.get('/task-management/:propertyId', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const { status, category } = req.query as Record<string, string>;

  const cacheKey = `hk-task-mgmt:${req.params.propertyId}:${status || 'all'}:${category || 'all'}`;
  const cached = cacheService.get(cacheKey);
  if (cached) return res.json(cached);

  let q = supabaseAdmin
    .from('housekeeping_task_mgmt')
    .select('*')
    .eq('property_id', req.params.propertyId)
    .order('due_date', { ascending: true });

  if (status && TASK_STATUSES.has(status)) q = q.eq('status', status);
  if (category && TASK_CATEGORIES.has(category)) q = q.eq('category', category);

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
    return {
      id: `TSK-${Date.now()}-${i + 1}`,
      property_id: propertyId,
      type,
      category: categoryForType(type),
      location: String(t.location).trim(),
      assigned_to: (t.assignedTo ?? assignedTo)?.trim() || null,
      priority: (t.priority && TASK_PRIORITIES.has(t.priority)) ? t.priority : sharedPriority,
      due_date: (t.dueDate ?? dueDate) || fallbackDue,
      status: 'Pending',
      progress: 0,
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
router.put('/task-management/:id/advance', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const { data: current, error: fetchError } = await supabaseAdmin
    .from('housekeeping_task_mgmt')
    .select('status, progress')
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
  }

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

// General update: reassign, change priority/dueDate/status/progress.
router.put('/task-management/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const { assignedTo, priority, dueDate, status, progress } = req.body || {};
  const update: any = {};
  if (assignedTo !== undefined) update.assigned_to = assignedTo?.trim() || null;
  if (priority !== undefined) {
    if (!TASK_PRIORITIES.has(priority)) return res.status(400).json({ error: `Invalid priority: ${priority}` });
    update.priority = priority;
  }
  if (dueDate !== undefined) update.due_date = dueDate;
  if (status !== undefined) {
    if (!TASK_STATUSES.has(status)) return res.status(400).json({ error: `Invalid status: ${status}` });
    update.status = status;
    if (status === 'Completed' || status === 'Verified') update.progress = 100;
  }
  if (progress !== undefined) {
    const p = Number(progress);
    if (Number.isNaN(p) || p < 0 || p > 100) return res.status(400).json({ error: 'progress must be 0–100' });
    update.progress = p;
  }

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

export default router;
