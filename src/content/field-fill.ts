export type FieldFillResult =
  | { state: 'filled' }
  | { state: 'not_empty' }
  | { state: 'not_eligible' }
  | { state: 'stale' };

const TEXT_LIKE_TYPES = new Set(['', 'text', 'search', 'email', 'tel', 'url', 'number']);
export type TextFieldElement = HTMLInputElement | HTMLTextAreaElement;
function isEffectivelyVisible(field: TextFieldElement): boolean {
  for (let element: Element | null = field; element !== null; element = element.parentElement) {
    if ((element === field && field.hidden) || element.hasAttribute('hidden')) return false;
    const style = globalThis.getComputedStyle?.(element);
    if (style?.display === 'none' || style?.visibility === 'hidden' || style?.visibility === 'collapse') return false;
  }
  return true;
}

export function isEligibleField(field: TextFieldElement): boolean {
  return (field instanceof HTMLTextAreaElement || TEXT_LIKE_TYPES.has(field.type.toLowerCase())) && !field.disabled && !field.readOnly && isEffectivelyVisible(field);
}

export function canFillField(field: TextFieldElement): boolean {
  return isEligibleField(field) && field.value === '';
}

function writeField(field: TextFieldElement, value: string): FieldFillResult {
  if (!field.isConnected) return { state: 'stale' };
  if (!isEligibleField(field)) return { state: 'not_eligible' };
  const setter = Object.getOwnPropertyDescriptor(field instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, 'value')?.set;
  if (setter === undefined) return { state: 'not_eligible' };
  setter.call(field, value);
  field.dispatchEvent(new Event('input', { bubbles: true }));
  field.dispatchEvent(new Event('change', { bubbles: true }));
  return { state: 'filled' };
}

/** Fill an empty field without submitting the form. */
export function fillEmptyField(field: TextFieldElement, value: string): FieldFillResult {
  if (!field.isConnected) return { state: 'stale' };
  if (!isEligibleField(field)) return { state: 'not_eligible' };
  if (field.value !== '') return { state: 'not_empty' };

  // Recheck at the final possible point, before invoking the framework-aware native setter.
  if (!field.isConnected) return { state: 'stale' };
  if (!isEligibleField(field)) return { state: 'not_eligible' };
  if (field.value !== '') return { state: 'not_empty' };

  return writeField(field, value);
}

/** Replace a field only after an explicit user confirmation. */
export function replaceField(field: TextFieldElement, value: string): FieldFillResult {
  return writeField(field, value);
}
