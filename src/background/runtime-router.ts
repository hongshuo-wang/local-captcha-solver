import type { ImageFetcher } from './image-fetch';
import type { InferenceHost } from './inference-host';
import { hostnameForPage, isRecognitionShortcut, normalizeHostname, type RecognitionShortcut, type SettingsStore } from '../platform/settings-store';
import { permissionOriginsForPage } from '../platform/permissions';
import { isInferenceRequest } from '../ocr/protocol';
import type { RecognitionMode } from '../core/types';
import type { EnableRegistrationOptions } from './content-registration';
import type { DiagnosticContext, ModelStatusStore, WorkflowActivity, WorkflowActivityOutcome } from './model-status';

export interface RuntimeSender { tab?: { id?: number; url?: string }; url?: string; }
export interface RuntimeRouterAdapter {
  permissions: { contains(details: { origins: readonly string[] }): Promise<boolean> };
  imageFetcher: ImageFetcher;
  inferenceHost: InferenceHost;
  modelStatus: ModelStatusStore;
  siteState: {
    isEnabled(pageUrl: string): Promise<boolean>;
    enablePage(pageUrl: string, options?: EnableRegistrationOptions): Promise<unknown>;
    disablePage(pageUrl: string): Promise<unknown>;
    reconcile?(): Promise<void>;
  };
  settings?: Pick<SettingsStore, 'read' | 'setCopyOnNoField' | 'setAutoFill' | 'setRecognitionShortcut'>;
  activeTab(): Promise<{ id?: number; url?: string } | undefined>;
}

interface WarmupRunState {
  active?: Promise<void>;
  generation: number;
}

const warmupStates = new WeakMap<object, WarmupRunState>();

export function runWarmup(
  adapter: Pick<RuntimeRouterAdapter, 'inferenceHost' | 'modelStatus'>,
  options: { force?: boolean } = {},
): Promise<void> | undefined {
  const warmup = adapter.inferenceHost.warmup;
  if (warmup === undefined) return undefined;
  const stateKey = adapter.modelStatus as object;
  const state = warmupStates.get(stateKey) ?? { generation: 0 };
  warmupStates.set(stateKey, state);
  const status = adapter.modelStatus.snapshot().status;
  if (!options.force && (status === 'ready' || (status === 'loading' && state.active !== undefined))) return state.active;
  const generation = ++state.generation;
  adapter.modelStatus.beginWarmup();
  const promise = Promise.resolve().then(() => warmup.call(adapter.inferenceHost)).then(
    () => {
      if (state.generation === generation) adapter.modelStatus.warmupReady();
    },
    (error: unknown) => {
      if (state.generation === generation) adapter.modelStatus.warmupFailed(error instanceof Error ? error.message : 'warmup failed');
      throw error;
    },
  );
  state.active = promise;
  promise.then(
    () => { if (state.active === promise) state.active = undefined; },
    () => { if (state.active === promise) state.active = undefined; },
  );
  return promise;
}

export interface RuntimeRouter { handle(message: unknown, sender: RuntimeSender): Promise<unknown | undefined>; }

function pageOrigin(pageUrl: unknown): string | undefined {
  if (typeof pageUrl !== 'string') return undefined;
  try {
    hostnameForPage(pageUrl);
    return new URL(pageUrl).origin;
  } catch { return undefined; }
}

function permissionOriginForPage(pageUrl: string): string | undefined {
  try {
    const url = new URL(pageUrl);
    return `${url.protocol}//${hostnameForPage(pageUrl)}/*`;
  } catch { return undefined; }
}

function requestOrigin(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.origin : undefined;
  } catch { return undefined; }
}

function senderPage(sender: RuntimeSender): string | undefined {
  const tabPage = sender.tab?.url;
  const tabOrigin = pageOrigin(tabPage);
  if (sender.tab?.id === undefined || tabPage === undefined || tabOrigin === undefined) return undefined;
  if (sender.url !== undefined && pageOrigin(sender.url) !== tabOrigin) return undefined;
  return sender.url ?? tabPage;
}

function isExtensionDocumentUrl(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  try {
    const protocol = new URL(value).protocol;
    return protocol === 'chrome-extension:' || protocol === 'moz-extension:';
  } catch { return false; }
}

function canManageDiagnostics(sender: RuntimeSender): boolean {
  if (sender.tab === undefined) return true;
  return isExtensionDocumentUrl(sender.url) && isExtensionDocumentUrl(sender.tab.url);
}

function recognitionError(error: unknown): { type: 'captcha:recognition-error'; code: 'model_unavailable' | 'recognition_failed' } {
  return { type: 'captcha:recognition-error', code: typeof error === 'object' && error !== null && 'code' in error && (error as { code?: unknown }).code === 'model_unavailable' ? 'model_unavailable' : 'recognition_failed' };
}

function isWorkflowActivity(value: unknown): value is WorkflowActivityOutcome {
  return value === 'filled' || value === 'confirmation' || value === 'copied' || value === 'no_field' || value === 'failed' || value === 'skipped';
}

function diagnosticContext(value: unknown): DiagnosticContext {
  if (typeof value !== 'object' || value === null) return {};
  const candidate = value as Record<string, unknown>;
  const trigger = candidate.trigger === 'automatic' || candidate.trigger === 'explicit' || candidate.trigger === 'context' ? candidate.trigger : undefined;
  const match = candidate.match === 'unique' || candidate.match === 'ambiguous' || candidate.match === 'none' ? candidate.match : undefined;
  const text = (key: string) => typeof candidate[key] === 'string' ? candidate[key] as string : undefined;
  const number = (key: string) => typeof candidate[key] === 'number' && Number.isFinite(candidate[key]) ? candidate[key] as number : undefined;
  return {
    ...(trigger === undefined ? {} : { trigger }),
    ...(text('candidateId') === undefined ? {} : { candidateId: text('candidateId') }),
    ...(number('width') === undefined ? {} : { width: number('width') }),
    ...(number('height') === undefined ? {} : { height: number('height') }),
    ...(text('source') === undefined ? {} : { source: text('source') }),
    ...(number('score') === undefined ? {} : { score: number('score') }),
    ...(text('recognizedText') === undefined ? {} : { recognizedText: text('recognizedText') }),
    ...(text('fillValue') === undefined ? {} : { fillValue: text('fillValue') }),
    ...(number('confidence') === undefined ? {} : { confidence: number('confidence') }),
    ...(match === undefined ? {} : { match }),
    ...(text('reason') === undefined ? {} : { reason: text('reason') }),
  };
}

export function createRuntimeRouter(adapter: RuntimeRouterAdapter): RuntimeRouter {
  const startWarmup = (): void => {
    void runWarmup(adapter)?.catch(() => undefined);
  };
  const currentPage = async (sender: RuntimeSender): Promise<string | undefined> => {
    if (sender.tab !== undefined && !isExtensionDocumentUrl(sender.url)) return senderPage(sender);
    const tab = await adapter.activeTab();
    return typeof tab?.url === 'string' && pageOrigin(tab.url) !== undefined ? tab.url : undefined;
  };

  return {
    async handle(message: unknown, sender: RuntimeSender): Promise<unknown | undefined> {
      if (message === null || typeof message !== 'object' || !('type' in message)) return undefined;
      const request = message as { type?: unknown; url?: unknown; imageDataUrl?: unknown; revision?: unknown; modes?: unknown; enabled?: unknown; hostname?: unknown; permissionAlreadyGranted?: unknown; copyOnNoField?: unknown; autoFill?: unknown; recognitionShortcut?: unknown; outcome?: unknown; diagnostic?: unknown };
      if (request.type === 'captcha:get-preferences') {
        const settings = await adapter.settings?.read();
        return {
          copyOnNoField: settings?.copyOnNoField === true,
          autoFill: settings?.autoFill !== false,
          recognitionShortcut: settings?.recognitionShortcut ?? 'middle',
          accessMode: settings?.accessMode ?? 'all',
          interfaceLocale: settings?.interfaceLocale ?? 'system',
        };
      }
      if (request.type === 'captcha:reconcile-access') {
        if (sender.tab !== undefined || adapter.siteState.reconcile === undefined) return { reconciled: false };
        await adapter.siteState.reconcile();
        return { reconciled: true };
      }
      if (request.type === 'captcha:set-preferences') {
        const current = await adapter.settings?.read();
        const copyOnNoField = current?.copyOnNoField === true;
        const autoFill = current?.autoFill !== false;
        const recognitionShortcut = current?.recognitionShortcut ?? 'middle';
        const changesCopy = request.copyOnNoField !== undefined;
        const changesAutoFill = request.autoFill !== undefined;
        const changesShortcut = request.recognitionShortcut !== undefined;
        if ((!changesCopy && !changesAutoFill && !changesShortcut) || (changesCopy && typeof request.copyOnNoField !== 'boolean') || (changesAutoFill && typeof request.autoFill !== 'boolean') || (changesShortcut && !isRecognitionShortcut(request.recognitionShortcut))) {
          return { copyOnNoField, autoFill, recognitionShortcut, reason: 'invalid-request' };
        }
        if (adapter.settings !== undefined && changesCopy) await adapter.settings.setCopyOnNoField(request.copyOnNoField as boolean);
        if (adapter.settings !== undefined && changesAutoFill) await adapter.settings.setAutoFill(request.autoFill as boolean);
        if (adapter.settings !== undefined && changesShortcut) await adapter.settings.setRecognitionShortcut(request.recognitionShortcut as RecognitionShortcut);
        return {
          copyOnNoField: changesCopy ? request.copyOnNoField : copyOnNoField,
          autoFill: changesAutoFill ? request.autoFill : autoFill,
          recognitionShortcut: changesShortcut ? request.recognitionShortcut : recognitionShortcut,
        };
      }
      if (request.type === 'captcha:acquire-image') {
        const page = senderPage(sender);
        const origin = page === undefined ? undefined : permissionOriginForPage(page);
        let permitted = false;
        if (origin !== undefined) {
          try { permitted = await adapter.permissions.contains({ origins: [origin] }); } catch { permitted = false; }
        }
        if (typeof request.url !== 'string' || !permitted || requestOrigin(request.url) !== requestOrigin(page)) {
          return { state: 'image_unavailable', reason: 'permission' };
        }
        return adapter.imageFetcher.fetch(request.url);
      }
      if (request.type === 'captcha:recognize') {
        const startedAt = performance.now();
        const page = senderPage(sender);
        const site = page === undefined ? undefined : hostnameForPage(page);
        const context = site === undefined ? {} : { site };
        adapter.modelStatus.recognitionStarted(context);
        const inferenceRequest = { type: 'ocr:recognize' as const, requestId: 'runtime-validation', imageRevision: request.revision, imageDataUrl: request.imageDataUrl, modes: request.modes };
        if (!isInferenceRequest(inferenceRequest)) {
          adapter.modelStatus.recognitionFailed('invalid request', performance.now() - startedAt, false, context);
          return recognitionError(undefined);
        }
        try {
          const results = await adapter.inferenceHost.recognize(inferenceRequest.imageDataUrl, inferenceRequest.imageRevision, inferenceRequest.modes);
          const confidence = results.length === 0 ? 0 : results.reduce((sum, result) => sum + result.confidence, 0) / results.length;
          const best = [...results].sort((left, right) => right.confidence - left.confidence)[0];
          adapter.modelStatus.recognitionSucceeded(performance.now() - startedAt, confidence, { ...context, recognizedText: best?.text });
          return results;
        } catch (error) {
          const durationMs = performance.now() - startedAt;
          const modelUnavailable = typeof error === 'object' && error !== null && 'code' in error && (error as { code?: unknown }).code === 'model_unavailable';
          adapter.modelStatus.recognitionFailed(error instanceof Error ? error.message : 'recognition failed', durationMs, modelUnavailable, context);
          return recognitionError(error);
        }
      }
      if (request.type === 'captcha:record-activity') {
        const page = senderPage(sender);
        if (page === undefined || !isWorkflowActivity(request.outcome)) return { recorded: false };
        const activity: WorkflowActivity = { outcome: request.outcome, ...diagnosticContext(request.diagnostic), site: hostnameForPage(page) };
        adapter.modelStatus.workflowCompleted(activity);
        return { recorded: true };
      }
      if (request.type === 'captcha:clear-diagnostics') {
        if (!canManageDiagnostics(sender)) return { cleared: false };
        adapter.modelStatus.clearLogs();
        return { cleared: true, snapshot: adapter.modelStatus.snapshot() };
      }
      if (request.type === 'captcha:get-model-status') return adapter.modelStatus.snapshot();
      if (request.type === 'captcha:retry-model-warmup') {
        void runWarmup(adapter, { force: true })?.catch(() => undefined);
        return adapter.modelStatus.snapshot();
      }
      if (request.type === 'captcha:get-site-state' || request.type === 'captcha:get-status') {
        const page = await currentPage(sender);
        if (page === undefined) return { enabled: false };
        try {
          const settings = await adapter.settings?.read();
          const accessMode = settings?.accessMode ?? 'all';
          const accessGranted = await adapter.permissions.contains({ origins: permissionOriginsForPage({ accessMode }, page) });
          const enabled = accessGranted && await adapter.siteState.isEnabled(page);
          if (enabled) startWarmup();
          return { enabled };
        } catch { return { enabled: false }; }
      }
      if (request.type === 'captcha:set-site-enabled') {
        const page = await currentPage(sender);
        if (page === undefined || typeof request.enabled !== 'boolean') return { enabled: false, reason: 'invalid-request' };
        let expectedHostname: string;
        try {
          if (typeof request.hostname !== 'string') throw new Error('invalid hostname');
          expectedHostname = normalizeHostname(request.hostname);
          if (expectedHostname !== request.hostname) throw new Error('hostname must be normalized');
        } catch { return { enabled: false, reason: 'invalid-request' }; }
        let hostname: string;
        try { hostname = hostnameForPage(page); } catch { return { enabled: false, reason: 'invalid-request' }; }
        if (expectedHostname !== hostname) return { enabled: false, reason: 'site-changed' };
        if (request.enabled) {
          const result = sender.tab === undefined && typeof request.permissionAlreadyGranted === 'boolean'
            ? adapter.siteState.enablePage(page, { permissionAlreadyGranted: request.permissionAlreadyGranted })
            : adapter.siteState.enablePage(page);
          const enabled = await result; startWarmup(); return enabled;
        }
        return adapter.siteState.disablePage(page);
      }
      return undefined;
    },
  };
}
