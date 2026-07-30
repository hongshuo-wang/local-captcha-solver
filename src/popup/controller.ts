import { hostnameForPage, isRecognitionShortcut, type RecognitionShortcut } from '../platform/settings-store';
import { GLOBAL_HTTP_ORIGINS } from '../platform/permissions';
import type { ModelLog, ModelStatusSnapshot } from '../background/model-status';

export interface PopupViewState {
  hostname: string;
  checked: boolean;
  disabled: boolean;
  accessGranted: boolean;
  status: string;
  error?: string;
}

export interface PopupView {
  render(state: PopupViewState): void;
}

export interface PopupControllerAdapter {
  tabs: { query(queryInfo: { active: boolean; currentWindow: boolean }): Promise<readonly { url?: unknown }[]> };
  runtime: { sendMessage(message: unknown): Promise<unknown> };
  permissions: {
    contains(details: { origins: string[] }): Promise<boolean>;
    request(details: { origins: string[] }): Promise<boolean>;
  };
}

export interface PopupController {
  start(): Promise<void>;
  grantAccess(): Promise<void>;
  setEnabled(enabled: boolean): Promise<void>;
}

export interface CopyPreferenceView { renderCopyPreference(enabled: boolean): void; }
export interface CopyPreferenceController { start(): Promise<void>; setEnabled(enabled: boolean): Promise<void>; }
export interface CopyPreferenceControllerAdapter { runtime: { sendMessage(message: unknown): Promise<unknown> }; }
export interface AutoFillPreferenceView { renderAutoFillPreference(enabled: boolean): void; }
export interface AutoFillPreferenceController { start(): Promise<void>; setEnabled(enabled: boolean): Promise<void>; }
export interface ShortcutPreferenceView { renderShortcutPreference(shortcut: RecognitionShortcut): void; }
export interface ShortcutPreferenceController { start(): Promise<void>; setShortcut(shortcut: RecognitionShortcut): Promise<void>; }

function isCopyPreference(value: unknown): value is { copyOnNoField: boolean } {
  return typeof value === 'object' && value !== null && typeof (value as { copyOnNoField?: unknown }).copyOnNoField === 'boolean';
}

function isAutoFillPreference(value: unknown): value is { autoFill: boolean } {
  return typeof value === 'object' && value !== null && typeof (value as { autoFill?: unknown }).autoFill === 'boolean';
}

function shortcutFromPreference(value: unknown): RecognitionShortcut | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const shortcut = (value as { recognitionShortcut?: unknown }).recognitionShortcut;
  return isRecognitionShortcut(shortcut) ? shortcut : undefined;
}

export function createShortcutPreferenceController(adapter: CopyPreferenceControllerAdapter, view: ShortcutPreferenceView): ShortcutPreferenceController {
  let shortcut: RecognitionShortcut = 'middle';
  return {
    async start(): Promise<void> {
      try { shortcut = shortcutFromPreference(await adapter.runtime.sendMessage({ type: 'captcha:get-preferences' })) ?? 'middle'; } catch { shortcut = 'middle'; }
      view.renderShortcutPreference(shortcut);
    },
    async setShortcut(next: RecognitionShortcut): Promise<void> {
      if (!isRecognitionShortcut(next)) return;
      try { shortcut = shortcutFromPreference(await adapter.runtime.sendMessage({ type: 'captcha:set-preferences', recognitionShortcut: next })) ?? shortcut; } catch { /* Keep the last known preference. */ }
      view.renderShortcutPreference(shortcut);
    },
  };
}

export function createCopyPreferenceController(adapter: CopyPreferenceControllerAdapter, view: CopyPreferenceView): CopyPreferenceController {
  let enabled = false;
  return {
    async start(): Promise<void> {
      try {
        const response = await adapter.runtime.sendMessage({ type: 'captcha:get-preferences' });
        enabled = isCopyPreference(response) ? response.copyOnNoField : false;
      } catch { enabled = false; }
      view.renderCopyPreference(enabled);
    },
    async setEnabled(next: boolean): Promise<void> {
      try {
        const response = await adapter.runtime.sendMessage({ type: 'captcha:set-preferences', copyOnNoField: next });
        if (isCopyPreference(response)) enabled = response.copyOnNoField;
      } catch { /* Keep the last known preference when storage is unavailable. */ }
      view.renderCopyPreference(enabled);
    },
  };
}

export function createAutoFillPreferenceController(adapter: CopyPreferenceControllerAdapter, view: AutoFillPreferenceView): AutoFillPreferenceController {
  let enabled = true;
  return {
    async start(): Promise<void> {
      try {
        const response = await adapter.runtime.sendMessage({ type: 'captcha:get-preferences' });
        enabled = isAutoFillPreference(response) ? response.autoFill : true;
      } catch { enabled = true; }
      view.renderAutoFillPreference(enabled);
    },
    async setEnabled(next: boolean): Promise<void> {
      try {
        const response = await adapter.runtime.sendMessage({ type: 'captcha:set-preferences', autoFill: next });
        if (isAutoFillPreference(response)) enabled = response.autoFill;
      } catch { /* Keep the last known preference when storage is unavailable. */ }
      view.renderAutoFillPreference(enabled);
    },
  };
}

export type ModelStatusView =
  | { renderModelStatus(snapshot: ModelStatusSnapshot): void }
  | { render(snapshot: ModelStatusSnapshot): void };

export interface ModelStatusControllerAdapter {
  runtime: { sendMessage(message: unknown): Promise<unknown> };
}

export interface ModelStatusController {
  start(): Promise<void>;
  retry(): Promise<void>;
}

export interface ModelStatusControllerOptions {
  readonly pollIntervalMs?: number;
  readonly maxPollAttempts?: number;
  readonly delay?: (durationMs: number, signal?: AbortSignal) => Promise<void>;
}

const MODEL_LOADING: ModelStatusSnapshot = Object.freeze({
  status: 'loading',
  progress: 0,
  message: '正在加载本地识别模型',
  logs: Object.freeze([]),
});

const MODEL_UNAVAILABLE: ModelStatusSnapshot = Object.freeze({
  status: 'error',
  progress: 0,
  message: '模型状态暂时不可用',
  logs: Object.freeze([]),
});

function isModelLog(value: unknown): value is ModelLog {
  if (typeof value !== 'object' || value === null) return false;
  const log = value as Partial<ModelLog>;
  return typeof log.at === 'number' && Number.isFinite(log.at) &&
    (log.kind === 'warmup' || log.kind === 'recognition' || log.kind === 'workflow') &&
    (log.outcome === 'started' || log.outcome === 'success' || log.outcome === 'failure') &&
    typeof log.message === 'string' &&
    (log.durationMs === undefined || (typeof log.durationMs === 'number' && Number.isFinite(log.durationMs)));
}

function isModelStatusSnapshot(value: unknown): value is ModelStatusSnapshot {
  if (typeof value !== 'object' || value === null) return false;
  const snapshot = value as Partial<ModelStatusSnapshot>;
  const validStateProgress = snapshot.status === 'ready'
    ? snapshot.progress === 100
    : snapshot.status === 'error'
      ? snapshot.progress === 0
      : snapshot.status === 'loading' && (snapshot.progress === 0 || snapshot.progress === 50);
  return validStateProgress &&
    typeof snapshot.message === 'string' && Array.isArray(snapshot.logs) &&
    snapshot.logs.every(isModelLog);
}

export function createModelStatusController(
  adapter: ModelStatusControllerAdapter,
  view: ModelStatusView,
  options: ModelStatusControllerOptions = {},
): ModelStatusController {
  let generation = 0;
  let activePoll: AbortController | undefined;
  const configuredInterval = options.pollIntervalMs ?? 500;
  const pollIntervalMs = Number.isFinite(configuredInterval) ? Math.max(0, configuredInterval) : 500;
  const configuredMaxRequests = options.maxPollAttempts ?? 60;
  const maxStatusRequests = Number.isFinite(configuredMaxRequests)
    ? Math.max(1, Math.floor(configuredMaxRequests))
    : 60;
  const delay = options.delay ?? ((durationMs: number, signal: AbortSignal) => new Promise<void>((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(resolve, durationMs);
    signal.addEventListener('abort', () => {
      clearTimeout(timer);
      resolve();
    }, { once: true });
  }));
  const render = (snapshot: ModelStatusSnapshot): void => {
    if ('renderModelStatus' in view) view.renderModelStatus(snapshot);
    else view.render(snapshot);
  };
  const unavailable = (): ModelStatusSnapshot => ({ ...MODEL_UNAVAILABLE, logs: [] });

  const pollUntilTerminal = async (requestGeneration: number, signal: AbortSignal, initial?: ModelStatusSnapshot): Promise<void> => {
    let snapshot = initial;
    // A retry response acknowledges the warmup start; only explicit status reads consume the budget.
    let statusRequests = 0;
    while (statusRequests < maxStatusRequests || snapshot === undefined) {
      if (requestGeneration !== generation || signal.aborted) return;
      if (snapshot === undefined) {
        try {
          const response = await adapter.runtime.sendMessage({ type: 'captcha:get-model-status' });
          if (requestGeneration !== generation || signal.aborted) return;
          statusRequests += 1;
          if (!isModelStatusSnapshot(response)) {
            render(unavailable());
            return;
          }
          snapshot = response;
        } catch {
          if (requestGeneration === generation) render(unavailable());
          return;
        }
      }
      render(snapshot);
      if (snapshot.status !== 'loading' || statusRequests >= maxStatusRequests) return;
      await delay(pollIntervalMs, signal);
      if (requestGeneration !== generation || signal.aborted) return;
      snapshot = undefined;
    }
  };

  const beginPoll = (): { requestGeneration: number; signal: AbortSignal } => {
    activePoll?.abort();
    const controller = new AbortController();
    activePoll = controller;
    return { requestGeneration: ++generation, signal: controller.signal };
  };

  return {
    async start(): Promise<void> {
      const { requestGeneration, signal } = beginPoll();
      render(MODEL_LOADING);
      await pollUntilTerminal(requestGeneration, signal);
    },
    async retry(): Promise<void> {
      const { requestGeneration, signal } = beginPoll();
      render(MODEL_LOADING);
      try {
        const response = await adapter.runtime.sendMessage({ type: 'captcha:retry-model-warmup' });
        if (requestGeneration !== generation || signal.aborted) return;
        if (!isModelStatusSnapshot(response)) {
          render(unavailable());
          return;
        }
        await pollUntilTerminal(requestGeneration, signal, response);
      } catch {
        if (requestGeneration === generation && !signal.aborted) {
          render(unavailable());
          return;
        }
      }
    },
  };
}

type SiteState = { enabled: boolean };
type DisableState = { disabled: true; permissionRemoved: boolean };

const OFF_STATUS = '此网站未开启自动识别。';
const ON_STATUS = '此网站已开启自动识别。';
const UNSUPPORTED_STATUS = '当前页面不支持自动识别。';

function isSiteState(value: unknown): value is SiteState {
  return typeof value === 'object' && value !== null &&
    ((value as { enabled?: unknown }).enabled === true || (value as { enabled?: unknown }).enabled === false);
}

function isDisableState(value: unknown): value is DisableState {
  return typeof value === 'object' && value !== null && (value as { disabled?: unknown }).disabled === true && typeof (value as { permissionRemoved?: unknown }).permissionRemoved === 'boolean';
}

function isPermissionDenied(value: unknown): boolean {
  return typeof value === 'object' && value !== null &&
    (value as { enabled?: unknown }).enabled === false &&
    (value as { reason?: unknown }).reason === 'permission-denied';
}

function isSiteChanged(value: unknown): boolean {
  return typeof value === 'object' && value !== null &&
    (value as { enabled?: unknown }).enabled === false &&
    (value as { reason?: unknown }).reason === 'site-changed';
}

export function createPopupController(adapter: PopupControllerAdapter, view: PopupView): PopupController {
  let hostname = '正在读取网站…';
  let supported = false;
  let knownEnabled = false;
  let stateKnown = false;
  let operationGeneration = 0;

  const isCurrent = (generation: number): boolean => generation === operationGeneration;
  const render = (generation: number, state: Omit<PopupViewState, 'hostname'>): void => {
    if (isCurrent(generation)) view.render({ hostname, ...state });
  };
  const renderKnown = (generation: number, error?: string, status = knownEnabled ? ON_STATUS : OFF_STATUS): void => render(generation, { checked: knownEnabled, disabled: false, accessGranted: true, status, error });

  const start = async (): Promise<void> => {
      const generation = ++operationGeneration;
      render(generation, { checked: false, disabled: true, accessGranted: false, status: '正在读取网站设置…' });
      stateKnown = false;
      try {
        const tabs = await adapter.tabs.query({ active: true, currentWindow: true });
        if (!isCurrent(generation)) return;
        const pageUrl = tabs[0]?.url;
        if (typeof pageUrl !== 'string') {
          const accessGranted = await adapter.permissions.contains({ origins: [...GLOBAL_HTTP_ORIGINS] });
          if (!isCurrent(generation)) return;
          if (!accessGranted) {
            hostname = '所有网站';
            supported = true;
            render(generation, { checked: false, disabled: true, accessGranted: false, status: '启用全站访问后开始自动识别。' });
            return;
          }
          throw new Error('unsupported');
        }
        hostname = hostnameForPage(pageUrl);
        supported = true;
      } catch {
        if (!isCurrent(generation)) return;
        hostname = '不支持的页面';
        supported = false;
        let accessGranted = false;
        try { accessGranted = await adapter.permissions.contains({ origins: [...GLOBAL_HTTP_ORIGINS] }); } catch { /* Keep the guarded unavailable state. */ }
        if (isCurrent(generation)) render(generation, { checked: false, disabled: true, accessGranted, status: UNSUPPORTED_STATUS });
        return;
      }

      try {
        const accessGranted = await adapter.permissions.contains({ origins: [...GLOBAL_HTTP_ORIGINS] });
        if (!isCurrent(generation)) return;
        if (!accessGranted) {
          knownEnabled = false;
          render(generation, { checked: false, disabled: true, accessGranted: false, status: '启用全站访问后开始自动识别。' });
          return;
        }
        const response = await adapter.runtime.sendMessage({ type: 'captcha:get-site-state' });
        if (!isCurrent(generation)) return;
        if (!isSiteState(response)) throw new Error('malformed');
        knownEnabled = response.enabled;
        stateKnown = true;
        renderKnown(generation);
      } catch {
        if (!isCurrent(generation)) return;
        knownEnabled = false;
        render(generation, { checked: false, disabled: true, accessGranted: false, status: OFF_STATUS, error: '无法读取网站设置。' });
      }
    };

  return {
    start,
    async grantAccess(): Promise<void> {
      if (!supported) return;
      const generation = ++operationGeneration;
      render(generation, { checked: false, disabled: true, accessGranted: false, status: '正在请求全站访问权限…' });
      try {
        const granted = await adapter.permissions.request({ origins: [...GLOBAL_HTTP_ORIGINS] });
        if (!isCurrent(generation)) return;
        if (!granted) {
          render(generation, { checked: false, disabled: true, accessGranted: false, status: '未启用全站访问。', error: '需要授权后才能自动识别。' });
          return;
        }
        await adapter.runtime.sendMessage({ type: 'captcha:reconcile-access' });
        const tabs = await adapter.tabs.query({ active: true, currentWindow: true });
        const pageUrl = tabs[0]?.url;
        if (typeof pageUrl !== 'string') throw new Error('unsupported');
        hostname = hostnameForPage(pageUrl);
        supported = true;
        const response = await adapter.runtime.sendMessage({ type: 'captcha:set-site-enabled', enabled: true, hostname, permissionAlreadyGranted: false });
        if (!isCurrent(generation)) return;
        if (!isSiteState(response) || !response.enabled) throw new Error('malformed');
        knownEnabled = true;
        stateKnown = true;
        renderKnown(generation);
      } catch {
        if (isCurrent(generation)) render(generation, { checked: false, disabled: true, accessGranted: false, status: '未启用全站访问。', error: '无法完成全站授权。' });
      }
    },
    async setEnabled(enabled: boolean): Promise<void> {
      if (!supported || !stateKnown) return;
      const generation = ++operationGeneration;
      const requestHostname = hostname;
      render(generation, { checked: knownEnabled, disabled: true, accessGranted: true, status: '正在更新网站设置…' });
      try {
        const response = await adapter.runtime.sendMessage({ type: 'captcha:set-site-enabled', enabled, hostname: requestHostname });
        if (!isCurrent(generation)) return;
        if (enabled && isSiteState(response) && response.enabled) {
          knownEnabled = true;
          renderKnown(generation);
          return;
        }
        if (enabled && isPermissionDenied(response)) {
          renderKnown(generation, '未获得此网站的权限。');
          return;
        }
        if (isSiteChanged(response)) {
          await start();
          return;
        }
        if (!enabled && isDisableState(response)) {
          knownEnabled = false;
          renderKnown(generation);
          return;
        }
        throw new Error('malformed');
      } catch {
        if (!isCurrent(generation)) return;
        renderKnown(generation, '无法更新网站设置。');
      }
    },
  };
}
