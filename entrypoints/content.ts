import { acquireImage } from '../src/content/image-source';
import { isVisible, snapshotForImage } from '../src/content/dom-snapshot';
import { observeCaptchaImages } from '../src/content/observer';
import { clearWorkflowStatus, showRecognizing, showWorkflowStatus } from '../src/content/status-ui';
import { createCaptchaWorkflow } from '../src/content/workflow';
import { AUTOMATIC_CANDIDATE_THRESHOLD, scoreCaptchaCandidate } from '../src/core/candidate-scorer';
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
  let automaticEnabled = false;
  let lifecycleGeneration = 0;
  const statusTokens = new WeakMap<HTMLImageElement, number>();
  const displayed = { cancel: workflow.cancel, cancelAll: workflow.cancelAll, invalidate: workflow.invalidate, run: async (...args: Parameters<typeof workflow.run>) => { if (args[1] === 'automatic' && !automaticEnabled) return { state: 'stale', candidateId: '' } as const; const generation = args[1] === 'automatic' ? lifecycleGeneration : ++lifecycleGeneration; const token = (statusTokens.get(args[0]) ?? 0) + 1; statusTokens.set(args[0], token); const snapshot = snapshotForImage(args[0]); const shouldShow = args[1] !== 'automatic' || (snapshot !== undefined && scoreCaptchaCandidate(snapshot.candidate.candidate).score >= AUTOMATIC_CANDIDATE_THRESHOLD); if (shouldShow) showRecognizing(args[0]); const result = await workflow.run(...args); if (shouldShow && lifecycleGeneration === generation && statusTokens.get(args[0]) === token && (args[1] !== 'automatic' || automaticEnabled)) showWorkflowStatus(result, args[0]); return result; } };
  let observer: ReturnType<typeof observeCaptchaImages> | undefined;
  runtime.onMessage.addListener((message) => {
    if (!message || typeof message !== 'object') return undefined;
    const type = (message as { type?: string }).type;
    if (type === 'captcha:ping') return { ok: true };
    if (type === 'captcha:auto-enable') { lifecycleGeneration += 1; automaticEnabled = true; observer ??= observeCaptchaImages(displayed); return { enabled: true }; }
    if (type === 'captcha:auto-disable') { lifecycleGeneration += 1; automaticEnabled = false; observer?.disconnect(); observer = undefined; workflow.cancelAll?.(); clearWorkflowStatus(); return { enabled: false }; }
    if (type === 'captcha:scan') { document.querySelectorAll('img').forEach((image) => void displayed.run(image, 'automatic')); return { queued: true }; }
    if (type === 'captcha:context-image') { const source = (message as { srcUrl?: unknown }).srcUrl; const matches = typeof source === 'string' ? Array.from(document.querySelectorAll('img')).filter((image) => isVisible(image) && (image.currentSrc === source || image.src === source)) : []; if (matches.length === 1) return displayed.run(matches[0]!, 'context'); lifecycleGeneration += 1; if (matches.length === 0) { const result = { state: 'no_candidate' as const }; showWorkflowStatus(result); return result; } const result = { state: 'ambiguous_image' as const, candidateIds: matches.map((image) => snapshotForImage(image)?.candidate.id).filter((id): id is string => id !== undefined) }; showWorkflowStatus(result); return result; }
    if (type === 'captcha:get-status') return { enabled: observer !== undefined };
    return undefined;
  });
  return { workflow: displayed, enable: () => { lifecycleGeneration += 1; automaticEnabled = true; observer ??= observeCaptchaImages(displayed); }, disable: () => { lifecycleGeneration += 1; automaticEnabled = false; observer?.disconnect(); observer = undefined; workflow.cancelAll?.(); clearWorkflowStatus(); } };
}

export default defineContentScript({ matches: [], registration: 'runtime', main() { createRuntimeContent(browser.runtime); } });
