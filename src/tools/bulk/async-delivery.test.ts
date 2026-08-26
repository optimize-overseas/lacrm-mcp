import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  LEDGER_SKILL,
  HEARTBEAT_INTERVAL_MS,
  mapChannelToLedger,
  completionFieldsPresent,
  registerLedgerJob,
  reportSheetName,
  deliverReportSheet,
  composeCounts,
  composeUserText,
  completeLedgerRun,
  sheetDeliverPython,
  sheetDeliverScript,
  sheetDeliveryConfigured,
  type FireLedger,
  type TerminalLedger,
} from './async-delivery.js';
import type { BulkRowResult, BulkRunSpec, BulkRunState } from './runstore.js';

const FIELDS = {
  channel: 'googlechat',
  requestorEmail: 'user@example.com',
  identifier: 'spaces/AAA',
  requestSummary: 'Update 100 contacts from the June letter file.',
};

function fireLedger(behavior?: { fail?: boolean }) {
  const calls: unknown[] = [];
  const ledger: FireLedger = {
    async createJob(input) {
      calls.push(input);
      if (behavior?.fail) throw new Error('daemon down');
      return 'job-123';
    },
  };
  return { ledger, calls };
}

function terminalLedger() {
  const calls: { jobId: string; patch: unknown }[] = [];
  const ledger: TerminalLedger = {
    async terminalUpdate(jobId, patch) {
      calls.push({ jobId, patch });
      return true;
    },
  };
  return { ledger, calls };
}

const SPEC: BulkRunSpec = {
  runId: 'run-9',
  operation: 'update',
  createdAt: '2026-07-21T00:00:00Z',
  keyColumn: 'Contact ID',
  presentColumns: ['Status'],
  rows: [],
  channel: 'googlechat',
  requestorEmail: 'user@example.com',
  identifier: 'spaces/AAA',
  requestSummary: 'Update contacts.',
  jobId: 'job-123',
};

function state(over: Partial<BulkRunState> = {}): BulkRunState {
  return {
    runId: 'run-9',
    operation: 'update',
    status: 'completed',
    total: 4,
    processed: 4,
    succeeded: 3,
    failed: 1,
    startedAt: '2026-07-21T00:00:00Z',
    updatedAt: '2026-07-21T00:30:00Z',
    finishedAt: '2026-07-21T00:30:00Z',
    reportCsvPath: '/tmp/lacrm-bulk-runs/run-9.report.csv',
    results: [
      { rowNumber: 1, key: '1', contactId: '1', status: 'updated' },
      { rowNumber: 2, key: '2', contactId: '2', status: 'created' },
      { rowNumber: 3, key: '3', contactId: '3', status: 'no_change' },
      { rowNumber: 4, key: '4', status: 'error', message: 'not found' },
    ],
    ...over,
  };
}

describe('mapChannelToLedger', () => {
  it('maps the skill-facing forms, any casing', () => {
    expect(mapChannelToLedger('GChat')).toBe('googlechat');
    expect(mapChannelToLedger('googlechat')).toBe('googlechat');
    expect(mapChannelToLedger('Gmail')).toBe('gmail');
    expect(mapChannelToLedger(' Asana ')).toBe('asana');
  });

  it('returns null on anything else - the caller degrades, never guesses', () => {
    expect(mapChannelToLedger('slack')).toBeNull();
    expect(mapChannelToLedger('')).toBeNull();
  });
});

describe('completionFieldsPresent', () => {
  it('requires ALL THREE identity fields, non-blank', () => {
    expect(completionFieldsPresent(FIELDS)).toBe(true);
    expect(completionFieldsPresent({ ...FIELDS, channel: undefined })).toBe(false);
    expect(completionFieldsPresent({ ...FIELDS, requestorEmail: ' ' })).toBe(false);
    expect(completionFieldsPresent({ ...FIELDS, identifier: '' })).toBe(false);
    expect(completionFieldsPresent({})).toBe(false);
  });

  it('does not require request_summary (optional on the wire)', () => {
    expect(completionFieldsPresent({ ...FIELDS, requestSummary: undefined })).toBe(true);
  });
});

describe('registerLedgerJob', () => {
  it('registers with skill lacrmbulk and the mapped channel, returning the jobId', async () => {
    const { ledger, calls } = fireLedger();
    const jobId = await registerLedgerJob({ ...FIELDS, channel: 'GChat' }, ledger);
    expect(jobId).toBe('job-123');
    // Byte-pin the create body keys and values: this is the wire contract.
    expect(calls).toEqual([
      {
        skill: LEDGER_SKILL,
        channel: 'googlechat',
        requestorEmail: 'user@example.com',
        identifier: 'spaces/AAA',
        requestSummary: 'Update 100 contacts from the June letter file.',
      },
    ]);
  });

  it('omits requestSummary from the create body when blank', async () => {
    const { ledger, calls } = fireLedger();
    await registerLedgerJob({ ...FIELDS, requestSummary: '  ' }, ledger);
    expect(Object.keys(calls[0] as object)).not.toContain('requestSummary');
  });

  it('returns undefined without calling the ledger when any identity field is missing', async () => {
    const { ledger, calls } = fireLedger();
    expect(await registerLedgerJob({ ...FIELDS, identifier: '' }, ledger)).toBeUndefined();
    expect(await registerLedgerJob({}, ledger)).toBeUndefined();
    expect(calls).toHaveLength(0);
  });

  it('returns undefined on an unmappable channel without calling the ledger', async () => {
    const { ledger, calls } = fireLedger();
    expect(await registerLedgerJob({ ...FIELDS, channel: 'carrier-pigeon' }, ledger)).toBeUndefined();
    expect(calls).toHaveLength(0);
  });

  it('DEGRADES on a create failure: returns undefined, never throws', async () => {
    const { ledger } = fireLedger({ fail: true });
    await expect(registerLedgerJob(FIELDS, ledger)).resolves.toBeUndefined();
  });
});

describe('reportSheetName', () => {
  it('matches the interactive naming convention, timestamped US Central', () => {
    // 2026-07-21 18:30 UTC = 13:30 CT (CDT).
    const name = reportSheetName('run-9', new Date('2026-07-21T18:30:00Z'));
    expect(name).toBe('CRM Bulk Upload Report (run run-9) - 2026-07-21 13:30 CT');
  });
});

describe('sheet-upload hook config (pure opt-in env)', () => {
  it('uses the env values verbatim when set', () => {
    process.env.LACRM_BULK_SHEET_PYTHON = '/custom/python';
    process.env.LACRM_BULK_SHEET_SCRIPT = '/custom/deliver.py';
    try {
      expect(sheetDeliverPython()).toBe('/custom/python');
      expect(sheetDeliverScript()).toBe('/custom/deliver.py');
      expect(sheetDeliveryConfigured()).toBe(true);
    } finally {
      delete process.env.LACRM_BULK_SHEET_PYTHON;
      delete process.env.LACRM_BULK_SHEET_SCRIPT;
    }
  });

  it('is disabled when unset - there are NO built-in defaults', () => {
    delete process.env.LACRM_BULK_SHEET_PYTHON;
    delete process.env.LACRM_BULK_SHEET_SCRIPT;
    expect(sheetDeliverPython()).toBeUndefined();
    expect(sheetDeliverScript()).toBeUndefined();
    expect(sheetDeliveryConfigured()).toBe(false);
  });

  it('requires BOTH env vars - one alone stays disabled', () => {
    process.env.LACRM_BULK_SHEET_PYTHON = '/custom/python';
    delete process.env.LACRM_BULK_SHEET_SCRIPT;
    try {
      expect(sheetDeliveryConfigured()).toBe(false);
    } finally {
      delete process.env.LACRM_BULK_SHEET_PYTHON;
    }
  });
});

describe('deliverReportSheet', () => {
  beforeEach(() => {
    process.env.LACRM_BULK_SHEET_PYTHON = '/custom/python';
    process.env.LACRM_BULK_SHEET_SCRIPT = '/custom/deliver.py';
  });
  afterEach(() => {
    delete process.env.LACRM_BULK_SHEET_PYTHON;
    delete process.env.LACRM_BULK_SHEET_SCRIPT;
  });

  it('passes the configured hook, --csv, and --name and parses its JSON', async () => {
    const seen: string[][] = [];
    const result = await deliverReportSheet('/tmp/r.csv', 'My Report', async (file, args) => {
      seen.push([file, ...args]);
      return { stdout: '{"ok": true, "sheet_url": "https://docs.google.com/spreadsheets/d/X/edit"}\n' };
    });
    expect(result).toEqual({ ok: true, sheetUrl: 'https://docs.google.com/spreadsheets/d/X/edit' });
    expect(seen[0]).toEqual(['/custom/python', '/custom/deliver.py', '--csv', '/tmp/r.csv', '--name', 'My Report']);
  });

  it('returns ok:false WITHOUT invoking the hook when unconfigured', async () => {
    delete process.env.LACRM_BULK_SHEET_PYTHON;
    delete process.env.LACRM_BULK_SHEET_SCRIPT;
    const result = await deliverReportSheet('/tmp/r.csv', 'N', async () => {
      throw new Error('must not be called');
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('not configured');
  });

  it('reads the LAST stdout line (the hook may log above its JSON)', async () => {
    const result = await deliverReportSheet('/tmp/r.csv', 'N', async () => ({
      stdout: 'noise\n{"ok": true, "sheet_url": "https://sheet"}\n',
    }));
    expect(result).toEqual({ ok: true, sheetUrl: 'https://sheet' });
  });

  it('returns ok:false on a hook error JSON, a malformed line, or an exec failure', async () => {
    expect(
      await deliverReportSheet('/tmp/r.csv', 'N', async () => ({ stdout: '{"ok": false, "error": "boom"}' })),
    ).toEqual({ ok: false, error: 'boom' });
    expect((await deliverReportSheet('/tmp/r.csv', 'N', async () => ({ stdout: 'not json' }))).ok).toBe(false);
    expect(
      (
        await deliverReportSheet('/tmp/r.csv', 'N', async () => {
          throw new Error('spawn ENOENT');
        })
      ).ok,
    ).toBe(false);
  });
});

describe('composeCounts', () => {
  it('maps row statuses to created/updated/skipped/failed', () => {
    expect(composeCounts(state().results)).toEqual({ created: 1, updated: 1, skipped: 1, failed: 1 });
    expect(composeCounts([])).toEqual({ created: 0, updated: 0, skipped: 0, failed: 0 });
  });
});

describe('composeUserText', () => {
  it('update mode: leads with N of M, names extras, points failures at the report', () => {
    const s = state({ total: 1204 });
    const results: BulkRowResult[] = [];
    for (let i = 0; i < 1180; i++) results.push({ rowNumber: i + 1, status: 'updated' });
    for (let i = 0; i < 24; i++) results.push({ rowNumber: 1181 + i, status: 'error', message: 'x' });
    const text = composeUserText(s, composeCounts(results), 'https://sheet');
    expect(text).toContain('1,180 of 1,204 contacts updated');
    expect(text).toContain('24 rows could not be applied');
    expect(text).toContain('Full row-by-row report: https://sheet');
    // Plain language only - never wire-format fields or jargon.
    expect(text).not.toMatch(/jobId|run_id|reportCsvPath|SUCCEEDED/);
  });

  it('create mode: leads with created counts', () => {
    const s = state({ operation: 'create', total: 3 });
    const counts = { created: 3, updated: 0, skipped: 0, failed: 0 };
    expect(composeUserText(s, counts, 'https://sheet')).toContain('3 of 3 contacts created');
  });

  it('a failed Sheet delivery is stated plainly, without a link', () => {
    const text = composeUserText(state(), composeCounts(state().results), null);
    expect(text).toContain('report spreadsheet could not be created');
    expect(text).not.toContain('https://');
  });

  it('a SKIPPED upload notes the report was retained - no failure language, no paths', () => {
    const text = composeUserText(state(), composeCounts(state().results), null, true);
    expect(text).toContain('retained on the host');
    expect(text).not.toContain('could not be created');
    expect(text).not.toContain('https://');
    expect(text).not.toContain('/tmp/');
  });
});

describe('completeLedgerRun', () => {
  it('is a NO-OP without a jobId (pre-v1.9.0 behavior byte-identical)', async () => {
    const { ledger, calls } = terminalLedger();
    await completeLedgerRun({ ...SPEC, jobId: undefined }, state(), {
      ledger,
      deliver: async () => {
        throw new Error('must not be called');
      },
    });
    expect(calls).toHaveLength(0);
  });

  it('posts SUCCEEDED with the sheet link, counts, and userText', async () => {
    const { ledger, calls } = terminalLedger();
    const saved: string[] = [];
    await completeLedgerRun(SPEC, state(), {
      ledger,
      deliver: async () => ({ ok: true, sheetUrl: 'https://sheet' }),
      saveSheetUrl: (u) => saved.push(u),
      now: () => 1_753_000_000_000,
    });
    expect(saved).toEqual(['https://sheet']);
    expect(calls).toEqual([
      {
        jobId: 'job-123',
        patch: {
          status: 'SUCCEEDED',
          result: {
            links: ['https://sheet'],
            counts: { created: 1, updated: 1, skipped: 1, failed: 1 },
            userText: expect.stringContaining('Full row-by-row report: https://sheet'),
          },
          finishedAt: 1_753_000_000_000,
        },
      },
    ]);
  });

  it('retries the Sheet delivery once, then still posts SUCCEEDED without a link', async () => {
    const { ledger, calls } = terminalLedger();
    let attempts = 0;
    await completeLedgerRun(SPEC, state(), {
      ledger,
      deliver: async () => {
        attempts += 1;
        return { ok: false, error: 'quota' };
      },
    });
    expect(attempts).toBe(2);
    const patch = calls[0].patch as { status: string; result: { links: string[]; userText: string } };
    expect(patch.status).toBe('SUCCEEDED');
    expect(patch.result.links).toEqual([]);
    expect(patch.result.userText).toContain('report spreadsheet could not be created');
  });

  it('SKIPS the upload gracefully when the hook env is unset: still SUCCEEDED with counts', async () => {
    // No deps.deliver and no LACRM_BULK_SHEET_* env: the default path must
    // skip (never attempt a subprocess) and still post a successful terminal.
    delete process.env.LACRM_BULK_SHEET_PYTHON;
    delete process.env.LACRM_BULK_SHEET_SCRIPT;
    const { ledger, calls } = terminalLedger();
    await completeLedgerRun(SPEC, state(), { ledger, now: () => 7 });
    const patch = calls[0].patch as {
      status: string;
      result: { links: string[]; counts: Record<string, number>; userText: string };
    };
    expect(patch.status).toBe('SUCCEEDED');
    expect(patch.result.links).toEqual([]);
    expect(patch.result.counts).toEqual({ created: 1, updated: 1, skipped: 1, failed: 1 });
    expect(patch.result.userText).toContain('retained on the host');
    expect(patch.result.userText).not.toContain('could not be created');
  });

  it('a worker-fatal run posts FAILED with an INTERNAL-ONLY reason and no userText', async () => {
    const { ledger, calls } = terminalLedger();
    await completeLedgerRun(SPEC, state({ status: 'failed', error: 'ENOSPC writing state' }), {
      ledger,
      deliver: async () => {
        throw new Error('must not deliver on failure');
      },
      now: () => 42,
    });
    expect(calls).toEqual([
      {
        jobId: 'job-123',
        patch: {
          status: 'FAILED',
          result: { reason: 'ENOSPC writing state' },
          finishedAt: 42,
        },
      },
    ]);
  });

  it('resume semantics: the jobId travels in the spec, so a resumed run completes the SAME job', async () => {
    // A resume relaunches the worker with the same runId; the worker re-reads
    // the spec - same jobId in, same jobId posted.
    const { ledger, calls } = terminalLedger();
    const resumedSpec = JSON.parse(JSON.stringify(SPEC)) as BulkRunSpec;
    await completeLedgerRun(resumedSpec, state(), {
      ledger,
      deliver: async () => ({ ok: true, sheetUrl: 'https://sheet' }),
    });
    expect(calls[0].jobId).toBe('job-123');
  });
});

describe('constants', () => {
  it('heartbeats every 60s while the run is in flight', () => {
    expect(HEARTBEAT_INTERVAL_MS).toBe(60_000);
  });
});
