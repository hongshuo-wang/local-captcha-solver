import { describe, expect, it, vi } from 'vitest';

import { fillEmptyField } from '../../src/content/field-fill';

function input(type = 'text'): HTMLInputElement {
  const element = document.createElement('input');
  element.type = type;
  document.body.append(element);
  return element;
}

describe('fillEmptyField', () => {
  it('uses the native value setter before bubbling input then change', () => {
    const field = input();
    const events: string[] = [];
    field.addEventListener('input', () => events.push(`input:${field.value}`));
    field.addEventListener('change', () => events.push(`change:${field.value}`));

    const nativeSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    expect(nativeSetter).toBeTypeOf('function');
    const setter = vi.fn(function (this: HTMLInputElement, value: string) {
      nativeSetter?.call(this, value);
    });
    Object.defineProperty(field, 'value', {
      configurable: true,
      get() {
        return nativeSetter === undefined
          ? ''
          : Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.get?.call(this) ?? '';
      },
      set: setter,
    });

    expect(fillEmptyField(field, '1742')).toEqual({ state: 'filled' });
    expect(field.value).toBe('1742');
    expect(setter).not.toHaveBeenCalled();
    expect(events).toEqual(['input:1742', 'change:1742']);
  });

  it('does not overwrite non-empty values, including whitespace', () => {
    const field = input();
    field.value = '   ';

    expect(fillEmptyField(field, '1742')).toEqual({ state: 'not_empty' });
    expect(field.value).toBe('   ');
  });

  it.each(['hidden', 'disabled', 'readonly', 'password'])('rejects an ineligible %s field', (state) => {
    const field = input(state === 'hidden' || state === 'password' ? state : 'text');
    if (state === 'disabled') field.disabled = true;
    if (state === 'readonly') field.readOnly = true;

    expect(fillEmptyField(field, '1742')).toEqual({ state: 'not_eligible' });
    expect(field.value).toBe('');
  });

  it('never creates click, keyboard, submit, or form submission side effects', () => {
    const form = document.createElement('form');
    const field = document.createElement('input');
    form.append(field);
    document.body.append(form);
    const sideEffects = vi.fn();
    for (const eventName of ['click', 'keydown', 'keyup', 'keypress', 'submit']) {
      form.addEventListener(eventName, sideEffects);
      field.addEventListener(eventName, sideEffects);
    }
    const submit = vi.spyOn(form, 'submit');

    expect(fillEmptyField(field, '1742')).toEqual({ state: 'filled' });
    expect(sideEffects).not.toHaveBeenCalled();
    expect(submit).not.toHaveBeenCalled();
  });

  it('returns stale when the field is disconnected immediately before write', () => {
    const field = input();
    field.remove();

    expect(fillEmptyField(field, '1742')).toEqual({ state: 'stale' });
  });
});
