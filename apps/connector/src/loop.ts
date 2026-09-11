import type { Logger } from './logger.js';

/**
 * Runs `fn` every `intervalMs`, never overlapping itself. On failure it backs
 * off (up to 5 minutes) instead of hammering a data plane that is down,
 * and resumes the normal pace after the next success.
 */
export class Loop {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  private stopped = true;
  private failures = 0;
  lastSuccessAt: number | null = null;
  lastError: string | null = null;

  constructor(
    readonly name: string,
    private readonly intervalMs: number,
    private readonly fn: () => Promise<unknown>,
    private readonly log: Logger,
  ) {}

  start(initialDelayMs = 0): void {
    this.stopped = false;
    this.schedule(initialDelayMs);
  }

  private schedule(delay: number): void {
    if (this.stopped) return;
    this.timer = setTimeout(() => void this.run(), delay);
  }

  private async run(): Promise<void> {
    if (this.running || this.stopped) return;
    this.running = true;
    try {
      await this.fn();
      this.failures = 0;
      this.lastSuccessAt = Date.now();
      this.lastError = null;
      this.schedule(this.intervalMs);
    } catch (error) {
      this.failures++;
      this.lastError = (error as Error).message;
      const delay = Math.min(this.intervalMs * 2 ** Math.min(this.failures, 6), 5 * 60_000);
      this.log.error({ loop: this.name, failures: this.failures, retryInMs: delay, err: { name: (error as Error).name, message: (error as Error).message } }, 'loop iteration failed');
      this.schedule(delay);
    } finally {
      this.running = false;
    }
  }

  /** True when the loop has not succeeded for `factor` intervals (used by /healthz). */
  isStalled(now: number, startedAt: number, factor = 3): boolean {
    const reference = this.lastSuccessAt ?? startedAt;
    return now - reference > Math.max(this.intervalMs * factor, 60_000);
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}
