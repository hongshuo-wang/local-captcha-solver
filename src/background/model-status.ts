export type ModelStatus = 'loading' | 'ready' | 'error';

export interface ModelLog {
  readonly at: number;
  readonly kind: 'warmup' | 'recognition' | 'workflow';
  readonly outcome: 'started' | 'success' | 'failure';
  readonly message: string;
  readonly durationMs?: number;
}

export type WorkflowActivityOutcome = 'filled' | 'confirmation' | 'copied' | 'no_field' | 'failed';

export interface ModelStatusSnapshot {
  readonly status: ModelStatus;
  readonly progress: 0 | 50 | 100;
  readonly message: string;
  readonly lastReadyAt?: number;
  readonly lastError?: string;
  readonly logs: readonly ModelLog[];
}

export interface ModelStatusStore {
  snapshot(): ModelStatusSnapshot;
  subscribe(listener: (snapshot: ModelStatusSnapshot) => void): () => void;
  beginWarmup(): void;
  warmupReady(): void;
  warmupFailed(message: string): void;
  recognitionStarted(): void;
  recognitionSucceeded(durationMs: number, confidence: number): void;
  recognitionFailed(message: string, durationMs: number, modelUnavailable: boolean): void;
  workflowCompleted(outcome: WorkflowActivityOutcome): void;
}

type Listener = (snapshot: ModelStatusSnapshot) => void;

const MAX_LOGS = 30;
const LOADING_MESSAGE = '正在加载本地识别模型';
const READY_MESSAGE = '本地识别模型已就绪';
const MODEL_ERROR_MESSAGE = '本地识别模型不可用';

export function createModelStatusStore(now: () => number = Date.now): ModelStatusStore {
  let state: Omit<ModelStatusSnapshot, 'logs'> = {
    status: 'loading',
    progress: 0,
    message: LOADING_MESSAGE,
  };
  let logs: ModelLog[] = [];
  const listeners = new Set<Listener>();

  function snapshot(): ModelStatusSnapshot {
    const snapshotLogs = Object.freeze(logs.map((log) => Object.freeze({ ...log })));
    return Object.freeze({
      ...state,
      logs: snapshotLogs,
    });
  }

  function publish(log: ModelLog): void {
    logs = [...logs, log].slice(-MAX_LOGS);
    const current = snapshot();
    for (const listener of listeners) listener(current);
  }

  function record(
    kind: ModelLog['kind'],
    outcome: ModelLog['outcome'],
    message: string,
    durationMs?: number,
  ): void {
    publish({
      at: now(),
      kind,
      outcome,
      message,
      ...(durationMs === undefined ? {} : { durationMs }),
    });
  }

  return {
    snapshot,

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    beginWarmup() {
      state = { status: 'loading', progress: 50, message: LOADING_MESSAGE };
      record('warmup', 'started', '正在准备本地识别模型');
    },

    warmupReady() {
      const readyAt = now();
      state = {
        status: 'ready',
        progress: 100,
        message: READY_MESSAGE,
        lastReadyAt: readyAt,
      };
      record('warmup', 'success', '本地识别模型加载成功');
    },

    warmupFailed(_message) {
      state = {
        status: 'error',
        progress: 0,
        message: MODEL_ERROR_MESSAGE,
        lastError: MODEL_ERROR_MESSAGE,
      };
      record('warmup', 'failure', '本地识别模型加载失败，可重试');
    },

    recognitionStarted() {
      record('recognition', 'started', '已开始本地识别');
    },

    recognitionSucceeded(durationMs, confidence) {
      const confidenceBand = confidence >= 0.85
        ? '高置信度'
        : confidence >= 0.6
          ? '中置信度'
          : '低置信度';
      record('recognition', 'success', `识别成功（${confidenceBand}）`, durationMs);
    },

    recognitionFailed(_message, durationMs, modelUnavailable) {
      const userMessage = modelUnavailable
        ? MODEL_ERROR_MESSAGE
        : '未能识别该验证码';
      if (modelUnavailable) {
        state = {
          status: 'error',
          progress: 0,
          message: MODEL_ERROR_MESSAGE,
          lastError: MODEL_ERROR_MESSAGE,
        };
      }
      record('recognition', 'failure', userMessage, durationMs);
    },

    workflowCompleted(outcome) {
      const messages: Record<WorkflowActivityOutcome, string> = {
        filled: '已填入验证码',
        confirmation: '识别完成，等待确认',
        copied: '识别完成，已复制结果',
        no_field: '识别完成，未找到输入框',
        failed: '识别流程未完成',
      };
      record('workflow', outcome === 'failed' ? 'failure' : 'success', messages[outcome]);
    },
  };
}
