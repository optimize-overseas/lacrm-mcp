import { describe, it, expect } from 'vitest';
import { registerBulkTools } from './index.js';

/**
 * Smoke tests for the tool wiring (CSV loading, confirm-gate, estimate, status lookup).
 * The merge/validate/template/runner logic is unit-tested in their own suites; these
 * verify the glue and exercise only the non-writing tools (no LACRM calls).
 */
type Handler = (args: any) => Promise<{ content: { text: string }[]; isError?: boolean }>;

function captureTools(): Record<string, Handler> {
  const tools: Record<string, Handler> = {};
  const fakeServer = {
    registerTool: (name: string, _def: unknown, handler: Handler) => {
      tools[name] = handler;
    },
  };
  registerBulkTools(fakeServer as never);
  return tools;
}

async function callJson(handler: Handler, args: any) {
  const res = await handler(args);
  return { json: JSON.parse(res.content[0].text), isError: res.isError };
}

const UPDATE_FIELDS = [
  { column: '$ Offer', strategy: 'replace' },
  { column: 'Owner Name Aliases', strategy: 'union_semicolon' },
];

describe('registerBulkTools', () => {
  it('registers all four bulk tools', () => {
    const tools = captureTools();
    expect(Object.keys(tools).sort()).toEqual(
      ['bulk_execute', 'bulk_generate_template', 'bulk_run_status', 'bulk_validate_csv'].sort(),
    );
  });

  it('bulk_generate_template returns a CSV and a per-field report', async () => {
    const tools = captureTools();
    const { json } = await callJson(tools.bulk_generate_template, {
      operation: 'update',
      key_column: 'Contact ID',
      fields: UPDATE_FIELDS,
    });
    expect(json.columns).toEqual(['Contact ID', '$ Offer', 'Owner Name Aliases']);
    expect(json.csv.split('\n')[0]).toBe('Contact ID,$ Offer,Owner Name Aliases');
    expect(json.report.find((r: any) => r.column === '$ Offer').behavior.toLowerCase()).toContain('clear');
  });

  it('bulk_validate_csv validates inline content and includes a time estimate', async () => {
    const tools = captureTools();
    const { json } = await callJson(tools.bulk_validate_csv, {
      operation: 'update',
      key_column: 'Contact ID',
      fields: UPDATE_FIELDS,
      csv_content: 'Contact ID,$ Offer\n1,$5\n2,\n',
    });
    expect(json.ok).toBe(true);
    expect(json.rowCount).toBe(2);
    expect(json.presentColumns).toEqual(['$ Offer']);
    expect(json.preservedColumns).toContain('Owner Name Aliases');
    expect(json.estimate.calls).toBe(4); // 2 rows * 2 calls/row (update)
    expect(json.estimate.seconds).toBe(4); // 4 calls * 1s
  });

  it('bulk_validate_csv reports blocking errors and stays ok=false', async () => {
    const tools = captureTools();
    const { json } = await callJson(tools.bulk_validate_csv, {
      operation: 'update',
      key_column: 'Contact ID',
      fields: UPDATE_FIELDS,
      csv_content: '$ Offer\n$5\n', // no Contact ID column
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
      csv_content: 'Contact ID,$ Offer\n1,$5\n',
    });
    expect(json.launched).toBe(false);
    expect(json.reason).toBe('confirmation_required');
  });

  it('bulk_execute refuses when validation fails', async () => {
    const tools = captureTools();
    const { json } = await callJson(tools.bulk_execute, {
      operation: 'update',
      key_column: 'Contact ID',
      fields: UPDATE_FIELDS,
      csv_content: '$ Offer\n$5\n',
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
