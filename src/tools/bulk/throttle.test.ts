import { describe, it, expect } from 'vitest';
import { SequentialThrottle, type ThrottleClock } from './throttle.js';

/** A deterministic virtual clock: sleep() advances time instead of waiting. */
function makeFakeClock(): ThrottleClock & { advance(ms: number): void } {
  let t = 0;
  return {
    now: () => t,
    sleep: async (ms: number) => {
      t += ms;
    },
    advance: (ms: number) => {
      t += ms;
    },
  };
}

describe('SequentialThrottle', () => {
  it('runs the first call immediately (no wait)', async () => {
    const clock = makeFakeClock();
    const throttle = new SequentialThrottle(1000, clock);
    let ranAt = -1;
    await throttle.run(async () => {
      ranAt = clock.now();
    });
    expect(ranAt).toBe(0);
  });

  it('spaces consecutive calls at least minIntervalMs apart', async () => {
    const clock = makeFakeClock();
    const throttle = new SequentialThrottle(1000, clock);
    const times: number[] = [];
    await throttle.run(async () => void times.push(clock.now()));
    await throttle.run(async () => void times.push(clock.now()));
    await throttle.run(async () => void times.push(clock.now()));
    expect(times).toEqual([0, 1000, 2000]);
  });

  it('does not wait when enough time has already elapsed', async () => {
    const clock = makeFakeClock();
    const throttle = new SequentialThrottle(1000, clock);
    const times: number[] = [];
    await throttle.run(async () => void times.push(clock.now()));
    clock.advance(5000);
    await throttle.run(async () => void times.push(clock.now()));
    expect(times).toEqual([0, 5000]);
  });

  it('serializes concurrently-submitted calls in order and returns each result', async () => {
    const clock = makeFakeClock();
    const throttle = new SequentialThrottle(10, clock);
    const order: number[] = [];
    const results = await Promise.all([
      throttle.run(async () => {
        order.push(1);
        return 'a';
      }),
      throttle.run(async () => {
        order.push(2);
        return 'b';
      }),
      throttle.run(async () => {
        order.push(3);
        return 'c';
      }),
    ]);
    expect(order).toEqual([1, 2, 3]);
    expect(results).toEqual(['a', 'b', 'c']);
  });

  it('keeps running after a call throws', async () => {
    const clock = makeFakeClock();
    const throttle = new SequentialThrottle(10, clock);
    await expect(throttle.run(async () => {
      throw new Error('boom');
    })).rejects.toThrow('boom');
    const result = await throttle.run(async () => 'ok');
    expect(result).toBe('ok');
  });
});
