import { describe, expect, it, vi } from 'vitest';

import { createPopupController, type PopupView } from '../../src/popup/controller';

function harness(options: { url?: string; state?: unknown; change?: unknown } = {}) {
  const sendMessage = vi.fn(async (message: { type: string }) => {
    if (message.type === 'captcha:get-site-state') return options.state ?? { enabled: false };
    return Object.hasOwn(options, 'change') ? options.change : { enabled: true };
  });
  const render = vi.fn();
  const view: PopupView = { render };
  const controller = createPopupController({
    tabs: { query: vi.fn(async () => [{ url: options.url ?? 'https://Portal.Example.test/login' }]) },
    runtime: { sendMessage },
  }, view);
  return { controller, render, sendMessage };
}

describe('popup controller', () => {
  it('normalizes the active hostname and renders the remotely reported enabled state', async () => {
    const app = harness({ state: { enabled: true } });

    await app.controller.start();

    expect(app.render).toHaveBeenLastCalledWith(expect.objectContaining({ hostname: 'portal.example.test', checked: true, disabled: false, status: 'Automatic recognition is on.' }));
    expect(app.sendMessage).toHaveBeenCalledWith({ type: 'captcha:get-site-state' });
  });

  it('renders a disabled site', async () => {
    const app = harness({ state: { enabled: false } });

    await app.controller.start();

    expect(app.render).toHaveBeenLastCalledWith(expect.objectContaining({ checked: false, disabled: false, status: 'Automatic recognition is off.' }));
  });

  it('shows a permission denial and keeps the toggle off', async () => {
    const app = harness({ state: { enabled: false }, change: { enabled: false, reason: 'permission-denied' } });
    await app.controller.start();

    await app.controller.setEnabled(true);

    expect(app.render).toHaveBeenLastCalledWith(expect.objectContaining({ checked: false, disabled: false, error: 'Permission was not granted for this site.' }));
  });

  it('treats a permission removal failure as a successful disable', async () => {
    const app = harness({ state: { enabled: true }, change: { disabled: true, permissionRemoved: false } });
    await app.controller.start();

    await app.controller.setEnabled(false);

    expect(app.render).toHaveBeenLastCalledWith(expect.objectContaining({ checked: false, disabled: false, status: 'Automatic recognition is off. Site permission could not be removed.' }));
  });

  it('does not send messages for unsupported pages', async () => {
    const app = harness({ url: 'edge://extensions/' });

    await app.controller.start();

    expect(app.render).toHaveBeenLastCalledWith(expect.objectContaining({ hostname: 'Unsupported page', checked: false, disabled: true, status: 'Automatic recognition is unavailable on this page.' }));
    expect(app.sendMessage).not.toHaveBeenCalled();
    await app.controller.setEnabled(true);
    expect(app.sendMessage).not.toHaveBeenCalled();
  });

  it('renders loading while a toggle request is pending', async () => {
    let release!: (result: unknown) => void;
    const pending = new Promise<unknown>((resolve) => { release = resolve; });
    const app = harness({ state: { enabled: false } });
    app.sendMessage.mockImplementation(async (message: { type: string }) => message.type === 'captcha:get-site-state' ? { enabled: false } : pending);
    await app.controller.start();

    const changing = app.controller.setEnabled(true);
    expect(app.render).toHaveBeenLastCalledWith(expect.objectContaining({ checked: false, disabled: true, status: 'Updating site setting...' }));
    release({ enabled: true });
    await changing;

    expect(app.render).toHaveBeenLastCalledWith(expect.objectContaining({ checked: true, disabled: false }));
  });

  it('maps malformed runtime responses to an error and restores the known state', async () => {
    const app = harness({ state: { enabled: true }, change: undefined });
    await app.controller.start();

    await app.controller.setEnabled(false);

    expect(app.render).toHaveBeenLastCalledWith(expect.objectContaining({ checked: true, disabled: false, error: 'Could not update this site setting.' }));
  });

  it('does not treat an incomplete enable response as a permission denial', async () => {
    const app = harness({ state: { enabled: false }, change: { enabled: false } });
    await app.controller.start();

    await app.controller.setEnabled(true);

    expect(app.render).toHaveBeenLastCalledWith(expect.objectContaining({ checked: false, disabled: false, error: 'Could not update this site setting.' }));
  });
});
