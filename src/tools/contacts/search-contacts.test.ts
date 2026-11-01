import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * search_contacts' summary must say `has_more_results: true` when the page is
 * full or LACRM says more exist, and false only when it is known nothing more
 * matched. It used to pass a literal `false`, so a full 25-result page read as
 * the whole answer.
 *
 * The fake LACRM below answers GetContacts the way the live API does: a wrapped
 * `{ HasMoreResults, Results }` page honouring `MaxNumberOfResults` and `Page`,
 * `HasMoreResults` true on a non-last page and false on the last. `bare: true`
 * answers with a bare array instead (some LACRM endpoints do), so the flag
 * cannot come from the API.
 */
const calls: Array<{ fn: string; params: Record<string, unknown> }> = [];
let matching = 0;
let bare = false;

vi.mock('../../client.js', () => ({
  getClient: () => ({
    call: async (fn: string, params: Record<string, unknown>) => {
      calls.push({ fn, params });
      const size = Number(params.MaxNumberOfResults ?? 500);
      const page = Number(params.Page ?? 1);
      const start = (page - 1) * size;
      const results = Array.from({ length: Math.max(0, Math.min(size, matching - start)) }, (_, i) => ({
        ContactId: String(1000 + start + i),
        AssignedTo: 'Staff',
      }));
      if (bare) return results;
      return { HasMoreResults: start + results.length < matching, Results: results };
    },
  }),
}));

const { registerContactTools } = await import('./index.js');

type Handler = (args: Record<string, unknown>) => Promise<{ content: { text: string }[]; isError?: boolean }>;

function searchContacts(): Handler {
  const tools: Record<string, Handler> = {};
  const fakeServer = {
    registerTool: (name: string, _def: unknown, handler: Handler) => {
      tools[name] = handler;
    },
  };
  registerContactTools(fakeServer as never);
  return tools.search_contacts;
}

async function search(args: Record<string, unknown>) {
  const res = await searchContacts()(args);
  expect(res.isError).toBeFalsy();
  return JSON.parse(res.content[0].text) as {
    summary: { page_count: number; has_more_results: boolean; note?: string };
    results: Array<{ ContactId: string; ContactUrl: string }>;
  };
}

describe('search_contacts has_more_results', () => {
  beforeEach(() => {
    calls.length = 0;
    matching = 0;
    bare = false;
  });

  it('says more when the default 25-result page is full and LACRM has more', async () => {
    matching = 140;
    const out = await search({ search_terms: 'Smith' });
    expect(calls[0].params.MaxNumberOfResults).toBe(25);
    expect(out.summary.page_count).toBe(25);
    expect(out.summary.has_more_results).toBe(true);
    expect(out.summary.note).toMatch(/NOT the total/);
  });

  it('says no more on a short page LACRM calls the last', async () => {
    matching = 7;
    const out = await search({ search_terms: 'Smith' });
    expect(out.summary.page_count).toBe(7);
    expect(out.summary.has_more_results).toBe(false);
    expect(out.summary.note).toBeUndefined();
  });

  it('follows LACRM on a full page that is exactly the last one', async () => {
    matching = 25;
    const out = await search({ search_terms: 'Smith' });
    expect(out.summary.page_count).toBe(25);
    expect(out.summary.has_more_results).toBe(false);
  });

  it('says more on a later full page while LACRM has more, with max_results and page', async () => {
    matching = 120;
    const out = await search({ search_terms: 'Smith', max_results: 50, page: 2 });
    expect(out.summary.page_count).toBe(50);
    expect(out.summary.has_more_results).toBe(true);
    const last = await search({ search_terms: 'Smith', max_results: 50, page: 3 });
    expect(last.summary.page_count).toBe(20);
    expect(last.summary.has_more_results).toBe(false);
  });

  it('keeps a bare-array answer, and says more when that page is full', async () => {
    bare = true;
    matching = 140;
    const out = await search({ search_terms: 'Smith' });
    expect(out.summary.page_count).toBe(25);
    expect(out.results[0].ContactUrl).toContain('ContactId=1000');
    expect(out.summary.has_more_results).toBe(true);
  });

  it('says no more for a short bare-array page', async () => {
    bare = true;
    matching = 3;
    const out = await search({ search_terms: 'Smith' });
    expect(out.summary.page_count).toBe(3);
    expect(out.summary.has_more_results).toBe(false);
  });
});
