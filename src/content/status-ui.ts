import type { WorkflowResult } from '../core/types';

const MESSAGES: Record<WorkflowResult['state'], string> = {
  filled: '验证码已识别并填入。', needs_confirmation: '识别到验证码，请确认是否填充。', no_candidate: '没有找到可识别的验证码。', no_field: '没有找到对应的验证码输入框。', image_unavailable: '验证码图片无法读取。', permission_denied: '浏览器未允许读取验证码图片。', recognition_failed: '验证码识别失败，请重试。', stale: '验证码已变化，请重新识别。', model_unavailable: '本地识别模型不可用。', ambiguous_image: '找到多个匹配的验证码图片。',
};
let removalTimer: ReturnType<typeof setTimeout> | undefined;
function position(region: HTMLElement, anchor?: Element): void {
  const fallback = { left: Math.max(8, globalThis.innerWidth - 240), top: Math.max(8, globalThis.innerHeight - 64), bottom: 0, right: 0, width: 0, height: 0 };
  const rect = anchor?.isConnected ? anchor.getBoundingClientRect() : fallback;
  const width = 240;
  const left = Math.min(Math.max(8, rect.left), Math.max(8, globalThis.innerWidth - width - 8));
  const top = rect.bottom + 8 + 72 <= globalThis.innerHeight ? rect.bottom + 8 : Math.max(8, rect.top - 72 - 8);
  Object.assign(region.style, { left: `${left}px`, top: `${top}px` });
}
function show(message: string, anchor?: Element, action?: { label: string; onClick: () => void }, timeout = action ? 8000 : 4000): void {
  const existing = document.querySelector('[data-local-captcha-status]'); existing?.remove(); if (removalTimer) clearTimeout(removalTimer);
  const region = document.createElement('div'); region.dataset.localCaptchaStatus = 'true'; region.setAttribute('role', 'status'); region.setAttribute('aria-live', 'polite');
  const text = document.createElement('span'); text.textContent = message; region.append(text);
  Object.assign(region.style, { position: 'fixed', width: '240px', minHeight: '36px', boxSizing: 'border-box', padding: '9px 10px', zIndex: '2147483647', pointerEvents: action ? 'auto' : 'none', font: '13px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif', color: '#17202a', background: '#fff', border: '1px solid #b8c2cc', borderRadius: '6px', boxShadow: '0 4px 14px rgba(23,32,42,.16)' });
  position(region, anchor); if (anchor?.isConnected) region.dataset.anchor = 'candidate';
  if (action) { const button = document.createElement('button'); button.type = 'button'; button.textContent = action.label; button.dataset.localCaptchaAction = 'true'; Object.assign(button.style, { marginTop: '7px', padding: '4px 9px', border: '1px solid #1769aa', borderRadius: '4px', color: '#fff', background: '#1769aa', cursor: 'pointer', font: 'inherit' }); button.addEventListener('click', () => { action.onClick(); region.remove(); }); region.append(button); }
  document.body.append(region); if (timeout > 0) removalTimer = setTimeout(() => region.remove(), timeout);
}
export function showRecognizing(anchor?: Element): void { show('正在识别验证码…', anchor, undefined, 0); }
export function showWorkflowStatus(result: WorkflowResult, anchor?: Element, onConfirm?: () => void): void {
  if (result.state === 'needs_confirmation' && result.fillValue !== undefined && onConfirm !== undefined) {
    show(`识别到：${result.displayText || result.fillValue}`, anchor, { label: '填充', onClick: onConfirm });
    return;
  }
  const detail = result.state === 'filled' ? `识别到：${result.displayText || result.fillValue}，已填入` : MESSAGES[result.state];
  show(detail, anchor);
}
export function clearWorkflowStatus(): void { if (removalTimer) clearTimeout(removalTimer); document.querySelector('[data-local-captcha-status]')?.remove(); }
