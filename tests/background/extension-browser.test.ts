import { describe, expect, it, vi } from 'vitest';

import { createExtensionBrowserAdapter } from '../../src/background/extension-browser';

describe('extension browser adapter', () => {
  it('adapts storage.local and optional-origin permissions without exposing browser globals', async () => {
    const get = vi.fn(async () => ({ setting: { value: 1 } })); const set = vi.fn(async () => undefined);
    const request = vi.fn(async () => true); const remove = vi.fn(async () => false);
    const adapter = createExtensionBrowserAdapter({ storage: { local: { get, set } }, permissions: { request, remove } });
    await expect(adapter.getLocal('setting')).resolves.toEqual({ value: 1 });
    await adapter.setLocal('setting', { value: 2 });
    await expect(adapter.requestOrigins(['https://portal.example.test/*'])).resolves.toBe(true);
    await expect(adapter.removeOrigins(['https://portal.example.test/*'])).resolves.toBe(false);
    expect(set).toHaveBeenCalledWith({ setting: { value: 2 } });
    expect(request).toHaveBeenCalledWith({ origins: ['https://portal.example.test/*'] });
  });
});
