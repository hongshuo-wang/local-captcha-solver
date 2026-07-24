import { describe, expect, it } from 'vitest';

import type { BrowserAdapter } from '../../src/platform/browser-adapter';
import {
  SETTINGS_STORAGE_KEY,
  createSettingsStore,
} from '../../src/platform/settings-store';

function adapterWith(initialValue?: unknown): BrowserAdapter & { values: Map<string, unknown> } {
  const values = new Map<string, unknown>();
  if (initialValue !== undefined) values.set(SETTINGS_STORAGE_KEY, initialValue);

  return {
    values,
    async getLocal<T>(key: string): Promise<T | undefined> {
      return values.get(key) as T | undefined;
    },
    async setLocal<T>(key: string, value: T): Promise<void> {
      values.set(key, value);
    },
    async requestOrigins(): Promise<boolean> {
      return true;
    },
    async removeOrigins(): Promise<boolean> {
      return true;
    },
  };
}

function adapterWithGatedReads(): BrowserAdapter & { releaseReads(): void; values: Map<string, unknown> } {
  const values = new Map<string, unknown>();
  let getCalls = 0;
  let release: (() => void) | undefined;
  const readsReady = new Promise<void>((resolve) => {
    release = resolve;
  });

  return {
    values,
    releaseReads(): void {
      release?.();
    },
    async getLocal<T>(key: string): Promise<T | undefined> {
      getCalls += 1;
      if (getCalls <= 2) await readsReady;
      return values.get(key) as T | undefined;
    },
    async setLocal<T>(key: string, value: T): Promise<void> {
      values.set(key, value);
    },
    async requestOrigins(): Promise<boolean> {
      return true;
    },
    async removeOrigins(): Promise<boolean> {
      return true;
    },
  };
}

describe('createSettingsStore', () => {
  it('reads the versioned captcha settings schema from the stable storage key', async () => {
    const adapter = adapterWith({ version: 1, allowlistedHosts: ['portal.example.test'] });
    const store = createSettingsStore(adapter);

    await expect(store.read()).resolves.toEqual({
      version: 1,
      allowlistedHosts: ['portal.example.test'],
    });
  });

  it('recovers from corrupt storage with empty versioned settings', async () => {
    const store = createSettingsStore(adapterWith({ version: 2, allowlistedHosts: 'nope' }));

    await expect(store.read()).resolves.toEqual({ version: 1, allowlistedHosts: [] });
  });

  it('normalizes case and keeps storage sorted and deduplicated', async () => {
    const adapter = adapterWith({ version: 1, allowlistedHosts: ['z.example.test', 'A.example.test', 'a.example.test'] });
    const store = createSettingsStore(adapter);

    await store.enable('B.example.test');

    await expect(store.read()).resolves.toEqual({
      version: 1,
      allowlistedHosts: ['a.example.test', 'b.example.test', 'z.example.test'],
    });
  });

  it('keeps exact hostnames separate from their subdomains', async () => {
    const store = createSettingsStore(adapterWith());

    await store.enable('example.test');

    await expect(store.isEnabled('https://example.test/any/path')).resolves.toBe(true);
    await expect(store.isEnabled('https://sub.example.test/any/path')).resolves.toBe(false);
  });

  it('uses URL parsing so all paths for an enabled normal page hostname match', async () => {
    const store = createSettingsStore(adapterWith());

    await store.enable('EXAMPLE.test');

    await expect(store.isEnabled('http://example.test/login/captcha?next=/')).resolves.toBe(true);
  });

  it('makes enabling and disabling a hostname idempotent', async () => {
    const adapter = adapterWith();
    const store = createSettingsStore(adapter);

    await store.enable('example.test');
    await store.enable('example.test');
    await store.disable('example.test');
    await store.disable('example.test');

    await expect(store.read()).resolves.toEqual({ version: 1, allowlistedHosts: [] });
  });

  it('serializes concurrent mutations so independent enables do not lose either hostname', async () => {
    const adapter = adapterWithGatedReads();
    const store = createSettingsStore(adapter);
    const first = store.enable('a.example.test');
    const second = store.enable('b.example.test');

    adapter.releaseReads();
    await Promise.all([first, second]);

    await expect(store.read()).resolves.toEqual({
      version: 1,
      allowlistedHosts: ['a.example.test', 'b.example.test'],
    });
  });

  it('serializes concurrent enable and disable so a removed hostname is not reintroduced', async () => {
    const adapter = adapterWithGatedReads();
    adapter.values.set(SETTINGS_STORAGE_KEY, { version: 1, allowlistedHosts: ['a.example.test'] });
    const store = createSettingsStore(adapter);
    const remove = store.disable('a.example.test');
    const add = store.enable('b.example.test');

    adapter.releaseReads();
    await Promise.all([remove, add]);

    await expect(store.read()).resolves.toEqual({
      version: 1,
      allowlistedHosts: ['b.example.test'],
    });
  });

  it.each([
    'https://example.test',
    'example.test/path',
    'example.test:8443',
    '*.example.test',
    'example test',
    'example.test\n',
    '127.0.0.1',
    '127.1',
    '127.0.0',
    '2130706433',
    '[::1]',
    'localhost',
    '',
  ])('rejects unsupported hostname input %j', async (host) => {
    const store = createSettingsStore(adapterWith());

    await expect(store.enable(host)).rejects.toThrow();
  });
});
