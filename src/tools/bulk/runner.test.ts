import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { runBulk, buildReportCsv, type LacrmCall } from './runner.js';
import { RunStore, type BulkRunSpec, type BulkRowResult } from './runstore.js';
import { SequentialThrottle, type ThrottleClock } from './throttle.js';

const FIXED_NOW = '2026-06-20T00:00:00Z';
const instantClock: ThrottleClock = { now: () => 0, sleep: async () => {} };

function freshStore(): RunStore {
  return new RunStore(join(tmpdir(), `lacrm-runner-test-${randomUUID()}`));
}

function recordingClient(handlers: Partial<Record<string, (params: any) => any>> = {}) {
  const calls: { fn: string; params: any }[] = [];
  const call: LacrmCall = async (fn, params) => {
    calls.push({ fn, params });
    if (handlers[fn]) return handlers[fn]!(params);
    if (fn === 'GetContact') return { ContactId: params.ContactId };
    if (fn === 'CreateContact') return { ContactId: `new-${calls.length}` };
    if (fn === 'EditContact') return { ContactId: params.ContactId };
    return {};
  };
  return { call, calls };
}

function deps(store: RunStore, client: { call: LacrmCall }) {
  return { call: client.call, store, throttle: new SequentialThrottle(0, instantClock), now: () => FIXED_NOW };
}

const UPDATE_SPEC: BulkRunSpec = {
  runId: 'r1',
  operation: 'update',
  createdAt: FIXED_NOW,
  keyColumn: 'Contact ID',
  fields: [
    { column: 'Status', strategy: 'replace' },
    { column: 'Tags', strategy: 'union_semicolon' },
  ],
  presentColumns: ['Status', 'Tags'],
  rows: [
    { 'Contact ID': '1', 'Status': 'A', 'Tags': 'vip' },
    { 'Contact ID': '2', 'Status': '', 'Tags': '' },
  ],
};

describe('runBulk — update mode', () => {
  it('reads each contact, writes merged params, and completes', async () => {
    const store = freshStore();
    const client = recordingClient();
    const state = await runBulk(UPDATE_SPEC, deps(store, client));

    expect(state.status).toBe('completed');
    expect(state.processed).toBe(2);
    expect(state.succeeded).toBe(2);
    expect(state.failed).toBe(0);

    const fns = client.calls.map((c) => c.fn);
    expect(fns).toEqual(['GetContact', 'EditContact', 'GetContact', 'EditContact']);

    // row 1: Status set, tags merged
    expect(client.calls[1].params).toEqual({ ContactId: '1', 'Status': 'A', 'Tags': 'vip' });
    // row 2: Status cleared (present+blank); tags omitted (blank union preserves)
    expect(client.calls[3].params).toEqual({ ContactId: '2', 'Status': '' });

    expect(state.results.map((r) => r.status)).toEqual(['updated', 'updated']);
  });

  it('skips EditContact when the merge yields no changes (no_change)', async () => {
    const store = freshStore();
    const client = recordingClient();
    const spec: BulkRunSpec = {
      ...UPDATE_SPEC,
      runId: 'r-nochange',
      // only an accumulate field, left blank -> nothing to write
      fields: [{ column: 'Tags', strategy: 'union_semicolon' }],
      presentColumns: ['Tags'],
      rows: [{ 'Contact ID': '1', 'Tags': '' }],
    };
    const state = await runBulk(spec, deps(store, client));
    expect(client.calls.map((c) => c.fn)).toEqual(['GetContact']); // no EditContact
    expect(state.results[0].status).toBe('no_change');
    expect(state.succeeded).toBe(1);
  });

  it('isolates a per-row failure and keeps processing the rest', async () => {
    const store = freshStore();
    const client = recordingClient({
      GetContact: (p) => {
        if (p.ContactId === '1') throw new Error('not found');
        return { ContactId: p.ContactId };
      },
    });
    const state = await runBulk(UPDATE_SPEC, deps(store, client));
    expect(state.status).toBe('completed');
    expect(state.failed).toBe(1);
    expect(state.succeeded).toBe(1);
    expect(state.results[0].status).toBe('error');
    expect(state.results[0].message).toMatch(/not found/);
    expect(state.results[1].status).toBe('updated');
  });

  it('creates a missing contact only when createIfMissing is set', async () => {
    const store = freshStore();
    const client = recordingClient({ GetContact: () => { throw new Error('missing'); } });
    const spec: BulkRunSpec = {
      ...UPDATE_SPEC,
      runId: 'r-createmissing',
      createIfMissing: true,
      createConfig: { nameColumn: 'Full Name', customFields: [{ column: 'Status' }] },
      rows: [{ 'Contact ID': '1', 'Full Name': 'Jane', 'Status': 'A' }],
    };
    const state = await runBulk(spec, deps(store, client));
    expect(client.calls.map((c) => c.fn)).toEqual(['GetContact', 'CreateContact']);
    expect(state.results[0].status).toBe('created');
    expect(state.results[0].contactId).toBeDefined();
  });

  it('threads updateAddressConfig through to EditContact, appending a new address', async () => {
    const store = freshStore();
    // The contact already has one address; the uploaded one is new -> EditContact gets both.
    const client = recordingClient({
      GetContact: () => ({ ContactId: '1', Address: [{ Street: '123 MAIN ST', City: 'HOUSTON', State: 'TX', Zip: '77002', Type: 'Work' }] }),
    });
    const spec: BulkRunSpec = {
      ...UPDATE_SPEC,
      runId: 'r-address',
      fields: [],
      updateAddressConfig: { street1: 'Street', city: 'City', state: 'State', zip: 'Zip', type: 'Work' },
      presentColumns: ['Contact ID', 'Street', 'City', 'State', 'Zip'],
      rows: [{ 'Contact ID': '1', Street: '900 Elm Dr', City: 'Austin', State: 'TX', Zip: '78701' }],
    };
    const state = await runBulk(spec, deps(store, client));

    const edit = client.calls.find((c) => c.fn === 'EditContact')!;
    expect(edit.params.Address).toHaveLength(2);
    expect((edit.params.Address as any[])[0].Street).toBe('123 MAIN ST'); // existing carried verbatim
    expect((edit.params.Address as any[])[1].Street).toBe('900 Elm Dr'); // new appended at the end
    expect(state.results[0].status).toBe('updated');
  });

  it('makes no change when the uploaded address duplicates an existing one', async () => {
    const store = freshStore();
    const client = recordingClient({
      GetContact: () => ({ ContactId: '1', Address: [{ Street: '123 MAIN ST', City: 'HOUSTON', State: 'TX', Zip: '77002', Type: 'Work' }] }),
    });
    const spec: BulkRunSpec = {
      ...UPDATE_SPEC,
      runId: 'r-address-dup',
      fields: [],
      updateAddressConfig: { street1: 'Street', city: 'City', state: 'State', zip: 'Zip', type: 'Work' },
      presentColumns: ['Contact ID', 'Street', 'City', 'State', 'Zip'],
      // Same address, differently formatted -> recognized as a duplicate, nothing to write.
      rows: [{ 'Contact ID': '1', Street: '123 Main Street', City: 'houston', State: 'Texas', Zip: '77002-9999' }],
    };
    const state = await runBulk(spec, deps(store, client));

    expect(client.calls.map((c) => c.fn)).toEqual(['GetContact']); // no EditContact
    expect(state.results[0].status).toBe('no_change');
  });

  it('records a report CSV path and writes the file', async () => {
    const store = freshStore();
    const client = recordingClient();
    const state = await runBulk(UPDATE_SPEC, deps(store, client));
    expect(state.reportCsvPath).toBe(store.reportPath('r1'));
    const report = readFileSync(state.reportCsvPath!, 'utf-8');
    expect(report.split('\n')[0]).toBe('Row,Key,ContactId,Status,Message');
    expect(report.split('\n')).toHaveLength(3); // header + 2 rows
  });

  it('resumes from existing state without re-processing completed rows', async () => {
    const store = freshStore();
    const client = recordingClient();
    // Pre-seed state as though row 1 already completed.
    store.writeState({
      runId: 'r1',
      operation: 'update',
      status: 'running',
      total: 2,
      processed: 1,
      succeeded: 1,
      failed: 0,
      startedAt: FIXED_NOW,
      updatedAt: FIXED_NOW,
      results: [{ rowNumber: 1, key: '1', contactId: '1', status: 'updated' }],
    });
    const state = await runBulk(UPDATE_SPEC, deps(store, client));
    // Only row 2 should be processed now.
    expect(client.calls.map((c) => c.fn)).toEqual(['GetContact', 'EditContact']);
    expect(client.calls[0].params.ContactId).toBe('2');
    expect(state.processed).toBe(2);
    expect(state.results).toHaveLength(2);
  });
});

describe('runBulk — create mode', () => {
  it('creates a contact per row', async () => {
    const store = freshStore();
    const client = recordingClient();
    const spec: BulkRunSpec = {
      runId: 'rc',
      operation: 'create',
      createdAt: FIXED_NOW,
      createConfig: { nameColumn: 'Full Name', assignedTo: 'U1', customFields: [{ column: 'Status' }] },
      presentColumns: ['Full Name', 'Status'],
      rows: [
        { 'Full Name': 'Jane', 'Status': 'A' },
        { 'Full Name': 'Bob', 'Status': '' },
      ],
    };
    const state = await runBulk(spec, deps(store, client));
    expect(client.calls.map((c) => c.fn)).toEqual(['CreateContact', 'CreateContact']);
    expect(client.calls[0].params).toMatchObject({ Name: 'Jane', AssignedTo: 'U1', 'Status': 'A' });
    expect(state.results.every((r) => r.status === 'created')).toBe(true);
    expect(state.succeeded).toBe(2);
  });
});

describe('buildReportCsv', () => {
  it('renders a header and one line per result, escaping messages', () => {
    const results: BulkRowResult[] = [
      { rowNumber: 1, key: '1', contactId: '1', status: 'updated' },
      { rowNumber: 2, key: '2', status: 'error', message: 'bad, value' },
    ];
    const csv = buildReportCsv(results);
    expect(csv).toBe(['Row,Key,ContactId,Status,Message', '1,1,1,updated,', '2,2,,error,"bad, value"'].join('\n'));
  });
});
