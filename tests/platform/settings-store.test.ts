import { describe, expect, it } from 'vitest';

import type { BrowserAdapter } from '../../src/platform/browser-adapter';
import { DEFAULT_SETTINGS, SETTINGS_STORAGE_KEY, createSettingsStore } from '../../src/platform/settings-store';

function adapterWith(initialValue?: unknown): BrowserAdapter & { values: Map<string, unknown> } {
  const values = new Map<string, unknown>();
  if (initialValue !== undefined) values.set(SETTINGS_STORAGE_KEY, initialValue);
  return {
    values,
    async getLocal<T>(key: string): Promise<T | undefined> { return values.get(key) as T | undefined; },
    async setLocal<T>(key: string, value: T): Promise<void> { values.set(key, value); },
    async requestOrigins(): Promise<boolean> { return true; },
    async removeOrigins(): Promise<boolean> { return true; },
  };
}

function adapterWithGatedReads(): BrowserAdapter & { releaseReads(): void; values: Map<string, unknown> } {
  const values = new Map<string, unknown>();
  let getCalls = 0;
  let release!: () => void;
  const readsReady = new Promise<void>((resolve) => { release = resolve; });
  return {
    values,
    releaseReads: release,
    async getLocal<T>(key: string): Promise<T | undefined> { if (++getCalls <= 2) await readsReady; return values.get(key) as T | undefined; },
    async setLocal<T>(key: string, value: T): Promise<void> { values.set(key, value); },
    async requestOrigins(): Promise<boolean> { return true; },
    async removeOrigins(): Promise<boolean> { return true; },
  };
}

const defaults = DEFAULT_SETTINGS;

describe('createSettingsStore', () => {
  it('migrates, normalizes, sorts, and deduplicates the version 2 schema', async () => {
    const store = createSettingsStore(adapterWith({ version: 2, disabledHosts: ['z.example.test', 'A.example.test', 'a.example.test'], copyOnNoField: true, autoFill: false, recognitionShortcut: 'alt-click' }));
    await expect(store.read()).resolves.toEqual({ ...defaults, accessMode: 'all', onboardingComplete: true, disabledHosts: ['a.example.test', 'z.example.test'], copyOnNoField: true, autoFill: false, recognitionShortcut: 'alt-click' });
  });

  it('migrates version 1 allowlist settings without treating other sites as disabled', async () => {
    const store = createSettingsStore(adapterWith({ version: 1, allowlistedHosts: ['portal.example.test'], copyOnNoField: true, recognitionShortcut: 'shift-click' }));
    await expect(store.read()).resolves.toEqual({ ...defaults, accessMode: 'all', onboardingComplete: true, copyOnNoField: true, recognitionShortcut: 'shift-click' });
  });

  it('migrates version 3 settings with automatic recognition modes', async () => {
    const { version: _version, siteRecognitionModes: _modes, ...versionThree } = defaults;
    const store = createSettingsStore(adapterWith({ ...versionThree, version: 3, autoFill: false }));
    await expect(store.read()).resolves.toEqual({ ...defaults, autoFill: false });
  });

  it('recovers corrupt or absent storage with privacy-conscious defaults', async () => {
    await expect(createSettingsStore(adapterWith({ version: 2, disabledHosts: 'nope' })).read()).resolves.toEqual(defaults);
    await expect(createSettingsStore(adapterWith()).read()).resolves.toEqual(defaults);
  });

  it('keeps disabled hosts separate from subdomains in all-sites mode', async () => {
    const store = createSettingsStore(adapterWith({ ...defaults, accessMode: 'all' }));
    await store.disable('example.test');
    await expect(store.isEnabled('https://example.test/any/path')).resolves.toBe(false);
    await expect(store.isEnabled('https://sub.example.test/any/path')).resolves.toBe(true);
  });

  it('makes disabling and enabling a hostname idempotent', async () => {
    const adapter = adapterWith({ ...defaults, accessMode: 'all' });
    const store = createSettingsStore(adapter);
    await store.disable('example.test');
    await store.disable('example.test');
    await store.enable('example.test');
    await store.enable('example.test');
    await expect(store.read()).resolves.toEqual({ ...defaults, accessMode: 'all' });
  });

  it('serializes concurrent disables so neither hostname is lost', async () => {
    const adapter = adapterWithGatedReads();
    const store = createSettingsStore(adapter);
    const first = store.disable('a.example.test');
    const second = store.disable('b.example.test');
    adapter.releaseReads();
    await Promise.all([first, second]);
    await expect(store.read()).resolves.toEqual({ ...defaults, disabledHosts: ['a.example.test', 'b.example.test'] });
  });

  it('serializes disable then enable so the final site state wins', async () => {
    const adapter = adapterWithGatedReads();
    adapter.values.set(SETTINGS_STORAGE_KEY, { ...defaults, accessMode: 'all' });
    const store = createSettingsStore(adapter);
    const disable = store.disable('a.example.test');
    const enable = store.enable('a.example.test');
    adapter.releaseReads();
    await Promise.all([disable, enable]);
    await expect(store.read()).resolves.toEqual({ ...defaults, accessMode: 'all' });
  });

  it.each(['https://example.test', 'example.test/path', 'example.test:8443', '*.example.test', 'example test', 'example.test\n', '127.1', '127.0.0', '2130706433', ''])('rejects unsupported hostname input %j', async (host) => {
    await expect(createSettingsStore(adapterWith()).disable(host)).rejects.toThrow();
  });

  it('persists copy and auto-fill preferences independently', async () => {
    const store = createSettingsStore(adapterWith());
    await store.setCopyOnNoField(true);
    await store.setAutoFill(false);
    await expect(store.read()).resolves.toEqual({ ...defaults, copyOnNoField: true, autoFill: false });
  });

  it.each(['127.0.0.1', '[::1]', 'localhost'])('supports local and IP hosts: %s', async (host) => {
    const store = createSettingsStore(adapterWith());
    await store.disable(host);
    await expect(store.read()).resolves.toMatchObject({ disabledHosts: [host] });
  });

  it('keeps a DNS hostname beginning with a digit valid', async () => {
    const store = createSettingsStore(adapterWith());
    await store.disable('3captcha.example');
    await expect(store.read()).resolves.toMatchObject({ disabledHosts: ['3captcha.example'] });
  });

  it('persists a custom recognition shortcut without changing other settings', async () => {
    const store = createSettingsStore(adapterWith());
    await store.setRecognitionShortcut('shift-click');
    await expect(store.read()).resolves.toEqual({ ...defaults, recognitionShortcut: 'shift-click' });
  });

  it('stores exact-host recognition modes and removes an override when automatic is restored', async () => {
    const store = createSettingsStore(adapterWith());
    await store.setSiteRecognitionMode('Login.Example.test', 'letters');
    await expect(store.recognitionModeForPage('https://login.example.test/captcha')).resolves.toBe('letters');
    await expect(store.recognitionModeForPage('https://other.login.example.test/captcha')).resolves.toBe('auto');
    await store.setSiteRecognitionMode('login.example.test', 'auto');
    await expect(store.read()).resolves.toEqual(defaults);
  });

  it('normalizes and sorts persisted recognition mode overrides', async () => {
    const store = createSettingsStore(adapterWith({
      ...defaults,
      siteRecognitionModes: [
        { hostname: 'z.example.test', mode: 'digits' },
        { hostname: 'A.example.test', mode: 'letters' },
        { hostname: 'a.example.test', mode: 'alphanumeric' },
      ],
    }));
    await expect(store.read()).resolves.toMatchObject({
      siteRecognitionModes: [
        { hostname: 'a.example.test', mode: 'alphanumeric' },
        { hostname: 'z.example.test', mode: 'digits' },
      ],
    });
  });

  it('recovers malformed optional preferences with new-install defaults', async () => {
    const store = createSettingsStore(adapterWith({ version: 2, disabledHosts: [], copyOnNoField: 'yes', autoFill: 'no', recognitionShortcut: 'double-click' }));
    await expect(store.read()).resolves.toEqual({ ...defaults, accessMode: 'all', onboardingComplete: true });
  });

  it('supports selected-site access with explicit subdomain coverage', async () => {
    const store = createSettingsStore(adapterWith());
    await store.setAccessMode('selected');
    await store.addSelectedSite({ hostname: 'example.test', includeSubdomains: true });
    await expect(store.isEnabled('https://example.test/login')).resolves.toBe(true);
    await expect(store.isEnabled('https://account.example.test/login')).resolves.toBe(true);
    await expect(store.isEnabled('https://other.test/login')).resolves.toBe(false);
    await store.disable('account.example.test');
    await expect(store.isEnabled('https://account.example.test/login')).resolves.toBe(false);
    await expect(store.isEnabled('https://example.test/login')).resolves.toBe(true);
  });

  it('persists interface locale and onboarding completion independently', async () => {
    const store = createSettingsStore(adapterWith());
    await store.setInterfaceLocale('en');
    await store.setOnboardingComplete(true);
    await expect(store.read()).resolves.toMatchObject({ interfaceLocale: 'en', onboardingComplete: true });
  });

  it('migrates existing settings without enabling slider automation on any site', async () => {
    const store = createSettingsStore(adapterWith({ ...defaults, version: 4, sliderEnabledHosts: undefined }));
    await expect(store.read()).resolves.toMatchObject({ version: 5, sliderEnabledHosts: [] });
  });

  it('stores slider automation as an exact-host permission independent of OCR access', async () => {
    const store = createSettingsStore(adapterWith());
    await store.setSliderEnabled('Login.Example.test', true);
    await expect(store.isSliderEnabled('https://login.example.test/captcha')).resolves.toBe(true);
    await expect(store.isSliderEnabled('https://child.login.example.test/captcha')).resolves.toBe(false);
    await expect(store.read()).resolves.toMatchObject({ sliderEnabledHosts: ['login.example.test'] });
    await store.setSliderEnabled('login.example.test', false);
    await expect(store.isSliderEnabled('https://login.example.test/captcha')).resolves.toBe(false);
  });
});
