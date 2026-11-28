/**
 * Safe expression engine for admin business rules and workflow conditions.
 * Hand-written tokenizer + recursive-descent parser; nothing is ever passed to eval/Function.
 *
 * Condition grammar
 *   expr    := or
 *   or      := and ( ('||' | 'or') and )*
 *   and     := not ( ('&&' | 'and') not )*
 *   not     := ('!' | 'not') not | cmp
 *   cmp     := primary ( ('==' | '!=' | '>' | '>=' | '<' | '<=' | 'in' | 'contains' | 'startswith') primary )?
 *   primary := number | 'string' | true | false | null | path | [ list ] | ( expr )
 *   path    := identifier ( '.' identifier )*          e.g. booking.nights, user.role
 *
 * Action grammar:  name(arg, ...) ; name(arg, ...)
 *   Allowed names: see ACTIONS. Args are literals or context paths.
 */

export type Ctx = Record<string, any>;

type Tok = { t: 'num' | 'str' | 'id' | 'op' | 'punc'; v: string };

const OPS = ['==', '!=', '>=', '<=', '&&', '||', '>', '<', '!'];
const WORD_OPS = new Set(['and', 'or', 'not', 'in', 'contains', 'startswith']);

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) { i++; continue; }
    if (/[0-9]/.test(c) || (c === '-' && /[0-9]/.test(src[i + 1] || '') && (!out.length || out[out.length - 1].t === 'op' || out[out.length - 1].v === '(' || out[out.length - 1].v === ',' || out[out.length - 1].v === '['))) {
      let j = i + 1;
      while (j < src.length && /[0-9.]/.test(src[j])) j++;
      out.push({ t: 'num', v: src.slice(i, j) });
      i = j; continue;
    }
    if (c === '"' || c === "'") {
      let j = i + 1;
      let s = '';
      while (j < src.length && src[j] !== c) {
        if (src[j] === '\\' && j + 1 < src.length) j++;
        s += src[j++];
      }
      if (src[j] !== c) throw new Error('Unterminated string');
      out.push({ t: 'str', v: s });
      i = j + 1; continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      let j = i + 1;
      while (j < src.length && /[A-Za-z0-9_.]/.test(src[j])) j++;
      const word = src.slice(i, j);
      out.push({ t: WORD_OPS.has(word.toLowerCase()) ? 'op' : 'id', v: WORD_OPS.has(word.toLowerCase()) ? word.toLowerCase() : word });
      i = j; continue;
    }
    const op = OPS.find(o => src.startsWith(o, i));
    if (op) { out.push({ t: 'op', v: op }); i += op.length; continue; }
    if ('()[],;'.includes(c)) { out.push({ t: 'punc', v: c }); i++; continue; }
    throw new Error(`Unexpected character "${c}"`);
  }
  return out;
}

type Node =
  | { k: 'lit'; v: any }
  | { k: 'path'; v: string }
  | { k: 'list'; v: Node[] }
  | { k: 'not'; v: Node }
  | { k: 'bin'; op: string; l: Node; r: Node };

class Parser {
  private p = 0;
  constructor(private toks: Tok[]) {}
  private peek() { return this.toks[this.p]; }
  private next() { return this.toks[this.p++]; }
  private isOp(...ops: string[]) { const t = this.peek(); return !!t && t.t === 'op' && ops.includes(t.v); }
  private isPunc(v: string) { const t = this.peek(); return !!t && t.t === 'punc' && t.v === v; }

  parseAll(): Node {
    const n = this.or();
    if (this.p < this.toks.length) throw new Error(`Unexpected "${this.peek().v}"`);
    return n;
  }
  or(): Node { let l = this.and(); while (this.isOp('||', 'or')) { this.next(); l = { k: 'bin', op: '||', l, r: this.and() }; } return l; }
  and(): Node { let l = this.not(); while (this.isOp('&&', 'and')) { this.next(); l = { k: 'bin', op: '&&', l, r: this.not() }; } return l; }
  not(): Node { if (this.isOp('!', 'not')) { this.next(); return { k: 'not', v: this.not() }; } return this.cmp(); }
  cmp(): Node {
    const l = this.primary();
    if (this.isOp('==', '!=', '>', '>=', '<', '<=', 'in', 'contains', 'startswith')) {
      const op = this.next().v;
      return { k: 'bin', op, l, r: this.primary() };
    }
    return l;
  }
  primary(): Node {
    const t = this.next();
    if (!t) throw new Error('Unexpected end of expression');
    if (t.t === 'num') return { k: 'lit', v: Number(t.v) };
    if (t.t === 'str') return { k: 'lit', v: t.v };
    if (t.t === 'id') {
      if (t.v === 'true') return { k: 'lit', v: true };
      if (t.v === 'false') return { k: 'lit', v: false };
      if (t.v === 'null') return { k: 'lit', v: null };
      return { k: 'path', v: t.v };
    }
    if (t.t === 'punc' && t.v === '(') { const n = this.or(); this.expect(')'); return n; }
    if (t.t === 'punc' && t.v === '[') {
      const items: Node[] = [];
      while (!this.isPunc(']')) {
        items.push(this.primary());
        if (this.isPunc(',')) this.next(); else break;
      }
      this.expect(']');
      return { k: 'list', v: items };
    }
    throw new Error(`Unexpected "${t.v}"`);
  }
  expect(v: string) { const t = this.next(); if (!t || t.v !== v) throw new Error(`Expected "${v}"`); }
}

const getPath = (ctx: Ctx, path: string) => {
  let cur: any = ctx;
  for (const key of path.split('.')) {
    if (cur === null || cur === undefined || typeof cur !== 'object' || key === '__proto__' || key === 'constructor' || key === 'prototype') return undefined;
    cur = cur[key];
  }
  return cur;
};

const norm = (v: any) => (typeof v === 'string' ? v.toLowerCase() : v);

function evalNode(n: Node, ctx: Ctx): any {
  switch (n.k) {
    case 'lit': return n.v;
    case 'path': return getPath(ctx, n.v);
    case 'list': return n.v.map(x => evalNode(x, ctx));
    case 'not': return !evalNode(n.v, ctx);
    case 'bin': {
      if (n.op === '&&') return !!evalNode(n.l, ctx) && !!evalNode(n.r, ctx);
      if (n.op === '||') return !!evalNode(n.l, ctx) || !!evalNode(n.r, ctx);
      const l = evalNode(n.l, ctx);
      const r = evalNode(n.r, ctx);
      switch (n.op) {
        case '==': return norm(l) === norm(r);
        case '!=': return norm(l) !== norm(r);
        case '>': case '>=': case '<': case '<=': {
          if (l === undefined || l === null || r === undefined || r === null) return false;
          const a = typeof l === 'number' || typeof r === 'number' ? Number(l) : l;
          const b = typeof l === 'number' || typeof r === 'number' ? Number(r) : r;
          if (n.op === '>') return a > b;
          if (n.op === '>=') return a >= b;
          if (n.op === '<') return a < b;
          return a <= b;
        }
        case 'in': return Array.isArray(r) ? r.map(norm).includes(norm(l)) : false;
        case 'contains':
          if (Array.isArray(l)) return l.map(norm).includes(norm(r));
          return typeof l === 'string' && typeof r === 'string' && l.toLowerCase().includes(r.toLowerCase());
        case 'startswith': return typeof l === 'string' && typeof r === 'string' && l.toLowerCase().startsWith(r.toLowerCase());
      }
    }
  }
  return false;
}

/** Throws with a readable message if the condition is not valid. */
export function parseCondition(src: string): Node {
  if (!src || !src.trim()) throw new Error('Condition is empty');
  return new Parser(tokenize(src)).parseAll();
}

export function evaluateCondition(src: string, ctx: Ctx): boolean {
  return !!evalNode(parseCondition(src), ctx);
}

// ── Actions ────────────────────────────────────────────────────

/** Whitelisted governance/control actions. Pricing & discounts are managed in Revenue Management. */
export const ACTIONS: Record<string, { min: number; max: number }> = {
  block: { min: 1, max: 1 },             // block("message")
  require_approval: { min: 1, max: 1 },  // require_approval("role")
  set: { min: 2, max: 2 },               // set("field", value)
  notify: { min: 1, max: 1 },            // notify("template_code")
  flag: { min: 1, max: 1 },              // flag("reason")
};

export interface Effect { name: string; args: any[] }

function parseActionCalls(src: string): { name: string; args: Node[] }[] {
  if (!src || !src.trim()) throw new Error('Action is empty');
  const toks = tokenize(src);
  const calls: { name: string; args: Node[] }[] = [];
  let p = 0;
  while (p < toks.length) {
    const nameTok = toks[p++];
    if (!nameTok || nameTok.t !== 'id') throw new Error('Expected an action name');
    const spec = ACTIONS[nameTok.v];
    if (!spec) throw new Error(`Unknown action "${nameTok.v}". Allowed: ${Object.keys(ACTIONS).join(', ')}`);
    if (!toks[p] || toks[p].v !== '(') throw new Error(`Expected "(" after ${nameTok.v}`);
    p++;
    const args: Node[] = [];
    // collect tokens up to the matching ')'
    let depth = 1;
    const start = p;
    const argToks: Tok[][] = [[]];
    while (p < toks.length) {
      const t = toks[p];
      if (t.t === 'punc' && (t.v === '(' || t.v === '[')) depth++;
      if (t.t === 'punc' && (t.v === ')' || t.v === ']')) { depth--; if (depth === 0) break; }
      if (t.t === 'punc' && t.v === ',' && depth === 1) argToks.push([]); else argToks[argToks.length - 1].push(t);
      p++;
    }
    if (depth !== 0) throw new Error(`Missing ")" in ${nameTok.v}`);
    void start;
    p++; // ')'
    if (!(argToks.length === 1 && argToks[0].length === 0)) for (const at of argToks) args.push(new Parser(at).parseAll());
    if (args.length < spec.min || args.length > spec.max) throw new Error(`${nameTok.v} expects ${spec.min === spec.max ? spec.min : `${spec.min}-${spec.max}`} argument(s)`);
    calls.push({ name: nameTok.v, args });
    if (p < toks.length) { if (toks[p].v !== ';') throw new Error('Separate actions with ";"'); p++; }
  }
  return calls;
}

export function validateAction(src: string): void { parseActionCalls(src); }

export function resolveEffects(src: string, ctx: Ctx): Effect[] {
  return parseActionCalls(src).map(c => ({ name: c.name, args: c.args.map(a => evalNode(a, ctx)) }));
}

// ── Rule set evaluation ────────────────────────────────────────

export interface RuleRow { id: string; name: string; category: string; priority: number; conditionExpr: string; actionExpr: string; active: boolean }

export interface RuleEvaluation {
  matched: { id: string; name: string; effects: Effect[] }[];
  effects: Effect[];
  blocked: string[];
  approvalRoles: string[];
  errors: { id: string; name: string; error: string }[];
}

export function evaluateRuleSet(rules: RuleRow[], ctx: Ctx): RuleEvaluation {
  const result: RuleEvaluation = { matched: [], effects: [], blocked: [], approvalRoles: [], errors: [] };
  for (const r of [...rules].filter(r => r.active).sort((a, b) => a.priority - b.priority)) {
    try {
      if (!evaluateCondition(r.conditionExpr, ctx)) continue;
      const effects = resolveEffects(r.actionExpr, ctx);
      result.matched.push({ id: r.id, name: r.name, effects });
      for (const e of effects) {
        result.effects.push(e);
        if (e.name === 'block') result.blocked.push(String(e.args[0]));
        if (e.name === 'require_approval') result.approvalRoles.push(String(e.args[0]).toLowerCase());
      }
    } catch (err: any) {
      result.errors.push({ id: r.id, name: r.name, error: err?.message || 'Rule failed' });
    }
  }
  return result;
}
