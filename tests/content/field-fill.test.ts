import { describe, expect, it, vi } from 'vitest';

import { fillEmptyField, replaceField } from '../../src/content/field-fill';

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

  it('fills an empty textarea with the native setter and input/change events', () => {
    const field = document.createElement('textarea');
    document.body.append(field);
    const events: string[] = [];
    field.addEventListener('input', () => events.push(`input:${field.value}`));
    field.addEventListener('change', () => events.push(`change:${field.value}`));

    expect(fillEmptyField(field, '验证码')).toEqual({ state: 'filled' });
    expect(field.value).toBe('验证码');
    expect(events).toEqual(['input:验证码', 'change:验证码']);
  });

  it('does not overwrite non-empty values, including whitespace', () => {
    const field = input();
    field.value = '   ';

    expect(fillEmptyField(field, '1742')).toEqual({ state: 'not_empty' });
    expect(field.value).toBe('   ');
  });

  it('does not automatically replace a value previously written by the extension', () => {
    const field = input();
    expect(fillEmptyField(field, '1742')).toEqual({ state: 'filled' });
    expect(fillEmptyField(field, '8391')).toEqual({ state: 'not_empty' });
    expect(field.value).toBe('1742');
  });

  it('replaces a non-empty value only through the explicit replacement function', () => {
    const field = input();
    expect(fillEmptyField(field, '1742')).toEqual({ state: 'filled' });
    field.value = 'user value';
    expect(fillEmptyField(field, '8391')).toEqual({ state: 'not_empty' });
    expect(replaceField(field, '8391')).toEqual({ state: 'filled' });
    expect(field.value).toBe('8391');
  });

  it.each(['hidden', 'disabled', 'readonly', 'password', 'file', 'checkbox', 'radio', 'button', 'submit'])('rejects an ineligible %s field', (state) => {
    const field = input(['hidden', 'password', 'file', 'checkbox', 'radio', 'button', 'submit'].includes(state) ? state : 'text');
    if (state === 'disabled') field.disabled = true;
    if (state === 'readonly') field.readOnly = true;
    const initialValue = field.value;

    expect(fillEmptyField(field, '1742')).toEqual({ state: 'not_eligible' });
    expect(field.value).toBe(initialValue);
  });

  it.each([
    (field: HTMLInputElement) => { field.hidden = true; },
    (field: HTMLInputElement) => { field.style.display = 'none'; },
    (field: HTMLInputElement) => { field.style.visibility = 'hidden'; },
  ])('rejects fields hidden by attribute or computed style', (hide) => {
    const field = input();
    hide(field);

    expect(fillEmptyField(field, '1742')).toEqual({ state: 'not_eligible' });
    expect(field.value).toBe('');
  });

  it.each([
    (ancestor: HTMLElement) => { ancestor.hidden = true; },
    (ancestor: HTMLElement) => { ancestor.style.display = 'none'; },
    (ancestor: HTMLElement) => { ancestor.style.visibility = 'hidden'; },
  ])('rejects a field hidden by an ancestor', (hide) => {
    const ancestor = document.createElement('div');
    const field = document.createElement('input');
    ancestor.append(field);
    document.body.append(ancestor);
    hide(ancestor);

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

  it('rechecks a controlled value immediately before invoking the native setter', () => {
    const field = input();
    let reads = 0;
    Object.defineProperty(field, 'value', {
      configurable: true,
      get: () => ++reads === 2 ? 'controlled value' : '',
    });

    expect(fillEmptyField(field, '1742')).toEqual({ state: 'not_empty' });
  });

  it('rechecks eligibility immediately before invoking the native setter', () => {
    const field = input();
    let reads = 0;
    Object.defineProperty(field, 'disabled', {
      configurable: true,
      get: () => ++reads === 2,
    });

    expect(fillEmptyField(field, '1742')).toEqual({ state: 'not_eligible' });
  });

  it('rechecks hidden state immediately before invoking the native setter', () => {
    const field = input();
    let reads = 0;
    Object.defineProperty(field, 'hidden', {
      configurable: true,
      get: () => ++reads === 2,
    });

    expect(fillEmptyField(field, '1742')).toEqual({ state: 'not_eligible' });
    expect(field.value).toBe('');
  });

  it('rechecks ancestor visibility immediately before invoking the native setter', () => {
    const ancestor = document.createElement('div');
    const field = document.createElement('input');
    ancestor.append(field);
    document.body.append(ancestor);
    let checks = 0;
    Object.defineProperty(ancestor, 'hasAttribute', {
      configurable: true,
      value: (name: string) => name === 'hidden' && ++checks === 2,
    });

    expect(fillEmptyField(field, '1742')).toEqual({ state: 'not_eligible' });
    expect(field.value).toBe('');
  });
});
