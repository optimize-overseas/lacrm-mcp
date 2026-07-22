import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { RunStore, defaultRunsDir } from './runstore.js';
import type { BulkRunSpec, BulkRunState } from './runstore.js';

function freshDir(): string {
  return join(tmpdir(), `lacrm-runstore-test-${randomUUID()}`);
}

const SPEC: BulkRunSpec = {
  runId: 'run-1',
  operation: 'update',
  createdAt: '2026-06-20T00:00:00Z',
  keyColumn: 'Contact ID',
  fields: [{ column: 'Status', strategy: 'replace' }],
  presentColumns: ['Status'],
  rows: [{ 'Contact ID': '1', 'Status': 'A' }],
};

const STATE: BulkRunState = {
  runId: 'run-1',
  operation: 'update',
  status: 'running',
  total: 1,
  processed: 0,
  succeeded: 0,
  failed: 0,
  startedAt: '2026-06-20T00:00:00Z',
  updatedAt: '2026-06-20T00:00:00Z',
  results: [],
};

describe('RunStore', () => {
  it('round-trips a spec', () => {
    const store = new RunStore(freshDir());
    store.writeSpec(SPEC);
    expect(store.readSpec('run-1')).toEqual(SPEC);
  });

  it('round-trips the async completion fields (channel/requestorEmail/identifier/requestSummary/jobId)', () => {
    const store = new RunStore(freshDir());
    const spec: BulkRunSpec = {
      ...SPEC,
      channel: 'googlechat',
      requestorEmail: 'user@example.com',
      identifier: 'spaces/AAA',
      requestSummary: 'Update the June letter contacts.',
      jobId: 'job-123',
    };
    store.writeSpec(spec);
    const read = store.readSpec('run-1')!;
    expect(read).toEqual(spec);
    // The jobId is what lets a resumed run complete the SAME ledger job.
    expect(read.jobId).toBe('job-123');
  });

  it('round-trips state with a reportSheetUrl', () => {
    const store = new RunStore(freshDir());
    store.writeState({ ...STATE, reportSheetUrl: 'https://docs.google.com/spreadsheets/d/X/edit' });
    expect(store.readState('run-1')!.reportSheetUrl).toBe(
      'https://docs.google.com/spreadsheets/d/X/edit',
    );
  });

  it('round-trips state', () => {
    const store = new RunStore(freshDir());
    store.writeState(STATE);
    expect(store.readState('run-1')).toEqual(STATE);
  });

  it('returns null for an unknown spec or state', () => {
    const store = new RunStore(freshDir());
    expect(store.readSpec('nope')).toBeNull();
    expect(store.readState('nope')).toBeNull();
  });

  it('creates the runs directory on first write', () => {
    const dir = freshDir();
    expect(existsSync(dir)).toBe(false);
    new RunStore(dir).writeState(STATE);
    expect(existsSync(dir)).toBe(true);
  });

  it('overwrites state on repeated writes (latest wins)', () => {
    const store = new RunStore(freshDir());
    store.writeState(STATE);
    store.writeState({ ...STATE, processed: 1, succeeded: 1, status: 'completed' });
    const read = store.readState('run-1')!;
    expect(read.processed).toBe(1);
    expect(read.status).toBe('completed');
  });

  it('exposes a report CSV path under its directory', () => {
    const dir = freshDir();
    const store = new RunStore(dir);
    expect(store.reportPath('run-1')).toBe(join(dir, 'run-1.report.csv'));
  });
});

describe('defaultRunsDir', () => {
  it('honors LACRM_BULK_RUNS_DIR when set', () => {
    const prev = process.env.LACRM_BULK_RUNS_DIR;
    process.env.LACRM_BULK_RUNS_DIR = '/var/tmp/custom-runs';
    try {
      expect(defaultRunsDir()).toBe('/var/tmp/custom-runs');
    } finally {
      if (prev === undefined) delete process.env.LACRM_BULK_RUNS_DIR;
      else process.env.LACRM_BULK_RUNS_DIR = prev;
    }
  });

  it('falls back to a lacrm-bulk-runs dir under the OS temp dir', () => {
    const prev = process.env.LACRM_BULK_RUNS_DIR;
    delete process.env.LACRM_BULK_RUNS_DIR;
    try {
      expect(defaultRunsDir()).toBe(join(tmpdir(), 'lacrm-bulk-runs'));
    } finally {
      if (prev !== undefined) process.env.LACRM_BULK_RUNS_DIR = prev;
    }
  });
});
