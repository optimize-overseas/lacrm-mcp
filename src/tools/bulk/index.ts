/**
 * Generic bulk-CSV tools for LACRM.
 *
 * Five tools let a caller import or update contacts in bulk from a CSV while
 * honoring LACRM's 1-request/second agreement:
 *
 *   - bulk_generate_template : produce a ready-to-fill CSV + a per-field behavior report
 *   - bulk_validate_csv      : dry-run validation (zero writes) + a time estimate
 *   - bulk_execute           : launch a detached, throttled worker; returns a run id
 *   - bulk_run_status        : progress, per-row errors, and the report-CSV path
 *   - bulk_run_resume        : continue a run whose worker died, from the first
 *                              unprocessed row (never reapplies completed rows)
 *
 * INSTANCE-AGNOSTIC BY DESIGN: nothing here encodes any particular CRM's fields,
 * merge rules, defaults, or use cases. The caller supplies the entire field
 * configuration (which columns exist, how each merges, create defaults) at call time.
 *
 * @module tools/bulk
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { formatErrorForLLM } from '../../utils/errors.js';
import { logger } from '../../utils/logger.js';
import { parseCsv } from './csv.js';
import { validateBulkCsv } from './validate.js';
import { generateTemplate } from './template.js';
import { LedgerClient } from '@optimizeoverseas/async-task-core';
import { RunStore, defaultRunsDir, type BulkRunSpec, type BulkRunState } from './runstore.js';
import { evaluateLiveness } from './liveness.js';
import { addressColumnList, type AddressColumnMapping } from './address.js';
import { registerLedgerJob, type FireLedger } from './async-delivery.js';
import type { FieldSpec } from './types.js';

const STRATEGY = z.enum(['replace', 'preserve_if_blank', 'union_semicolon', 'never_write']);

const fieldSpec = z.object({
  column: z.string().describe('CSV header (column) name this field reads from.'),
  field: z.string().optional().describe('LACRM field key to write to. Defaults to the column name.'),
  strategy: STRATEGY.describe(
    'Update-mode merge strategy: replace (blank cell clears the field), preserve_if_blank (blank ignored), union_semicolon (value added to the existing semicolon-list), never_write (always preserved). An absent column is always preserved.',
  ),
  required: z.boolean().optional().describe('Column must be present and non-blank in every row.'),
  separator: z.string().optional().describe('Join separator for union_semicolon (default "; ").'),
  example: z.string().optional().describe('Example value for a generated template example row.'),
  description: z.string().optional().describe('Human description shown in the template report.'),
});

// CSV-column -> address mapping (shared by create and update); see AddressColumnMapping.
const addressMapping = z.object({
  street1: z.string(),
  street2: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  zip: z.string().optional(),
  country: z.string().optional(),
  type: z.string().optional(),
});

const createConfig = z.object({
  nameColumn: z.string().describe('CSV column holding the contact name.'),
  nameField: z.string().optional().describe('LACRM name field key (default "Name").'),
  assignedTo: z.string().optional().describe('User ID to assign new contacts to.'),
  isCompany: z.boolean().optional().describe('Create companies instead of people (default false).'),
  phone: z.object({ column: z.string(), type: z.string().optional() }).optional(),
  email: z.object({ column: z.string(), type: z.string().optional() }).optional(),
  address: addressMapping.optional(),
  customFields: z.array(z.object({ column: z.string(), field: z.string().optional() })).optional(),
});

const updateAddressConfig = addressMapping.describe(
  'Update-mode address mapping: an uploaded address is appended to the contact only if it is not already present (CRM copy wins on a duplicate; existing addresses untouched).',
);

function ok(data: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
}

function fail(error: unknown) {
  return { content: [{ type: 'text' as const, text: formatErrorForLLM(error) }], isError: true };
}

function loadCsvText(args: { csv_content?: string; csv_path?: string }): string {
  if (args.csv_content && args.csv_content.trim() !== '') return args.csv_content;
  if (args.csv_path) return readFileSync(args.csv_path, 'utf-8');
  throw new Error('Provide either csv_content or csv_path.');
}

/** The CSV column names of an optional address mapping (undefined when no mapping was supplied). */
function addressColumnsOf(config?: AddressColumnMapping): string[] | undefined {
  return config ? addressColumnList(config) : undefined;
}

function workerScriptPath(): string {
  // build/tools/bulk/index.js -> build/bulk-worker.js
  return join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'bulk-worker.js');
}

function spawnWorkerDetached(runId: string): void {
  const child = spawn(process.execPath, [workerScriptPath(), runId], {
    detached: true,
    stdio: 'ignore',
    env: process.env,
  });
  child.unref();
}

/** Test seams; production callers pass nothing. */
export interface BulkToolDeps {
  /** Ledger used to register async-completion jobs (defaults to the real SDK client, lazily). */
  fireLedger?: FireLedger;
  /** Detached-worker launcher (defaults to the real spawn). */
  spawnWorker?: (runId: string) => void;
}

export function registerBulkTools(server: McpServer, deps: BulkToolDeps = {}): void {
  const spawnWorker = deps.spawnWorker ?? spawnWorkerDetached;
  // Lazy so the daemon URL env is read at call time and no client is built
  // for callers that never pass the completion fields.
  const fireLedger = (): FireLedger => deps.fireLedger ?? new LedgerClient();
  // ---- bulk_generate_template -------------------------------------------------
  server.registerTool(
    'bulk_generate_template',
    {
      title: 'Bulk: Generate CSV Template',
      description: `Generate a ready-to-fill CSV template for a bulk operation, plus a per-field report
describing exactly what happens when each column is populated, left blank, or omitted.

The template is generated from the SAME field configuration the validate/execute tools use, so it
always reflects the rules that will actually be applied. Supply the field configuration as arguments;
nothing about any specific CRM is built in.

Returns: { csv, columns, report } where report[].behavior explains each field's merge strategy.
Columns are ordered LACRM built-in fields first (key, owner name, address block, then other standard fields), then custom fields.`,
      inputSchema: {
        operation: z.enum(['create', 'update']).describe('Which operation the template is for.'),
        fields: z.array(fieldSpec).describe('Field configuration (the columns "on the menu").'),
        key_column: z.string().optional().describe('Identity column for update mode (placed first, required).'),
        key_description: z.string().optional().describe('Optional description for the key column.'),
        include_example_row: z.boolean().optional().describe('Append one example row built from field examples.'),
        address_config: updateAddressConfig.optional(),
      },
    },
    async (args) => {
      try {
        const result = generateTemplate({
          operation: args.operation,
          fields: args.fields as FieldSpec[],
          keyColumn: args.key_column,
          keyDescription: args.key_description,
          includeExampleRow: args.include_example_row,
          addressColumns: addressColumnsOf(args.address_config),
        });
        return ok(result);
      } catch (error) {
        return fail(error);
      }
    },
  );

  // ---- bulk_validate_csv ------------------------------------------------------
  server.registerTool(
    'bulk_validate_csv',
    {
      title: 'Bulk: Validate CSV (dry run)',
      description: `Validate a bulk CSV against a field configuration WITHOUT making any changes.

Reports row count, which configured columns are present (will be acted on) vs absent (left unchanged),
unknown columns, missing required columns/values, duplicate keys, and a rough time estimate (runs are
paced at ~1 request/second). Always run this and review it before bulk_execute.

Provide the CSV as csv_content (inline) or csv_path (a readable file path).`,
      inputSchema: {
        operation: z.enum(['create', 'update']),
        csv_content: z.string().optional().describe('Inline CSV text.'),
        csv_path: z.string().optional().describe('Path to a CSV file (alternative to csv_content).'),
        fields: z.array(fieldSpec).describe('Field configuration.'),
        key_column: z.string().optional().describe('Identity column for update mode.'),
        address_config: updateAddressConfig.optional(),
        interval_ms: z.number().optional().describe('Per-call pacing for the estimate (default 1000).'),
      },
    },
    async (args) => {
      try {
        const parsed = parseCsv(loadCsvText(args));
        const result = validateBulkCsv({
          parsed,
          fields: args.fields as FieldSpec[],
          operation: args.operation,
          keyColumn: args.key_column,
          addressColumns: addressColumnsOf(args.address_config),
        });
        const callsPerRow = args.operation === 'update' ? 2 : 1;
        const intervalMs = args.interval_ms ?? 1000;
        const estimatedCalls = result.rowCount * callsPerRow;
        const estimate = { calls: estimatedCalls, seconds: Math.ceil((estimatedCalls * intervalMs) / 1000) };
        return ok({ ...result, estimate });
      } catch (error) {
        return fail(error);
      }
    },
  );

  // ---- bulk_execute -----------------------------------------------------------
  server.registerTool(
    'bulk_execute',
    {
      title: 'Bulk: Execute (live)',
      description: `Execute a bulk create/update by launching a detached background worker that paces calls at
~1 request/second (LACRM's agreement). Returns a run_id immediately.

SAFETY: this performs LIVE writes. It re-validates first and refuses to run if validation fails. You must
pass confirm=true to proceed (omitting it returns the validation only). Always show the user a
bulk_validate_csv preview and obtain explicit approval before passing confirm=true.

ASYNC COMPLETION (optional): pass channel + requestor_email + identifier (and request_summary) and the
finished result - including the report delivered as an editable Google Sheet - is posted back on the
originating channel automatically when the run completes; no polling needed. Without them, poll
bulk_run_status as before.

Update mode uses per-field merge strategies (see fields[].strategy); an absent column is left unchanged.
Provide the CSV as csv_content or csv_path.`,
      inputSchema: {
        operation: z.enum(['create', 'update']),
        csv_content: z.string().optional(),
        csv_path: z.string().optional(),
        fields: z.array(fieldSpec).optional().describe('Update-mode merge fields.'),
        key_column: z.string().optional().describe('Identity column (required for update mode).'),
        create_config: createConfig.optional().describe('Create-mode field mapping (required for create mode).'),
        create_if_missing: z.boolean().optional().describe('Update mode: create a contact when the key is not found.'),
        address_config: updateAddressConfig.optional().describe('Update-mode address mapping (append-if-absent).'),
        interval_ms: z.number().optional().describe('Min ms between calls (default 1000; do not go below 1000).'),
        confirm: z.boolean().optional().describe('Must be true to perform live writes.'),
        channel: z.string().optional().describe(
          'Async completion: originating channel (googlechat | gmail | asana). With requestor_email + identifier, the finished result is delivered automatically on that channel.',
        ),
        requestor_email: z.string().optional().describe('Async completion: email address of the requesting user.'),
        identifier: z.string().optional().describe(
          'Async completion: channel-native message identifier (gmail message id | asana task gid | gchat space), case-exact.',
        ),
        request_summary: z.string().optional().describe(
          'Async completion: 1-3 sentence plain-language restatement of what was asked (composed at fire time).',
        ),
      },
    },
    async (args) => {
      try {
        const parsed = parseCsv(loadCsvText(args));
        // Recognize whichever address mapping applies to this operation so the preview
        // doesn't falsely flag address columns as "unknown": update uses address_config;
        // create's mapping lives on create_config.address (and IS consumed at execute time).
        const addressMappingForValidation =
          args.operation === 'create' ? args.create_config?.address : args.address_config;
        const validation = validateBulkCsv({
          parsed,
          fields: (args.fields ?? []) as FieldSpec[],
          operation: args.operation,
          keyColumn: args.key_column,
          addressColumns: addressColumnsOf(addressMappingForValidation),
        });
        if (!validation.ok) {
          return ok({ launched: false, reason: 'validation_failed', validation });
        }
        if (args.operation === 'update' && !args.key_column) {
          return ok({ launched: false, reason: 'key_column_required_for_update' });
        }
        if (args.operation === 'create' && !args.create_config) {
          return ok({ launched: false, reason: 'create_config_required_for_create' });
        }
        if (!args.confirm) {
          return ok({ launched: false, reason: 'confirmation_required', validation, hint: 'Re-call with confirm=true to perform live writes.' });
        }

        const runId = randomUUID();
        const store = new RunStore(defaultRunsDir());
        const intervalMs = Math.max(args.interval_ms ?? 1000, 1000);

        // Async completion (optional): register the run with the completion
        // daemon BEFORE spawning so the worker can post heartbeats + the
        // terminal result itself. Any failure here returns undefined and the
        // run launches exactly as before - the ledger never blocks a bulk run.
        const jobId = await registerLedgerJob(
          {
            channel: args.channel,
            requestorEmail: args.requestor_email,
            identifier: args.identifier,
            requestSummary: args.request_summary,
          },
          fireLedger(),
        );

        const spec: BulkRunSpec = {
          runId,
          operation: args.operation,
          createdAt: new Date().toISOString(),
          keyColumn: args.key_column,
          createIfMissing: args.create_if_missing,
          intervalMs,
          fields: args.fields as FieldSpec[] | undefined,
          updateAddressConfig: args.address_config,
          createConfig: args.create_config,
          presentColumns: parsed.headers,
          rows: parsed.rows,
          ...(jobId
            ? {
                channel: args.channel,
                requestorEmail: args.requestor_email,
                identifier: args.identifier,
                requestSummary: args.request_summary,
                jobId,
              }
            : {}),
        };
        store.writeSpec(spec);

        // Pre-write an initial running state so the run is immediately queryable.
        const startedAt = new Date().toISOString();
        const initial: BulkRunState = {
          runId,
          operation: args.operation,
          status: 'running',
          total: parsed.rows.length,
          processed: 0,
          succeeded: 0,
          failed: 0,
          startedAt,
          updatedAt: startedAt,
          results: [],
        };
        store.writeState(initial);

        spawnWorker(runId);

        logger.info(
          `bulk_execute: launched run ${runId} (${parsed.rows.length} rows, ${intervalMs}ms pacing${jobId ? `, ledger job ${jobId}` : ''})`,
        );
        return ok({
          launched: true,
          run_id: runId,
          total: parsed.rows.length,
          estimate_seconds: Math.ceil((parsed.rows.length * (args.operation === 'update' ? 2 : 1) * intervalMs) / 1000),
          ...(jobId
            ? {
                job_id: jobId,
                delivery:
                  'The finished result (including the report Sheet) will be delivered automatically on the originating channel; bulk_run_status is for on-demand progress checks only.',
              }
            : { poll: 'Call bulk_run_status with this run_id for progress.' }),
        });
      } catch (error) {
        return fail(error);
      }
    },
  );

  // ---- bulk_run_status --------------------------------------------------------
  server.registerTool(
    'bulk_run_status',
    {
      title: 'Bulk: Run Status',
      description: `Get the status of a bulk run started by bulk_execute. Returns progress (processed/total),
success/failure counts, per-row errors, and the path to the final report CSV when complete.`,
      inputSchema: {
        run_id: z.string().describe('The run_id returned by bulk_execute.'),
      },
    },
    async ({ run_id }) => {
      try {
        const store = new RunStore(defaultRunsDir());
        const state = store.readState(run_id);
        if (!state) return ok({ found: false, run_id });
        const spec = store.readSpec(run_id);
        const errors = state.results.filter((r) => r.status === 'error');
        // A worker that died mid-run never rewrites its state, so the stored
        // status would say `running` forever. Reconcile it against reality here
        // rather than reporting a number we know can be false.
        const liveness = evaluateLiveness({
          status: state.status,
          updatedAt: state.updatedAt,
          workerPid: state.workerPid,
          intervalMs: spec?.intervalMs,
          nowMs: Date.now(),
        });
        return ok({
          found: true,
          run_id,
          status: liveness.status,
          ...(liveness.status === 'interrupted'
            ? {
                stored_status: state.status,
                interrupted_reason: liveness.interruptedReason,
                resumable: state.processed < state.total,
                resume: 'Call bulk_run_resume with this run_id to continue from the first unprocessed row.',
              }
            : {}),
          seconds_since_progress: liveness.secondsSinceProgress,
          operation: state.operation,
          total: state.total,
          processed: state.processed,
          succeeded: state.succeeded,
          failed: state.failed,
          startedAt: state.startedAt,
          finishedAt: state.finishedAt,
          reportCsvPath: state.reportCsvPath,
          ...(state.reportSheetUrl ? { reportSheetUrl: state.reportSheetUrl } : {}),
          error: state.error,
          errors: errors.slice(0, 100),
        });
      } catch (error) {
        return fail(error);
      }
    },
  );

  // ---- bulk_run_resume --------------------------------------------------------
  server.registerTool(
    'bulk_run_resume',
    {
      title: 'Bulk: Resume Run',
      description: `Continue a bulk run whose worker stopped before finishing (host restart, killed process).
Progress is persisted after every row, so the run resumes at the first unprocessed row and rows that were
already applied are never applied again. Refuses if the run is already finished or still actively running.`,
      inputSchema: {
        run_id: z.string().describe('The run_id of an interrupted run (see bulk_run_status).'),
      },
    },
    async ({ run_id }) => {
      try {
        const store = new RunStore(defaultRunsDir());
        const spec = store.readSpec(run_id);
        const state = store.readState(run_id);
        if (!spec || !state) return ok({ resumed: false, found: false, run_id });

        if (state.status === 'completed') {
          return ok({
            resumed: false,
            run_id,
            status: 'completed',
            reason: 'This run already finished; there is nothing left to process.',
            reportCsvPath: state.reportCsvPath,
          });
        }

        // Never launch a second worker onto a live run: two workers sharing one
        // state file would both write it and reapply each other's rows.
        const liveness = evaluateLiveness({
          status: state.status,
          updatedAt: state.updatedAt,
          workerPid: state.workerPid,
          intervalMs: spec.intervalMs,
          nowMs: Date.now(),
        });
        if (liveness.status === 'running') {
          return ok({
            resumed: false,
            run_id,
            status: 'running',
            processed: state.processed,
            total: state.total,
            reason: 'This run is still being worked on; resuming now would process rows twice.',
          });
        }

        if (state.processed >= state.total) {
          return ok({
            resumed: false,
            run_id,
            status: liveness.status,
            reason: 'Every row has already been processed; nothing left to resume.',
          });
        }

        // The relaunched worker reads the SAME spec - including any async
        // completion jobId - so a resumed run heartbeats and completes the
        // same ledger job it was fired with.
        spawnWorker(run_id);

        const remaining = state.total - state.processed;
        logger.info(`bulk_run_resume: relaunched run ${run_id} at row ${state.processed + 1} of ${state.total}`);
        return ok({
          resumed: true,
          run_id,
          resumed_at_row: state.processed + 1,
          remaining,
          total: state.total,
          estimate_seconds: Math.ceil(
            (remaining * (state.operation === 'update' ? 2 : 1) * (spec.intervalMs ?? 1000)) / 1000,
          ),
          ...(spec.jobId
            ? {
                delivery:
                  'This run has async completion delivery: the finished result will be posted automatically on the originating channel.',
              }
            : {}),
          poll: 'Call bulk_run_status with this run_id for progress.',
        });
      } catch (error) {
        return fail(error);
      }
    },
  );
}
