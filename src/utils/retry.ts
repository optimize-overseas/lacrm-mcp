/**
 * Generic transient-retry utility.
 *
 * HTTP calls to any upstream occasionally fail with a transient blip - a 5xx,
 * a gateway timeout, or a dropped socket - that a single retry papers over. This
 * module provides a small, dependency-free retry runner with jittered
 * exponential backoff, a total wall-clock deadline, and honoring of the
 * `Retry-After` header, plus the predicates a caller needs to decide what is
 * safe to retry.
 *
 * Idempotency: only read operations are safe to auto-retry, since retrying a
 * write that already committed could duplicate it. The LACRM API names every
 * read `Get*` and every write `Create*`/`Edit*`/`Delete*`, so `isIdempotent`
 * gates on that prefix.
 *
 * @module utils/retry
 */

/** Transient HTTP statuses worth retrying (server blips + gateway timeouts). */
export const RETRYABLE_STATUS: ReadonlySet<number> = new Set([429, 500, 502, 503, 504, 522, 524]);

/** Low-level socket error codes that indicate a request never got a response. */
const NETWORK_ERROR_CODES = new Set(['ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED', 'EAI_AGAIN', 'ENOTFOUND', 'EPIPE']);

/** Default retry tuning. Overridable via environment variables. */
const DEFAULTS = { maxRetries: 3, baseMs: 400, deadlineMs: 175000 } as const;

/**
 * Whether an operation is safe to auto-retry.
 * Read operations (LACRM `Get*`) are idempotent; writes are not.
 */
export function isIdempotent(functionName: string): boolean {
  return /^Get/.test(functionName);
}

/**
 * Whether an error represents a network/timeout failure (as opposed to an
 * application-level error). These are safe to retry for idempotent calls.
 */
export function isNetworkError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  // fetch aborts (AbortSignal.timeout) surface as TimeoutError / AbortError.
  if (error.name === 'TimeoutError' || error.name === 'AbortError') return true;
  // Node fetch wraps connection failures as a TypeError ("fetch failed").
  if (error instanceof TypeError && /fetch failed|network|socket/i.test(error.message)) return true;
  const code = (error as { code?: unknown }).code;
  if (typeof code === 'string' && NETWORK_ERROR_CODES.has(code)) return true;
  // Some runtimes attach the socket code to error.cause.
  const cause = (error as { cause?: unknown }).cause;
  if (cause && typeof cause === 'object') {
    const causeCode = (cause as { code?: unknown }).code;
    if (typeof causeCode === 'string' && NETWORK_ERROR_CODES.has(causeCode)) return true;
  }
  return false;
}

/**
 * Parse a `Retry-After` header value into a delay in milliseconds relative to
 * `now`. Supports both delta-seconds ("120") and an HTTP-date. Returns
 * `undefined` if the value is absent or unparseable; never returns a negative
 * delay.
 */
export function parseRetryAfterMs(headerValue: string | null | undefined, now: number): number | undefined {
  if (headerValue == null) return undefined;
  const trimmed = headerValue.trim();
  if (trimmed === '') return undefined;

  // Delta-seconds form.
  if (/^\d+$/.test(trimmed)) {
    return Math.max(0, Number(trimmed) * 1000);
  }

  // HTTP-date form.
  const dateMs = Date.parse(trimmed);
  if (!Number.isNaN(dateMs)) {
    return Math.max(0, dateMs - now);
  }

  return undefined;
}

/** Resolved retry configuration. */
export interface RetryConfig {
  maxRetries: number;
  baseMs: number;
  deadlineMs: number;
}

/**
 * Load retry tuning from an environment-like object, falling back to defaults
 * for any missing or invalid value. A value must be a positive integer to take
 * effect (`0` and negatives are treated as invalid and ignored).
 */
export function getRetryConfig(env: Record<string, string | undefined>): RetryConfig {
  // maxRetries may be 0 (disables retries); baseMs/deadlineMs must be positive.
  const readInt = (raw: string | undefined, fallback: number, min: number): number => {
    if (raw == null) return fallback;
    const n = Number(raw);
    return Number.isInteger(n) && n >= min ? n : fallback;
  };
  return {
    maxRetries: readInt(env.LACRM_MAX_RETRIES, DEFAULTS.maxRetries, 0),
    baseMs: readInt(env.LACRM_RETRY_BASE_MS, DEFAULTS.baseMs, 1),
    deadlineMs: readInt(env.LACRM_RETRY_DEADLINE_MS, DEFAULTS.deadlineMs, 1),
  };
}

/** Options for {@link retry}. Clock, sleep, and randomness are injectable for tests. */
export interface RetryOptions {
  /** Maximum number of retries after the initial attempt. */
  maxRetries: number;
  /** Backoff base in milliseconds. */
  baseMs: number;
  /** Total wall-clock budget across all attempts, in milliseconds. */
  deadlineMs: number;
  /** Decide whether a thrown error is retryable. */
  shouldRetry: (error: unknown, attempt: number) => boolean;
  /** Extract an explicit Retry-After delay (ms) from an error, if any. */
  retryAfterMs?: (error: unknown) => number | undefined;
  /** Observe each retry (e.g. for logging). */
  onRetry?: (error: unknown, attempt: number, delayMs: number) => void;
  /** Injectable clock (defaults to Date.now). */
  now?: () => number;
  /** Injectable sleep (defaults to real setTimeout). */
  sleep?: (ms: number) => Promise<void>;
  /** Injectable randomness in [0, 1) for jitter (defaults to Math.random). */
  random?: () => number;
}

/**
 * Run `fn` with transient-retry semantics.
 *
 * The attempt receives a context with the current `attempt` index and the
 * `remainingMs` budget, so it can bound its own per-attempt timeout. On a
 * retryable error, the runner backs off (full jitter, exponential, or an
 * explicit Retry-After) and retries until `maxRetries` is reached or the
 * `deadlineMs` budget is spent, then rethrows the last error.
 */
export async function retry<T>(
  fn: (ctx: { attempt: number; remainingMs: number }) => Promise<T>,
  opts: RetryOptions,
): Promise<T> {
  const now = opts.now ?? (() => Date.now());
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const random = opts.random ?? Math.random;

  const start = now();
  let lastError: unknown;

  for (let attempt = 0; attempt <= opts.maxRetries; attempt++) {
    const remainingMs = Math.max(0, opts.deadlineMs - (now() - start));
    try {
      return await fn({ attempt, remainingMs });
    } catch (error) {
      lastError = error;

      // Out of retries, or the error is not retryable -> give up now.
      if (attempt >= opts.maxRetries || !opts.shouldRetry(error, attempt)) {
        throw error;
      }

      // Compute the backoff delay: an explicit Retry-After wins; otherwise full
      // jitter over an exponential ceiling (baseMs * 2^attempt).
      const explicit = opts.retryAfterMs?.(error);
      const ceiling = opts.baseMs * 2 ** attempt;
      const delay = explicit != null ? explicit : Math.floor(random() * ceiling);

      // No budget left for another attempt after sleeping -> give up now.
      const elapsed = now() - start;
      if (elapsed + delay >= opts.deadlineMs) {
        throw error;
      }

      opts.onRetry?.(error, attempt, delay);
      await sleep(delay);
    }
  }

  // Unreachable: the loop either returns or throws.
  throw lastError;
}
