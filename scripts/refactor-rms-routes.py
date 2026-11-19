#!/usr/bin/env python3
"""One-shot refactor for rmsPortal.routes.ts (audit item 4.1).

- Consolidates all per-section *_WRITE_ROLES constants into RMS_WRITE_ROLES.
- Collapses canonical scoped PUT/DELETE handlers into updateScoped()/deleteScoped()
  factory calls (factories are inserted by this script near the top helpers).

Only handler bodies matching the exact canonical shapes are rewritten; anything
with extra logic (parent-scope checks, credential merging, custom responses)
is left untouched.
"""
import re
import sys

PATH = 'src/server/routes/rmsPortal.routes.ts'
src = open(PATH, encoding='utf-8').read()
orig_len = len(src.splitlines())

# ── 1. Insert shared factories after withPropOrGlobal ───────────────────────
FACTORIES = """
// ── Shared scoped-CRUD factories ──────────────────────────────────────────
// Collapses the repeated "filter allowed fields -> update/delete by id, scoped
// by property" boilerplate used by ~50 handlers below. `fields` is the body
// allowlist; `notFound` is the 404 message when the (property-scoped) row
// doesn't exist.
const pickUpdates = (body: any, fields: string[]): Record<string, any> => {
  const updates: Record<string, any> = {};
  for (const k of fields) if (body?.[k] !== undefined) updates[k] = body[k];
  return updates;
};

const updateScoped = (table: string, fields: string[], notFound = 'Record not found') =>
  async (req: any, res: any) => {
    if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
    const propertyId = propBody(req);
    const updates = pickUpdates(req.body, fields);
    if (Object.keys(updates).length === 0) return res.status(400).json({ error: 'no fields' });
    const q = supabaseAdmin.from(table).update(updates).eq('id', req.params.id);
    const { data, error } = await (propertyId ? q.eq('property_id', propertyId) : q).select().single();
    if (error) return res.status(500).json({ error: error.message });
    if (!data) return res.status(404).json({ error: notFound });
    res.json({ success: true, data });
  };

const deleteScoped = (table: string) =>
  async (req: any, res: any) => {
    if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
    const propertyId = propBody(req);
    const q = supabaseAdmin.from(table).delete().eq('id', req.params.id);
    const { error } = await (propertyId ? q.eq('property_id', propertyId) : q);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true });
  };
"""

anchor = "const withPropOrGlobal = (q: any, propertyId: string | undefined) =>\n  propertyId ? q.or(`property_id.eq.${propertyId},property_id.is.null`) : q;\n"
assert anchor in src, 'anchor not found'
src = src.replace(anchor, anchor + FACTORIES, 1)

# ── 2. Consolidate role constants ───────────────────────────────────────────
src, n_roles = re.subn(r'requireRole\(\.\.\.\w+_WRITE_ROLES\)', 'requireRole(...RMS_WRITE_ROLES)', src)
# Remove now-unused duplicate constants (keep RMS_WRITE_ROLES).
src, n_consts = re.subn(r'\nconst (?!RMS_WRITE_ROLES)\w+_WRITE_ROLES = \[\'revenue_manager\'[^\n]*\];\n', '\n', src)
print(f'role refs rewritten: {n_roles}, duplicate consts removed: {n_consts}')

# ── 3. Canonical PUT bodies -> updateScoped ─────────────────────────────────
PUT_BODY = re.compile(
    r"async \(req, res\) => \{\n"
    r"  if \(!hasSupabaseAdminConfig \|\| !supabaseAdmin\) return dbNotConfigured\(res\);\n"
    r"(?:  const \{ id \} = req\.params;\n)?"
    r"(?:  const b = req\.body \|\| \{\};\n)?"
    r"  const propertyId = propBody\(req\);\n"
    r"  const updates: Record<string, any> = \{\};\n"
    r"(?:  (\[[^\]]+\])\.forEach\(k => \{ if \(req\.body\?\.\[k\] !== undefined\) updates\[k\] = req\.body\[k\]; \}\);\n"
    r"|  for \(const k of (\[[^\]]+\])\) \{\n    if \(b\[k\] !== undefined\) updates\[k\] = b\[k\];\n  \}\n)"
    r"(?:  if \(Object\.keys\(updates\)\.length === 0\) return res\.status\(400\)\.json\(\{ error: 'no fields' \}\);\n)?"
    r"  const q = supabaseAdmin\.from\('([^']+)'\)\.update\(updates\)\.eq\('id', (?:req\.params\.id|id)\);\n"
    r"  const \{ data, error \} = await \(propertyId \? q\.eq\('property_id', propertyId\) : q\)\.select\(\)\.single\(\);\n"
    r"  if \(error\) return res\.status\(500\)\.json\(\{ error: error\.message \}\);\n"
    r"  if \(!data\) return res\.status\(404\)\.json\(\{ error: '([^']+)' \}\);\n"
    r"  res\.json\(\{ success: true, data \}\);\n"
    r"\}\)"
)

def put_repl(m):
    fields = m.group(1) or m.group(2)
    table, msg = m.group(3), m.group(4)
    return f"updateScoped('{table}', {fields}, '{msg}')"

src, n_puts = PUT_BODY.subn(put_repl, src)
print(f'PUT handlers collapsed: {n_puts}')

# ── 4. Canonical DELETE bodies -> deleteScoped ──────────────────────────────
DEL_BODY = re.compile(
    r"async \(req, res\) => \{\n"
    r"  if \(!hasSupabaseAdminConfig \|\| !supabaseAdmin\) return dbNotConfigured\(res\);\n"
    r"(?:  const \{ id \} = req\.params;\n)?"
    r"  const propertyId = propBody\(req\);\n"
    r"  const q = supabaseAdmin\.from\('([^']+)'\)\.delete\(\)\.eq\('id', (?:req\.params\.id|id)\);\n"
    r"  const \{ error \} = await \(propertyId \? q\.eq\('property_id', propertyId\) : q\);\n"
    r"  if \(error\) return res\.status\(500\)\.json\(\{ error: error\.message \}\);\n"
    r"  res\.json\(\{ success: true \}\);\n"
    r"\}\)"
)

def del_repl(m):
    return f"deleteScoped('{m.group(1)}')"

src, n_dels = DEL_BODY.subn(del_repl, src)
print(f'DELETE handlers collapsed: {n_dels}')

# Unscoped competitor delete -> scoped factory (competitors are property-scoped
# since migration 572; the unscoped delete was an oversight).
UNSCOPED_DEL = re.compile(
    r"async \(req, res\) => \{\n"
    r"  if \(!hasSupabaseAdminConfig \|\| !supabaseAdmin\) return dbNotConfigured\(res\);\n"
    r"  const \{ id \} = req\.params;\n"
    r"  const \{ error \} = await supabaseAdmin\.from\('([^']+)'\)\.delete\(\)\.eq\('id', id\);\n"
    r"  if \(error\) return res\.status\(500\)\.json\(\{ error: error\.message \}\);\n"
    r"  res\.json\(\{ success: true \}\);\n"
    r"\}\)"
)
src, n_unscoped = UNSCOPED_DEL.subn(lambda m: f"deleteScoped('{m.group(1)}')", src)
print(f'unscoped DELETEs converted: {n_unscoped}')

open(PATH, 'w', encoding='utf-8', newline='\n').write(src)
new_len = len(src.splitlines())
print(f'{orig_len} -> {new_len} lines ({orig_len - new_len} removed)')
