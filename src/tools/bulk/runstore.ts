/**
 * File-based persistence for bulk runs.
 *
 * A bulk run is detached from the MCP request that launches it, so its spec (config
 * + rows) and live state (progress) live on disk where a separate worker process
 * writes them and a later `bulk_run_status` call reads them. State survives MCP and
 * host restarts. The directory is configurable via `LACRM_BULK_RUNS_DIR`.
 *
 * @module tools/bulk/runstore
 */

import { mkdirSync, writeFileSync, readFileSync, existsSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { FieldSpec } from './types.js';
import type { CreateConfig } from './create.js';

/** The immutable spec for a run: everything the worker needs to execute it. */
export interface BulkRunSpec {
  runId: string;
  operation: 'create' | 'update';
  /** ISO timestamp set by the launcher. */
  createdAt: string;
  /** Update mode: the identity column (e.g. a Contact ID column). */
  keyColumn?: string;
  /** Update mode: create a contact when the key is not found (default false). */
  createIfMissing?: boolean;
  /** Minimum ms between API calls (throttle). Default 1000. */
  intervalMs?: number;
  /** Update-mode merge fields. */
  fields?: FieldSpec[];
  /** Create-mode field mapping. */
  createConfig?: CreateConfig;
  /** Columns present in the uploaded CSV header. */
  presentColumns: string[];
  /** Parsed CSV rows, keyed by column. */
  rows: Record<string, string>[];
}

export type BulkRowStatus = 'updated' | 'created' | 'no_change' | 'error';

export interface BulkRowResult {
  rowNumber: number;
  key?: string;
  contactId?: string;
  status: BulkRowStatus;
  message?: string;
}

export interface BulkRunState {
  runId: string;
  operation: 'create' | 'update';
  status: 'running' | 'completed' | 'failed';
  total: number;
  processed: number;
  succeeded: number;
  failed: number;
  startedAt: string;
  updatedAt: string;
  finishedAt?: string;
  results: BulkRowResult[];
  reportCsvPath?: string;
  /** Set if the worker hit a fatal error. */
  error?: string;
}

/** The default runs directory: `$LACRM_BULK_RUNS_DIR` or `<os-temp>/lacrm-bulk-runs`. */
export function defaultRunsDir(): string {
  return process.env.LACRM_BULK_RUNS_DIR || join(tmpdir(), 'lacrm-bulk-runs');
}

export class RunStore {
  constructor(private readonly dir: string) {}

  private ensure(): void {
    mkdirSync(this.dir, { recursive: true });
  }

  private specPath(runId: string): string {
    return join(this.dir, `${runId}.spec.json`);
  }

  private statePath(runId: string): string {
    return join(this.dir, `${runId}.state.json`);
  }

  reportPath(runId: string): string {
    return join(this.dir, `${runId}.report.csv`);
  }

  writeSpec(spec: BulkRunSpec): void {
    this.ensure();
    writeFileSync(this.specPath(spec.runId), JSON.stringify(spec, null, 2));
  }

  readSpec(runId: string): BulkRunSpec | null {
    const path = this.specPath(runId);
    return existsSync(path) ? (JSON.parse(readFileSync(path, 'utf-8')) as BulkRunSpec) : null;
  }

  /** Write state atomically (tmp file + rename) so readers never see a partial write. */
  writeState(state: BulkRunState): void {
    this.ensure();
    const path = this.statePath(state.runId);
    const tmp = `${path}.tmp`;
    writeFileSync(tmp, JSON.stringify(state, null, 2));
    renameSync(tmp, path);
  }

  readState(runId: string): BulkRunState | null {
    const path = this.statePath(runId);
    return existsSync(path) ? (JSON.parse(readFileSync(path, 'utf-8')) as BulkRunState) : null;
  }
}
