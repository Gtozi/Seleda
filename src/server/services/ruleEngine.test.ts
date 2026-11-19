import { describe, it, expect } from 'vitest';
import { evaluateCondition, resolveEffects, validateAction, evaluateRuleSet, parseCondition } from './ruleEngine';

const ctx = { booking: { nights: 8, channel: 'Direct', total: 1200 }, user: { role: 'manager' }, tags: ['vip', 'corp'] };

describe('ruleEngine conditions', () => {
  it('compares numbers and strings case-insensitively', () => {
    expect(evaluateCondition('booking.nights >= 7', ctx)).toBe(true);
    expect(evaluateCondition('booking.nights < 7', ctx)).toBe(false);
    expect(evaluateCondition("booking.channel == 'direct'", ctx)).toBe(true);
  });
  it('supports boolean logic, precedence and parentheses', () => {
    expect(evaluateCondition('booking.nights > 10 || booking.total > 1000 && user.role == "manager"', ctx)).toBe(true);
    expect(evaluateCondition('(booking.nights > 10 || booking.total > 5000) and user.role == "manager"', ctx)).toBe(false);
    expect(evaluateCondition('not booking.missing', ctx)).toBe(true);
  });
  it('supports in / contains', () => {
    expect(evaluateCondition("user.role in ['manager', 'gm']", ctx)).toBe(true);
    expect(evaluateCondition("tags contains 'vip'", ctx)).toBe(true);
    expect(evaluateCondition("tags contains 'staff'", ctx)).toBe(false);
  });
  it('treats missing values as non-matching for ordering comparisons', () => {
    expect(evaluateCondition('booking.deposit > 0', ctx)).toBe(false);
  });
  it('rejects code-like input instead of executing it', () => {
    expect(() => parseCondition('process.exit(1)')).toThrow();
    expect(() => parseCondition('a == 1; drop')).toThrow();
    expect(() => parseCondition('')).toThrow();
    expect(evaluateCondition('constructor.name == "x"', ctx)).toBe(false);
  });
});

describe('ruleEngine actions', () => {
  it('resolves args from literals and context', () => {
    expect(resolveEffects('apply_discount(10); notify("long_stay")', ctx)).toEqual([
      { name: 'apply_discount', args: [10] },
      { name: 'notify', args: ['long_stay'] },
    ]);
    expect(resolveEffects('set("total", booking.total)', ctx)).toEqual([{ name: 'set', args: ['total', 1200] }]);
  });
  it('validates names and arity', () => {
    expect(() => validateAction('rm_rf("/")')).toThrow(/Unknown action/);
    expect(() => validateAction('apply_discount()')).toThrow(/expects/);
    expect(() => validateAction('block("x") block("y")')).toThrow();
  });
});

describe('evaluateRuleSet', () => {
  const rules = [
    { id: '2', name: 'Big order approval', category: 'procurement', priority: 20, conditionExpr: 'amount > 1000', actionExpr: 'require_approval("gm")', active: true },
    { id: '1', name: 'Block blacklist', category: 'procurement', priority: 10, conditionExpr: "supplier.status == 'blocked'", actionExpr: 'block("Supplier blocked")', active: true },
    { id: '3', name: 'Inactive', category: 'procurement', priority: 1, conditionExpr: 'true', actionExpr: 'block("never")', active: false },
    { id: '4', name: 'Broken', category: 'procurement', priority: 30, conditionExpr: 'amount >>', actionExpr: 'flag("x")', active: true },
  ];
  it('orders by priority, skips inactive, collects effects and isolates errors', () => {
    const r = evaluateRuleSet(rules, { amount: 5000, supplier: { status: 'blocked' } });
    expect(r.matched.map(m => m.id)).toEqual(['1', '2']);
    expect(r.blocked).toEqual(['Supplier blocked']);
    expect(r.approvalRoles).toEqual(['gm']);
    expect(r.errors).toHaveLength(1);
  });
});
