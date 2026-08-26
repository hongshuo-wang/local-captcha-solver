import { describe, expect, it, vi } from 'vitest';

import { createModelStatusStore, type ModelLog } from '../../src/background/model-status';

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
    expect(store.snapshot()).toMatchObject({ status: 'loading', progress: 50 });
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

  it('returns frozen snapshots, log arrays, and log records', () => {
    const store = createModelStatusStore(() => 1000);
    store.warmupReady();
    const snapshot = store.snapshot();

    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.logs)).toBe(true);
    expect(Object.isFrozen(snapshot.logs[0])).toBe(true);
    expect(() => (snapshot as { message: string }).message = 'changed').toThrow(TypeError);
    expect(() => (snapshot.logs as unknown as { push(value: unknown): void }).push({})).toThrow(TypeError);
  });

  it('does not let one subscriber change the snapshot observed by another', () => {
    const store = createModelStatusStore(() => 1000);
    const second = vi.fn();
    store.subscribe((snapshot) => {
      expect(() => (snapshot as { message: string }).message = 'changed').toThrow(TypeError);
      expect(() => (snapshot.logs as unknown as { push(value: unknown): void }).push({})).toThrow(TypeError);
    });
    store.subscribe(second);

    store.beginWarmup();

    expect(second).toHaveBeenCalledWith(expect.objectContaining({
      message: expect.not.stringMatching('changed'),
      logs: [expect.objectContaining({ kind: 'warmup', outcome: 'started' })],
    }));
  });

  it('stops notifying a subscriber after unsubscribe', () => {
    const store = createModelStatusStore(() => 1000);
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);

    store.beginWarmup();
    unsubscribe();
    store.warmupReady();

    expect(listener).toHaveBeenCalledOnce();
  });

  it('retains only the most recent 20 user-facing records', () => {
    let now = 1;
    const store = createModelStatusStore(() => now++);
    for (let index = 0; index < 35; index += 1) store.recognitionStarted();

    const logs = store.snapshot().logs;
    expect(logs).toHaveLength(20);
    expect(logs[0]?.at).toBe(16);
    expect(logs.at(-1)?.at).toBe(35);
  });

  it('records bounded recognition text and actionable errors', () => {
    const store = createModelStatusStore(() => 1000);
    store.recognitionStarted();
    store.recognitionSucceeded(42, 0.93, { site: 'portal.example.test', recognizedText: '12+7=?' });
    store.recognitionFailed('captcha text SECRET123 was rejected', 55, false);

    const logs = store.snapshot().logs;
    expect(logs).toHaveLength(3);
    expect(logs[1]).toMatchObject({ kind: 'recognition', outcome: 'success', durationMs: 42, site: 'portal.example.test', recognizedText: '12+7=?' });
    expect(logs[1]?.message).toContain('高置信度');
    expect(logs[2]).toMatchObject({ kind: 'recognition', outcome: 'failure', durationMs: 55 });
    expect(logs[2]?.error).toContain('SECRET123');
  });

  it('marks the model unavailable when recognition reports that category', () => {
    const store = createModelStatusStore(() => 1000);
    store.recognitionFailed('model details', 10, true);

    expect(store.snapshot()).toMatchObject({ status: 'error', progress: 0 });
  });

  it('records workflow outcomes with sanitized diagnostic context', () => {
    const store = createModelStatusStore(() => 1000);
    store.workflowCompleted('filled');
    store.workflowCompleted({ outcome: 'confirmation', site: 'portal.example.test', trigger: 'automatic', candidateId: 'image-2', recognizedText: '8642', fillValue: '8642', confidence: 0.91, match: 'ambiguous', reason: 'ambiguous_field' });
    store.workflowCompleted('copied');
    expect(store.snapshot().logs).toEqual([
      expect.objectContaining({ kind: 'workflow', outcome: 'success', message: '已填入验证码' }),
      expect.objectContaining({ kind: 'workflow', outcome: 'success', message: '识别完成，等待确认', site: 'portal.example.test', candidateId: 'image-2', recognizedText: '8642' }),
      expect.objectContaining({ kind: 'workflow', outcome: 'success', message: '识别完成，已复制结果' }),
    ]);
  });

  it('sanitizes and records persistent numerical slider diagnostics without page data', async () => {
    const write = vi.fn(async (_value: { version: 1; logs: readonly ModelLog[] }) => undefined);
    const store = createModelStatusStore(() => 1000, { read: vi.fn(async () => undefined), write });
    const activity = {
      state: 'failed' as const,
      trigger: 'automatic' as const,
      site: 'https://2captcha.com/demo/geetest-v4?token=SECRET',
      provider: 'geetest-v4' as const,
      attemptId: 'a31f950c-4',
      challengeId: 'a31f950c',
      phase: 'outcome' as const,
      imageSource: 'paired-background' as const,
      localizationMethod: 'reference-difference' as const,
      localizationScore: 72.5,
      confidenceThreshold: .68,
      alternativeImageSource: 'viewport' as const,
      alternativeConfidence: .61,
      confidence: .72,
      reason: 'challenge-rejected',
      durationMs: 812.4,
      gapX: 184.25,
      gapY: 31,
      pieceOffsetX: 7.5,
      desiredPieceOffsetX: 184.25,
      actualPieceOffsetX: 184,
      pieceErrorX: .25,
      correctionX: 1,
      imageWidth: 300,
      imageHeight: 180,
      trackWidth: 300,
      handleWidth: 40,
      scaleX: 2,
      scaleY: 2,
      startX: 20,
      requestedEndX: 196.75,
      endX: 196.75,
      releaseX: 196.75,
      plannedDragX: 176.75,
      finalDragX: 176.75,
      outcomeSequence: 'pending>failure',
      backgroundDataUrl: 'data:image/png;base64,SECRET',
      pageText: 'SECRET PAGE CONTENT',
    };

    store.sliderCompleted(activity);

    expect(store.snapshot().logs).toEqual([expect.objectContaining({
      kind: 'slider',
      outcome: 'failure',
      message: '滑块验证未通过',
      site: '2captcha.com',
      trigger: 'automatic',
      sliderState: 'failed',
      provider: 'geetest-v4',
      attemptId: 'a31f950c-4',
      challengeId: 'a31f950c',
      phase: 'outcome',
      imageSource: 'paired-background',
      localizationMethod: 'reference-difference',
      confidenceThreshold: .68,
      alternativeImageSource: 'viewport',
      alternativeConfidence: .61,
      confidence: .72,
      durationMs: 812.4,
      gapX: 184.25,
      desiredPieceOffsetX: 184.25,
      actualPieceOffsetX: 184,
      pieceErrorX: .25,
      correctionX: 1,
      requestedEndX: 196.75,
      releaseX: 196.75,
      plannedDragX: 176.75,
      finalDragX: 176.75,
      outcomeSequence: 'pending>failure',
    })]);
    await vi.waitFor(() => expect(write).toHaveBeenCalled());
    const persisted = JSON.stringify(write.mock.calls.at(-1)?.[0]);
    expect(persisted).not.toContain('SECRET');
    expect(persisted).not.toContain('backgroundDataUrl');
    expect(persisted).not.toContain('pageText');
  });

  it('hydrates, caps, persists, and clears local diagnostic records', async () => {
    const write = vi.fn(async (_value: { version: 1; logs: readonly ModelLog[] }) => undefined);
    const read = vi.fn(async () => ({ version: 1, logs: [
      { at: 850, kind: 'slider', outcome: 'failure', message: '滑块定位置信度不足', site: 'saved.example/path?token=ignored', trigger: 'manual', sliderState: 'low-confidence', provider: 'geetest', gapX: 175, releaseX: Number.POSITIVE_INFINITY },
      { at: 900, kind: 'workflow', outcome: 'success', message: '旧记录', site: 'saved.example' },
    ] }));
    const store = createModelStatusStore(() => 1000, { read, write });

    await store.hydrate();
    expect(store.snapshot().logs).toEqual([
      expect.objectContaining({ kind: 'slider', site: 'saved.example', trigger: 'manual', sliderState: 'low-confidence', provider: 'geetest', gapX: 175 }),
      expect.objectContaining({ message: '旧记录', site: 'saved.example' }),
    ]);
    expect(store.snapshot().logs[0]).not.toHaveProperty('releaseX');
    store.workflowCompleted({ outcome: 'skipped', reason: 'below_threshold', score: 54 });
    await vi.waitFor(() => expect(write).toHaveBeenCalled());
    expect(write.mock.calls.at(-1)?.[0]).toMatchObject({ version: 1, logs: expect.arrayContaining([expect.objectContaining({ reason: 'below_threshold', score: 54 })]) });

    store.clearLogs();
    expect(store.snapshot().logs).toEqual([]);
    await vi.waitFor(() => expect(write.mock.calls.at(-1)?.[0]).toEqual({ version: 1, logs: [] }));
  });
});
