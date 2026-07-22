/**
 * File-based persistence for bulk runs.
 *
 * A bulk run is detached from the MCP request that launches it, so its spec (config
 * + rows) and live state (progress) live on disk where a separate worker process
 * writes them and a later `bulk_run_status` call reads them.
 *
 * The files survive an MCP or host restart; the WORKER does not. State is
 * rewritten after every row precisely so an interrupted run can be picked up
 * from where it stopped (`bulk_run_resume`) instead of being redone.
 *
 * The directory is configurable via `LACRM_BULK_RUNS_DIR`.
 *
 * @module tools/bulk/runstore
 */

import { mkdirSync, writeFileSync, readFileSync, existsSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { FieldSpec } from './types.js';
import type { CreateConfig } from './create.js';
import type { AddressColumnMapping } from './address.js';

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
  /** Update-mode structured-address mapping (append-if-absent). */
  updateAddressConfig?: AddressColumnMapping;
  /** Create-mode field mapping. */
  createConfig?: CreateConfig;
  /** Columns present in the uploaded CSV header. */
  presentColumns: string[];
  /** Parsed CSV rows, keyed by column. */
  rows: Record<string, string>[];
  /**
   * OPTIONAL async-completion fields (all-or-nothing in practice; see
   * tools/bulk/async-delivery). When the launcher registered the run with a
   * host completion daemon, `jobId` is set and the worker posts heartbeats and
   * the terminal result itself; a resumed run reads the SAME jobId from this
   * spec and completes the same ledger job. When absent, behavior is exactly
   * the pre-v1.9.0 poll-driven flow.
   */
  /** Originating channel of the request ('gmail' | 'asana' | 'googlechat'). */
  channel?: string;
  /** Email address of the requesting user. */
  requestorEmail?: string;
  /** Channel-native message identifier (mail id / task gid / space), case-exact. */
  identifier?: string;
  /** 1-3 sentence plain-language restatement of what was asked, authored at fire time. */
  requestSummary?: string;
  /** Completion-daemon job id minted at launch; the worker's delivery handle. */
  jobId?: string;
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
  /** URL of the report delivered as an editable Google Sheet (async runs only;
   * written by the worker after upload so a status read can hand out the link). */
  reportSheetUrl?: string;
  /** Set if the worker hit a fatal error. */
  error?: string;
  /**
   * Process id of the worker that owns this run, stamped by the worker itself
   * (never by the launcher, which would race the worker's first state write).
   * Lets a status read tell "still working" from "died without finishing" -
   * see tools/bulk/liveness. Absent on runs started before this was recorded.
   */
  workerPid?: number;
  /** ISO timestamp at which that worker took the run over (a fresh one on resume). */
  workerStartedAt?: string;
  /** How many times this run has been resumed after an interruption. */
  resumeCount?: number;
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
