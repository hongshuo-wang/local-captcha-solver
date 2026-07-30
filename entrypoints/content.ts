import { acquireImage } from '../src/content/image-source';
import { imageRevision, isVisible, snapshotForImage } from '../src/content/dom-snapshot';
import { observeCaptchaImages } from '../src/content/observer';
import { clearWorkflowStatus, showRecognizing, showWorkflowStatus, type CopyOutcome, type StatusAction } from '../src/content/status-ui';
import { createCaptchaWorkflow } from '../src/content/workflow';
import { fillEmptyField, replaceField, type TextFieldElement } from '../src/content/field-fill';
import { copyText } from '../src/content/clipboard';
import { AUTOMATIC_CANDIDATE_THRESHOLD, scoreCaptchaCandidate } from '../src/core/candidate-scorer';
import type { OcrResult, WorkflowResult } from '../src/core/types';
import { sendRuntimeMessage } from '../src/platform/runtime-messaging';
import { isRecognitionShortcut, SETTINGS_STORAGE_KEY, type RecognitionShortcut } from '../src/platform/settings-store';

type Runtime = {
  sendMessage(message: unknown): Promise<unknown>;
  onMessage: { addListener(listener: (message: unknown) => unknown): void };
  settings?: { read(): Promise<unknown>; subscribe(listener: (settings: unknown) => void): () => void };
};
function isOcrResults(value: unknown): value is readonly OcrResult[] { return Array.isArray(value) && value.every((item) => item && typeof item === 'object' && typeof (item as OcrResult).text === 'string' && typeof (item as OcrResult).confidence === 'number' && typeof (item as OcrResult).mode === 'string'); }
function isRecognitionError(value: unknown): value is { type: 'captcha:recognition-error'; code: 'model_unavailable' | 'recognition_failed' } { return typeof value === 'object' && value !== null && (value as { type?: unknown }).type === 'captcha:recognition-error' && ((value as { code?: unknown }).code === 'model_unavailable' || (value as { code?: unknown }).code === 'recognition_failed'); }
function isSiteState(value: unknown): value is { enabled: boolean } { return typeof value === 'object' && value !== null && typeof (value as { enabled?: unknown }).enabled === 'boolean'; }
function isCopyPreference(value: unknown): value is { copyOnNoField: boolean } { return typeof value === 'object' && value !== null && typeof (value as { copyOnNoField?: unknown }).copyOnNoField === 'boolean'; }
function autoFillFromSettings(value: unknown): boolean { return typeof value !== 'object' || value === null || (value as { autoFill?: unknown }).autoFill !== false; }
function shortcutFromSettings(value: unknown): RecognitionShortcut {
  if (typeof value !== 'object' || value === null) return 'middle';
  const shortcut = (value as { recognitionShortcut?: unknown }).recognitionShortcut;
  return isRecognitionShortcut(shortcut) ? shortcut : 'middle';
}
function matchesShortcut(event: MouseEvent, shortcut: RecognitionShortcut): boolean {
  if (shortcut === 'middle') return event.button === 1;
  if (event.button !== 0) return false;
  if (shortcut === 'ctrl-click') return event.ctrlKey || event.metaKey;
  if (shortcut === 'alt-click') return event.altKey;
  return event.shiftKey;
}
export function createRuntimeContent(runtime: Runtime) {
  let autoFillEnabled = true;
  const workflow = createCaptchaWorkflow({
    acquire: (image) => acquireImage(image, { fetchRemote: async (url) => runtime.sendMessage({ type: 'captcha:acquire-image', url }) as Promise<{ state: 'ready'; bytes: Uint8Array; mimeType: string } | { state: 'image_unavailable'; reason: 'permission' | 'cors' | 'type' | 'size' | 'network' }> }),
    recognize: async (imageDataUrl, revision, modes) => {
      const response = await runtime.sendMessage({ type: 'captcha:recognize', imageDataUrl, revision, modes });
      if (isRecognitionError(response)) throw Object.assign(new Error(response.code), { code: response.code });
      if (!isOcrResults(response)) throw new Error('Invalid OCR response');
      return response;
    },
    autoFillEnabled: () => autoFillEnabled,
  });
  let automaticEnabled = false;
  let lifecycleGeneration = 0;
  const statusTokens = new WeakMap<HTMLImageElement, number>();
  const dismissedRevisions = new WeakMap<HTMLImageElement, string>();
  const copyNoFieldResult = async (result: WorkflowResult, isCurrent: () => boolean): Promise<CopyOutcome | undefined> => {
    if (result.state !== 'no_field' || result.fillValue === undefined) return undefined;
    let copyEnabled = false;
    try {
      const preference = await runtime.sendMessage({ type: 'captcha:get-preferences' });
      copyEnabled = isCopyPreference(preference) ? preference.copyOnNoField : false;
    } catch { copyEnabled = false; }
    if (!isCurrent()) return undefined;
    if (!copyEnabled) return 'disabled';
    return await copyText(result.fillValue) ? 'copied' : 'failed';
  };
  const selectField = (fields: readonly TextFieldElement[], value: string): Promise<boolean> => new Promise((resolve) => {
    const previous = fields.map((field) => ({ field, outline: field.style.outline, outlineOffset: field.style.outlineOffset }));
    fields.forEach((field) => {
      field.style.outline = '2px solid #47725a';
      field.style.outlineOffset = '2px';
    });
    const cleanup = () => {
      document.removeEventListener('click', choose, true);
      document.removeEventListener('keydown', cancel, true);
      previous.forEach(({ field, outline, outlineOffset }) => Object.assign(field.style, { outline, outlineOffset }));
    };
    const finish = (selected?: TextFieldElement) => {
      cleanup();
      if (selected === undefined) { resolve(false); return; }
      const outcome = selected.value === '' ? fillEmptyField(selected, value) : replaceField(selected, value);
      if (outcome.state === 'filled') selected.focus({ preventScroll: true });
      resolve(outcome.state === 'filled');
    };
    const choose = (event: Event) => {
      const target = event.target;
      const selected = target instanceof Element ? fields.find((field) => field === target || field.contains(target)) : undefined;
      if (selected === undefined) return;
      event.preventDefault();
      event.stopPropagation();
      finish(selected);
    };
    const cancel = (event: KeyboardEvent) => { if (event.key === 'Escape') finish(); };
    document.addEventListener('click', choose, true);
    document.addEventListener('keydown', cancel, true);
  });
  const copyAction = (value: string): StatusAction => ({
    label: '复制',
    onClick: () => copyText(value),
    successMessage: '已复制到剪贴板',
    failureMessage: '复制失败，请重试',
  });
  const displayed = {
    cancel: workflow.cancel,
    cancelAll: workflow.cancelAll,
    invalidate: workflow.invalidate,
    run: async (...args: Parameters<typeof workflow.run>) => {
      if (args[1] === 'automatic' && !automaticEnabled) return { state: 'stale', candidateId: '' } as const;
      if (args[1] === 'automatic' && dismissedRevisions.get(args[0]) === imageRevision(args[0])) return { state: 'stale', candidateId: '' } as const;
      const generation = args[1] === 'automatic' ? lifecycleGeneration : ++lifecycleGeneration;
      const token = (statusTokens.get(args[0]) ?? 0) + 1;
      statusTokens.set(args[0], token);
      const snapshot = snapshotForImage(args[0]);
      const shouldShow = args[1] !== 'automatic' || (snapshot !== undefined && scoreCaptchaCandidate(snapshot.candidate.candidate).score >= AUTOMATIC_CANDIDATE_THRESHOLD);
      const isCurrentStatus = () => shouldShow && lifecycleGeneration === generation && statusTokens.get(args[0]) === token && (args[1] !== 'automatic' || automaticEnabled);
      if (shouldShow) {
        let preparing = false;
        try {
          const model = await runtime.sendMessage({ type: 'captcha:get-model-status' });
          preparing = typeof model === 'object' && model !== null && (model as { status?: unknown }).status === 'loading';
        } catch { /* Recognition will surface a guarded model error if needed. */ }
        if (isCurrentStatus()) showRecognizing(args[0], preparing ? 'preparing' : 'recognizing');
      }
      const result = await workflow.run(...args);
      if (!isCurrentStatus()) return result;
      if (result.state === 'stale') { clearWorkflowStatus(); return result; }
      const copyOutcome = await copyNoFieldResult(result, isCurrentStatus);
      if (!isCurrentStatus()) return result;
      const activity = result.state === 'filled' ? 'filled'
        : result.state === 'needs_confirmation' ? 'confirmation'
          : result.state === 'no_field' ? (copyOutcome === 'copied' ? 'copied' : 'no_field')
            : result.state === 'recognition_failed' || result.state === 'image_unavailable' || result.state === 'permission_denied' || result.state === 'model_unavailable' ? 'failed'
              : undefined;
      if (activity !== undefined) void runtime.sendMessage({ type: 'captcha:record-activity', outcome: activity }).catch(() => undefined);
      const detail = snapshotForImage(args[0]);
      const field = result.state === 'filled'
        ? detail?.fields.find((item) => item.id === result.fieldId)
        : result.state === 'needs_confirmation' && result.fieldIds.length === 1
          ? detail?.fields.find((item) => item.id === result.fieldIds[0])
          : undefined;
      const actions: StatusAction[] = [];
      if (result.state === 'needs_confirmation' && result.fillValue !== undefined) {
        if (field !== undefined) {
          const replacing = field.element.value !== '';
          actions.push({
            label: replacing ? '替换' : '填入',
            kind: 'primary',
            onClick: () => (replacing ? replaceField(field.element, result.fillValue!) : fillEmptyField(field.element, result.fillValue!)).state === 'filled',
            successMessage: replacing ? '已替换验证码' : '已填入验证码',
            failureMessage: '输入框状态已变化',
          });
        } else if (result.fieldIds.length > 1) {
          const choices = detail?.fields.filter((item) => result.fieldIds.includes(item.id)).map((item) => item.element) ?? [];
          if (choices.length > 0) actions.push({ label: '选择输入框', kind: 'primary', onClick: () => selectField(choices, result.fillValue!), successMessage: '已填入所选输入框', failureMessage: '未选择输入框' });
        }
        actions.push(copyAction(result.fillValue));
      }
      if (result.state === 'no_field' && result.fillValue !== undefined && copyOutcome !== 'copied') actions.push(copyAction(result.fillValue));
      if (result.state === 'recognition_failed' || result.state === 'image_unavailable' || result.state === 'permission_denied') {
        actions.push({ label: '重试', kind: 'primary', onClick: () => { setTimeout(() => { void displayed.run(args[0], 'explicit'); }, 0); } });
      }
      if (result.state === 'model_unavailable') {
        actions.push({ label: '重新加载模型', kind: 'primary', onClick: async () => { await runtime.sendMessage({ type: 'captcha:retry-model-warmup' }); setTimeout(() => { void displayed.run(args[0], 'explicit'); }, 0); } });
      }
      const onDismiss = () => dismissedRevisions.set(args[0], imageRevision(args[0]));
      showWorkflowStatus(result, field?.element ?? args[0], { actions, copyOutcome, onDismiss });
      return result;
    },
  };
  let observer: ReturnType<typeof observeCaptchaImages> | undefined;
  let recognitionShortcut: RecognitionShortcut = 'middle';
  let shortcutGeneration = 0;
  const initialShortcutGeneration = shortcutGeneration;
  void runtime.settings?.read().then((settings) => {
    if (shortcutGeneration === initialShortcutGeneration) {
      recognitionShortcut = shortcutFromSettings(settings);
      autoFillEnabled = autoFillFromSettings(settings);
    }
  }).catch(() => undefined);
  const unsubscribeSettings = runtime.settings?.subscribe((settings) => {
    shortcutGeneration += 1;
    recognitionShortcut = shortcutFromSettings(settings);
    autoFillEnabled = autoFillFromSettings(settings);
  });
  const documentWithShortcut = document as Document & { __localCaptchaShortcutCleanup?: () => void };
  documentWithShortcut.__localCaptchaShortcutCleanup?.();
  const shortcutImage = (event: Event): HTMLImageElement | undefined => {
    if (!(event instanceof MouseEvent) || !matchesShortcut(event, recognitionShortcut)) return undefined;
    const target = event.target;
    const image = target instanceof Element ? target.closest('img') : undefined;
    return image instanceof HTMLImageElement && isVisible(image) ? image : undefined;
  };
  const onShortcutDown = (event: Event): void => {
    const image = shortcutImage(event);
    if (image === undefined) return;
    event.preventDefault();
    void displayed.run(image, 'explicit');
  };
  const suppressShortcutDefault = (event: Event): void => { if (shortcutImage(event) !== undefined) event.preventDefault(); };
  document.addEventListener('mousedown', onShortcutDown, true);
  document.addEventListener('click', suppressShortcutDefault, true);
  document.addEventListener('auxclick', suppressShortcutDefault, true);
  documentWithShortcut.__localCaptchaShortcutCleanup = () => {
    document.removeEventListener('mousedown', onShortcutDown, true);
    document.removeEventListener('click', suppressShortcutDefault, true);
    document.removeEventListener('auxclick', suppressShortcutDefault, true);
    unsubscribeSettings?.();
  };
  const enable = () => { lifecycleGeneration += 1; automaticEnabled = true; observer ??= observeCaptchaImages(displayed); };
  const disable = () => { lifecycleGeneration += 1; automaticEnabled = false; observer?.disconnect(); observer = undefined; workflow.cancelAll?.(); clearWorkflowStatus(); };
  runtime.onMessage.addListener((message) => {
    if (!message || typeof message !== 'object') return undefined;
    const type = (message as { type?: string }).type;
    if (type === 'captcha:ping') return Promise.resolve({ ok: true });
    if (type === 'captcha:auto-enable') { enable(); return Promise.resolve({ enabled: true }); }
    if (type === 'captcha:auto-disable') { disable(); return Promise.resolve({ enabled: false }); }
    if (type === 'captcha:scan') { enable(); return Promise.resolve({ queued: true }); }
    if (type === 'captcha:context-image') { const source = (message as { srcUrl?: unknown }).srcUrl; const matches = typeof source === 'string' ? Array.from(document.querySelectorAll('img')).filter((image) => isVisible(image) && (image.currentSrc === source || image.src === source)) : []; if (matches.length === 1) return displayed.run(matches[0]!, 'context'); lifecycleGeneration += 1; if (matches.length === 0) { const result = { state: 'no_candidate' as const }; showWorkflowStatus(result); return Promise.resolve(result); } const result = { state: 'ambiguous_image' as const, candidateIds: matches.map((image) => snapshotForImage(image)?.candidate.id).filter((id): id is string => id !== undefined) }; showWorkflowStatus(result); return Promise.resolve(result); }
    if (type === 'captcha:get-status') return Promise.resolve({ enabled: observer !== undefined });
    return undefined;
  });
  const initialGeneration = lifecycleGeneration;
  void Promise.resolve(runtime.sendMessage({ type: 'captcha:get-site-state' })).then((state) => { if (isSiteState(state) && state.enabled && lifecycleGeneration === initialGeneration) enable(); }).catch(() => undefined);
  return { workflow: displayed, enable, disable };
}

export default defineContentScript({ matches: [], registration: 'runtime', main() {
  const runtime = browser.runtime;
  createRuntimeContent({
    sendMessage: (message) => sendRuntimeMessage(runtime, message),
    onMessage: runtime.onMessage,
    settings: {
      async read() { return (await browser.storage.local.get(SETTINGS_STORAGE_KEY))[SETTINGS_STORAGE_KEY]; },
      subscribe(listener) {
        const handle = (changes: Record<string, { newValue?: unknown }>, areaName: string) => {
          if (areaName === 'local' && Object.hasOwn(changes, SETTINGS_STORAGE_KEY)) listener(changes[SETTINGS_STORAGE_KEY]?.newValue);
        };
        browser.storage.onChanged.addListener(handle);
        return () => browser.storage.onChanged.removeListener(handle);
      },
    },
  });
} });
