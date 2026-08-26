import { SLIDER_RESULT_STATES, type SliderDiagnosticPhase, type SliderImageSource, type SliderLocalizationMethod, type SliderProvider, type SliderResultState, type SliderRunDiagnostic } from '../slider/types';

export type ModelStatus = 'loading' | 'ready' | 'error';
export type DiagnosticTrigger = 'automatic' | 'manual' | 'explicit' | 'context';
export type DiagnosticFieldMatch = 'unique' | 'ambiguous' | 'none';

export interface DiagnosticContext extends SliderRunDiagnostic {
  readonly site?: string;
  readonly trigger?: DiagnosticTrigger;
  readonly candidateId?: string;
  readonly width?: number;
  readonly height?: number;
  readonly source?: string;
  readonly score?: number;
  readonly recognizedText?: string;
  readonly fillValue?: string;
  readonly confidence?: number;
  readonly match?: DiagnosticFieldMatch;
  readonly sliderState?: SliderResultState;
  readonly reason?: string;
  readonly error?: string;
}

export interface ModelLog extends DiagnosticContext {
  readonly at: number;
  readonly kind: 'warmup' | 'recognition' | 'workflow' | 'slider';
  readonly outcome: 'started' | 'success' | 'failure' | 'skipped';
  readonly message: string;
  readonly durationMs?: number;
}

export type WorkflowActivityOutcome = 'filled' | 'confirmation' | 'copied' | 'no_field' | 'failed' | 'skipped';
export interface WorkflowActivity extends DiagnosticContext { readonly outcome: WorkflowActivityOutcome }
export interface SliderDiagnosticActivity extends SliderRunDiagnostic {
  readonly site?: string;
  readonly trigger: 'manual' | 'automatic';
  readonly state: SliderResultState;
  readonly confidence?: number;
  readonly reason?: string;
  readonly durationMs: number;
}

export interface ModelStatusSnapshot {
  readonly status: ModelStatus;
  readonly progress: 0 | 50 | 100;
  readonly message: string;
  readonly lastReadyAt?: number;
  readonly lastError?: string;
  readonly logs: readonly ModelLog[];
}

export interface ModelLogPersistence {
  read(): Promise<unknown>;
  write(value: { version: 1; logs: readonly ModelLog[] }): Promise<void>;
}

export interface ModelStatusStore {
  snapshot(): ModelStatusSnapshot;
  subscribe(listener: (snapshot: ModelStatusSnapshot) => void): () => void;
  hydrate(): Promise<void>;
  clearLogs(): void;
  beginWarmup(): void;
  warmupReady(): void;
  warmupFailed(message: string): void;
  recognitionStarted(context?: DiagnosticContext): void;
  recognitionSucceeded(durationMs: number, confidence: number, context?: DiagnosticContext): void;
  recognitionFailed(message: string, durationMs: number, modelUnavailable: boolean, context?: DiagnosticContext): void;
  workflowCompleted(activity: WorkflowActivityOutcome | WorkflowActivity): void;
  sliderCompleted(activity: SliderDiagnosticActivity): void;
}

type Listener = (snapshot: ModelStatusSnapshot) => void;

export const MODEL_LOGS_STORAGE_KEY = 'captcha-diagnostic-logs';
const MAX_LOGS = 20;
const MAX_TEXT_LENGTH = 500;
const LOADING_MESSAGE = '正在加载本地识别模型';
const READY_MESSAGE = '本地识别模型已就绪';
const MODEL_ERROR_MESSAGE = '本地识别模型不可用';

function cleanText(value: unknown, maxLength = MAX_TEXT_LENGTH): string | undefined {
  if (typeof value !== 'string') return undefined;
  const cleaned = value
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned.length === 0 ? undefined : cleaned.slice(0, maxLength);
}

function finiteNumber(value: unknown, minimum: number, maximum: number): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= minimum && value <= maximum ? value : undefined;
}

function cleanSource(value: unknown): string | undefined {
  const source = cleanText(value, 120);
  if (source === undefined) return undefined;
  if (/^data:/i.test(source)) return '内嵌图片';
  if (/^blob:/i.test(source)) return '临时图片';
  const withoutParameters = source.split(/[?#]/, 1)[0] ?? '';
  try {
    const pathname = new URL(withoutParameters).pathname;
    return cleanText(pathname.split('/').filter(Boolean).at(-1) ?? pathname, 120);
  } catch { return cleanText(withoutParameters, 120); }
}

function cleanSite(value: unknown): string | undefined {
  const site = cleanText(value, 120);
  if (site === undefined) return undefined;
  try { return cleanText(new URL(site).hostname, 120); } catch {
    return cleanText(site.split(/[/?#]/, 1)[0], 120);
  }
}

function sanitizeContext(context: DiagnosticContext = {}): DiagnosticContext {
  const trigger = context.trigger === 'automatic' || context.trigger === 'manual' || context.trigger === 'explicit' || context.trigger === 'context' ? context.trigger : undefined;
  const match = context.match === 'unique' || context.match === 'ambiguous' || context.match === 'none' ? context.match : undefined;
  const provider: SliderProvider | undefined = context.provider === 'geetest' || context.provider === 'geetest-v4' || context.provider === 'generic' ? context.provider : undefined;
  const imageSource: SliderImageSource | undefined = context.imageSource === 'paired-background' || context.imageSource === 'background' || context.imageSource === 'viewport' ? context.imageSource : undefined;
  const localizationMethod: SliderLocalizationMethod | undefined = context.localizationMethod === 'reference-difference' || context.localizationMethod === 'texture' || context.localizationMethod === 'shape' || context.localizationMethod === 'geometry' || context.localizationMethod === 'edge-perimeter' ? context.localizationMethod : undefined;
  const phase: SliderDiagnosticPhase | undefined = context.phase === 'discovery' || context.phase === 'activation' || context.phase === 'localization' || context.phase === 'execution' || context.phase === 'outcome' ? context.phase : undefined;
  const sliderState = context.sliderState !== undefined && SLIDER_RESULT_STATES.includes(context.sliderState) ? context.sliderState : undefined;
  const coordinate = (value: unknown) => finiteNumber(value, -10_000, 10_000);
  const dimension = (value: unknown) => finiteNumber(value, 0, 10_000);
  const scale = (value: unknown) => finiteNumber(value, 0.01, 100);
  const site = cleanSite(context.site);
  const candidateId = cleanText(context.candidateId, 80);
  const attemptId = cleanText(context.attemptId, 40);
  const challengeId = cleanText(context.challengeId, 40);
  const width = dimension(context.width);
  const height = dimension(context.height);
  const source = cleanSource(context.source);
  const score = finiteNumber(context.score, 0, 100);
  const recognizedText = cleanText(context.recognizedText, 160);
  const fillValue = cleanText(context.fillValue, 160);
  const confidence = finiteNumber(context.confidence, 0, 1);
  const reason = cleanText(context.reason, 120);
  const error = cleanText(context.error);
  const outcomeSequence = cleanText(context.outcomeSequence, 120);
  return {
    ...(site === undefined ? {} : { site }),
    ...(trigger === undefined ? {} : { trigger }),
    ...(candidateId === undefined ? {} : { candidateId }),
    ...(width === undefined ? {} : { width }),
    ...(height === undefined ? {} : { height }),
    ...(source === undefined ? {} : { source }),
    ...(score === undefined ? {} : { score }),
    ...(recognizedText === undefined ? {} : { recognizedText }),
    ...(fillValue === undefined ? {} : { fillValue }),
    ...(confidence === undefined ? {} : { confidence }),
    ...(match === undefined ? {} : { match }),
    ...(provider === undefined ? {} : { provider }),
    ...(attemptId === undefined ? {} : { attemptId }),
    ...(challengeId === undefined ? {} : { challengeId }),
    ...(phase === undefined ? {} : { phase }),
    ...(imageSource === undefined ? {} : { imageSource }),
    ...(localizationMethod === undefined ? {} : { localizationMethod }),
    ...(finiteNumber(context.localizationScore, -1_000_000, 1_000_000) === undefined ? {} : { localizationScore: finiteNumber(context.localizationScore, -1_000_000, 1_000_000) }),
    ...(finiteNumber(context.confidenceThreshold, 0, 1) === undefined ? {} : { confidenceThreshold: finiteNumber(context.confidenceThreshold, 0, 1) }),
    ...(context.alternativeImageSource !== 'paired-background' && context.alternativeImageSource !== 'background' && context.alternativeImageSource !== 'viewport' ? {} : { alternativeImageSource: context.alternativeImageSource }),
    ...(finiteNumber(context.alternativeConfidence, 0, 1) === undefined ? {} : { alternativeConfidence: finiteNumber(context.alternativeConfidence, 0, 1) }),
    ...(sliderState === undefined ? {} : { sliderState }),
    ...(coordinate(context.gapX) === undefined ? {} : { gapX: coordinate(context.gapX) }),
    ...(coordinate(context.gapY) === undefined ? {} : { gapY: coordinate(context.gapY) }),
    ...(coordinate(context.pieceOffsetX) === undefined ? {} : { pieceOffsetX: coordinate(context.pieceOffsetX) }),
    ...(coordinate(context.pieceOffsetY) === undefined ? {} : { pieceOffsetY: coordinate(context.pieceOffsetY) }),
    ...(coordinate(context.desiredPieceOffsetX) === undefined ? {} : { desiredPieceOffsetX: coordinate(context.desiredPieceOffsetX) }),
    ...(coordinate(context.actualPieceOffsetX) === undefined ? {} : { actualPieceOffsetX: coordinate(context.actualPieceOffsetX) }),
    ...(coordinate(context.pieceErrorX) === undefined ? {} : { pieceErrorX: coordinate(context.pieceErrorX) }),
    ...(coordinate(context.correctionX) === undefined ? {} : { correctionX: coordinate(context.correctionX) }),
    ...(dimension(context.imageWidth) === undefined ? {} : { imageWidth: dimension(context.imageWidth) }),
    ...(dimension(context.imageHeight) === undefined ? {} : { imageHeight: dimension(context.imageHeight) }),
    ...(dimension(context.trackWidth) === undefined ? {} : { trackWidth: dimension(context.trackWidth) }),
    ...(dimension(context.handleWidth) === undefined ? {} : { handleWidth: dimension(context.handleWidth) }),
    ...(scale(context.scaleX) === undefined ? {} : { scaleX: scale(context.scaleX) }),
    ...(scale(context.scaleY) === undefined ? {} : { scaleY: scale(context.scaleY) }),
    ...(coordinate(context.startX) === undefined ? {} : { startX: coordinate(context.startX) }),
    ...(coordinate(context.requestedEndX) === undefined ? {} : { requestedEndX: coordinate(context.requestedEndX) }),
    ...(coordinate(context.endX) === undefined ? {} : { endX: coordinate(context.endX) }),
    ...(coordinate(context.releaseX) === undefined ? {} : { releaseX: coordinate(context.releaseX) }),
    ...(coordinate(context.plannedDragX) === undefined ? {} : { plannedDragX: coordinate(context.plannedDragX) }),
    ...(coordinate(context.finalDragX) === undefined ? {} : { finalDragX: coordinate(context.finalDragX) }),
    ...(outcomeSequence === undefined ? {} : { outcomeSequence }),
    ...(reason === undefined ? {} : { reason }),
    ...(error === undefined ? {} : { error }),
  };
}

function parseLog(value: unknown): ModelLog | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const candidate = value as Partial<ModelLog>;
  const kind = candidate.kind === 'warmup' || candidate.kind === 'recognition' || candidate.kind === 'workflow' || candidate.kind === 'slider' ? candidate.kind : undefined;
  const outcome = candidate.outcome === 'started' || candidate.outcome === 'success' || candidate.outcome === 'failure' || candidate.outcome === 'skipped' ? candidate.outcome : undefined;
  const at = finiteNumber(candidate.at, 0, Number.MAX_SAFE_INTEGER);
  const message = cleanText(candidate.message, 160);
  if (kind === undefined || outcome === undefined || at === undefined || message === undefined) return undefined;
  const durationMs = finiteNumber(candidate.durationMs, 0, 3_600_000);
  return {
    at,
    kind,
    outcome,
    message,
    ...(durationMs === undefined ? {} : { durationMs }),
    ...sanitizeContext(candidate),
  };
}

function parsePersistedLogs(value: unknown): ModelLog[] {
  if (typeof value !== 'object' || value === null || (value as { version?: unknown }).version !== 1) return [];
  const stored = (value as { logs?: unknown }).logs;
  if (!Array.isArray(stored)) return [];
  return stored.map(parseLog).filter((log): log is ModelLog => log !== undefined).slice(-MAX_LOGS);
}

export function createModelStatusStore(now: () => number = Date.now, persistence?: ModelLogPersistence): ModelStatusStore {
  let state: Omit<ModelStatusSnapshot, 'logs'> = {
    status: 'loading',
    progress: 0,
    message: LOADING_MESSAGE,
  };
  let logs: ModelLog[] = [];
  let hydration: Promise<void> | undefined;
  let persistenceQueue: Promise<void> = Promise.resolve();
  const listeners = new Set<Listener>();

  function snapshot(): ModelStatusSnapshot {
    const snapshotLogs = Object.freeze(logs.map((log) => Object.freeze({ ...log })));
    return Object.freeze({ ...state, logs: snapshotLogs });
  }

  function notify(): void {
    const current = snapshot();
    for (const listener of listeners) listener(current);
  }

  function persist(): void {
    if (persistence === undefined) return;
    const value = { version: 1 as const, logs: logs.map((log) => ({ ...log })) };
    persistenceQueue = persistenceQueue.catch(() => undefined).then(() => persistence.write(value));
    void persistenceQueue.catch(() => undefined);
  }

  function publish(log: ModelLog): void {
    logs = [...logs, log].slice(-MAX_LOGS);
    persist();
    notify();
  }

  function record(kind: ModelLog['kind'], outcome: ModelLog['outcome'], message: string, durationMs?: number, context?: DiagnosticContext): void {
    publish({
      at: now(),
      kind,
      outcome,
      message,
      ...(durationMs === undefined ? {} : { durationMs }),
      ...sanitizeContext(context),
    });
  }

  return {
    snapshot,

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    hydrate() {
      if (hydration !== undefined) return hydration;
      hydration = persistence === undefined ? Promise.resolve() : persistence.read().then((value) => {
        logs = [...parsePersistedLogs(value), ...logs].slice(-MAX_LOGS);
        notify();
      }).catch(() => undefined);
      return hydration;
    },

    clearLogs() {
      logs = [];
      persist();
      notify();
    },

    beginWarmup() {
      state = { status: 'loading', progress: 50, message: LOADING_MESSAGE };
      record('warmup', 'started', '正在准备本地识别模型');
    },

    warmupReady() {
      const readyAt = now();
      state = { status: 'ready', progress: 100, message: READY_MESSAGE, lastReadyAt: readyAt };
      record('warmup', 'success', '本地识别模型加载成功');
    },

    warmupFailed(message) {
      const error = cleanText(message) ?? '模型初始化失败';
      state = { status: 'error', progress: 0, message: MODEL_ERROR_MESSAGE, lastError: error };
      record('warmup', 'failure', '本地识别模型加载失败，可重试', undefined, { error });
    },

    recognitionStarted(context) {
      record('recognition', 'started', '已开始本地识别', undefined, context);
    },

    recognitionSucceeded(durationMs, confidence, context) {
      const confidenceBand = confidence >= 0.85 ? '高置信度' : confidence >= 0.6 ? '中置信度' : '低置信度';
      record('recognition', 'success', `识别成功（${confidenceBand}）`, durationMs, { ...context, confidence });
    },

    recognitionFailed(message, durationMs, modelUnavailable, context) {
      const error = cleanText(message) ?? '识别失败';
      const userMessage = modelUnavailable ? MODEL_ERROR_MESSAGE : '未能识别该验证码';
      if (modelUnavailable) state = { status: 'error', progress: 0, message: MODEL_ERROR_MESSAGE, lastError: error };
      record('recognition', 'failure', userMessage, durationMs, { ...context, error });
    },

    workflowCompleted(activity) {
      const entry: WorkflowActivity = typeof activity === 'string' ? { outcome: activity } : activity;
      const messages: Record<WorkflowActivityOutcome, string> = {
        filled: '已填入验证码',
        confirmation: '识别完成，等待确认',
        copied: '识别完成，已复制结果',
        no_field: '识别完成，未找到输入框',
        failed: '识别流程未完成',
        skipped: '自动扫描未执行',
      };
      const outcome = entry.outcome === 'failed' ? 'failure' : entry.outcome === 'skipped' ? 'skipped' : 'success';
      record('workflow', outcome, messages[entry.outcome], undefined, entry);
    },

    sliderCompleted(activity) {
      const messages: Record<SliderResultState, string> = {
        success: '滑块验证已通过',
        'not-found': '当前页面未找到唯一滑块',
        unsupported: '当前滑块暂不支持',
        'low-confidence': '滑块定位置信度不足',
        'permission-denied': '滑块处理权限不足',
        'page-inactive': '页面未处于可处理状态',
        'user-active': '检测到用户正在操作滑块',
        failed: '滑块验证未通过',
        uncertain: '无法确认滑块验证结果',
      };
      const skipped = activity.state === 'not-found' || activity.state === 'unsupported' || activity.state === 'permission-denied' || activity.state === 'page-inactive' || activity.state === 'user-active';
      const outcome = activity.state === 'success' ? 'success' : skipped ? 'skipped' : 'failure';
      record('slider', outcome, messages[activity.state], activity.durationMs, { ...activity, sliderState: activity.state });
    },
  };
}
