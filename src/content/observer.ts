import { AUTOMATIC_CANDIDATE_THRESHOLD, scoreCaptchaCandidate } from '../core/candidate-scorer';
import { imageRevision, isVisible, noteImageLoaded, snapshotImages } from './dom-snapshot';
import type { CaptchaWorkflow } from './workflow';

export interface CaptchaObserver { disconnect(): void }
export interface CaptchaScanSkip {
  candidateId: string;
  width: number;
  height: number;
  score: number;
  reason: 'below_threshold';
}
export interface CaptchaObserverOptions { onSkip?(skip: CaptchaScanSkip): void }

const BETTER_CANDIDATE_MARGIN = 10;
const DIAGNOSTIC_CANDIDATE_THRESHOLD = AUTOMATIC_CANDIDATE_THRESHOLD - 20;

export function observeCaptchaImages(workflow: CaptchaWorkflow, root: Document = document, options: CaptchaObserverOptions = {}): CaptchaObserver {
  let active = true;
  let scanTimer: ReturnType<typeof setTimeout> | undefined;
  let selected: { image: HTMLImageElement; revision: string; score: number } | undefined;
  let filled: { image: HTMLImageElement; revision: string } | undefined;
  const processed = new WeakMap<HTMLImageElement, string>();
  const reportedSkips = new WeakMap<HTMLImageElement, string>();

  const rankedCandidates = () => snapshotImages(root)
    .map((snapshot, order) => {
      const score = scoreCaptchaCandidate(snapshot.candidate).score;
      return { snapshot, score, order };
    })
    .sort((left, right) => right.score - left.score || left.order - right.order);

  const scan = (): void => {
    if (!active) return;
    if (filled !== undefined) {
      if (filled.image.isConnected && isVisible(filled.image) && imageRevision(filled.image) === filled.revision) return;
      filled = undefined;
    }

    const best = rankedCandidates()[0];
    if (best === undefined) {
      selected = undefined;
      return;
    }
    if (best.score < AUTOMATIC_CANDIDATE_THRESHOLD) {
      selected = undefined;
      if (best.score >= DIAGNOSTIC_CANDIDATE_THRESHOLD && reportedSkips.get(best.snapshot.element) !== best.snapshot.revision) {
        reportedSkips.set(best.snapshot.element, best.snapshot.revision);
        options.onSkip?.({
          candidateId: best.snapshot.id,
          width: best.snapshot.candidate.width,
          height: best.snapshot.candidate.height,
          score: best.score,
          reason: 'below_threshold',
        });
      }
      return;
    }
    const image = best.snapshot.element;
    const revision = best.snapshot.revision;
    if (processed.get(image) === revision) return;
    if (selected !== undefined && selected.image.isConnected && isVisible(selected.image) && imageRevision(selected.image) === selected.revision && selected.image !== image && best.score < selected.score + BETTER_CANDIDATE_MARGIN) return;

    selected = { image, revision, score: best.score };
    processed.set(image, revision);
    void workflow.run(image, 'automatic').then((result) => {
      if (!active || selected?.image !== image || selected.revision !== revision) return;
      if (result.state === 'filled') filled = { image, revision };
      if (result.state === 'no_field') processed.delete(image);
    });
  };

  const scheduleScan = (): void => {
    if (!active) return;
    if (scanTimer !== undefined) clearTimeout(scanTimer);
    scanTimer = setTimeout(() => {
      scanTimer = undefined;
      scan();
    }, 150);
  };

  scan();
  const onLoad = (event: Event): void => {
    const target = event.target;
    if (!(target instanceof HTMLImageElement) || !isVisible(target)) return;
    noteImageLoaded(target);
    scheduleScan();
  };
  const contextNode = (node: Node): Element | undefined => node instanceof Element ? node : node.parentElement ?? undefined;
  const relevant = (node: Element): boolean => node instanceof HTMLImageElement || node.matches('input, label, form, fieldset, select, textarea') || node.querySelector('img, input, label, form, fieldset, select, textarea') !== null;
  const observer = new MutationObserver((records) => {
    if (records.some((record) => {
      const target = contextNode(record.target);
      if (target?.closest('[data-local-captcha-status]')) return false;
      if (record.type === 'attributes') return target !== undefined && relevant(target);
      if (record.type === 'characterData') return target !== undefined && relevant(target);
      return [...record.addedNodes, ...record.removedNodes].some((node) => {
        const element = contextNode(node);
        return element !== undefined && !element.closest('[data-local-captcha-status]') && relevant(element);
      });
    })) scheduleScan();
  });
  observer.observe(root.documentElement, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['src', 'srcset', 'class', 'style', 'hidden', 'disabled', 'readonly', 'aria-label', 'aria-labelledby', 'placeholder', 'name', 'id', 'for'] });
  root.addEventListener('load', onLoad, true);

  return {
    disconnect() {
      active = false;
      observer.disconnect();
      root.removeEventListener('load', onLoad, true);
      if (scanTimer !== undefined) clearTimeout(scanTimer);
      workflow.cancelAll?.();
    },
  };
}
