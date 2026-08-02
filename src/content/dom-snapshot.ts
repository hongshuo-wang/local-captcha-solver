import type { CandidateSnapshot } from '../core/candidate-scorer';
import { hasCaptchaFieldSemantics, type FieldSnapshot } from '../core/field-matcher';
import { isEligibleField } from './field-fill';

export interface ImageSnapshot { id: string; element: HTMLImageElement; revision: string; candidate: CandidateSnapshot }
export type TextFieldElement = HTMLInputElement | HTMLTextAreaElement;
export interface SnapshotField { id: string; element: TextFieldElement; field: FieldSnapshot }
export interface ImageDetailSnapshot { candidate: ImageSnapshot; fields: readonly SnapshotField[] }

const imageIds = new WeakMap<HTMLImageElement, string>();
const fieldIds = new WeakMap<TextFieldElement, string>();
const loadRevisions = new WeakMap<HTMLImageElement, number>();
let nextId = 1;
function idFor<T extends Element>(element: T, ids: WeakMap<T, string>, prefix: string): string { let id = ids.get(element); if (!id) { id = `${prefix}-${nextId++}`; ids.set(element, id); } return id; }
export function isVisible(element: Element): boolean { for (let node: Element | null = element; node; node = node.parentElement) { if (node.hasAttribute('hidden')) return false; const style = globalThis.getComputedStyle?.(node); if (style?.display === 'none' || style?.visibility === 'hidden' || style?.visibility === 'collapse') return false; } return true; }
function dimensions(image: HTMLImageElement): readonly [number, number] { return [image.naturalWidth || image.width || 0, image.naturalHeight || image.height || 0]; }
export function imageRevision(image: HTMLImageElement): string { const [width, height] = dimensions(image); return [image.currentSrc, image.src, image.getAttribute('srcset') ?? '', width, height, loadRevisions.get(image) ?? 0].join('|'); }
export function noteImageLoaded(image: HTMLImageElement): void { loadRevisions.set(image, (loadRevisions.get(image) ?? 0) + 1); }
function eligible(field: TextFieldElement): boolean {
  return isVisible(field) && isEligibleField(field);
}
function labelFor(field: TextFieldElement): string {
  const owner = field.ownerDocument;
  const labels = field.labels ? [...field.labels].map((label) => label.textContent ?? '') : [];
  const explicit = field.id ? owner.querySelector(`label[for="${CSS.escape(field.id)}"]`)?.textContent ?? '' : '';
  const attributes = ['id', 'name', 'class', 'title', 'placeholder', 'aria-label', 'aria-labelledby', 'data-label', 'data-placeholder'].map((name) => field.getAttribute(name) ?? '');
  const labelledBy = field.getAttribute('aria-labelledby')?.split(/\s+/).map((id) => owner.getElementById(id)?.textContent ?? '').join(' ') ?? '';
  const parent = field.parentElement;
  const parentText = parent !== null && parent !== owner.body && parent !== owner.documentElement ? parent.textContent?.slice(0, 300) ?? '' : '';
  const adjacentText = [field.previousElementSibling?.textContent ?? '', field.nextElementSibling?.textContent ?? ''].join(' ').slice(0, 300);
  return [...labels, explicit, ...attributes, labelledBy, parentText, adjacentText].filter(Boolean).join(' ').trim();
}
function normalizedText(value: string): string { return value.trim().replace(/\s+/g, ' ').toLocaleLowerCase(); }
function legacyPlaceholderValue(field: TextFieldElement, labelText: string): string | undefined {
  if (field.value === '' || field.value !== field.defaultValue || !hasCaptchaFieldSemantics(labelText)) return undefined;
  const value = normalizedText(field.value);
  const markers = ['placeholder', 'title', 'aria-label', 'data-placeholder'].map((name) => normalizedText(field.getAttribute(name) ?? ''));
  return value !== '' && markers.includes(value) ? field.value : undefined;
}
function distance(a: Element, b: Element): number { const ar = a.getBoundingClientRect(); const br = b.getBoundingClientRect(); return Math.hypot((ar.left + ar.width / 2) - (br.left + br.width / 2), (ar.top + ar.height / 2) - (br.top + br.height / 2)); }
export function snapshotImages(root: Document = document): readonly ImageSnapshot[] { return [...root.querySelectorAll('img')].filter((image) => isVisible(image) && !image.closest('[data-local-captcha-status]')).map((image) => { const [width, height] = dimensions(image); const nearby = image.parentElement?.textContent ?? ''; const form = image.closest('form'); const nearbyFields = form?.querySelectorAll<TextFieldElement>('input, textarea') ?? root.querySelectorAll<TextFieldElement>('input, textarea'); return { id: idFor(image, imageIds, 'image'), element: image, revision: imageRevision(image), candidate: { attrText: [image.alt, image.title, image.id, image.className, image.getAttribute('name')].filter(Boolean).join(' '), nearbyText: nearby.slice(0, 1000), width, height, inForm: form !== null, nearShortInput: [...nearbyFields].some((field) => eligible(field) && distance(image, field) <= 300) } }; }); }
export function snapshotForImage(image: HTMLImageElement, root: Document = document): ImageDetailSnapshot | undefined {
  const candidate = snapshotImages(root).find((item) => item.element === image);
  if (candidate === undefined) return undefined;
  const form = image.closest('form');
  const fields = [...root.querySelectorAll<TextFieldElement>('input, textarea')].filter(eligible).map((element) => {
    const labelText = labelFor(element);
    return {
      id: idFor(element, fieldIds, 'field'),
      element,
      field: {
        id: idFor(element, fieldIds, 'field'),
        type: element instanceof HTMLTextAreaElement ? 'textarea' : element.type,
        value: element.value,
        replaceable: true,
        visible: true,
        disabled: element.disabled,
        readOnly: element.readOnly,
        distance: distance(image, element),
        sameForm: form !== null && element.closest('form') === form,
        labelText,
        placeholderValue: legacyPlaceholderValue(element, labelText),
      },
    };
  });
  return { candidate, fields };
}
