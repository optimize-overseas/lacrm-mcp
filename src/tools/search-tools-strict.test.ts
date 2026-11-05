import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

/**
 * The search tools refuse an argument they do not have (v2.0.0). Before, the
 * SDK's non-strict wrapper dropped it and the search ran without it, so a
 * filter passed under a made-up name silently became no filter at all.
 * Driven through the REAL SDK (client + server over an in-memory transport):
 * calling the handlers directly would skip the validation step under test.
 */
const calls: string[] = [];

vi.mock('../client.js', () => ({
  getClient: () => ({
    call: async (fn: string) => {
      calls.push(fn);
      return { HasMoreResults: false, Results: [] };
    },
  }),
}));

const { registerPipelineItemTools } = await import('./pipeline-items/index.js');
const { registerNoteTools } = await import('./notes/index.js');
const { registerTaskTools } = await import('./tasks/index.js');
const { registerEventTools } = await import('./events/index.js');
const { registerEmailTools } = await import('./emails/index.js');

// Each search tool with the least it needs to run.
const SEARCH_TOOLS: Array<[string, Record<string, unknown>]> = [
  ['search_pipeline_items', { pipeline_id: '9' }],
  ['search_notes', {}],
  ['search_tasks', { start_date: '2026-01-01', end_date: '2026-12-31' }],
  ['search_events', { start_date: '2026-01-01', end_date: '2026-12-31' }],
  ['search_emails', {}],
];

let client: Client;

beforeAll(async () => {
  const server = new McpServer({ name: 'test', version: '0.0.0' });
  for (const register of [registerPipelineItemTools, registerNoteTools, registerTaskTools, registerEventTools, registerEmailTools]) {
    register(server);
  }
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  client = new Client({ name: 'test-client', version: '0.0.0' });
  await client.connect(clientSide);
});

afterAll(async () => {
  await client.close();
});

async function call(name: string, args: Record<string, unknown>) {
  const res = await client.callTool({ name, arguments: args });
  const content = res.content as Array<{ type: string; text: string }>;
  return { isError: Boolean(res.isError), text: content[0]?.text ?? '' };
}

describe('search tools refuse an unknown argument', () => {
  for (const [tool, args] of SEARCH_TOOLS) {
    it(`${tool} refuses {"name": ...} without calling the API`, async () => {
      calls.length = 0;
      const res = await call(tool, { ...args, name: 'Smith' });
      expect(res.isError).toBe(true);
      expect(res.text).toMatch(/Unrecognized key/);
      expect(res.text).toContain('name');
      expect(calls).toHaveLength(0);
    });

    it(`${tool} still runs with its own arguments`, async () => {
      calls.length = 0;
      const res = await call(tool, args);
      expect(res.isError, res.text).toBe(false);
      expect(calls.length).toBeGreaterThan(0);
    });
  }

  it('search_pipeline_items refuses a misspelt key inside an advanced filter (it would have sent no Value)', async () => {
    calls.length = 0;
    const res = await call('search_pipeline_items', {
      pipeline_id: '9',
      advanced_filters: [{ Name: 'Stage', Operation: 'IsExactly', value: 'Open' }],
    });
    expect(res.isError).toBe(true);
    expect(res.text).toMatch(/Unrecognized key/);
    expect(calls).toHaveLength(0);
  });

  it('advertises additionalProperties: false on every search tool', async () => {
    const { tools } = await client.listTools();
    for (const [tool] of SEARCH_TOOLS) {
      const schema = tools.find((t) => t.name === tool)!.inputSchema as { additionalProperties?: boolean };
      expect(schema.additionalProperties, tool).toBe(false);
    }
  });
});
