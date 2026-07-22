import { describe, it, expect } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { registerBulkTools, type BulkToolDeps } from './index.js';
import { RunStore } from './runstore.js';

/**
 * Smoke tests for the tool wiring (CSV loading, confirm-gate, estimate, status lookup).
 * The merge/validate/template/runner logic is unit-tested in their own suites; these
 * verify the glue and exercise only the non-writing tools (no LACRM calls).
 */
type Handler = (args: any) => Promise<{ content: { text: string }[]; isError?: boolean }>;

function captureTools(deps?: BulkToolDeps): Record<string, Handler> {
  const tools: Record<string, Handler> = {};
  const fakeServer = {
    registerTool: (name: string, _def: unknown, handler: Handler) => {
      tools[name] = handler;
    },
  };
  registerBulkTools(fakeServer as never, deps);
  return tools;
}

async function callJson(handler: Handler, args: any) {
  const res = await handler(args);
  return { json: JSON.parse(res.content[0].text), isError: res.isError };
}

const UPDATE_FIELDS = [
  { column: 'Status', strategy: 'replace' },
  { column: 'Tags', strategy: 'union_semicolon' },
];

describe('registerBulkTools', () => {
  it('registers all five bulk tools', () => {
    const tools = captureTools();
    expect(Object.keys(tools).sort()).toEqual(
      ['bulk_execute', 'bulk_generate_template', 'bulk_run_resume', 'bulk_run_status', 'bulk_validate_csv'].sort(),
    );
  });

  it('bulk_generate_template returns a CSV and a per-field report', async () => {
    const tools = captureTools();
    const { json } = await callJson(tools.bulk_generate_template, {
      operation: 'update',
      key_column: 'Contact ID',
      fields: UPDATE_FIELDS,
    });
    expect(json.columns).toEqual(['Contact ID', 'Status', 'Tags']);
    expect(json.csv.split('\n')[0]).toBe('Contact ID,Status,Tags');
    expect(json.report.find((r: any) => r.column === 'Status').behavior.toLowerCase()).toContain('clear');
  });

  it('bulk_validate_csv validates inline content and includes a time estimate', async () => {
    const tools = captureTools();
    const { json } = await callJson(tools.bulk_validate_csv, {
      operation: 'update',
      key_column: 'Contact ID',
      fields: UPDATE_FIELDS,
      csv_content: 'Contact ID,Status\n1,A\n2,\n',
    });
    expect(json.ok).toBe(true);
    expect(json.rowCount).toBe(2);
    expect(json.presentColumns).toEqual(['Status']);
    expect(json.preservedColumns).toContain('Tags');
    expect(json.estimate.calls).toBe(4); // 2 rows * 2 calls/row (update)
    expect(json.estimate.seconds).toBe(4); // 4 calls * 1s
  });

  it('bulk_validate_csv reports blocking errors and stays ok=false', async () => {
    const tools = captureTools();
    const { json } = await callJson(tools.bulk_validate_csv, {
      operation: 'update',
      key_column: 'Contact ID',
      fields: UPDATE_FIELDS,
      csv_content: 'Status\nA\n', // no Contact ID column
    });
    expect(json.ok).toBe(false);
    expect(json.missingRequiredColumns).toContain('Contact ID');
  });

  it('bulk_execute refuses to run without confirm=true (no worker spawned)', async () => {
    const tools = captureTools();
    const { json } = await callJson(tools.bulk_execute, {
      operation: 'update',
      key_column: 'Contact ID',
      fields: UPDATE_FIELDS,
      csv_content: 'Contact ID,Status\n1,A\n',
    });
    expect(json.launched).toBe(false);
    expect(json.reason).toBe('confirmation_required');
  });

  it('bulk_execute create-mode preview recognizes create_config.address columns (no false "unknown" warning)', async () => {
    const tools = captureTools();
    const { json } = await callJson(tools.bulk_execute, {
      operation: 'create',
      fields: [{ column: 'Full Name', field: 'FullName', strategy: 'replace', required: true }],
      create_config: { nameColumn: 'Full Name', address: { street1: 'Addr1', city: 'City' } },
      csv_content: 'Full Name,Addr1,City\nJane,123 Main,Dallas\n',
      // no confirm -> returns the validation preview without launching a worker
    });
    expect(json.launched).toBe(false);
    expect(json.reason).toBe('confirmation_required');
    // The create address columns are consumed at execute time, so the preview must NOT
    // flag them as unknown / to-be-ignored.
    expect(json.validation.unknownColumns).toEqual([]);
    expect(json.validation.presentColumns).toEqual(expect.arrayContaining(['Addr1', 'City']));
    expect(json.validation.warnings).toEqual([]);
  });

  it('bulk_execute refuses when validation fails', async () => {
    const tools = captureTools();
    const { json } = await callJson(tools.bulk_execute, {
      operation: 'update',
      key_column: 'Contact ID',
      fields: UPDATE_FIELDS,
      csv_content: 'Status\nA\n',
      confirm: true,
    });
    expect(json.launched).toBe(false);
    expect(json.reason).toBe('validation_failed');
  });

  it('bulk_run_status returns found=false for an unknown run', async () => {
    const tools = captureTools();
    const { json } = await callJson(tools.bulk_run_status, { run_id: 'does-not-exist' });
    expect(json.found).toBe(false);
  });
});

/**
 * Interrupted-run reporting and resume.
 *
 * These exercise the real tool handlers against a temporary runs directory, so
 * they cover the wiring (state read, liveness reconciliation, refusal rules)
 * without launching a worker or making an API call. The one thing they must
 * never do is let a resume start a second worker on a live run.
 */
describe('interrupted runs', () => {
  function seedRun(state: Record<string, unknown>, spec: Record<string, unknown> = {}) {
    const dir = join(tmpdir(), `lacrm-bulk-idx-${randomUUID()}`);
    mkdirSync(dir, { recursive: true });
    const runId = String(state.runId ?? 'r1');
    writeFileSync(
      join(dir, `${runId}.spec.json`),
      JSON.stringify({ runId, operation: 'update', createdAt: new Date().toISOString(), intervalMs: 1000, presentColumns: [], rows: [], ...spec }),
    );
    writeFileSync(join(dir, `${runId}.state.json`), JSON.stringify(state));
    process.env.LACRM_BULK_RUNS_DIR = dir;
    return { dir, runId, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
  }

  const baseState = (over: Record<string, unknown> = {}) => ({
    runId: 'r1',
    operation: 'update',
    status: 'running',
    total: 100,
    processed: 40,
    succeeded: 38,
    failed: 2,
    startedAt: new Date(Date.now() - 3600_000).toISOString(),
    updatedAt: new Date(Date.now() - 3600_000).toISOString(),
    results: [],
    // a pid that cannot be running
    workerPid: 2147483646,
    ...over,
  });

  it('bulk_run_status reports a dead run as interrupted, not running', async () => {
    const run = seedRun(baseState());
    try {
      const { json } = await callJson(captureTools().bulk_run_status, { run_id: 'r1' });
      expect(json.status).toBe('interrupted');
      expect(json.stored_status).toBe('running');
      expect(json.resumable).toBe(true);
      expect(json.processed).toBe(40);
    } finally {
      run.cleanup();
    }
  });

  it('bulk_run_status leaves a completed run alone', async () => {
    const run = seedRun(baseState({ status: 'completed', processed: 100, finishedAt: new Date().toISOString() }));
    try {
      const { json } = await callJson(captureTools().bulk_run_status, { run_id: 'r1' });
      expect(json.status).toBe('completed');
      expect(json.resumable).toBeUndefined();
    } finally {
      run.cleanup();
    }
  });

  it('bulk_run_resume refuses a run that is still being worked on', async () => {
    // The worker is this very process, so it is unambiguously alive.
    const run = seedRun(baseState({ workerPid: process.pid, updatedAt: new Date().toISOString() }));
    try {
      const { json } = await callJson(captureTools().bulk_run_resume, { run_id: 'r1' });
      expect(json.resumed).toBe(false);
      expect(json.status).toBe('running');
      expect(json.reason).toMatch(/twice/);
    } finally {
      run.cleanup();
    }
  });

  it('bulk_run_resume refuses a completed run', async () => {
    const run = seedRun(baseState({ status: 'completed', processed: 100 }));
    try {
      const { json } = await callJson(captureTools().bulk_run_resume, { run_id: 'r1' });
      expect(json.resumed).toBe(false);
      expect(json.status).toBe('completed');
    } finally {
      run.cleanup();
    }
  });

  it('bulk_run_resume refuses when every row was already processed', async () => {
    const run = seedRun(baseState({ status: 'failed', processed: 100 }));
    try {
      const { json } = await callJson(captureTools().bulk_run_resume, { run_id: 'r1' });
      expect(json.resumed).toBe(false);
      expect(json.reason).toMatch(/nothing left/i);
    } finally {
      run.cleanup();
    }
  });

  it('bulk_run_resume reports an unknown run rather than throwing', async () => {
    const run = seedRun(baseState());
    try {
      const { json } = await callJson(captureTools().bulk_run_resume, { run_id: 'no-such-run' });
      expect(json.resumed).toBe(false);
      expect(json.found).toBe(false);
    } finally {
      run.cleanup();
    }
  });
});

/**
 * Async completion wiring (v1.9.0): the OPTIONAL channel/requestor_email/
 * identifier params register the run with the completion daemon before the
 * worker spawns, and the jobId is persisted into the spec. Every failure on
 * that path degrades to the exact pre-v1.9.0 launch - never blocks the run.
 */
describe('bulk_execute async completion', () => {
  const CSV = 'Contact ID,Status\n1,A\n2,B\n';
  const EXEC_ARGS = {
    operation: 'update',
    key_column: 'Contact ID',
    fields: UPDATE_FIELDS,
    csv_content: CSV,
    confirm: true,
  };
  const LEDGER_ARGS = {
    channel: 'googlechat',
    requestor_email: 'user@example.com',
    identifier: 'spaces/AAA',
    request_summary: 'Update two contacts.',
  };

  function tempRuns() {
    const dir = join(tmpdir(), `lacrm-bulk-async-${randomUUID()}`);
    mkdirSync(dir, { recursive: true });
    process.env.LACRM_BULK_RUNS_DIR = dir;
    return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
  }

  function deps(behavior?: { fail?: boolean }) {
    const created: unknown[] = [];
    const spawned: string[] = [];
    const d: BulkToolDeps = {
      fireLedger: {
        async createJob(input) {
          created.push(input);
          if (behavior?.fail) throw new Error('daemon down');
          return 'job-777';
        },
      },
      spawnWorker: (runId) => {
        spawned.push(runId);
      },
    };
    return { d, created, spawned };
  }

  it('registers the job BEFORE spawning and persists the jobId into the spec', async () => {
    const runs = tempRuns();
    const { d, created, spawned } = deps();
    try {
      const { json } = await callJson(captureTools(d).bulk_execute, { ...EXEC_ARGS, ...LEDGER_ARGS });
      expect(json.launched).toBe(true);
      expect(json.job_id).toBe('job-777');
      expect(json.delivery).toMatch(/delivered automatically/);
      expect(json.poll).toBeUndefined();
      expect(created).toEqual([
        {
          skill: 'lacrmbulk',
          channel: 'googlechat',
          requestorEmail: 'user@example.com',
          identifier: 'spaces/AAA',
          requestSummary: 'Update two contacts.',
        },
      ]);
      expect(spawned).toEqual([json.run_id]);
      const spec = new RunStore(runs.dir).readSpec(json.run_id)!;
      expect(spec.jobId).toBe('job-777');
      expect(spec.channel).toBe('googlechat');
      expect(spec.requestorEmail).toBe('user@example.com');
      expect(spec.identifier).toBe('spaces/AAA');
      expect(spec.requestSummary).toBe('Update two contacts.');
    } finally {
      runs.cleanup();
    }
  });

  it('DEGRADES on a ledger create failure: launches exactly as today, without a jobId', async () => {
    const runs = tempRuns();
    const { d, spawned } = deps({ fail: true });
    try {
      const { json } = await callJson(captureTools(d).bulk_execute, { ...EXEC_ARGS, ...LEDGER_ARGS });
      expect(json.launched).toBe(true);
      expect(json.job_id).toBeUndefined();
      expect(json.poll).toMatch(/bulk_run_status/);
      expect(spawned).toHaveLength(1);
      const spec = new RunStore(runs.dir).readSpec(json.run_id)!;
      expect(spec.jobId).toBeUndefined();
      expect(spec.channel).toBeUndefined();
    } finally {
      runs.cleanup();
    }
  });

  it('without the completion fields, behavior is unchanged: no ledger call, poll flow', async () => {
    const runs = tempRuns();
    const { d, created, spawned } = deps();
    try {
      const { json } = await callJson(captureTools(d).bulk_execute, EXEC_ARGS);
      expect(json.launched).toBe(true);
      expect(json.job_id).toBeUndefined();
      expect(json.delivery).toBeUndefined();
      expect(json.poll).toMatch(/bulk_run_status/);
      expect(created).toHaveLength(0);
      expect(spawned).toHaveLength(1);
      expect(new RunStore(runs.dir).readSpec(json.run_id)!.jobId).toBeUndefined();
    } finally {
      runs.cleanup();
    }
  });

  it('bulk_run_resume relaunches the worker on the SAME spec (jobId travels with the run)', async () => {
    const dir = join(tmpdir(), `lacrm-bulk-async-${randomUUID()}`);
    mkdirSync(dir, { recursive: true });
    process.env.LACRM_BULK_RUNS_DIR = dir;
    const { d, spawned } = deps();
    try {
      writeFileSync(
        join(dir, 'r9.spec.json'),
        JSON.stringify({
          runId: 'r9',
          operation: 'update',
          createdAt: new Date().toISOString(),
          intervalMs: 1000,
          presentColumns: [],
          rows: [{}, {}],
          jobId: 'job-777',
        }),
      );
      writeFileSync(
        join(dir, 'r9.state.json'),
        JSON.stringify({
          runId: 'r9',
          operation: 'update',
          status: 'running',
          total: 2,
          processed: 1,
          succeeded: 1,
          failed: 0,
          startedAt: new Date(Date.now() - 3600_000).toISOString(),
          updatedAt: new Date(Date.now() - 3600_000).toISOString(),
          results: [],
          workerPid: 2147483646, // a pid that cannot be running
        }),
      );
      const { json } = await callJson(captureTools(d).bulk_run_resume, { run_id: 'r9' });
      expect(json.resumed).toBe(true);
      // The relaunched worker reads the same spec file, so the persisted
      // jobId is what it heartbeats and terminal-posts against.
      expect(spawned).toEqual(['r9']);
      expect(json.delivery).toMatch(/delivered automatically|posted automatically/);
      expect(new RunStore(dir).readSpec('r9')!.jobId).toBe('job-777');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('bulk_run_status surfaces the delivered report sheet URL when the worker recorded one', async () => {
    const dir = join(tmpdir(), `lacrm-bulk-async-${randomUUID()}`);
    mkdirSync(dir, { recursive: true });
    process.env.LACRM_BULK_RUNS_DIR = dir;
    try {
      writeFileSync(
        join(dir, 'r10.spec.json'),
        JSON.stringify({
          runId: 'r10', operation: 'update', createdAt: new Date().toISOString(),
          intervalMs: 1000, presentColumns: [], rows: [{}],
        }),
      );
      writeFileSync(
        join(dir, 'r10.state.json'),
        JSON.stringify({
          runId: 'r10', operation: 'update', status: 'completed', total: 1,
          processed: 1, succeeded: 1, failed: 0,
          startedAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
          finishedAt: new Date().toISOString(), results: [],
          reportSheetUrl: 'https://docs.google.com/spreadsheets/d/X/edit',
        }),
      );
      const { json } = await callJson(captureTools().bulk_run_status, { run_id: 'r10' });
      expect(json.reportSheetUrl).toBe('https://docs.google.com/spreadsheets/d/X/edit');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
