import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

/**
 * search_contacts input handling, driven through the REAL MCP SDK (a server
 * and a client over an in-memory transport) so the SDK's own input validation
 * runs exactly as it does for a real caller. Calling the handler directly
 * would skip that step, and that step is where the bug lived.
 *
 * Before v2.0.0 the input schema was a raw zod shape, which the SDK wraps in a
 * NON-strict object: `{"name":"x"}` had its unknown key STRIPPED, and the
 * handler then ran GetContacts with `{ MaxNumberOfResults: 25 }` and nothing
 * else - a read of the whole account (with count_only, a walk of every page).
 * Proved with this harness before the fix, by asserting exactly that call.
 */
const calls: Array<{ fn: string; params: Record<string, unknown> }> = [];

vi.mock('../../client.js', () => ({
  getClient: () => ({
    call: async (fn: string, params: Record<string, unknown>) => {
      calls.push({ fn, params });
      return { HasMoreResults: false, Results: [{ ContactId: '1001', AssignedTo: 'Staff' }] };
    },
  }),
}));

const { registerContactTools } = await import('./index.js');

let client: Client;

beforeEach(async () => {
  calls.length = 0;
  const server = new McpServer({ name: 'test', version: '0.0.0' });
  registerContactTools(server);
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  client = new Client({ name: 'test-client', version: '0.0.0' });
  await client.connect(clientSide);
});

afterEach(async () => {
  await client.close();
});

async function call(args: Record<string, unknown>) {
  const res = await client.callTool({ name: 'search_contacts', arguments: args });
  const content = res.content as Array<{ type: string; text: string }>;
  return { isError: Boolean(res.isError), text: content[0]?.text ?? '' };
}

describe('search_contacts refuses an unknown argument', () => {
  it('refuses {"name": ...} instead of stripping it, and never calls LACRM', async () => {
    const res = await call({ name: 'Smith' });
    expect(res.isError).toBe(true);
    expect(res.text).toContain('Unknown argument(s) for search_contacts: name');
    expect(res.text).toContain('Accepted: search_terms, record_type, owner_filter');
    expect(res.text).toContain('allow_unfiltered');
    expect(res.text).toContain('advanced_filters with FullName, FirstName or LastName');
    expect(calls).toHaveLength(0);
  });

  it('refuses it with count_only too (that was the whole-account page walk)', async () => {
    const res = await call({ name: 'Smith', count_only: true });
    expect(res.isError).toBe(true);
    expect(res.text).toContain('Unknown argument(s) for search_contacts: name');
    expect(calls).toHaveLength(0);
  });

  it('refuses an unknown key even beside a real filter, naming every unknown key', async () => {
    const res = await call({ search_terms: 'Smith', region: 'North', state: 'CA' });
    expect(res.isError).toBe(true);
    expect(res.text).toContain('region, state');
    expect(calls).toHaveLength(0);
  });

  it('refuses a misspelt key inside an advanced filter (it would have sent no Value)', async () => {
    const res = await call({ advanced_filters: [{ Name: 'LastName', Operation: 'Contains', value: 'Smith' }] });
    expect(res.isError).toBe(true);
    expect(res.text).toMatch(/Unrecognized key/);
    expect(res.text).toContain('value');
    expect(calls).toHaveLength(0);
  });

  it('refuses advanced_filters given as an object instead of a list', async () => {
    const res = await call({ advanced_filters: { Region: 'North' } });
    expect(res.isError).toBe(true);
    expect(calls).toHaveLength(0);
  });
});

describe('search_contacts refuses a search with no filter unless asked', () => {
  const unfiltered: Array<[string, Record<string, unknown>]> = [
    ['an empty object', {}],
    ['count_only alone', { count_only: true }],
    ['blank search_terms', { search_terms: '   ' }],
    ['an empty advanced_filters list', { advanced_filters: [] }],
    ['an empty owner_filter list', { owner_filter: [] }],
    ['an owner_filter of blank IDs', { owner_filter: ['', '  '] }],
    ['record_type, sort and paging only', { record_type: 'Contacts', sort_by: 'LastName', max_results: 50, page: 2 }],
    ['allow_unfiltered: false', { allow_unfiltered: false }],
  ];
  for (const [label, args] of unfiltered) {
    it(`refuses ${label}, without calling LACRM`, async () => {
      const res = await call(args);
      expect(res.isError).toBe(true);
      expect(res.text).toContain('search_contacts was not run: it was given no filter');
      expect(res.text).toContain('allow_unfiltered: true');
      expect(calls).toHaveLength(0);
    });
  }

  it('runs an unfiltered search when allow_unfiltered is true, without sending the flag to LACRM', async () => {
    const res = await call({ allow_unfiltered: true, sort_by: 'LastUpdate' });
    expect(res.isError).toBe(false);
    expect(calls).toEqual([{ fn: 'GetContacts', params: { SortBy: 'LastUpdate', MaxNumberOfResults: 25 } }]);
  });
});

describe('search_contacts still runs every filtered search', () => {
  it('search_terms', async () => {
    const res = await call({ search_terms: 'Smith' });
    expect(res.isError).toBe(false);
    expect(calls).toEqual([{ fn: 'GetContacts', params: { SearchTerms: 'Smith', MaxNumberOfResults: 25 } }]);
    expect(JSON.parse(res.text).results[0].ContactId).toBe('1001');
  });

  it('advanced_filters on a name field', async () => {
    const filters = [{ Name: 'LastName', Operation: 'Contains', Value: 'Smith' }];
    const res = await call({ advanced_filters: filters });
    expect(res.isError).toBe(false);
    expect(calls).toEqual([{ fn: 'GetContacts', params: { AdvancedFilters: filters, MaxNumberOfResults: 25 } }]);
  });

  it('a custom-field filter and a name filter together', async () => {
    const filters = [
      { Name: 'LastName', Operation: 'Contains', Value: 'Smith' },
      { Name: 'Custom_1234567890', Operation: 'Contains', Value: 'Example' },
    ];
    const res = await call({ advanced_filters: filters, max_results: 10 });
    expect(res.isError).toBe(false);
    expect(calls[0].params.AdvancedFilters).toEqual(filters);
  });

  it('an IsEmpty filter with no Value', async () => {
    const res = await call({ advanced_filters: [{ Name: 'Email', Operation: 'IsEmpty' }] });
    expect(res.isError).toBe(false);
    expect(calls).toHaveLength(1);
  });

  it('owner_filter alone', async () => {
    const res = await call({ owner_filter: ['42'] });
    expect(res.isError).toBe(false);
    expect(calls[0].params.OwnerFilter).toEqual(['42']);
  });

  it('count_only with a filter', async () => {
    const res = await call({ search_terms: 'Smith', count_only: true });
    expect(res.isError).toBe(false);
    expect(calls[0].params.SearchTerms).toBe('Smith');
  });
});

describe('search_contacts advertises the contract', () => {
  it('lists additionalProperties: false, the opt-in flag, and the filter-required rule', async () => {
    const { tools } = await client.listTools();
    const tool = tools.find((t) => t.name === 'search_contacts')!;
    const schema = tool.inputSchema as {
      additionalProperties?: boolean;
      properties: Record<string, { items?: { additionalProperties?: boolean } }>;
    };
    expect(schema.additionalProperties).toBe(false);
    expect(Object.keys(schema.properties)).toContain('allow_unfiltered');
    expect(schema.properties.advanced_filters.items?.additionalProperties).toBe(false);
    expect(tool.description).toContain('A FILTER IS REQUIRED');
  });
});
