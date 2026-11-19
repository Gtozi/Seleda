import { describe, it, expect, vi } from 'vitest';
import { rateLimit } from './rateLimit';

function run(mw: any, key = 'k1') {
  const req: any = { ip: key };
  const res: any = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
    setHeader: vi.fn(),
  };
  const next = vi.fn();
  mw(req, res, next);
  return { res, next };
}

describe('rateLimit', () => {
  it('allows up to max requests per key within the window', () => {
    const mw = rateLimit({ windowMs: 60_000, max: 3 });
    expect(run(mw).next).toHaveBeenCalled();
    expect(run(mw).next).toHaveBeenCalled();
    expect(run(mw).next).toHaveBeenCalled();
    const { res, next } = run(mw);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(429);
  });

  it('tracks keys independently', () => {
    const mw = rateLimit({ windowMs: 60_000, max: 1 });
    expect(run(mw, 'a').next).toHaveBeenCalled();
    expect(run(mw, 'b').next).toHaveBeenCalled();
    expect(run(mw, 'a').next).not.toHaveBeenCalled();
  });

  it('expires entries after the window', () => {
    vi.useFakeTimers();
    try {
      const mw = rateLimit({ windowMs: 1_000, max: 1 });
      expect(run(mw).next).toHaveBeenCalled();
      expect(run(mw).next).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1_001);
      expect(run(mw).next).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('sets Retry-After when limited', () => {
    const mw = rateLimit({ windowMs: 30_000, max: 1 });
    run(mw);
    const { res } = run(mw);
    expect(res.setHeader).toHaveBeenCalledWith('Retry-After', 30);
  });
});
