export interface BackoffOptions {
  baseMs: number;
  maxMs: number;
  /** Fraction of the delay to randomise, e.g. 0.2 → ±20 %. */
  jitter?: number;
  random?: () => number;
}

/**
 * Exponential backoff with jitter. `attempt` is 1-based: attempt 1 → ~baseMs,
 * attempt 2 → ~2×baseMs, … capped at maxMs (before jitter, and after).
 */
export function computeBackoffMs(attempt: number, opts: BackoffOptions): number {
  const n = Math.max(1, Math.floor(attempt));
  const exp = Math.min(opts.maxMs, opts.baseMs * 2 ** Math.min(n - 1, 30));
  const jitter = opts.jitter ?? 0.2;
  const random = opts.random ?? Math.random;
  const factor = 1 + (random() * 2 - 1) * jitter;
  return Math.max(0, Math.min(opts.maxMs, Math.round(exp * factor)));
}
