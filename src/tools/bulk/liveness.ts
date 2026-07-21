/**
 * Is a bulk run still being worked on?
 *
 * A run's state file says `running` from the moment the worker starts until it
 * writes a terminal status. If the worker dies in between — the host restarted,
 * the process was killed, the machine rebooted — nothing ever rewrites that
 * file, so `running` becomes a permanent lie and any caller polling
 * `bulk_run_status` waits forever on work that stopped long ago.
 *
 * This module derives the honest answer at read time from two independent
 * signals, without mutating the stored state (a status read must not race the
 * worker's own writes):
 *
 *   1. the worker's recorded pid — decisive when present: no process, no run;
 *   2. how long ago the state was last written — the runner rewrites state after
 *      every row, so silence is evidence. Used as the sole signal for runs
 *      started before a pid was recorded, and as a staleness hint otherwise.
 *
 * Both are needed. A pid alone can be misread after the OS recycles it onto an
 * unrelated process; elapsed time alone cannot distinguish a dead worker from a
 * slow one. Neither signal is platform-specific.
 *
 * @module tools/bulk/liveness
 */

/** What a status read reports, once the stored status is reconciled with reality. */
export type EffectiveRunStatus = 'running' | 'completed' | 'failed' | 'interrupted';

export interface LivenessInput {
  /** The status recorded in the run's state file. */
  status: 'running' | 'completed' | 'failed';
  /** ISO timestamp of the last state write. */
  updatedAt: string;
  /** The worker process id, if the run recorded one. */
  workerPid?: number;
  /** The run's configured pacing, used to size the silence window. */
  intervalMs?: number;
  /** Now, in epoch ms (injected so this is testable without a clock). */
  nowMs: number;
  /** Process-existence check (injected for tests). Defaults to a signal-0 probe. */
  isAlive?: (pid: number) => boolean;
}

export interface LivenessResult {
  status: EffectiveRunStatus;
  /** Present when the run stopped without recording a terminal status. */
  interruptedReason?: string;
  /** Seconds since the last state write; useful for spotting a stalled run. */
  secondsSinceProgress: number;
}

/**
 * Default process-existence probe. Signal 0 performs the permission and
 * existence checks without delivering a signal, and is supported on every
 * platform Node runs on. EPERM means the process exists but is owned by another
 * user — still alive, so it counts.
 */
export function processIsAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException)?.code === 'EPERM';
  }
}

/**
 * How long a `running` run may go without writing state before we treat silence
 * as death. Generous on purpose: a single row can legitimately take a while when
 * the API is slow and the client is retrying, and a false "interrupted" on a
 * healthy run is worse than a slow-to-notice one — it invites a caller to resume
 * a run that is still writing, duplicating work.
 */
export function silenceWindowMs(intervalMs?: number): number {
  const pacing = typeof intervalMs === 'number' && intervalMs > 0 ? intervalMs : 1000;
  return Math.max(15 * 60_000, pacing * 300);
}

/** Reconcile a run's stored status with whether its worker is actually there. */
export function evaluateLiveness(input: LivenessInput): LivenessResult {
  const alive = input.isAlive ?? processIsAlive;
  const written = Date.parse(input.updatedAt);
  const secondsSinceProgress = Number.isNaN(written)
    ? 0
    : Math.max(0, Math.round((input.nowMs - written) / 1000));

  if (input.status !== 'running') {
    return { status: input.status, secondsSinceProgress };
  }

  if (typeof input.workerPid === 'number') {
    if (!alive(input.workerPid)) {
      return {
        status: 'interrupted',
        interruptedReason: 'the worker process is no longer running',
        secondsSinceProgress,
      };
    }
    // The pid is live. Trust it — but a pid can be recycled onto an unrelated
    // process, so a run that has also been silent far past its pacing is
    // reported as interrupted rather than left running forever.
    if (!Number.isNaN(written) && input.nowMs - written > silenceWindowMs(input.intervalMs)) {
      return {
        status: 'interrupted',
        interruptedReason: 'no progress recorded for far longer than this run pacing allows',
        secondsSinceProgress,
      };
    }
    return { status: 'running', secondsSinceProgress };
  }

  // No pid recorded (a run started by an older version): fall back to silence.
  if (!Number.isNaN(written) && input.nowMs - written > silenceWindowMs(input.intervalMs)) {
    return {
      status: 'interrupted',
      interruptedReason: 'no progress recorded for far longer than this run pacing allows',
      secondsSinceProgress,
    };
  }
  return { status: 'running', secondsSinceProgress };
}
