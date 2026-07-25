import { describe, expect, it } from 'vitest';

import { createPopupView } from '../../entrypoints/popup/main';

describe('popup view', () => {
  it('renders a native labelled checkbox with product, hostname, and status regions', () => {
    const root = document.createElement('main');
    document.body.append(root);
    const view = createPopupView(root);
    const label = root.querySelector<HTMLLabelElement>('label[for="site-enabled"]');
    const hostname = root.querySelector<HTMLElement>('[data-popup-hostname]');
    const status = root.querySelector<HTMLElement>('[data-popup-status]');

    expect(root.textContent).toContain('Local CAPTCHA Solver');
    expect(label?.textContent).toContain('Automatically recognize on this site');
    expect(view.checkbox.type).toBe('checkbox');
    expect(label?.control).toBe(view.checkbox);
    expect(hostname).not.toBeNull();
    expect(status?.getAttribute('role')).toBe('status');
    root.remove();
  });

  it('keeps the toggle focusable and reflects disabled loading states without changing layout hooks', () => {
    const root = document.createElement('main');
    document.body.append(root);
    const view = createPopupView(root);
    const row = root.querySelector('.toggle-row');
    const status = root.querySelector<HTMLElement>('[data-popup-status]');

    view.render({ hostname: 'portal.example.test', checked: false, disabled: true, status: 'Checking site setting...' });
    expect(view.checkbox.disabled).toBe(true);
    expect(row).not.toBeNull();
    expect(status?.classList.contains('status')).toBe(true);

    view.render({ hostname: 'portal.example.test', checked: true, disabled: false, status: 'Automatic recognition is on.' });
    view.checkbox.focus();
    expect(document.activeElement).toBe(view.checkbox);
    expect(view.checkbox.checked).toBe(true);
    expect(view.checkbox.disabled).toBe(false);
    root.remove();
  });
});
