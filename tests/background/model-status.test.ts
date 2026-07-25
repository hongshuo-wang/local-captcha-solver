import { describe, expect, it, vi } from 'vitest';

import { createModelStatusStore } from '../../src/background/model-status';

describe('ModelStatusStore', () => {
  it('starts loading with no progress completed', () => {
    const store = createModelStatusStore(() => 1000);

    expect(store.snapshot()).toMatchObject({
      status: 'loading',
      progress: 0,
      message: expect.any(String),
      logs: [],
    });
  });

  it('records warmup transitions and notifies subscribers', () => {
    let now = 1000;
    const store = createModelStatusStore(() => now);
    const listener = vi.fn();
    store.subscribe(listener);

    store.beginWarmup();
    now = 1100;
    store.warmupReady();

    expect(store.snapshot()).toMatchObject({ status: 'ready', progress: 100, lastReadyAt: 1100 });
    expect(listener).toHaveBeenCalledTimes(2);
    expect(store.snapshot().logs).toEqual([
      expect.objectContaining({ kind: 'warmup', outcome: 'started' }),
      expect.objectContaining({ kind: 'warmup', outcome: 'success' }),
    ]);

    now = 1200;
    store.beginWarmup();
    now = 1300;
    store.warmupFailed('internal stack trace and file path');
    expect(store.snapshot()).toMatchObject({
      status: 'error',
      progress: 0,
      lastError: expect.any(String),
    });
    expect(store.snapshot().logs.at(-1)).toMatchObject({ kind: 'warmup', outcome: 'failure' });
    expect(store.snapshot().logs.at(-1)?.message).not.toContain('internal stack trace');
  });

  it('returns immutable snapshots and clones logs', () => {
    const store = createModelStatusStore(() => 1000);
    store.warmupReady();
    const first = store.snapshot();
    (first.logs as unknown as { push(value: unknown): void }).push({});
    (first as { message: string }).message = 'changed';

    const second = store.snapshot();
    expect(second.logs).toHaveLength(1);
    expect(second.message).not.toBe('changed');
    expect(second).not.toBe(first);
    expect(second.logs).not.toBe(first.logs);
  });

  it('retains only the most recent 30 user-facing records', () => {
    let now = 1;
    const store = createModelStatusStore(() => now++);
    for (let index = 0; index < 35; index += 1) store.recognitionStarted();

    const logs = store.snapshot().logs;
    expect(logs).toHaveLength(30);
    expect(logs[0]?.at).toBe(6);
    expect(logs.at(-1)?.at).toBe(35);
  });

  it('records recognition outcomes without recognized text', () => {
    const store = createModelStatusStore(() => 1000);
    store.recognitionStarted();
    store.recognitionSucceeded(42, 0.93);
    store.recognitionFailed('captcha text SECRET123 was rejected', 55, false);

    const logs = store.snapshot().logs;
    expect(logs).toHaveLength(3);
    expect(logs[1]).toMatchObject({ kind: 'recognition', outcome: 'success', durationMs: 42 });
    expect(logs[1]?.message).toContain('高置信度');
    expect(logs[2]).toMatchObject({ kind: 'recognition', outcome: 'failure', durationMs: 55 });
    expect(logs.every((log) => !log.message.includes('SECRET123'))).toBe(true);
  });

  it('marks the model unavailable when recognition reports that category', () => {
    const store = createModelStatusStore(() => 1000);
    store.recognitionFailed('model details', 10, true);

    expect(store.snapshot()).toMatchObject({ status: 'error', progress: 0 });
  });
});
