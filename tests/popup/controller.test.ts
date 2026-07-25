import { describe, expect, it, vi } from 'vitest';

import { createPopupController, type PopupView } from '../../src/popup/controller';

function harness(options: { url?: string; state?: unknown; change?: unknown } = {}) {
  const sendMessage = vi.fn(async (message: { type: string }) => {
    if (message.type === 'captcha:get-site-state') return Object.hasOwn(options, 'state') ? options.state : { enabled: false };
    return Object.hasOwn(options, 'change') ? options.change : { enabled: true };
  });
  const render = vi.fn();
  const view: PopupView = { render };
  const tabsQuery = vi.fn(async () => [{ url: Object.hasOwn(options, 'url') ? options.url : 'https://Portal.Example.test/login' }]);
  const controller = createPopupController({
    tabs: { query: tabsQuery },
    runtime: { sendMessage },
  }, view);
  return { controller, render, sendMessage, tabsQuery };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => { resolve = complete; });
  return { promise, resolve };
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

  it.each(['edge://extensions/', 'about:blank', 'file:///tmp/captcha.html', undefined])('does not send messages for unsupported pages (%s)', async (url) => {
    const app = harness({ url });

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

  it('includes the rendered hostname in a toggle request', async () => {
    const app = harness({ state: { enabled: false }, change: { enabled: true } });
    await app.controller.start();

    await app.controller.setEnabled(true);

    expect(app.sendMessage).toHaveBeenLastCalledWith({ type: 'captcha:set-site-enabled', enabled: true, hostname: 'portal.example.test' });
  });

  it('refreshes the current site after the background rejects a stale hostname', async () => {
    const app = harness({ state: { enabled: false } });
    app.sendMessage.mockImplementation(async (message: { type: string }) => message.type === 'captcha:set-site-enabled'
      ? { enabled: false, reason: 'site-changed' }
      : { enabled: false });
    await app.controller.start();
    app.tabsQuery.mockResolvedValueOnce([{ url: 'https://other.example.test/login' }]);

    await app.controller.setEnabled(true);

    expect(app.sendMessage).toHaveBeenCalledTimes(3);
    expect(app.sendMessage).toHaveBeenLastCalledWith({ type: 'captcha:get-site-state' });
    expect(app.render).toHaveBeenLastCalledWith(expect.objectContaining({ hostname: 'other.example.test', checked: false }));
  });

  it.each([
    ['undefined response', undefined],
    ['malformed response', { enabled: 'yes' }],
  ])('shows a typed loading error for an initial %s', async (_name, state) => {
    const app = harness({ state });

    await app.controller.start();

    expect(app.render).toHaveBeenLastCalledWith(expect.objectContaining({ checked: false, disabled: true, error: 'Could not load this site setting.' }));
  });

  it('shows a typed loading error when the initial state request rejects', async () => {
    const app = harness();
    app.sendMessage.mockRejectedValueOnce(new Error('runtime unavailable'));

    await app.controller.start();

    expect(app.render).toHaveBeenLastCalledWith(expect.objectContaining({ checked: false, disabled: true, error: 'Could not load this site setting.' }));
  });

  it('does not mutate when the initial site state is unknown', async () => {
    const app = harness({ state: undefined });
    await app.controller.start();

    await app.controller.setEnabled(true);

    expect(app.sendMessage).toHaveBeenCalledOnce();
  });

  it('ignores an older site-state response after a newer start selects another hostname', async () => {
    const firstState = deferred<unknown>();
    const secondState = deferred<unknown>();
    let firstRequested!: () => void;
    let secondRequested!: () => void;
    const firstRequest = new Promise<void>((resolve) => { firstRequested = resolve; });
    const secondRequest = new Promise<void>((resolve) => { secondRequested = resolve; });
    const tabsQuery = vi.fn().mockResolvedValueOnce([{ url: 'https://first.example.test/' }]).mockResolvedValueOnce([{ url: 'https://second.example.test/' }]);
    const sendMessage = vi.fn()
      .mockImplementationOnce(() => { firstRequested(); return firstState.promise; })
      .mockImplementationOnce(() => { secondRequested(); return secondState.promise; });
    const render = vi.fn();
    const controller = createPopupController({ tabs: { query: tabsQuery }, runtime: { sendMessage } }, { render });

    const first = controller.start();
    await firstRequest;
    const second = controller.start();
    await secondRequest;
    secondState.resolve({ enabled: false });
    await second;
    firstState.resolve({ enabled: true });
    await first;

    expect(render).toHaveBeenLastCalledWith(expect.objectContaining({ hostname: 'second.example.test', checked: false, disabled: false }));
  });

  it('ignores an older mutation response after a newer toggle completes', async () => {
    const firstMutation = deferred<unknown>();
    const secondMutation = deferred<unknown>();
    let firstRequested!: () => void;
    let secondRequested!: () => void;
    const firstRequest = new Promise<void>((resolve) => { firstRequested = resolve; });
    const secondRequest = new Promise<void>((resolve) => { secondRequested = resolve; });
    const app = harness({ state: { enabled: true } });
    app.sendMessage.mockImplementationOnce(async () => ({ enabled: true }))
      .mockImplementationOnce(() => { firstRequested(); return firstMutation.promise; })
      .mockImplementationOnce(() => { secondRequested(); return secondMutation.promise; });
    await app.controller.start();

    const first = app.controller.setEnabled(true);
    await firstRequest;
    const second = app.controller.setEnabled(false);
    await secondRequest;
    secondMutation.resolve({ disabled: true, permissionRemoved: true });
    await second;
    firstMutation.resolve({ enabled: true });
    await first;

    expect(app.render).toHaveBeenLastCalledWith(expect.objectContaining({ checked: false, disabled: false, status: 'Automatic recognition is off.' }));
  });
});
