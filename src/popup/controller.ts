import { hostnameForPage } from '../platform/settings-store';
import { originsForPage } from '../platform/permissions';
import type { ModelLog, ModelStatusSnapshot } from '../background/model-status';

export interface PopupViewState {
  hostname: string;
  checked: boolean;
  disabled: boolean;
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
  setEnabled(enabled: boolean): Promise<void>;
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
    (log.kind === 'warmup' || log.kind === 'recognition') &&
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

const OFF_STATUS = 'Automatic recognition is off.';
const ON_STATUS = 'Automatic recognition is on.';
const UNSUPPORTED_STATUS = 'Automatic recognition is unavailable on this page.';

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
  let hostname = 'Loading site...';
  let supported = false;
  let knownEnabled = false;
  let stateKnown = false;
  let operationGeneration = 0;

  const isCurrent = (generation: number): boolean => generation === operationGeneration;
  const render = (generation: number, state: Omit<PopupViewState, 'hostname'>): void => {
    if (isCurrent(generation)) view.render({ hostname, ...state });
  };
  const renderKnown = (generation: number, error?: string, status = knownEnabled ? ON_STATUS : OFF_STATUS): void => render(generation, { checked: knownEnabled, disabled: false, status, error });

  const start = async (): Promise<void> => {
      const generation = ++operationGeneration;
      render(generation, { checked: false, disabled: true, status: 'Checking site setting...' });
      stateKnown = false;
      try {
        const tabs = await adapter.tabs.query({ active: true, currentWindow: true });
        if (!isCurrent(generation)) return;
        const pageUrl = tabs[0]?.url;
        if (typeof pageUrl !== 'string') throw new Error('unsupported');
        hostname = hostnameForPage(pageUrl);
        supported = true;
      } catch {
        if (!isCurrent(generation)) return;
        hostname = 'Unsupported page';
        supported = false;
        render(generation, { checked: false, disabled: true, status: UNSUPPORTED_STATUS });
        return;
      }

      try {
        const response = await adapter.runtime.sendMessage({ type: 'captcha:get-site-state' });
        if (!isCurrent(generation)) return;
        if (!isSiteState(response)) throw new Error('malformed');
        knownEnabled = response.enabled;
        stateKnown = true;
        renderKnown(generation);
      } catch {
        if (!isCurrent(generation)) return;
        knownEnabled = false;
        render(generation, { checked: false, disabled: true, status: OFF_STATUS, error: 'Could not load this site setting.' });
      }
    };

  return {
    start,
    async setEnabled(enabled: boolean): Promise<void> {
      if (!supported || !stateKnown) return;
      const generation = ++operationGeneration;
      const requestHostname = hostname;
      render(generation, { checked: knownEnabled, disabled: true, status: 'Updating site setting...' });
      try {
        let response: unknown;
        if (enabled) {
          const origins = originsForPage(`https://${requestHostname}/`);
          const previouslyGranted = await adapter.permissions.contains({ origins: [...origins] });
          if (!isCurrent(generation)) return;
          if (!previouslyGranted && !await adapter.permissions.request({ origins: [...origins] })) {
            if (isCurrent(generation)) renderKnown(generation, 'Permission was not granted for this site.');
            return;
          }
          if (!isCurrent(generation)) return;
          response = await adapter.runtime.sendMessage({ type: 'captcha:set-site-enabled', enabled: true, hostname: requestHostname, permissionAlreadyGranted: previouslyGranted });
        } else {
          response = await adapter.runtime.sendMessage({ type: 'captcha:set-site-enabled', enabled: false, hostname: requestHostname });
        }
        if (!isCurrent(generation)) return;
        if (enabled && isSiteState(response) && response.enabled) {
          knownEnabled = true;
          renderKnown(generation);
          return;
        }
        if (enabled && isPermissionDenied(response)) {
          renderKnown(generation, 'Permission was not granted for this site.');
          return;
        }
        if (isSiteChanged(response)) {
          await start();
          return;
        }
        if (!enabled && isDisableState(response)) {
          knownEnabled = false;
          renderKnown(generation, undefined, response.permissionRemoved ? OFF_STATUS : `${OFF_STATUS} Site permission could not be removed.`);
          return;
        }
        throw new Error('malformed');
      } catch {
        if (!isCurrent(generation)) return;
        renderKnown(generation, 'Could not update this site setting.');
      }
    },
  };
}
