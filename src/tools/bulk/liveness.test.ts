/**
 * Tests for run liveness — turning a stored `running` status into an honest one.
 *
 * The bug this guards: a worker that dies mid-run never rewrites its state, so
 * `running` persists forever and a caller polling for completion waits on work
 * that stopped. Equally important is the opposite error — declaring a healthy
 * run dead, which would invite a resume that processes rows twice.
 */

import { describe, it, expect } from 'vitest';
import { evaluateLiveness, silenceWindowMs, processIsAlive } from './liveness.js';

const NOW = Date.parse('2024-05-01T12:00:00.000Z');
const isoAgo = (seconds: number) => new Date(NOW - seconds * 1000).toISOString();

const alive = () => true;
const dead = () => false;

describe('evaluateLiveness', () => {
  it('reports a run whose worker is alive and writing as running', () => {
    const r = evaluateLiveness({
      status: 'running',
      updatedAt: isoAgo(2),
      workerPid: 4242,
      nowMs: NOW,
      isAlive: alive,
    });
    expect(r.status).toBe('running');
    expect(r.secondsSinceProgress).toBe(2);
  });

  it('reports a run whose worker process is gone as interrupted', () => {
    const r = evaluateLiveness({
      status: 'running',
      updatedAt: isoAgo(5),
      workerPid: 4242,
      nowMs: NOW,
      isAlive: dead,
    });
    expect(r.status).toBe('interrupted');
    expect(r.interruptedReason).toMatch(/no longer running/);
  });

  it('does not need the worker to be gone: prolonged silence is also interrupted', () => {
    // Guards pid reuse — the OS can hand a dead worker's pid to something else.
    const r = evaluateLiveness({
      status: 'running',
      updatedAt: isoAgo(60 * 60),
      workerPid: 4242,
      intervalMs: 1000,
      nowMs: NOW,
      isAlive: alive,
    });
    expect(r.status).toBe('interrupted');
    expect(r.interruptedReason).toMatch(/no progress/);
  });

  it('falls back to silence alone for runs that recorded no pid', () => {
    // Runs started by an earlier version have no workerPid.
    const fresh = evaluateLiveness({ status: 'running', updatedAt: isoAgo(30), nowMs: NOW });
    expect(fresh.status).toBe('running');

    const silent = evaluateLiveness({ status: 'running', updatedAt: isoAgo(60 * 60), nowMs: NOW });
    expect(silent.status).toBe('interrupted');
  });

  it('leaves terminal statuses untouched', () => {
    for (const status of ['completed', 'failed'] as const) {
      const r = evaluateLiveness({ status, updatedAt: isoAgo(60 * 60 * 24), nowMs: NOW, isAlive: dead });
      expect(r.status).toBe(status);
      expect(r.interruptedReason).toBeUndefined();
    }
  });

  it('does not call a slow-but-live run dead just because a row took a while', () => {
    // A single row can take a long time when the API is slow and the client is
    // retrying. A false "interrupted" invites a duplicate-processing resume.
    const r = evaluateLiveness({
      status: 'running',
      updatedAt: isoAgo(5 * 60),
      workerPid: 4242,
      intervalMs: 1000,
      nowMs: NOW,
      isAlive: alive,
    });
    expect(r.status).toBe('running');
  });

  it('scales the silence window with the run pacing', () => {
    expect(silenceWindowMs(1000)).toBe(15 * 60_000);
    expect(silenceWindowMs(10_000)).toBe(10_000 * 300);
    expect(silenceWindowMs(undefined)).toBe(15 * 60_000);
    expect(silenceWindowMs(0)).toBe(15 * 60_000);
  });

  it('survives an unparseable timestamp without declaring the run dead', () => {
    const r = evaluateLiveness({ status: 'running', updatedAt: 'not-a-date', nowMs: NOW });
    expect(r.status).toBe('running');
    expect(r.secondsSinceProgress).toBe(0);
  });
});

describe('processIsAlive', () => {
  it('sees this very process', () => {
    expect(processIsAlive(process.pid)).toBe(true);
  });

  it('rejects impossible pids instead of throwing', () => {
    expect(processIsAlive(0)).toBe(false);
    expect(processIsAlive(-1)).toBe(false);
    expect(processIsAlive(Number.NaN)).toBe(false);
  });
});
