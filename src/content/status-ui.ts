import type { WorkflowResult } from '../core/types';

const MESSAGES: Record<WorkflowResult['state'], string> = {
  filled: 'CAPTCHA answer filled.', needs_confirmation: 'CAPTCHA answer needs confirmation.', no_candidate: 'No CAPTCHA candidate found.', no_field: 'No matching CAPTCHA field found.', image_unavailable: 'CAPTCHA image unavailable.', permission_denied: 'Permission is needed to read the CAPTCHA image.', recognition_failed: 'CAPTCHA recognition failed.', stale: 'CAPTCHA changed before it could be filled.', model_unavailable: 'CAPTCHA model unavailable.',
};
let removalTimer: ReturnType<typeof setTimeout> | undefined;
function show(message: string, anchor?: Element): void { const existing = document.querySelector('[data-local-captcha-status]'); existing?.remove(); if (removalTimer) clearTimeout(removalTimer); const region = document.createElement('div'); region.dataset.localCaptchaStatus = 'true'; region.setAttribute('role', 'status'); region.setAttribute('aria-live', 'polite'); region.textContent = message; Object.assign(region.style, { position: 'fixed', right: '12px', bottom: '12px', width: '220px', padding: '8px', zIndex: '2147483647', pointerEvents: 'none', font: '12px sans-serif', color: '#111', background: '#fff', border: '1px solid #777' }); if (anchor?.isConnected) region.dataset.anchor = 'candidate'; document.body.append(region); removalTimer = setTimeout(() => region.remove(), 4000); }
export function showRecognizing(anchor?: Element): void { show('Recognizing CAPTCHA.', anchor); }
export function showWorkflowStatus(result: WorkflowResult, anchor?: Element): void { show(MESSAGES[result.state], anchor); }
export function clearWorkflowStatus(): void { if (removalTimer) clearTimeout(removalTimer); document.querySelector('[data-local-captcha-status]')?.remove(); }
