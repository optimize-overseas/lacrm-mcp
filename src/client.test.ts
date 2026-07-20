import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { LacrmClient } from './client.js';
import { ApiError, AuthenticationError } from './utils/errors.js';

/** Build a minimal Response-like object for the fetch stub. */
function fakeResponse(opts: {
  ok?: boolean;
  status?: number;
  statusText?: string;
  body?: unknown;
  headers?: Record<string, string>;
  jsonThrows?: boolean;
}) {
  const headers = opts.headers ?? {};
  return {
    ok: opts.ok ?? true,
    status: opts.status ?? 200,
    statusText: opts.statusText ?? 'OK',
    headers: { get: (k: string) => headers[k.toLowerCase()] ?? null },
    json: async () => {
      if (opts.jsonThrows) throw new Error('not json');
      return opts.body ?? {};
    },
  } as unknown as Response;
}

describe('LacrmClient retry behavior', () => {
  const originalFetch = globalThis.fetch;
  let client: LacrmClient;

  beforeEach(() => {
    // Fast, deterministic backoff so retrying tests do not wait on the wall clock.
    process.env.LACRM_RETRY_BASE_MS = '1';
    process.env.LACRM_MAX_RETRIES = '3';
    process.env.LACRM_RETRY_DEADLINE_MS = '175000';
    client = new LacrmClient('test-key');
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    delete process.env.LACRM_RETRY_BASE_MS;
    delete process.env.LACRM_MAX_RETRIES;
    delete process.env.LACRM_RETRY_DEADLINE_MS;
    vi.restoreAllMocks();
  });

  it('retries a read (Get*) on a transient 500 and then succeeds', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(fakeResponse({ ok: false, status: 500, statusText: 'Server Error' }))
      .mockResolvedValueOnce(fakeResponse({ body: { Results: [{ ContactId: '1' }] } }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const result = await client.call<{ Results: unknown[] }>('GetContacts', { SearchTerms: 'x' });

    expect(result.Results).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('retries a read on a 524 gateway timeout then succeeds', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(fakeResponse({ ok: false, status: 524, statusText: 'Timeout' }))
      .mockResolvedValueOnce(fakeResponse({ body: { Results: [] } }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await client.call('GetContacts', {});
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('retries a read on a network failure then succeeds', async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce(fakeResponse({ body: { Results: [] } }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await client.call('GetContacts', {});
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does NOT retry a write (Create*) on a 500 - throws immediately', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValue(fakeResponse({ ok: false, status: 500, statusText: 'Server Error' }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await expect(client.call('CreateContact', { Name: 'x' })).rejects.toBeInstanceOf(ApiError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('gives up after exhausting retries on a persistent 500', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValue(fakeResponse({ ok: false, status: 500, statusText: 'Server Error' }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await expect(client.call('GetContacts', {})).rejects.toBeInstanceOf(ApiError);
    // initial + 3 retries
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it('does not retry a permanent 404 even for a read', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValue(fakeResponse({ ok: false, status: 404, statusText: 'Not Found' }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await expect(client.call('GetContact', { ContactId: 'nope' })).rejects.toBeInstanceOf(ApiError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not retry an auth failure (401)', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValue(fakeResponse({ ok: false, status: 401, statusText: 'Unauthorized' }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await expect(client.call('GetContacts', {})).rejects.toBeInstanceOf(AuthenticationError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not retry a LACRM application error (ErrorCode in a 200 body)', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValue(fakeResponse({ body: { ErrorCode: 'InvalidParameter', ErrorDescription: 'bad' } }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await expect(client.call('GetContacts', {})).rejects.toBeInstanceOf(ApiError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
