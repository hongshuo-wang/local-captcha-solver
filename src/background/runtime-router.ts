import type { ImageFetcher } from './image-fetch';
import type { InferenceHost } from './inference-host';
import { hostnameForPage, normalizeHostname } from '../platform/settings-store';
import { originsForPage } from '../platform/permissions';
import { isInferenceRequest } from '../ocr/protocol';
import type { RecognitionMode } from '../core/types';
import type { EnableRegistrationOptions } from './content-registration';
import type { ModelStatusStore } from './model-status';

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
  };
  activeTab(): Promise<{ id?: number; url?: string } | undefined>;
}

export function runWarmup(adapter: Pick<RuntimeRouterAdapter, 'inferenceHost' | 'modelStatus'>): Promise<void> | undefined {
  const warmup = adapter.inferenceHost.warmup;
  if (warmup === undefined) return undefined;
  adapter.modelStatus.beginWarmup();
  const promise = Promise.resolve().then(() => warmup.call(adapter.inferenceHost)).then(
    () => {
      adapter.modelStatus.warmupReady();
    },
    (error: unknown) => {
      adapter.modelStatus.warmupFailed(error instanceof Error ? error.message : 'warmup failed');
      throw error;
    },
  );
  return promise;
}

export interface RuntimeRouter { handle(message: unknown, sender: RuntimeSender): Promise<unknown | undefined>; }

function pageOrigin(pageUrl: unknown): string | undefined {
  if (typeof pageUrl !== 'string') return undefined;
  try {
    const hostname = hostnameForPage(pageUrl);
    const scheme = new URL(pageUrl).protocol;
    return `${scheme}//${hostname}/*`;
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

function recognitionError(error: unknown): { type: 'captcha:recognition-error'; code: 'model_unavailable' | 'recognition_failed' } {
  return { type: 'captcha:recognition-error', code: typeof error === 'object' && error !== null && 'code' in error && (error as { code?: unknown }).code === 'model_unavailable' ? 'model_unavailable' : 'recognition_failed' };
}

export function createRuntimeRouter(adapter: RuntimeRouterAdapter): RuntimeRouter {
  const startWarmup = (): void => {
    void runWarmup(adapter)?.catch(() => undefined);
  };
  const currentPage = async (sender: RuntimeSender): Promise<string | undefined> => {
    if (sender.tab !== undefined) return senderPage(sender);
    const tab = await adapter.activeTab();
    return typeof tab?.url === 'string' && pageOrigin(tab.url) !== undefined ? tab.url : undefined;
  };

  return {
    async handle(message: unknown, sender: RuntimeSender): Promise<unknown | undefined> {
      if (message === null || typeof message !== 'object' || !('type' in message)) return undefined;
      const request = message as { type?: unknown; url?: unknown; imageDataUrl?: unknown; revision?: unknown; modes?: unknown; enabled?: unknown; hostname?: unknown; permissionAlreadyGranted?: unknown };
      if (request.type === 'captcha:acquire-image') {
        const page = senderPage(sender);
        const origin = page === undefined ? undefined : pageOrigin(page);
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
        adapter.modelStatus.recognitionStarted();
        const inferenceRequest = { type: 'ocr:recognize' as const, requestId: 'runtime-validation', imageRevision: request.revision, imageDataUrl: request.imageDataUrl, modes: request.modes };
        if (!isInferenceRequest(inferenceRequest)) {
          adapter.modelStatus.recognitionFailed('invalid request', performance.now() - startedAt, false);
          return recognitionError(undefined);
        }
        try {
          const results = await adapter.inferenceHost.recognize(inferenceRequest.imageDataUrl, inferenceRequest.imageRevision, inferenceRequest.modes);
          const confidence = results.length === 0 ? 0 : results.reduce((sum, result) => sum + result.confidence, 0) / results.length;
          adapter.modelStatus.recognitionSucceeded(performance.now() - startedAt, confidence);
          return results;
        } catch (error) {
          const durationMs = performance.now() - startedAt;
          const modelUnavailable = typeof error === 'object' && error !== null && 'code' in error && (error as { code?: unknown }).code === 'model_unavailable';
          adapter.modelStatus.recognitionFailed(error instanceof Error ? error.message : 'recognition failed', durationMs, modelUnavailable);
          return recognitionError(error);
        }
      }
      if (request.type === 'captcha:get-model-status') return adapter.modelStatus.snapshot();
      if (request.type === 'captcha:retry-model-warmup') {
        void runWarmup(adapter)?.catch(() => undefined);
        return adapter.modelStatus.snapshot();
      }
      if (request.type === 'captcha:get-site-state' || request.type === 'captcha:get-status') {
        const page = await currentPage(sender);
        if (page === undefined) return { enabled: false };
        try { const enabled = await adapter.permissions.contains({ origins: originsForPage(page) }) && await adapter.siteState.isEnabled(page); if (enabled) startWarmup(); return { enabled }; } catch { return { enabled: false }; }
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
