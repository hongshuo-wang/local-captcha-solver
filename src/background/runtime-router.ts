import type { ImageFetcher } from './image-fetch';
import type { InferenceHost } from './inference-host';
import { hostnameForPage } from '../platform/settings-store';
import { originsForPage } from '../platform/permissions';
import { isInferenceRequest } from '../ocr/protocol';
import type { RecognitionMode } from '../core/types';

export interface RuntimeSender { tab?: { id?: number; url?: string }; url?: string; }
export interface RuntimeRouterAdapter {
  permissions: { contains(details: { origins: readonly string[] }): Promise<boolean> };
  imageFetcher: ImageFetcher;
  inferenceHost: InferenceHost;
  siteState: {
    isEnabled(pageUrl: string): Promise<boolean>;
    enablePage(pageUrl: string): Promise<unknown>;
    disablePage(pageUrl: string): Promise<unknown>;
  };
  activeTab(): Promise<{ id?: number; url?: string } | undefined>;
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
  const currentPage = async (sender: RuntimeSender): Promise<string | undefined> => {
    if (sender.tab !== undefined) return senderPage(sender);
    const tab = await adapter.activeTab();
    return typeof tab?.url === 'string' && pageOrigin(tab.url) !== undefined ? tab.url : undefined;
  };

  return {
    async handle(message: unknown, sender: RuntimeSender): Promise<unknown | undefined> {
      if (message === null || typeof message !== 'object' || !('type' in message)) return undefined;
      const request = message as { type?: unknown; url?: unknown; imageDataUrl?: unknown; revision?: unknown; modes?: unknown; enabled?: unknown };
      if (request.type === 'captcha:acquire-image') {
        const page = senderPage(sender);
        const origin = page === undefined ? undefined : pageOrigin(page);
        let permitted = false;
        if (origin !== undefined) {
          try { permitted = await adapter.permissions.contains({ origins: [origin] }); } catch { permitted = false; }
        }
        if (typeof request.url !== 'string' || !permitted) {
          return { state: 'image_unavailable', reason: 'permission' };
        }
        return adapter.imageFetcher.fetch(request.url);
      }
      if (request.type === 'captcha:recognize') {
        const inferenceRequest = { type: 'ocr:recognize' as const, requestId: 'runtime-validation', imageRevision: request.revision, imageDataUrl: request.imageDataUrl, modes: request.modes };
        if (!isInferenceRequest(inferenceRequest)) return recognitionError(undefined);
        try { return await adapter.inferenceHost.recognize(inferenceRequest.imageDataUrl, inferenceRequest.imageRevision, inferenceRequest.modes); } catch (error) { return recognitionError(error); }
      }
      if (request.type === 'captcha:get-site-state' || request.type === 'captcha:get-status') {
        const page = await currentPage(sender);
        if (page === undefined) return { enabled: false };
        try { return { enabled: await adapter.permissions.contains({ origins: originsForPage(page) }) && await adapter.siteState.isEnabled(page) }; } catch { return { enabled: false }; }
      }
      if (request.type === 'captcha:set-site-enabled') {
        const page = await currentPage(sender);
        if (page === undefined || typeof request.enabled !== 'boolean') return { enabled: false, reason: 'invalid-request' };
        return request.enabled ? adapter.siteState.enablePage(page) : adapter.siteState.disablePage(page);
      }
      return undefined;
    },
  };
}
