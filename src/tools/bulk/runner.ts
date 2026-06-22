/**
 * The bulk-run orchestration engine.
 *
 * Drives a whole run: for each CSV row, calls LACRM through an injected `call`
 * function (so it is fully testable with no network), applies the merge/create
 * logic, records per-row outcomes, and persists progress after every row so a
 * crashed run can resume. Per-row failures are isolated — one bad contact never
 * aborts the batch. A fatal error (e.g. persistence failure) marks the run failed.
 *
 * Pure of any LACRM/MCP coupling: the worker entry point wires in the real client.
 *
 * @module tools/bulk/runner
 */

import { writeFileSync } from 'node:fs';
import { computeUpdateParams } from './merge.js';
import { buildCreateParams } from './create.js';
import { csvRow } from './csv.js';
import type { SequentialThrottle } from './throttle.js';
import type { RunStore, BulkRunSpec, BulkRunState, BulkRowResult } from './runstore.js';

/** A throttled LACRM API call: (functionName, params) -> result. */
export interface LacrmCall {
  (functionName: string, params: Record<string, unknown>): Promise<any>;
}

export interface RunnerDeps {
  call: LacrmCall;
  store: RunStore;
  throttle: SequentialThrottle;
  /** ISO timestamp provider (injectable for deterministic tests). */
  now?: () => string;
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Build the per-run report CSV from row results. */
export function buildReportCsv(results: BulkRowResult[]): string {
  const lines = [csvRow(['Row', 'Key', 'ContactId', 'Status', 'Message'])];
  for (const r of results) {
    lines.push(csvRow([String(r.rowNumber), r.key ?? '', r.contactId ?? '', r.status, r.message ?? '']));
  }
  return lines.join('\n');
}

async function processRow(
  spec: BulkRunSpec,
  row: Record<string, string>,
  rowNumber: number,
  deps: RunnerDeps,
): Promise<BulkRowResult> {
  try {
    if (spec.operation === 'create') {
      const params = buildCreateParams(spec.createConfig!, row);
      const created = await deps.throttle.run(() => deps.call('CreateContact', params));
      return { rowNumber, contactId: created?.ContactId, status: 'created' };
    }

    // update mode
    const key = (row[spec.keyColumn!] ?? '').trim();
    if (!key) return { rowNumber, status: 'error', message: 'Missing key value' };

    let existing: Record<string, unknown>;
    try {
      existing = await deps.throttle.run(() => deps.call('GetContact', { ContactId: key }));
    } catch (err) {
      if (spec.createIfMissing && spec.createConfig) {
        const params = buildCreateParams(spec.createConfig, row);
        const created = await deps.throttle.run(() => deps.call('CreateContact', params));
        return { rowNumber, key, contactId: created?.ContactId, status: 'created' };
      }
      return { rowNumber, key, status: 'error', message: `Contact not found or unreadable: ${messageOf(err)}` };
    }

    const params = computeUpdateParams({
      fields: spec.fields ?? [],
      presentColumns: spec.presentColumns,
      row,
      existing: existing ?? {},
      addressConfig: spec.updateAddressConfig,
    });
    if (Object.keys(params).length === 0) {
      return { rowNumber, key, contactId: key, status: 'no_change' };
    }
    await deps.throttle.run(() => deps.call('EditContact', { ContactId: key, ...params }));
    return { rowNumber, key, contactId: key, status: 'updated' };
  } catch (err) {
    return { rowNumber, status: 'error', message: messageOf(err) };
  }
}

export async function runBulk(spec: BulkRunSpec, deps: RunnerDeps): Promise<BulkRunState> {
  const now = deps.now ?? (() => new Date().toISOString());

  let state: BulkRunState =
    deps.store.readState(spec.runId) ?? {
      runId: spec.runId,
      operation: spec.operation,
      status: 'running',
      total: spec.rows.length,
      processed: 0,
      succeeded: 0,
      failed: 0,
      startedAt: now(),
      updatedAt: now(),
      results: [],
    };
  deps.store.writeState(state);

  try {
    for (let i = state.processed; i < spec.rows.length; i++) {
      const result = await processRow(spec, spec.rows[i], i + 1, deps);
      state.results.push(result);
      state.processed = i + 1;
      if (result.status === 'error') state.failed += 1;
      else state.succeeded += 1;
      state.updatedAt = now();
      deps.store.writeState(state);
    }

    const reportPath = deps.store.reportPath(spec.runId);
    writeFileSync(reportPath, buildReportCsv(state.results));
    state.reportCsvPath = reportPath;
    state.status = 'completed';
    state.finishedAt = now();
    deps.store.writeState(state);
  } catch (err) {
    state.status = 'failed';
    state.error = messageOf(err);
    state.finishedAt = now();
    deps.store.writeState(state);
  }

  return state;
}
