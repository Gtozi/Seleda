import { Request, Response, NextFunction } from 'express';

/**
 * Lightweight in-memory sliding-window rate limiter.
 *
 * No external dependency — process-local state is sufficient for the single
 * node deployment this server targets. For multi-instance deployments swap
 * the Map for a shared store (Redis/Postgres) without changing call sites.
 */
export function rateLimit(opts: {
  windowMs: number;
  max: number;
  key?: (req: Request) => string;
  message?: string;
}) {
  const { windowMs, max } = opts;
  const keyFn = opts.key || ((req: Request) => req.ip || req.socket.remoteAddress || 'unknown');
  const message = opts.message || 'Too many requests — please try again later';
  const hits = new Map<string, number[]>();

  const sweep = setInterval(() => {
    const now = Date.now();
    for (const [key, stamps] of hits) {
      const kept = stamps.filter(t => now - t < windowMs);
      if (kept.length) hits.set(key, kept);
      else hits.delete(key);
    }
  }, windowMs);
  // Don't keep the process alive just for the sweeper.
  sweep.unref?.();

  return (req: Request, res: Response, next: NextFunction) => {
    const now = Date.now();
    const key = keyFn(req);
    const stamps = (hits.get(key) || []).filter(t => now - t < windowMs);
    if (stamps.length >= max) {
      res.setHeader('Retry-After', Math.ceil(windowMs / 1000));
      return res.status(429).json({ error: message });
    }
    stamps.push(now);
    hits.set(key, stamps);
    next();
  };
}
