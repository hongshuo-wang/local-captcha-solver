import { describe, expect, it, vi } from 'vitest';

import { createBackgroundRuntime } from '../../src/background/background-runtime';

describe('background runtime composition', () => {
  it('retains one inference host and registers startup, install, runtime, and menu listeners once', async () => {
    const runtimeListener = vi.fn(); const startupListener = vi.fn(); const installedListener = vi.fn(); const menuListener = vi.fn(); const storageListener = vi.fn();
    const reconcile = vi.fn(async () => undefined); const install = vi.fn(async () => undefined); const recognize = vi.fn(async () => [{ mode: 'digits' as const, text: '7', confidence: .9 }]);
    const app = createBackgroundRuntime({
      permissions: { contains: vi.fn(async () => true) }, imageFetcher: { fetch: vi.fn() }, inferenceHost: { recognize },
      siteState: { isEnabled: vi.fn(async () => false), enablePage: vi.fn(), disablePage: vi.fn() }, activeTab: vi.fn(async () => undefined),
      registration: { reconcile, enablePage: vi.fn(), disablePage: vi.fn() }, contextMenu: { install, handleClick: vi.fn() },
      runtime: { onMessage: { addListener: runtimeListener }, onStartup: { addListener: startupListener }, onInstalled: { addListener: installedListener } },
      storage: { onChanged: { addListener: storageListener } },
      contextMenus: { onClicked: { addListener: menuListener } },
    });
    await app.start(); await app.start();
    expect(reconcile).toHaveBeenCalledOnce(); expect(install).toHaveBeenCalledOnce();
    expect(runtimeListener).toHaveBeenCalledOnce(); expect(startupListener).toHaveBeenCalledOnce(); expect(installedListener).toHaveBeenCalledOnce(); expect(menuListener).toHaveBeenCalledOnce(); expect(storageListener).toHaveBeenCalledOnce();
    const handle = runtimeListener.mock.calls[0]?.[0] as (message: unknown, sender: unknown) => Promise<unknown>;
    await expect(handle({ type: 'captcha:recognize', imageDataUrl: 'data:image/png;base64,AQ==', revision: 'r', modes: ['digits'] }, { tab: { id: 2, url: 'https://portal.example.test/' }, url: 'https://portal.example.test/' })).resolves.toEqual([{ mode: 'digits', text: '7', confidence: .9 }]);
    expect(recognize).toHaveBeenCalledOnce();
    (storageListener.mock.calls[0]?.[0] as (changes: Record<string, unknown>, area: string) => void)({ 'captcha-settings': {} }, 'local');
    await Promise.resolve();
    expect(reconcile).toHaveBeenCalledTimes(2);
  });

  it('logs a failed initialization and retries without duplicating listeners', async () => {
    const runtimeListener = vi.fn(); const startupListener = vi.fn(); const installedListener = vi.fn(); const menuListener = vi.fn(); const reportError = vi.fn();
    const reconcile = vi.fn<() => Promise<void>>().mockRejectedValueOnce(new Error('temporary failure')).mockResolvedValueOnce(undefined);
    const install = vi.fn(async () => undefined);
    const app = createBackgroundRuntime({
      permissions: { contains: vi.fn(async () => true) }, imageFetcher: { fetch: vi.fn() }, inferenceHost: { recognize: vi.fn() },
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
