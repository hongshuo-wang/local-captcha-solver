import { describe, expect, it } from 'vitest';

import type { BrowserAdapter } from '../../src/platform/browser-adapter';
import { createPermissionManager, originsForPage } from '../../src/platform/permissions';
import { SETTINGS_STORAGE_KEY, createSettingsStore } from '../../src/platform/settings-store';

function adapterWith(requestGranted: boolean, removeGranted = true): BrowserAdapter & { calls: string[]; values: Map<string, unknown>; requested: string[][]; removed: string[][] } {
  const values = new Map<string, unknown>();
  const calls: string[] = [];
  const requested: string[][] = [];
  const removed: string[][] = [];
  return {
    calls,
    values,
    requested,
    removed,
    async getLocal<T>(key: string): Promise<T | undefined> {
      calls.push('get');
      return values.get(key) as T | undefined;
    },
    async setLocal<T>(key: string, value: T): Promise<void> {
      calls.push('set');
      values.set(key, value);
    },
    async requestOrigins(origins: readonly string[]): Promise<boolean> {
      calls.push('request');
      requested.push([...origins]);
      return requestGranted;
    },
    async removeOrigins(origins: readonly string[]): Promise<boolean> {
      calls.push('remove');
      removed.push([...origins]);
      return removeGranted;
    },
  };
}

describe('originsForPage', () => {
  it('returns both exact-host scheme origins for a normal page URL', () => {
    expect(originsForPage('https://Portal.Example.test/captcha?flow=login')).toEqual([
      'http://portal.example.test/*',
      'https://portal.example.test/*',
    ]);
  });

  it('accepts case-insensitive HTTP schemes and normalizes the hostname', () => {
    expect(originsForPage('HtTpS://Portal.Example.test/captcha')).toEqual([
      'http://portal.example.test/*',
      'https://portal.example.test/*',
    ]);
  });

  it.each([
    'ftp://example.test/file',
    'https://user:pass@example.test/',
    'https://@example.test/',
    'https://:@example.test/',
    ' https://@example.test/',
    '\nhttps://:@example.test/',
    'https:@example.test/',
    'https:example.test/',
    'https://example.test:8443/',
    'https://127.0.0.1/',
    'https://[::1]/',
    'https://localhost/',
    'not a URL',
  ])('rejects an unsupported page URL %j', (pageUrl) => {
    expect(() => originsForPage(pageUrl)).toThrow();
  });

  it('allows an at sign outside the URL authority userinfo segment', () => {
    expect(originsForPage('https://example.test/path@segment?email=a@example.test')).toEqual([
      'http://example.test/*',
      'https://example.test/*',
    ]);
  });
});

describe('createPermissionManager', () => {
  it('does not persist an allowlist entry when permission is denied', async () => {
    const adapter = adapterWith(false);
    const manager = createPermissionManager(adapter, createSettingsStore(adapter));

    await expect(manager.enablePage('https://portal.example.test/login')).resolves.toEqual({ enabled: false, reason: 'permission-denied' });
    expect(adapter.calls).toEqual(['request']);
    expect(adapter.requested).toEqual([['http://portal.example.test/*', 'https://portal.example.test/*']]);
    expect(adapter.values.get(SETTINGS_STORAGE_KEY)).toBeUndefined();
  });

  it('requests exact origins before persisting a granted hostname', async () => {
    const adapter = adapterWith(true);
    const manager = createPermissionManager(adapter, createSettingsStore(adapter));

    await expect(manager.enablePage('https://portal.example.test/login')).resolves.toEqual({ enabled: true });
    expect(adapter.calls).toEqual(['request', 'get', 'set']);
    expect(adapter.values.get(SETTINGS_STORAGE_KEY)).toEqual({ version: 1, allowlistedHosts: ['portal.example.test'] });
  });

  it('removes the local allowlist entry before attempting permission removal', async () => {
    const adapter = adapterWith(true, false);
    adapter.values.set(SETTINGS_STORAGE_KEY, { version: 1, allowlistedHosts: ['portal.example.test'] });
    const manager = createPermissionManager(adapter, createSettingsStore(adapter));

    await expect(manager.disablePage('https://portal.example.test/captcha')).resolves.toEqual({ disabled: true, permissionRemoved: false });
    expect(adapter.calls).toEqual(['get', 'set', 'remove']);
    expect(adapter.values.get(SETTINGS_STORAGE_KEY)).toEqual({ version: 1, allowlistedHosts: [] });
    expect(adapter.removed).toEqual([['http://portal.example.test/*', 'https://portal.example.test/*']]);
  });
});
