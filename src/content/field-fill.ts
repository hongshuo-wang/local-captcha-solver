export type FieldFillResult =
  | { state: 'filled' }
  | { state: 'not_empty' }
  | { state: 'not_eligible' }
  | { state: 'stale' };

const TEXT_LIKE_TYPES = new Set(['', 'text', 'search', 'email', 'tel', 'url', 'number']);

function isEffectivelyVisible(field: HTMLInputElement): boolean {
  for (let element: Element | null = field; element !== null; element = element.parentElement) {
    if ((element === field && field.hidden) || element.hasAttribute('hidden')) return false;
    const style = globalThis.getComputedStyle?.(element);
    if (style?.display === 'none' || style?.visibility === 'hidden' || style?.visibility === 'collapse') return false;
  }
  return true;
}

function isEligible(field: HTMLInputElement): boolean {
  return TEXT_LIKE_TYPES.has(field.type.toLowerCase()) && !field.disabled && !field.readOnly && isEffectivelyVisible(field);
}

/** Fill only a still-empty text-like input, without submitting or simulating user gestures. */
export function fillEmptyField(field: HTMLInputElement, value: string): FieldFillResult {
  if (!field.isConnected) return { state: 'stale' };
  if (!isEligible(field)) return { state: 'not_eligible' };
  if (field.value !== '') return { state: 'not_empty' };

  // Recheck at the final possible point, before invoking the framework-aware native setter.
  if (!field.isConnected) return { state: 'stale' };
  if (!isEligible(field)) return { state: 'not_eligible' };
  if (field.value !== '') return { state: 'not_empty' };

  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  if (setter === undefined) return { state: 'not_eligible' };
  setter.call(field, value);
  field.dispatchEvent(new Event('input', { bubbles: true }));
  field.dispatchEvent(new Event('change', { bubbles: true }));
  return { state: 'filled' };
}
