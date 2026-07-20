import { describe, it, expect } from 'vitest';
import {
  RETRYABLE_STATUS,
  isIdempotent,
  isNetworkError,
  parseRetryAfterMs,
  getRetryConfig,
  retry,
} from './retry.js';

describe('isIdempotent', () => {
  it('treats LACRM read functions (Get*) as idempotent', () => {
    expect(isIdempotent('GetContacts')).toBe(true);
    expect(isIdempotent('GetContact')).toBe(true);
    expect(isIdempotent('GetContactsById')).toBe(true);
    expect(isIdempotent('GetPipelineItems')).toBe(true);
  });

  it('treats write functions as non-idempotent (never auto-retried)', () => {
    expect(isIdempotent('CreateContact')).toBe(false);
    expect(isIdempotent('EditContact')).toBe(false);
    expect(isIdempotent('DeleteContact')).toBe(false);
    expect(isIdempotent('CreateGroupMembership')).toBe(false);
  });
});

describe('RETRYABLE_STATUS', () => {
  it('includes transient server / gateway statuses', () => {
    for (const s of [429, 500, 502, 503, 504, 522, 524]) {
      expect(RETRYABLE_STATUS.has(s)).toBe(true);
    }
  });

  it('excludes success and permanent client errors', () => {
    for (const s of [200, 400, 401, 403, 404, 422]) {
      expect(RETRYABLE_STATUS.has(s)).toBe(false);
    }
  });
});

describe('isNetworkError', () => {
  it('recognizes fetch timeout / abort errors', () => {
    const timeout = new Error('The operation timed out');
    timeout.name = 'TimeoutError';
    expect(isNetworkError(timeout)).toBe(true);

    const abort = new Error('aborted');
    abort.name = 'AbortError';
    expect(isNetworkError(abort)).toBe(true);
  });

  it('recognizes low-level socket errors by code', () => {
    for (const code of ['ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED', 'EAI_AGAIN', 'ENOTFOUND']) {
      const err = Object.assign(new Error('socket'), { code });
      expect(isNetworkError(err)).toBe(true);
    }
  });

  it('recognizes a generic fetch failure', () => {
    expect(isNetworkError(new TypeError('fetch failed'))).toBe(true);
  });

  it('does not flag ordinary errors', () => {
    expect(isNetworkError(new Error('validation failed'))).toBe(false);
    expect(isNetworkError('nope')).toBe(false);
    expect(isNetworkError(undefined)).toBe(false);
  });
});

describe('parseRetryAfterMs', () => {
  const now = 1_000_000;

  it('parses delta-seconds', () => {
    expect(parseRetryAfterMs('2', now)).toBe(2000);
    expect(parseRetryAfterMs('0', now)).toBe(0);
  });

  it('parses an HTTP-date into a delay from now', () => {
    const future = new Date(now + 5000).toUTCString();
    const ms = parseRetryAfterMs(future, now);
    // toUTCString truncates to whole seconds, so allow a 1s slack.
    expect(ms).toBeGreaterThanOrEqual(4000);
    expect(ms).toBeLessThanOrEqual(6000);
  });

  it('never returns a negative delay for a past date', () => {
    const past = new Date(now - 10000).toUTCString();
    expect(parseRetryAfterMs(past, now)).toBe(0);
  });

  it('returns undefined for a missing or garbage value', () => {
    expect(parseRetryAfterMs(null, now)).toBeUndefined();
    expect(parseRetryAfterMs('soon', now)).toBeUndefined();
  });
});

describe('getRetryConfig', () => {
  it('supplies sensible defaults with no env set', () => {
    const cfg = getRetryConfig({});
    expect(cfg.maxRetries).toBe(3);
    expect(cfg.baseMs).toBe(400);
    expect(cfg.deadlineMs).toBe(175000);
  });

  it('reads overrides from env', () => {
    const cfg = getRetryConfig({
      LACRM_MAX_RETRIES: '5',
      LACRM_RETRY_BASE_MS: '250',
      LACRM_RETRY_DEADLINE_MS: '120000',
    });
    expect(cfg.maxRetries).toBe(5);
    expect(cfg.baseMs).toBe(250);
    expect(cfg.deadlineMs).toBe(120000);
  });

  it('ignores invalid env values and falls back to defaults', () => {
    const cfg = getRetryConfig({ LACRM_MAX_RETRIES: 'abc', LACRM_RETRY_BASE_MS: '-1' });
    expect(cfg.maxRetries).toBe(3);
    expect(cfg.baseMs).toBe(400);
  });
});

// A controllable test harness: a fake clock + recording sleep so retry() never
// waits on the wall clock, and injected randomness so backoff is deterministic.
function harness(overrides: Record<string, unknown> = {}) {
  let clock = 0;
  const slept: number[] = [];
  return {
    slept,
    advance: (ms: number) => { clock += ms; },
    opts: {
      now: () => clock,
      sleep: async (ms: number) => { slept.push(ms); clock += ms; },
      random: () => 0.5,
      ...overrides,
    },
  };
}

describe('retry', () => {
  it('returns immediately on success without sleeping', async () => {
    const h = harness();
    let calls = 0;
    const result = await retry(async () => { calls++; return 'ok'; }, {
      maxRetries: 3,
      baseMs: 400,
      deadlineMs: 175000,
      shouldRetry: () => true,
      ...h.opts,
    });
    expect(result).toBe('ok');
    expect(calls).toBe(1);
    expect(h.slept).toEqual([]);
  });

  it('retries a transient failure and then succeeds', async () => {
    const h = harness();
    let calls = 0;
    const result = await retry(async () => {
      calls++;
      if (calls < 3) throw new Error('500');
      return 'recovered';
    }, {
      maxRetries: 3,
      baseMs: 400,
      deadlineMs: 175000,
      shouldRetry: () => true,
      ...h.opts,
    });
    expect(result).toBe('recovered');
    expect(calls).toBe(3);
    expect(h.slept.length).toBe(2);
  });

  it('throws the last error after exhausting retries', async () => {
    const h = harness();
    let calls = 0;
    await expect(retry(async () => {
      calls++;
      throw new Error(`boom ${calls}`);
    }, {
      maxRetries: 2,
      baseMs: 400,
      deadlineMs: 175000,
      shouldRetry: () => true,
      ...h.opts,
    })).rejects.toThrow('boom 3');
    expect(calls).toBe(3); // initial + 2 retries
  });

  it('does not retry when shouldRetry is false', async () => {
    const h = harness();
    let calls = 0;
    await expect(retry(async () => {
      calls++;
      throw new Error('permanent');
    }, {
      maxRetries: 3,
      baseMs: 400,
      deadlineMs: 175000,
      shouldRetry: () => false,
      ...h.opts,
    })).rejects.toThrow('permanent');
    expect(calls).toBe(1);
    expect(h.slept).toEqual([]);
  });

  it('stops retrying once the total deadline is exhausted', async () => {
    // sleep advances the clock; a short deadline means the second retry has no budget.
    const h = harness();
    let calls = 0;
    await expect(retry(async () => {
      calls++;
      throw new Error('slow');
    }, {
      maxRetries: 5,
      baseMs: 400,
      deadlineMs: 500, // only room for the first backoff
      shouldRetry: () => true,
      ...h.opts,
    })).rejects.toThrow('slow');
    // 1 initial + at most 1 retry before the deadline is blown.
    expect(calls).toBeLessThanOrEqual(2);
  });

  it('passes shrinking remainingMs to the attempt', async () => {
    const h = harness();
    const seen: number[] = [];
    let calls = 0;
    await retry(async (ctx) => {
      seen.push(ctx.remainingMs);
      calls++;
      if (calls < 2) throw new Error('once');
      return 'done';
    }, {
      maxRetries: 3,
      baseMs: 1000,
      deadlineMs: 175000,
      shouldRetry: () => true,
      ...h.opts,
    });
    expect(seen[0]).toBe(175000);
    expect(seen[1]).toBeLessThan(175000); // backoff sleep consumed budget
  });

  it('honors an explicit Retry-After delay over computed backoff', async () => {
    const h = harness();
    let calls = 0;
    await retry(async () => {
      calls++;
      if (calls < 2) throw new Error('rate limited');
      return 'ok';
    }, {
      maxRetries: 3,
      baseMs: 400,
      deadlineMs: 175000,
      shouldRetry: () => true,
      retryAfterMs: () => 3000,
      ...h.opts,
    });
    expect(h.slept).toEqual([3000]);
  });

  it('uses jittered exponential backoff bounded by baseMs * 2^attempt', async () => {
    // random() = 1 -> full jitter upper bound; assert the delay ceiling grows exponentially.
    const h = harness({ random: () => 1 });
    let calls = 0;
    await expect(retry(async () => {
      calls++;
      throw new Error('always');
    }, {
      maxRetries: 3,
      baseMs: 100,
      deadlineMs: 175000,
      shouldRetry: () => true,
      ...h.opts,
    })).rejects.toThrow('always');
    // full-jitter upper bounds: 100, 200, 400
    expect(h.slept[0]).toBeLessThanOrEqual(100);
    expect(h.slept[1]).toBeLessThanOrEqual(200);
    expect(h.slept[2]).toBeLessThanOrEqual(400);
    expect(h.slept[1]).toBeGreaterThan(h.slept[0]);
  });
});
