import { hasSupabaseAdminConfig, supabaseAdmin } from '../supabaseAdmin';
import { evaluateCondition, parseCondition } from './ruleEngine';

/**
 * Runtime for admin_workflows definitions (migration 657) with state in
 * admin_workflow_instances (migration 658).
 *
 * Step shape (stored in admin_workflows.steps):
 *   { "name": "Manager review", "type": "approval" | "task" | "notify", "role": "manager",
 *     "condition": "amount > 500",              // optional: step is skipped when false
 *     "message": "PO {{entityId}} needs review" // notify only
 *   }
 * approval/task steps pause the instance until someone with `role` completes them.
 * notify steps write to the staff `notifications` table and continue.
 */

export type StepType = 'approval' | 'task' | 'notify';
export interface WorkflowStep { name: string; type: StepType; role?: string; condition?: string; message?: string }

export function validateSteps(steps: unknown): string | null {
  if (!Array.isArray(steps)) return 'Steps must be a JSON array';
  for (const [i, s] of steps.entries()) {
    const n = `Step ${i + 1}`;
    if (!s || typeof s !== 'object') return `${n} must be an object`;
    if (!s.name || typeof s.name !== 'string') return `${n} needs a "name"`;
    if (!['approval', 'task', 'notify'].includes(s.type)) return `${n} "type" must be approval, task or notify`;
    if ((s.type === 'approval' || s.type === 'task') && !s.role) return `${n} needs a "role"`;
    if (s.condition) { try { parseCondition(s.condition); } catch (e: any) { return `${n} condition: ${e.message}`; } }
  }
  return null;
}

export type Instance = {
  id: string; workflow_name: string; entity_type: string; entity_id: string; property_id: string | null;
  context: Record<string, any>; steps: WorkflowStep[]; current_step: number; status: string; history: any[];
};

const render = (text: string, vars: Record<string, any>) => text.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, k) => String(vars[k] ?? ''));

async function notify(inst: Instance, step: WorkflowStep) {
  if (!inst.property_id) return;
  await supabaseAdmin!.from('notifications').insert({
    id: crypto.randomUUID(),
    property_id: inst.property_id,
    message: render(step.message || `${inst.workflow_name}: ${step.name}`, { ...inst.context, entityId: inst.entity_id, entityType: inst.entity_type }),
    type: 'info', department: 'Workflow', read: false, created_at: new Date().toISOString(),
  });
}

/** Walk forward from current_step: skip steps whose condition is false, run notifies, stop at the next approval/task or finish. */
async function run(inst: Instance): Promise<Instance> {
  const history = [...inst.history];
  let idx = inst.current_step;
  let assignedRole: string | null = null;
  while (idx < inst.steps.length) {
    const step = inst.steps[idx];
    const ctx = { ...inst.context, entityId: inst.entity_id, entityType: inst.entity_type };
    let applies = true;
    try { applies = !step.condition || evaluateCondition(step.condition, ctx); } catch { applies = false; }
    if (!applies) { history.push({ at: new Date().toISOString(), step: idx, name: step.name, action: 'skipped' }); idx++; continue; }
    if (step.type === 'notify') {
      try { await notify(inst, step); } catch (e: any) { console.warn('[workflow] notify failed:', e?.message); }
      history.push({ at: new Date().toISOString(), step: idx, name: step.name, action: 'notified' });
      idx++; continue;
    }
    assignedRole = String(step.role).toLowerCase();
    break;
  }
  const status = assignedRole ? 'pending' : 'completed';
  const now = new Date().toISOString();
  const { data, error } = await supabaseAdmin!.from('admin_workflow_instances')
    .update({ current_step: idx, assigned_role: assignedRole, status, history, updated_at: now, completed_at: status === 'completed' ? now : null })
    .eq('id', inst.id).select().single();
  if (error) throw error;
  return data as Instance;
}

/** Start every active workflow whose trigger_event matches. Never throws into the caller's request. */
export async function startWorkflows(event: string, input: { entityType: string; entityId: string; context?: Record<string, any>; propertyId?: string | null; userId?: string | null }): Promise<string[]> {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return [];
  try {
    const { data: defs, error } = await supabaseAdmin.from('admin_workflows').select('*').eq('status', 'active').eq('trigger_event', event);
    if (error) throw error;
    const started: string[] = [];
    // A resubmission supersedes earlier rejections so they stop blocking the entity.
    if (defs?.length) {
      await supabaseAdmin.from('admin_workflow_instances').update({ status: 'cancelled', updated_at: new Date().toISOString() }).eq('entity_type', input.entityType).eq('entity_id', String(input.entityId)).eq('status', 'rejected');
    }
    for (const def of defs || []) {
      if (def.property_id && def.property_id !== input.propertyId) continue;
      if (validateSteps(def.steps)) continue;
      const { data: existing } = await supabaseAdmin.from('admin_workflow_instances').select('id').eq('workflow_id', def.id).eq('entity_id', String(input.entityId)).eq('status', 'pending').maybeSingle();
      if (existing) continue;
      const { data: inst, error: insErr } = await supabaseAdmin.from('admin_workflow_instances').insert({
        workflow_id: def.id, workflow_name: def.name, workflow_version: def.version, entity_type: input.entityType, entity_id: String(input.entityId),
        trigger_event: event, property_id: input.propertyId ?? null, context: input.context || {}, steps: def.steps, started_by: input.userId ?? null,
        history: [{ at: new Date().toISOString(), action: 'started', by: input.userId ?? null }],
      }).select().single();
      if (insErr) throw insErr;
      await run(inst as Instance);
      started.push(inst.id);
    }
    return started;
  } catch (e: any) {
    console.warn(`[workflow] startWorkflows(${event}) failed:`, e?.message);
    return [];
  }
}

export interface Actor { id?: string; role?: string }

/** Complete or reject the current approval/task step. */
export async function advanceWorkflow(instanceId: string, decision: 'approve' | 'reject', actor: Actor, comment?: string): Promise<{ error?: string; status?: number; instance?: Instance }> {
  if (!supabaseAdmin) return { error: 'Database not configured', status: 503 };
  const { data: inst } = await supabaseAdmin.from('admin_workflow_instances').select('*').eq('id', instanceId).maybeSingle();
  if (!inst) return { error: 'Workflow instance not found', status: 404 };
  if (inst.status !== 'pending') return { error: `Workflow is already ${inst.status}`, status: 409 };
  const role = String(actor.role || '').toLowerCase();
  if (role !== 'executive' && role !== 'system_admin' && role !== inst.assigned_role) {
    return { error: `This step is assigned to role "${inst.assigned_role}"`, status: 403 };
  }
  const step = (inst.steps as WorkflowStep[])[inst.current_step];
  const history = [...(inst.history || []), { at: new Date().toISOString(), step: inst.current_step, name: step?.name, action: decision === 'approve' ? 'approved' : 'rejected', by: actor.id ?? null, comment: comment ?? null }];
  if (decision === 'reject') {
    const now = new Date().toISOString();
    const { data, error } = await supabaseAdmin.from('admin_workflow_instances').update({ status: 'rejected', history, updated_at: now, completed_at: now }).eq('id', instanceId).select().single();
    if (error) return { error: error.message, status: 500 };
    return { instance: data as Instance };
  }
  try { return { instance: await run({ ...(inst as Instance), current_step: inst.current_step + 1, history }) }; } catch (e: any) { return { error: e.message, status: 500 }; }
}

/** Returns a blocking message if the entity has a pending or rejected workflow, otherwise null. */
export async function workflowBlocker(entityType: string, entityId: string): Promise<string | null> {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return null;
  const { data } = await supabaseAdmin.from('admin_workflow_instances').select('workflow_name, status, assigned_role').eq('entity_type', entityType).eq('entity_id', String(entityId)).in('status', ['pending', 'rejected']);
  const hit = (data || []).find((r: any) => r.status === 'rejected') || (data || [])[0];
  if (!hit) return null;
  return hit.status === 'rejected' ? `Workflow "${hit.workflow_name}" was rejected` : `Workflow "${hit.workflow_name}" is waiting for ${hit.assigned_role}`;
}
