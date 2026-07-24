import type { CandidateSnapshot } from '../core/candidate-scorer';
import type { FieldSnapshot } from '../core/field-matcher';

export interface ImageSnapshot { id: string; element: HTMLImageElement; revision: string; candidate: CandidateSnapshot }
export interface SnapshotField { id: string; element: HTMLInputElement; field: FieldSnapshot }
export interface ImageDetailSnapshot { candidate: ImageSnapshot; fields: readonly SnapshotField[] }

const imageIds = new WeakMap<HTMLImageElement, string>();
const fieldIds = new WeakMap<HTMLInputElement, string>();
const loadRevisions = new WeakMap<HTMLImageElement, number>();
let nextId = 1;
function idFor<T extends Element>(element: T, ids: WeakMap<T, string>, prefix: string): string { let id = ids.get(element); if (!id) { id = `${prefix}-${nextId++}`; ids.set(element, id); } return id; }
export function isVisible(element: Element): boolean { for (let node: Element | null = element; node; node = node.parentElement) { if (node.hasAttribute('hidden')) return false; const style = globalThis.getComputedStyle?.(node); if (style?.display === 'none' || style?.visibility === 'hidden' || style?.visibility === 'collapse') return false; } return true; }
function dimensions(image: HTMLImageElement): readonly [number, number] { return [image.naturalWidth || image.width || 0, image.naturalHeight || image.height || 0]; }
export function imageRevision(image: HTMLImageElement): string { const [width, height] = dimensions(image); return [image.currentSrc, image.src, image.getAttribute('srcset') ?? '', width, height, loadRevisions.get(image) ?? 0].join('|'); }
export function noteImageLoaded(image: HTMLImageElement): void { loadRevisions.set(image, (loadRevisions.get(image) ?? 0) + 1); }
function eligible(field: HTMLInputElement): boolean { return isVisible(field) && !field.disabled && !field.readOnly && ['','text','search','email','tel','url','number'].includes(field.type.toLowerCase()); }
function labelFor(field: HTMLInputElement): string { const labels = field.labels ? [...field.labels].map((label) => label.textContent ?? '') : []; const explicit = field.id ? document.querySelector(`label[for="${CSS.escape(field.id)}"]`)?.textContent ?? '' : ''; return `${labels.join(' ')} ${explicit} ${field.getAttribute('aria-label') ?? ''}`.trim(); }
function distance(a: Element, b: Element): number { const ar = a.getBoundingClientRect(); const br = b.getBoundingClientRect(); return Math.hypot((ar.left + ar.width / 2) - (br.left + br.width / 2), (ar.top + ar.height / 2) - (br.top + br.height / 2)); }
export function snapshotImages(root: Document = document): readonly ImageSnapshot[] { return [...root.querySelectorAll('img')].filter((image) => isVisible(image) && !image.closest('[data-local-captcha-status]')).map((image) => { const [width, height] = dimensions(image); const nearby = image.parentElement?.textContent ?? ''; const form = image.closest('form'); return { id: idFor(image, imageIds, 'image'), element: image, revision: imageRevision(image), candidate: { attrText: [image.alt, image.title, image.id, image.className, image.getAttribute('name')].filter(Boolean).join(' '), nearbyText: nearby.slice(0, 1000), width, height, inForm: form !== null, nearShortInput: [...(form?.querySelectorAll('input') ?? document.querySelectorAll('input'))].some((field) => eligible(field) && distance(image, field) <= 300) } }; }); }
export function snapshotForImage(image: HTMLImageElement, root: Document = document): ImageDetailSnapshot | undefined { const candidate = snapshotImages(root).find((item) => item.element === image); if (candidate === undefined) return undefined; const form = image.closest('form'); const fields = [...root.querySelectorAll('input')].filter(eligible).map((element) => ({ id: idFor(element, fieldIds, 'field'), element, field: { id: idFor(element, fieldIds, 'field'), type: element.type, value: element.value, visible: true, disabled: element.disabled, readOnly: element.readOnly, distance: distance(image, element), sameForm: form !== null && element.closest('form') === form, labelText: labelFor(element) } })); return { candidate, fields }; }
