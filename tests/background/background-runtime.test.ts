import { describe, expect, it, vi } from 'vitest';

import { createBackgroundRuntime } from '../../src/background/background-runtime';
import { createModelStatusStore } from '../../src/background/model-status';

describe('background runtime composition', () => {
  it('retains one inference host and registers startup, install, runtime, and menu listeners once', async () => {
    const runtimeListener = vi.fn(); const startupListener = vi.fn(); const installedListener = vi.fn(); const menuListener = vi.fn(); const storageListener = vi.fn();
    const reconcile = vi.fn(async () => undefined); const install = vi.fn(async () => undefined); const recognize = vi.fn(async () => [{ mode: 'digits' as const, text: '7', confidence: .9 }]); const warmup = vi.fn(async () => undefined);
    const modelStatus = createModelStatusStore(() => 1000);
    const app = createBackgroundRuntime({
      permissions: { contains: vi.fn(async () => true) }, imageFetcher: { fetch: vi.fn() }, inferenceHost: { recognize, warmup }, modelStatus,
      siteState: { isEnabled: vi.fn(async () => false), enablePage: vi.fn(), disablePage: vi.fn() }, activeTab: vi.fn(async () => undefined),
      registration: { reconcile, enablePage: vi.fn(), disablePage: vi.fn() }, contextMenu: { install, handleClick: vi.fn() },
      runtime: { onMessage: { addListener: runtimeListener }, onStartup: { addListener: startupListener }, onInstalled: { addListener: installedListener } },
      storage: { onChanged: { addListener: storageListener } },
      contextMenus: { onClicked: { addListener: menuListener } },
    });
    await app.start(); await app.start();
    expect(reconcile).toHaveBeenCalledOnce(); expect(install).toHaveBeenCalledOnce(); expect(warmup).toHaveBeenCalledOnce();
    expect(runtimeListener).toHaveBeenCalledOnce(); expect(startupListener).toHaveBeenCalledOnce(); expect(installedListener).toHaveBeenCalledOnce(); expect(menuListener).toHaveBeenCalledOnce(); expect(storageListener).toHaveBeenCalledOnce();
    const handle = runtimeListener.mock.calls[0]?.[0] as (message: unknown, sender: unknown) => Promise<unknown>;
    await expect(handle({ type: 'captcha:recognize', imageDataUrl: 'data:image/png;base64,AQ==', revision: 'r', modes: ['digits'] }, { tab: { id: 2, url: 'https://portal.example.test/' }, url: 'https://portal.example.test/' })).resolves.toEqual([{ mode: 'digits', text: '7', confidence: .9 }]);
    expect(recognize).toHaveBeenCalledOnce();
    (storageListener.mock.calls[0]?.[0] as (changes: Record<string, unknown>, area: string) => void)({ 'captcha-settings': {} }, 'local');
    await Promise.resolve();
    expect(reconcile).toHaveBeenCalledTimes(2);
  });

  it('publishes warmup lifecycle and maps model status to the action badge', async () => {
    const action = { setBadgeText: vi.fn(async () => undefined), setBadgeBackgroundColor: vi.fn(async () => undefined) };
    const modelStatus = createModelStatusStore(() => 1000);
    const warmup = vi.fn(async () => undefined);
    const app = createBackgroundRuntime({
      permissions: { contains: vi.fn(async () => true) }, imageFetcher: { fetch: vi.fn() }, inferenceHost: { recognize: vi.fn(), warmup }, modelStatus, action,
      siteState: { isEnabled: vi.fn(async () => false), enablePage: vi.fn(), disablePage: vi.fn() }, activeTab: vi.fn(async () => undefined),
      registration: { reconcile: vi.fn(async () => undefined), enablePage: vi.fn(), disablePage: vi.fn() }, contextMenu: { install: vi.fn(async () => undefined), handleClick: vi.fn() },
      runtime: { onMessage: { addListener: vi.fn() }, onStartup: { addListener: vi.fn() }, onInstalled: { addListener: vi.fn() } },
      contextMenus: { onClicked: { addListener: vi.fn() } },
    });

    await app.start();
    await Promise.resolve();

    expect(modelStatus.snapshot().status).toBe('ready');
    expect(action.setBadgeText).toHaveBeenCalledWith({ text: '…' });
    expect(action.setBadgeBackgroundColor).toHaveBeenCalledWith({ color: '#f9ab00' });
    expect(action.setBadgeText).toHaveBeenCalledWith({ text: '✓' });
    expect(action.setBadgeBackgroundColor).toHaveBeenCalledWith({ color: '#188038' });
    modelStatus.warmupFailed('test failure');
    await Promise.resolve();
    expect(action.setBadgeText).toHaveBeenCalledWith({ text: '!' });
    expect(action.setBadgeBackgroundColor).toHaveBeenCalledWith({ color: '#d93025' });
  });

  it('publishes a failed warmup as an error state', async () => {
    const modelStatus = createModelStatusStore(() => 1000);
    const reportError = vi.fn();
    const app = createBackgroundRuntime({
      permissions: { contains: vi.fn(async () => true) }, imageFetcher: { fetch: vi.fn() },
      inferenceHost: { recognize: vi.fn(), warmup: vi.fn(async () => { throw new Error('offline model'); }) }, modelStatus,
      siteState: { isEnabled: vi.fn(async () => false), enablePage: vi.fn(), disablePage: vi.fn() }, activeTab: vi.fn(async () => undefined),
      registration: { reconcile: vi.fn(async () => undefined), enablePage: vi.fn(), disablePage: vi.fn() }, contextMenu: { install: vi.fn(async () => undefined), handleClick: vi.fn() },
      runtime: { onMessage: { addListener: vi.fn() }, onStartup: { addListener: vi.fn() }, onInstalled: { addListener: vi.fn() } }, reportError,
      contextMenus: { onClicked: { addListener: vi.fn() } },
    });

    await app.start();
    await Promise.resolve();
    expect(modelStatus.snapshot()).toMatchObject({ status: 'error', progress: 0, logs: [{ kind: 'warmup', outcome: 'started' }, { kind: 'warmup', outcome: 'failure' }] });
  });

  it('does not reject startup when badge updates fail', async () => {
    const reportError = vi.fn();
    const action = { setBadgeText: vi.fn(async () => { throw new Error('badge unavailable'); }), setBadgeBackgroundColor: vi.fn(async () => { throw new Error('badge unavailable'); }) };
    const modelStatus = createModelStatusStore(() => 1000);
    const app = createBackgroundRuntime({
      permissions: { contains: vi.fn(async () => true) }, imageFetcher: { fetch: vi.fn() }, inferenceHost: { recognize: vi.fn(), warmup: vi.fn(async () => undefined) }, modelStatus, action,
      siteState: { isEnabled: vi.fn(async () => false), enablePage: vi.fn(), disablePage: vi.fn() }, activeTab: vi.fn(async () => undefined),
      registration: { reconcile: vi.fn(async () => undefined), enablePage: vi.fn(), disablePage: vi.fn() }, contextMenu: { install: vi.fn(async () => undefined), handleClick: vi.fn() }, reportError,
      runtime: { onMessage: { addListener: vi.fn() }, onStartup: { addListener: vi.fn() }, onInstalled: { addListener: vi.fn() } },
      contextMenus: { onClicked: { addListener: vi.fn() } },
    });

    await expect(app.start()).resolves.toBeUndefined();
    await Promise.resolve();
    expect(reportError).toHaveBeenCalled();
  });

  it('logs a failed initialization and retries without duplicating listeners', async () => {
    const runtimeListener = vi.fn(); const startupListener = vi.fn(); const installedListener = vi.fn(); const menuListener = vi.fn(); const reportError = vi.fn();
    const reconcile = vi.fn<() => Promise<void>>().mockRejectedValueOnce(new Error('temporary failure')).mockResolvedValueOnce(undefined);
    const install = vi.fn(async () => undefined);
    const app = createBackgroundRuntime({
      permissions: { contains: vi.fn(async () => true) }, imageFetcher: { fetch: vi.fn() }, inferenceHost: { recognize: vi.fn() }, modelStatus: createModelStatusStore(),
      siteState: { isEnabled: vi.fn(async () => false), enablePage: vi.fn(), disablePage: vi.fn() }, activeTab: vi.fn(async () => undefined),
      registration: { reconcile, enablePage: vi.fn(), disablePage: vi.fn() }, contextMenu: { install, handleClick: vi.fn() }, reportError,
      runtime: { onMessage: { addListener: runtimeListener }, onStartup: { addListener: startupListener }, onInstalled: { addListener: installedListener } },
      contextMenus: { onClicked: { addListener: menuListener } },
    });
    await expect(app.start()).resolves.toBeUndefined();
    expect(reportError).toHaveBeenCalledOnce();
    await expect(app.start()).resolves.toBeUndefined();
    expect(reconcile).toHaveBeenCalledTimes(2); expect(install).toHaveBeenCalledTimes(2);
    expect(runtimeListener).toHaveBeenCalledOnce(); expect(startupListener).toHaveBeenCalledOnce(); expect(installedListener).toHaveBeenCalledOnce(); expect(menuListener).toHaveBeenCalledOnce();
  });
});
