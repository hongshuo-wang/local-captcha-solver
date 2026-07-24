import { acquireImage } from '../src/content/image-source';
import { observeCaptchaImages } from '../src/content/observer';
import { clearWorkflowStatus, showRecognizing, showWorkflowStatus } from '../src/content/status-ui';
import { createCaptchaWorkflow } from '../src/content/workflow';
import type { OcrResult } from '../src/core/types';

type Runtime = { sendMessage(message: unknown): Promise<unknown>; onMessage: { addListener(listener: (message: unknown) => unknown): void } };
function isOcrResults(value: unknown): value is readonly OcrResult[] { return Array.isArray(value) && value.every((item) => item && typeof item === 'object' && typeof (item as OcrResult).text === 'string' && typeof (item as OcrResult).confidence === 'number' && typeof (item as OcrResult).mode === 'string'); }
export function createRuntimeContent(runtime: Runtime) {
  const workflow = createCaptchaWorkflow({
    acquire: (image) => acquireImage(image, { fetchRemote: async (url) => runtime.sendMessage({ type: 'captcha:acquire-image', url }) as Promise<{ state: 'ready'; bytes: Uint8Array; mimeType: string } | { state: 'image_unavailable'; reason: 'permission' | 'cors' | 'type' | 'size' | 'network' }> }),
    recognize: async (imageDataUrl, revision, modes) => {
      const response = await runtime.sendMessage({ type: 'captcha:recognize', imageDataUrl, revision, modes });
      if (!isOcrResults(response)) throw new Error('Invalid OCR response');
      return response;
    },
  });
  let automaticEnabled = true;
  const displayed = { run: async (...args: Parameters<typeof workflow.run>) => { if (args[1] === 'automatic' && !automaticEnabled) return { state: 'stale', candidateId: '' } as const; showRecognizing(args[0]); const result = await workflow.run(...args); if (args[1] !== 'automatic' || automaticEnabled) showWorkflowStatus(result, args[0]); return result; } };
  let observer: ReturnType<typeof observeCaptchaImages> | undefined;
  runtime.onMessage.addListener((message) => {
    if (!message || typeof message !== 'object') return undefined;
    const type = (message as { type?: string }).type;
    if (type === 'captcha:ping') return { ok: true };
    if (type === 'captcha:auto-enable') { automaticEnabled = true; observer ??= observeCaptchaImages(displayed); return { enabled: true }; }
    if (type === 'captcha:auto-disable') { automaticEnabled = false; observer?.disconnect(); observer = undefined; clearWorkflowStatus(); return { enabled: false }; }
    if (type === 'captcha:scan') { document.querySelectorAll('img').forEach((image) => void displayed.run(image, 'automatic')); return { queued: true }; }
    if (type === 'captcha:context-image') { const source = (message as { srcUrl?: unknown }).srcUrl; const matches = typeof source === 'string' ? [...document.images].filter((image) => image.currentSrc === source || image.src === source) : []; return matches.length === 1 ? displayed.run(matches[0]!, 'context') : { state: 'needs_confirmation', fieldIds: [] }; }
    if (type === 'captcha:get-status') return { enabled: observer !== undefined };
    return undefined;
  });
  return { workflow: displayed, enable: () => { automaticEnabled = true; observer ??= observeCaptchaImages(displayed); }, disable: () => { automaticEnabled = false; observer?.disconnect(); observer = undefined; clearWorkflowStatus(); } };
}

export default defineContentScript({ matches: [], registration: 'runtime', main() { createRuntimeContent(browser.runtime); } });
