import { describe, expect, it, vi } from 'vitest';

import { createModelStatusController, createPopupController, type ModelStatusView, type PopupView } from '../../src/popup/controller';
import type { ModelStatusSnapshot } from '../../src/background/model-status';

function harness(options: { url?: string; state?: unknown; change?: unknown; permissionsGranted?: boolean; permissionRequest?: boolean } = {}) {
  const sendMessage = vi.fn(async (message: { type: string }) => {
    if (message.type === 'captcha:get-site-state') return Object.hasOwn(options, 'state') ? options.state : { enabled: false };
    return Object.hasOwn(options, 'change') ? options.change : { enabled: true };
  });
  const render = vi.fn();
  const view: PopupView = { render };
  const tabsQuery = vi.fn(async () => [{ url: Object.hasOwn(options, 'url') ? options.url : 'https://Portal.Example.test/login' }]);
  const permissionsContains = vi.fn(async () => options.permissionsGranted ?? false);
  const permissionsRequest = vi.fn(async () => options.permissionRequest ?? true);
  const controller = createPopupController({
    tabs: { query: tabsQuery },
    runtime: { sendMessage },
    permissions: { contains: permissionsContains, request: permissionsRequest },
  }, view);
  return { controller, render, sendMessage, tabsQuery, permissionsContains, permissionsRequest };
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

    expect(app.permissionsContains).toHaveBeenCalledWith({ origins: ['http://portal.example.test/*', 'https://portal.example.test/*'] });
    expect(app.permissionsRequest).toHaveBeenCalledWith({ origins: ['http://portal.example.test/*', 'https://portal.example.test/*'] });
    expect(app.sendMessage).toHaveBeenLastCalledWith({ type: 'captcha:set-site-enabled', enabled: true, hostname: 'portal.example.test', permissionAlreadyGranted: false });
  });

  it('does not request an already granted origin from the popup gesture', async () => {
    const app = harness({ state: { enabled: false }, permissionsGranted: true, change: { enabled: true } });

    await app.controller.start();
    await app.controller.setEnabled(true);

    expect(app.permissionsContains).toHaveBeenCalledOnce();
    expect(app.permissionsRequest).not.toHaveBeenCalled();
    expect(app.sendMessage).toHaveBeenLastCalledWith({ type: 'captcha:set-site-enabled', enabled: true, hostname: 'portal.example.test', permissionAlreadyGranted: true });
  });

  it('does not update background state when popup permission is denied', async () => {
    const app = harness({ state: { enabled: false }, permissionRequest: false });

    await app.controller.start();
    await app.controller.setEnabled(true);

    expect(app.sendMessage).toHaveBeenCalledOnce();
    expect(app.render).toHaveBeenLastCalledWith(expect.objectContaining({ checked: false, disabled: false, error: 'Permission was not granted for this site.' }));
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
    const controller = createPopupController({ tabs: { query: tabsQuery }, runtime: { sendMessage }, permissions: { contains: vi.fn(async () => true), request: vi.fn(async () => true) } }, { render });

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

function modelSnapshot(overrides: Partial<ModelStatusSnapshot> = {}): ModelStatusSnapshot {
  return {
    status: 'ready',
    progress: 100,
    message: '本地识别模型已就绪',
    logs: [],
    ...overrides,
  };
}

describe('popup model status controller', () => {
  it('polls a loading startup snapshot until the model is ready', async () => {
    const render = vi.fn();
    const delay = vi.fn(async () => undefined);
    const sendMessage = vi.fn()
      .mockResolvedValueOnce(modelSnapshot({ status: 'loading', progress: 50, message: '正在加载本地识别模型' }))
      .mockResolvedValueOnce(modelSnapshot({ status: 'ready', progress: 100 }));
    const controller = createModelStatusController({ runtime: { sendMessage } }, { render }, { delay, pollIntervalMs: 1 });

    await controller.start();

    expect(delay).toHaveBeenCalledOnce();
    expect(sendMessage).toHaveBeenCalledTimes(2);
    expect(sendMessage).toHaveBeenNthCalledWith(1, { type: 'captcha:get-model-status' });
    expect(sendMessage).toHaveBeenNthCalledWith(2, { type: 'captcha:get-model-status' });
    expect(render).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'ready', progress: 100 }));
  });

  it.each([
    ['ready', modelSnapshot({ status: 'ready', progress: 100 })],
    ['error', modelSnapshot({ status: 'error', progress: 0, message: '本地识别模型不可用' })],
  ] as const)('polls a loading retry until the model reaches %s', async (_name, terminalSnapshot) => {
    const render = vi.fn();
    const delay = vi.fn(async () => undefined);
    const sendMessage = vi.fn()
      .mockResolvedValueOnce(modelSnapshot({ status: 'error', progress: 0, message: '本地识别模型不可用' }))
      .mockResolvedValueOnce(modelSnapshot({ status: 'loading', progress: 50, message: '正在加载本地识别模型' }))
      .mockResolvedValueOnce(terminalSnapshot);
    const controller = createModelStatusController({ runtime: { sendMessage } }, { render }, { delay, pollIntervalMs: 1 });

    await controller.start();
    await controller.retry();

    expect(sendMessage).toHaveBeenNthCalledWith(2, { type: 'captcha:retry-model-warmup' });
    expect(sendMessage).toHaveBeenNthCalledWith(3, { type: 'captcha:get-model-status' });
    expect(delay).toHaveBeenCalledOnce();
    expect(render).toHaveBeenLastCalledWith(terminalSnapshot);
  });

  it('does not spend the status-request budget on the retry acknowledgement snapshot', async () => {
    const render = vi.fn();
    const delay = vi.fn(async () => undefined);
    const sendMessage = vi.fn()
      .mockResolvedValueOnce(modelSnapshot({ status: 'error', progress: 0, message: '本地识别模型不可用' }))
      .mockResolvedValueOnce(modelSnapshot({ status: 'loading', progress: 50 }))
      .mockResolvedValueOnce(modelSnapshot({ status: 'ready', progress: 100 }));
    const controller = createModelStatusController(
      { runtime: { sendMessage } },
      { render },
      { delay, pollIntervalMs: 1, maxPollAttempts: 1 },
    );

    await controller.start();
    await controller.retry();

    expect(sendMessage).toHaveBeenNthCalledWith(3, { type: 'captcha:get-model-status' });
    expect(delay).toHaveBeenCalledOnce();
    expect(render).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'ready' }));
  });

  it('cancels a stale loading poll when a newer startup refresh begins', async () => {
    const waiting = deferred<void>();
    const render = vi.fn();
    let firstSignal: AbortSignal | undefined;
    const sendMessage = vi.fn()
      .mockResolvedValueOnce(modelSnapshot({ status: 'loading', progress: 50 }))
      .mockResolvedValueOnce(modelSnapshot({ status: 'ready', progress: 100 }));
    const controller = createModelStatusController({ runtime: { sendMessage } }, { render }, {
      delay: (_durationMs, signal) => {
        firstSignal = signal;
        return waiting.promise;
      },
      pollIntervalMs: 1,
    });

    const first = controller.start();
    await vi.waitFor(() => expect(sendMessage).toHaveBeenCalledOnce());
    const second = controller.start();
    await second;
    expect(firstSignal?.aborted).toBe(true);
    waiting.resolve();
    await first;

    expect(sendMessage).toHaveBeenCalledTimes(2);
    expect(render).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'ready' }));
  });

  it('stops polling after the configured loading attempt limit', async () => {
    const render = vi.fn();
    const delay = vi.fn(async () => undefined);
    const sendMessage = vi.fn(async () => modelSnapshot({ status: 'loading', progress: 50 }));
    const controller = createModelStatusController(
      { runtime: { sendMessage } },
      { render },
      { delay, pollIntervalMs: 1, maxPollAttempts: 2 },
    );

    await controller.start();

    expect(sendMessage).toHaveBeenCalledTimes(2);
    expect(delay).toHaveBeenCalledOnce();
    expect(render).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'loading' }));
  });

  it.each([
    ['ready', 0],
    ['error', 50],
  ] as const)('rejects a contradictory %s progress snapshot', async (status, progress) => {
    const render = vi.fn();
    const sendMessage = vi.fn(async () => modelSnapshot({ status, progress }));
    const controller = createModelStatusController({ runtime: { sendMessage } }, { render });

    await controller.start();

    expect(render).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'error', message: '模型状态暂时不可用' }));
  });

  it('renders a typed unavailable state without exposing runtime errors', async () => {
    const render = vi.fn();
    const controller = createModelStatusController({ runtime: { sendMessage: vi.fn(async () => { throw new Error('secret stack trace'); }) } }, { render });

    await controller.start();

    expect(render).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'error', message: '模型状态暂时不可用' }));
    expect(render.mock.lastCall?.[0]).not.toEqual(expect.objectContaining({ message: expect.stringContaining('secret') }));
  });
});
