import { imageRevision, isVisible, noteImageLoaded, snapshotImages } from './dom-snapshot';
import type { CaptchaWorkflow } from './workflow';

export interface CaptchaObserver { disconnect(): void }
export function observeCaptchaImages(workflow: CaptchaWorkflow, root: Document = document): CaptchaObserver {
  let active = true;
  const pending = new Map<HTMLImageElement, ReturnType<typeof setTimeout>>();
  const processed = new WeakMap<HTMLImageElement, string>();
  const execute = (image: HTMLImageElement) => { const revision = imageRevision(image); if (!active || !isVisible(image) || processed.get(image) === revision) return; processed.set(image, revision); void workflow.run(image, 'automatic'); };
  const schedule = (image: HTMLImageElement) => { if (!active || !isVisible(image)) return; const old = pending.get(image); if (old) clearTimeout(old); const timer = setTimeout(() => { pending.delete(image); execute(image); }, 150); pending.set(image, timer); };
  const scan = (node: ParentNode) => { if (node instanceof HTMLImageElement) schedule(node); node.querySelectorAll?.('img').forEach(schedule); };
  snapshotImages(root).forEach((item) => execute(item.element));
  const onLoad = (event: Event) => { const target = event.target; if (target instanceof HTMLImageElement && isVisible(target)) { noteImageLoaded(target); schedule(target); } };
  const observer = new MutationObserver((records) => records.forEach((record) => { if (record.type === 'attributes' && record.target instanceof HTMLImageElement) schedule(record.target); record.addedNodes.forEach((node) => { if (node instanceof Element && !node.closest('[data-local-captcha-status]')) scan(node); }); }));
  observer.observe(root.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['src', 'srcset'] });
  root.addEventListener('load', onLoad, true);
  return { disconnect() { active = false; observer.disconnect(); root.removeEventListener('load', onLoad, true); pending.forEach(clearTimeout); pending.clear(); workflow.cancelAll?.(); } };
}
