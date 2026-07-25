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
  const refreshImages = (scope: ParentNode): number => { const images = scope instanceof HTMLImageElement ? [scope] : [...scope.querySelectorAll('img')]; images.forEach((image) => { processed.delete(image); workflow.invalidate?.(image); schedule(image); }); return images.length; };
  const contextNode = (node: Node): Element | undefined => node instanceof Element ? node : node.parentElement ?? undefined;
  const relevant = (node: Element): boolean => node instanceof HTMLImageElement || node.matches('input, label, form, fieldset, select, textarea');
  const refreshContext = (node: Element) => { if (node.closest('[data-local-captcha-status]')) return; const scope = node instanceof HTMLImageElement || node.querySelector('img') !== null ? node : node.closest('form, fieldset') ?? node.parentElement; if (scope && refreshImages(scope) > 0) return; snapshotImages(root).forEach((snapshot) => { processed.delete(snapshot.element); workflow.invalidate?.(snapshot.element); schedule(snapshot.element); }); };
  const observer = new MutationObserver((records) => records.forEach((record) => { const target = contextNode(record.target); if (record.type === 'attributes') { if (target) refreshContext(target); return; } if (record.type === 'characterData') { if (target) refreshContext(target); return; } const additions = [...record.addedNodes].map(contextNode).filter((node): node is Element => node !== undefined && !node.closest('[data-local-captcha-status]')); additions.forEach(scan); const changedRelevant = additions.some(relevant) || [...record.removedNodes].some((node) => node instanceof Element && relevant(node)); if (changedRelevant && target) refreshContext(target); }));
  observer.observe(root.documentElement, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['src', 'srcset', 'class', 'style', 'hidden', 'disabled', 'readonly', 'aria-label', 'aria-labelledby', 'placeholder', 'name', 'id', 'for'] });
  root.addEventListener('load', onLoad, true);
  return { disconnect() { active = false; observer.disconnect(); root.removeEventListener('load', onLoad, true); pending.forEach(clearTimeout); pending.clear(); workflow.cancelAll?.(); } };
}
