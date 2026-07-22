#!/usr/bin/env node
/**
 * Detached bulk worker.
 *
 * Spawned by the `bulk_execute` tool as an independent, unref'd process so a
 * multi-thousand-row run (paced at 1 request/second) can outlive the 180s MCP
 * request chain. It loads the run spec from the runs directory, processes it
 * through the throttled runner, and persists progress + a report CSV that
 * `bulk_run_status` reads.
 *
 * What survives a restart is the run's STATE, not this process: a host restart
 * or a kill ends the worker, and `bulk_run_status` then reports the run as
 * `interrupted`. Because state is written after every row, `bulk_run_resume`
 * relaunches this worker and the runner continues from the first unprocessed
 * row - already-applied rows are never reapplied.
 *
 * ASYNC COMPLETION (v1.9.0, opt-in): when the spec carries a `jobId` (the
 * launcher registered the run with the host's async completion daemon), this
 * worker heartbeats that ledger entry every 60s while it runs, delivers the
 * report CSV as an editable Google Sheet itself at completion, and posts the
 * terminal result (sheet link + plain-language summary; a crash posts FAILED
 * with an internal-only reason). A spec WITHOUT a jobId changes nothing -
 * behavior is byte-identical to the poll-driven flow. See
 * tools/bulk/async-delivery.ts.
 *
 * Usage: `node build/bulk-worker.js <runId>`
 *
 * @module bulk-worker
 */

import { LedgerClient, startHeartbeat, type HeartbeatHandle } from '@optimizeoverseas/async-task-core';
import { loadConfig } from './config.js';
import { initializeClient, getClient } from './client.js';
import { logger } from './utils/logger.js';
import { RunStore, defaultRunsDir, type BulkRunSpec } from './tools/bulk/runstore.js';
import { SequentialThrottle } from './tools/bulk/throttle.js';
import { runBulk } from './tools/bulk/runner.js';
import { completeLedgerRun, HEARTBEAT_INTERVAL_MS } from './tools/bulk/async-delivery.js';

async function main(): Promise<void> {
  const runId = process.argv[2];
  if (!runId) {
    logger.error('bulk-worker: missing runId argument');
    process.exit(2);
  }

  const store = new RunStore(defaultRunsDir());
  const spec = store.readSpec(runId);
  if (!spec) {
    logger.error(`bulk-worker: no spec found for run ${runId}`);
    process.exit(2);
  }

  // Ledger client + heartbeat exist ONLY for ledger-registered runs (a resumed
  // run reads the same jobId from the spec and completes the same job).
  const ledger = spec.jobId ? new LedgerClient() : null;
  let heartbeat: HeartbeatHandle | null = null;
  if (ledger && spec.jobId) {
    heartbeat = startHeartbeat(ledger, spec.jobId, HEARTBEAT_INTERVAL_MS);
  }

  try {
    const config = loadConfig();
    initializeClient(config.apiKey);
    const client = getClient();

    const throttle = new SequentialThrottle(spec.intervalMs ?? 1000);
    const finalState = await runBulk(spec, {
      call: (functionName, params) => client.call(functionName, params),
      store,
      throttle,
      // Record ownership so a status read can tell a live run from one whose
      // worker died without writing a terminal status.
      workerPid: process.pid,
    });

    heartbeat?.stop();
    if (ledger) {
      await completeLedgerRun(spec, finalState, {
        ledger,
        saveSheetUrl: (url) => {
          // Persist the link so bulk_run_status can hand it out on demand.
          const latest = store.readState(runId);
          if (latest) {
            latest.reportSheetUrl = url;
            store.writeState(latest);
          }
        },
      });
    }

    logger.info(
      `bulk-worker: run ${runId} ${finalState.status} — ${finalState.succeeded} ok, ${finalState.failed} failed of ${finalState.total}`,
    );
  } catch (err) {
    // Crash outside the runner's own catch (config/client init, store I/O):
    // post FAILED so a ledger-registered run never dies into the void. The
    // reason is internal-only - the daemon never shows it to the user.
    heartbeat?.stop();
    if (ledger && spec.jobId) {
      await ledger.terminalUpdate(spec.jobId, {
        status: 'FAILED',
        result: { reason: `bulk-worker crashed: ${err instanceof Error ? err.message : String(err)}` },
        finishedAt: Date.now(),
      });
    }
    throw err;
  }
}

main().catch((err) => {
  logger.error('bulk-worker fatal error', err);
  process.exit(1);
});
