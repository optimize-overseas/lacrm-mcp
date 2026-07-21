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
 * Usage: `node build/bulk-worker.js <runId>`
 *
 * @module bulk-worker
 */

import { loadConfig } from './config.js';
import { initializeClient, getClient } from './client.js';
import { logger } from './utils/logger.js';
import { RunStore, defaultRunsDir } from './tools/bulk/runstore.js';
import { SequentialThrottle } from './tools/bulk/throttle.js';
import { runBulk } from './tools/bulk/runner.js';

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

  logger.info(
    `bulk-worker: run ${runId} ${finalState.status} — ${finalState.succeeded} ok, ${finalState.failed} failed of ${finalState.total}`,
  );
}

main().catch((err) => {
  logger.error('bulk-worker fatal error', err);
  process.exit(1);
});
