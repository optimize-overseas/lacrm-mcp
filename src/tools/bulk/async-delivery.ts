/**
 * Async completion delivery for bulk runs (opt-in, v1.9.0).
 *
 * When `bulk_execute` is called with the OPTIONAL completion fields (channel,
 * requestor_email, identifier), the launcher registers the run as a job with
 * a host-provided async completion service (endpoint from `ASYNC_DAEMON_URL`)
 * BEFORE spawning the worker, and persists the minted jobId into the run spec.
 * The detached worker then:
 *
 *   1. heartbeats the ledger every 60 s while the run is in flight (a silent
 *      job is marked stale well before a multi-thousand-row run at 1 req/s
 *      finishes),
 *   2. at completion optionally uploads the report CSV as an editable Google
 *      Sheet ITSELF (by shelling out to a host-provided CSV->Sheet hook - see
 *      `deliverReportSheet`), and
 *   3. posts the terminal result (SUCCEEDED with the sheet link + plain-
 *      language summary; FAILED with an internal-only reason) that the daemon
 *      delivers back to the user on the originating channel.
 *
 * DEGRADE, NEVER BLOCK: every failure on this path degrades to the pre-v1.9.0
 * behavior. A ledger-create failure launches the run WITHOUT a jobId (the
 * poll-driven `bulk_run_status` flow still works); a spec without a jobId
 * changes nothing at all. The bulk run itself never waits on - and is never
 * refused because of - the completion machinery.
 *
 * PUBLIC-PACKAGE POSTURE: everything here is opt-in via the optional tool
 * params. A caller that never passes them gets byte-identical pre-v1.9.0
 * behavior, no daemon lookups, no hook shell-outs. The Sheet-upload hook is
 * pure opt-in env config (LACRM_BULK_SHEET_PYTHON + LACRM_BULK_SHEET_SCRIPT);
 * when either is unset the worker skips the upload and retains the report
 * file on the host.
 *
 * @module tools/bulk/async-delivery
 */

import { execFile } from 'node:child_process';
import { logger } from '../../utils/logger.js';
import type { BulkRowResult, BulkRunSpec, BulkRunState } from './runstore.js';

/** Ledger skill name reported with each job. */
export const LEDGER_SKILL = 'lacrmbulk';

/** Heartbeat cadence while the worker runs. */
export const HEARTBEAT_INTERVAL_MS = 60_000;

/**
 * The OPTIONAL host-provided CSV -> editable-spreadsheet hook. The worker
 * shells out to it because this package carries no spreadsheet/Drive client of
 * its own; any host can supply any executable honoring the small contract
 * (`<python> <script> --csv <path> --name <name>`, printing one JSON line:
 * {ok:true, sheet_url} or {ok:false, error}).
 *
 * Pure opt-in env config - there are deliberately NO built-in defaults. Both
 * LACRM_BULK_SHEET_PYTHON and LACRM_BULK_SHEET_SCRIPT must be set (used
 * verbatim); when either is unset the upload is disabled and the worker
 * skips it gracefully, retaining the report file on the host.
 */
export function sheetDeliverPython(): string | undefined {
  return process.env.LACRM_BULK_SHEET_PYTHON || undefined;
}

export function sheetDeliverScript(): string | undefined {
  return process.env.LACRM_BULK_SHEET_SCRIPT || undefined;
}

/** True only when BOTH env hooks are set - Sheet upload is pure opt-in. */
export function sheetDeliveryConfigured(): boolean {
  return Boolean(sheetDeliverPython() && sheetDeliverScript());
}

/** Helper subprocess budget: a single small-file Drive upload, generously bounded. */
export const SHEET_DELIVER_TIMEOUT_MS = 180_000;

// ---------------------------------------------------------------------------
// Fire side (bulk_execute / launcher)
// ---------------------------------------------------------------------------

export interface CompletionFields {
  channel?: string;
  requestorEmail?: string;
  identifier?: string;
  requestSummary?: string;
}

/** Structural slice of the SDK's LedgerClient used by the fire side (test seam). */
export interface FireLedger {
  createJob(input: {
    skill: string;
    channel: string;
    requestorEmail: string;
    identifier: string;
    requestSummary?: string;
  }): Promise<string>;
}

/**
 * Maps a skill-facing channel value (any casing; 'GChat' included) to the
 * ledger channel. Returns null when unmappable - the caller then degrades to
 * the poll flow rather than guessing a delivery channel.
 */
export function mapChannelToLedger(channel: string): 'googlechat' | 'gmail' | 'asana' | null {
  switch ((channel || '').trim().toLowerCase()) {
    case 'gchat':
    case 'googlechat':
      return 'googlechat';
    case 'gmail':
      return 'gmail';
    case 'asana':
      return 'asana';
    default:
      return null;
  }
}

/** True when ALL THREE identity fields are present and non-blank. */
export function completionFieldsPresent(fields: CompletionFields): boolean {
  return Boolean(
    (fields.channel || '').trim() &&
      (fields.requestorEmail || '').trim() &&
      (fields.identifier || '').trim(),
  );
}

/**
 * Register the run with the completion daemon. Returns the minted jobId, or
 * undefined when the fields are absent/unmappable or the create failed - in
 * every non-jobId case the caller proceeds exactly as before v1.9.0 (the
 * ledger must never block a bulk run).
 */
export async function registerLedgerJob(
  fields: CompletionFields,
  ledger: FireLedger,
): Promise<string | undefined> {
  if (!completionFieldsPresent(fields)) return undefined;
  const channel = mapChannelToLedger(fields.channel!);
  if (!channel) {
    logger.warn(
      `bulk async: unmappable channel ${JSON.stringify(fields.channel)} - launching without completion delivery`,
    );
    return undefined;
  }
  try {
    const jobId = await ledger.createJob({
      skill: LEDGER_SKILL,
      channel,
      requestorEmail: fields.requestorEmail!.trim(),
      identifier: fields.identifier!.trim(),
      ...((fields.requestSummary || '').trim()
        ? { requestSummary: fields.requestSummary!.trim() }
        : {}),
    });
    return jobId;
  } catch (err) {
    logger.warn(
      `bulk async: ledger create failed - launching without completion delivery: ${err instanceof Error ? err.message : String(err)}`,
    );
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Worker side (report Sheet delivery + terminal post)
// ---------------------------------------------------------------------------

export type DeliverSheetResult = { ok: true; sheetUrl: string } | { ok: false; error: string };

/** Test seam for the helper subprocess: resolves with stdout, rejects on failure. */
export type ExecFn = (file: string, args: string[]) => Promise<{ stdout: string }>;

function defaultExec(file: string, args: string[]): Promise<{ stdout: string }> {
  return new Promise((resolve, reject) => {
    execFile(
      file,
      args,
      { timeout: SHEET_DELIVER_TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024 },
      (err, stdout) => {
        if (err) reject(err);
        else resolve({ stdout: String(stdout) });
      },
    );
  });
}

/** Display name for the delivered report Sheet (timestamped US Central). */
export function reportSheetName(runId: string, at: Date = new Date()): string {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Chicago',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const parts = Object.fromEntries(fmt.formatToParts(at).map((p) => [p.type, p.value]));
  return `CRM Bulk Upload Report (run ${runId}) - ${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute} CT`;
}

/**
 * Deliver the report CSV as an editable Google Sheet via the optional host
 * hook. The hook prints one JSON line: {ok:true, sheet_url} or
 * {ok:false, error}. When the hook is not configured this returns ok:false
 * without shelling out (callers that care should check
 * `sheetDeliveryConfigured()` first and skip instead).
 */
export async function deliverReportSheet(
  csvPath: string,
  name: string,
  execFn: ExecFn = defaultExec,
): Promise<DeliverSheetResult> {
  const python = sheetDeliverPython();
  const script = sheetDeliverScript();
  if (!python || !script) {
    return {
      ok: false,
      error:
        'sheet-upload hook not configured (LACRM_BULK_SHEET_PYTHON / LACRM_BULK_SHEET_SCRIPT unset)',
    };
  }
  try {
    const { stdout } = await execFn(python, [
      script,
      '--csv',
      csvPath,
      '--name',
      name,
    ]);
    const lines = stdout.split('\n').filter((l) => l.trim());
    const parsed = JSON.parse(lines[lines.length - 1] || '{}') as {
      ok?: boolean;
      sheet_url?: string;
      error?: string;
    };
    if (parsed.ok && parsed.sheet_url) return { ok: true, sheetUrl: parsed.sheet_url };
    return { ok: false, error: parsed.error || 'helper returned no sheet_url' };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Per-outcome counts for the terminal result (ledger `result.counts`). */
export function composeCounts(results: BulkRowResult[]): Record<string, number> {
  const counts = { created: 0, updated: 0, skipped: 0, failed: 0 };
  for (const r of results) {
    if (r.status === 'created') counts.created += 1;
    else if (r.status === 'updated') counts.updated += 1;
    else if (r.status === 'no_change') counts.skipped += 1;
    else counts.failed += 1;
  }
  return counts;
}

function n(value: number): string {
  return value.toLocaleString('en-US');
}

/**
 * The plain-language completion summary (ledger `result.userText`) - the same
 * register the skill used to compose from bulk_run_status: lead with "N of M",
 * name what actually changed, point failures at the report Sheet. Purely
 * deterministic - never a model call (it is the verbatim fallback text when
 * AI re-composition fails).
 */
export function composeUserText(
  state: BulkRunState,
  counts: Record<string, number>,
  sheetUrl: string | null,
  uploadSkipped = false,
): string {
  const total = state.total;
  const applied = counts.created + counts.updated;
  const lines: string[] = [];

  if (state.operation === 'create') {
    lines.push(`Bulk contact import finished: ${n(counts.created)} of ${n(total)} contacts created.`);
  } else {
    let lead = `Bulk contact update finished: ${n(counts.updated)} of ${n(total)} contacts updated`;
    const extras: string[] = [];
    if (counts.created > 0) extras.push(`${n(counts.created)} created as new contacts`);
    if (counts.skipped > 0) extras.push(`${n(counts.skipped)} already matched and needed no changes`);
    if (extras.length > 0) lead += ` (${extras.join('; ')})`;
    lines.push(`${lead}.`);
  }

  if (counts.failed > 0) {
    lines.push(
      `${n(counts.failed)} ${counts.failed === 1 ? 'row' : 'rows'} could not be applied - the report below lists each one with what went wrong.`,
    );
  }
  if (applied === 0 && counts.failed === 0 && counts.skipped > 0) {
    lines.push('No contacts needed changes.');
  }

  if (sheetUrl) {
    lines.push(`Full row-by-row report: ${sheetUrl}`);
  } else if (uploadSkipped) {
    // Sheet upload is an opt-in host hook; when it is not configured the
    // report file stays behind. Never surface a filesystem path here - paths
    // are host jargon, not user language.
    lines.push('The full row-by-row report file was retained on the host and can be shared on request.');
  } else {
    lines.push(
      'The row-by-row report spreadsheet could not be created this time; the full results are saved and can be shared on request.',
    );
  }
  return lines.join('\n');
}

/** Structural slice of the SDK's LedgerClient used by the worker (test seam). */
export interface TerminalLedger {
  terminalUpdate(
    jobId: string,
    patch: {
      status: 'SUCCEEDED' | 'FAILED' | 'REVIEW_REQUIRED';
      result: {
        links?: string[];
        counts?: Record<string, number>;
        reason?: string;
        userText?: string;
      };
      finishedAt?: number;
    },
  ): Promise<boolean>;
}

export interface CompleteDeps {
  ledger: TerminalLedger;
  deliver?: (csvPath: string, name: string) => Promise<DeliverSheetResult>;
  /** Persist the delivered sheet URL back into run state (status-on-demand). */
  saveSheetUrl?: (url: string) => void;
  now?: () => number;
}

/**
 * The worker's completion step for a ledger-registered run: upload the report
 * Sheet when the optional host hook is configured (one retry), then post the
 * terminal update. The upload is SKIPPED gracefully (one log line) when the
 * hook env vars are unset - the run still posts SUCCEEDED with its counts,
 * and the summary notes the report file was retained on the host. A
 * Sheet-delivery failure likewise NEVER turns a completed run into a FAILED
 * job - the CRM writes happened. A spec without a jobId is a no-op
 * (pre-v1.9.0 behavior byte-identical).
 */
export async function completeLedgerRun(
  spec: BulkRunSpec,
  state: BulkRunState,
  deps: CompleteDeps,
): Promise<void> {
  if (!spec.jobId) return;
  const now = deps.now ?? Date.now;

  if (state.status !== 'completed') {
    // Worker-fatal run: reason is INTERNAL-ONLY (the daemon routes it to the
    // operator escalation path; the user gets the daemon's plain failure template).
    await deps.ledger.terminalUpdate(spec.jobId, {
      status: 'FAILED',
      result: { reason: state.error || `bulk run ended with status ${state.status}` },
      finishedAt: now(),
    });
    return;
  }

  const deliver =
    deps.deliver ?? (sheetDeliveryConfigured() ? deliverReportSheet : undefined);
  let sheetUrl: string | null = null;
  let uploadSkipped = false;
  if (state.reportCsvPath) {
    if (!deliver) {
      // The Sheet-upload hook is opt-in; unset env vars mean skip, not fail.
      uploadSkipped = true;
      logger.info(
        'bulk async: Sheet-upload hook not configured (LACRM_BULK_SHEET_PYTHON / LACRM_BULK_SHEET_SCRIPT unset) - skipping report upload; the report file is retained on the host',
      );
    } else {
      const name = reportSheetName(spec.runId);
      let attempt = await deliver(state.reportCsvPath, name);
      if (!attempt.ok) {
        logger.warn(`bulk async: report Sheet delivery failed (retrying once): ${attempt.error}`);
        attempt = await deliver(state.reportCsvPath, name);
      }
      if (attempt.ok) {
        sheetUrl = attempt.sheetUrl;
        try {
          deps.saveSheetUrl?.(sheetUrl);
        } catch (err) {
          logger.warn(
            `bulk async: could not persist reportSheetUrl: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      } else {
        logger.error(`bulk async: report Sheet delivery failed after retry: ${attempt.error}`);
      }
    }
  }

  const counts = composeCounts(state.results);
  await deps.ledger.terminalUpdate(spec.jobId, {
    status: 'SUCCEEDED',
    result: {
      links: sheetUrl ? [sheetUrl] : [],
      counts,
      userText: composeUserText(state, counts, sheetUrl, uploadSkipped),
    },
    finishedAt: now(),
  });
}
