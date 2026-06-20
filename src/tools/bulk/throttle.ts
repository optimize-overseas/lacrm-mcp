/**
 * A single-queue sequential rate limiter.
 *
 * Every task submitted via {@link SequentialThrottle.run} executes one-at-a-time, in
 * submission order, with at least `minIntervalMs` between the start of consecutive
 * tasks. This is how the bulk worker honors LACRM's 1-request/second agreement
 * (technical-support agreement, 2017): a single queued client, no parallelism.
 *
 * The clock is injectable so timing is deterministic under test.
 *
 * @module tools/bulk/throttle
 */

export interface ThrottleClock {
  now(): number;
  sleep(ms: number): Promise<void>;
}

const realClock: ThrottleClock = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

export class SequentialThrottle {
  private chain: Promise<unknown> = Promise.resolve();
  private last = -Infinity;

  constructor(private readonly minIntervalMs: number, private readonly clock: ThrottleClock = realClock) {}

  /** Queue `fn`; it runs after all previously-queued tasks and after the interval gap. */
  run<T>(fn: () => Promise<T>): Promise<T> {
    const task = this.chain.then(async () => {
      const wait = this.minIntervalMs - (this.clock.now() - this.last);
      if (wait > 0) await this.clock.sleep(wait);
      this.last = this.clock.now();
      return fn();
    });
    // Keep the chain alive even if a task rejects, so later tasks still run.
    this.chain = task.then(
      () => undefined,
      () => undefined,
    );
    return task as Promise<T>;
  }
}
