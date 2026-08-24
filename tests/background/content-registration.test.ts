import { describe, expect, it, vi } from 'vitest';

import { GLOBAL_REGISTRATION_ID, GLOBAL_SLIDER_REGISTRATION_ID, contentScriptRegistrationId, createContentRegistration } from '../../src/background/content-registration';
import { GLOBAL_HTTP_ORIGINS } from '../../src/platform/permissions';
import { createSettingsStore, DEFAULT_SETTINGS, SETTINGS_STORAGE_KEY } from '../../src/platform/settings-store';

const defaults = { ...DEFAULT_SETTINGS, accessMode: 'all' as const };

function harness(options: { permitted?: boolean; registrations?: readonly { id: string; matches: readonly string[]; js: readonly string[]; persistAcrossSessions?: boolean }[]; setFails?: boolean } = {}) {
  const values = new Map<string, unknown>([[SETTINGS_STORAGE_KEY, defaults]]);
  const registrations = [...(options.registrations ?? [])];
  const registerContentScripts = vi.fn(async (scripts: readonly { id: string; matches: readonly string[]; js: readonly string[]; persistAcrossSessions: boolean }[]) => { registrations.push(...scripts); });
  const unregisterContentScripts = vi.fn(async ({ ids }: { ids?: readonly string[] }) => { for (const id of ids ?? []) { let index = registrations.findIndex((script) => script.id === id); while (index >= 0) { registrations.splice(index, 1); index = registrations.findIndex((script) => script.id === id); } } });
  const executeScript = vi.fn(async () => undefined);
  const sendMessage = vi.fn(async () => undefined);
  const request = vi.fn(async () => true);
  const remove = vi.fn(async () => true);
  const contains = vi.fn(async () => options.permitted ?? true);
  const query = vi.fn(async () => [{ id: 7, url: 'https://portal.example.test/login' }]);
  return {
    values, registrations, registerContentScripts, unregisterContentScripts, executeScript, sendMessage, request, remove, contains, query,
    registration: createContentRegistration({
      settings: createSettingsStore({ getLocal: async <T>(key: string): Promise<T | undefined> => values.get(key) as T | undefined, setLocal: async <T>(key: string, value: T): Promise<void> => { if (options.setFails) throw new Error('storage failed'); values.set(key, value); }, requestOrigins: async () => true, removeOrigins: async () => true }),
      permissions: { contains, request, remove },
      scripting: { getRegisteredContentScripts: async () => registrations, registerContentScripts, unregisterContentScripts, executeScript },
      tabs: { query, sendMessage },
    }),
  };
}

describe('content registration', () => {
  it('keeps deterministic legacy hostname IDs for cleanup compatibility', async () => {
    await expect(contentScriptRegistrationId('portal.example.test')).resolves.toBe('captcha-auto-aad516fbeda76e37');
  });

  it('registers one persistent global content script after all-site access is granted', async () => {
    const app = harness();
    await app.registration.reconcile();
    expect(app.registerContentScripts).toHaveBeenCalledWith([{ id: GLOBAL_REGISTRATION_ID, matches: [...GLOBAL_HTTP_ORIGINS], js: ['content-scripts/content.js'], persistAcrossSessions: true }]);
  });

  it('does not register a second slider content script when global access already covers the host', async () => {
    const app = harness();
    app.values.set(SETTINGS_STORAGE_KEY, { ...defaults, sliderEnabledHosts: ['portal.example.test'] });
    await app.registration.reconcile();
    expect(app.registerContentScripts).toHaveBeenCalledWith([{ id: GLOBAL_REGISTRATION_ID, matches: [...GLOBAL_HTTP_ORIGINS], js: ['content-scripts/content.js'], persistAcrossSessions: true }]);
  });

  it('removes old per-site registrations and stays unregistered without global access', async () => {
    const app = harness({ permitted: false, registrations: [{ id: 'captcha-auto-old', matches: ['https://old.example.test/*'], js: ['content-scripts/content.js'], persistAcrossSessions: true }] });
    await app.registration.reconcile();
    expect(app.unregisterContentScripts).toHaveBeenCalledWith({ ids: ['captcha-auto-old'] });
    expect(app.registerContentScripts).not.toHaveBeenCalled();
  });

  it('requests global access, enables the site, registers globally, and notifies open tabs', async () => {
    const app = harness({ permitted: false });
    app.contains.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    await expect(app.registration.enablePage('https://portal.example.test/login')).resolves.toEqual({ enabled: true });
    expect(app.request).toHaveBeenCalledWith({ origins: GLOBAL_HTTP_ORIGINS });
    expect(app.registerContentScripts).toHaveBeenCalledOnce();
    expect(app.sendMessage).toHaveBeenCalledWith(7, { type: 'captcha:auto-enable' });
  });

  it('uses a popup-granted global permission and rolls it back when registration fails', async () => {
    const app = harness({ permitted: true });
    app.registerContentScripts.mockRejectedValueOnce(new Error('registration failed'));
    await expect(app.registration.enablePage('https://portal.example.test/login', { permissionAlreadyGranted: false })).resolves.toEqual({ enabled: false, reason: 'registration-failed' });
    expect(app.request).not.toHaveBeenCalled();
    expect(app.remove).toHaveBeenCalledWith({ origins: GLOBAL_HTTP_ORIGINS });
  });

  it('disables a host without removing global registration or browser permission', async () => {
    const app = harness({ registrations: [{ id: GLOBAL_REGISTRATION_ID, matches: [...GLOBAL_HTTP_ORIGINS], js: ['content-scripts/content.js'], persistAcrossSessions: true }] });
    await expect(app.registration.disablePage('https://portal.example.test/login')).resolves.toEqual({ disabled: true, permissionRemoved: false });
    expect(app.values.get(SETTINGS_STORAGE_KEY)).toEqual({ ...defaults, disabledHosts: ['portal.example.test'] });
    expect(app.unregisterContentScripts).not.toHaveBeenCalled();
    expect(app.remove).not.toHaveBeenCalled();
    expect(app.sendMessage).toHaveBeenCalledWith(7, { type: 'captcha:auto-disable' });
  });

  it('re-enables a disabled host without duplicating the global registration', async () => {
    const script = { id: GLOBAL_REGISTRATION_ID, matches: [...GLOBAL_HTTP_ORIGINS], js: ['content-scripts/content.js'], persistAcrossSessions: true };
    const app = harness({ registrations: [script] });
    app.values.set(SETTINGS_STORAGE_KEY, { ...defaults, disabledHosts: ['portal.example.test'] });
    await expect(app.registration.enablePage('https://portal.example.test/login')).resolves.toEqual({ enabled: true });
    expect(app.values.get(SETTINGS_STORAGE_KEY)).toEqual(defaults);
    expect(app.registerContentScripts).not.toHaveBeenCalled();
  });

  it('injects an unloaded tab after notification fails and retries once', async () => {
    const app = harness();
    app.sendMessage.mockRejectedValueOnce(new Error('content client unavailable'));
    await expect(app.registration.enablePage('https://portal.example.test/login')).resolves.toEqual({ enabled: true });
    expect(app.executeScript).toHaveBeenCalledWith({ target: { tabId: 7 }, files: ['content-scripts/content.js'] });
    expect(app.sendMessage).toHaveBeenCalledTimes(2);
  });

  it('removes duplicate global registrations and restores one canonical script', async () => {
    const script = { id: GLOBAL_REGISTRATION_ID, matches: [...GLOBAL_HTTP_ORIGINS], js: ['content-scripts/content.js'], persistAcrossSessions: true };
    const app = harness({ registrations: [script, { ...script }] });
    await app.registration.reconcile();
    expect(app.unregisterContentScripts).toHaveBeenCalledWith({ ids: [GLOBAL_REGISTRATION_ID] });
    expect(app.registerContentScripts).toHaveBeenCalledWith([script]);
  });

  it('rolls back only a newly granted global permission when settings persistence fails', async () => {
    const app = harness({ permitted: false, setFails: true });
    app.values.set(SETTINGS_STORAGE_KEY, { ...defaults, disabledHosts: ['portal.example.test'] });
    await expect(app.registration.enablePage('https://portal.example.test/login')).resolves.toEqual({ enabled: false, reason: 'settings-failed' });
    expect(app.remove).toHaveBeenCalledWith({ origins: GLOBAL_HTTP_ORIGINS });
  });

  it('fails closed when permission state cannot be read', async () => {
    const app = harness();
    app.contains.mockRejectedValueOnce(new Error('permission API unavailable'));
    await expect(app.registration.enablePage('https://portal.example.test/login')).resolves.toEqual({ enabled: false, reason: 'permission-unavailable' });
    expect(app.request).not.toHaveBeenCalled();
  });

  it('registers only granted selected-site match patterns', async () => {
    const app = harness();
    app.values.set(SETTINGS_STORAGE_KEY, { ...defaults, accessMode: 'selected', selectedSites: [{ hostname: 'portal.example.test', includeSubdomains: false }] });
    await app.registration.reconcile();
    expect(app.registerContentScripts).toHaveBeenCalledWith([expect.objectContaining({ matches: ['http://portal.example.test/*', 'https://portal.example.test/*'] })]);
    expect(app.registerContentScripts.mock.calls[0]?.[0]?.[0]?.id).toBe('captcha-auto-aad516fbeda76e37');
  });

  it('does not duplicate a granted selected-site content script for an enabled slider host', async () => {
    const app = harness();
    app.values.set(SETTINGS_STORAGE_KEY, {
      ...defaults,
      accessMode: 'selected',
      selectedSites: [{ hostname: 'portal.example.test', includeSubdomains: true }],
      sliderEnabledHosts: ['login.portal.example.test'],
    });
    await app.registration.reconcile();
    expect(app.registerContentScripts).toHaveBeenCalledWith([expect.objectContaining({ matches: ['http://*.portal.example.test/*', 'https://*.portal.example.test/*'] })]);
    expect(app.registerContentScripts.mock.calls[0]?.[0]).toHaveLength(1);
  });

  it('registers a separate global slider script when slider access is global but OCR access is selected', async () => {
    const app = harness();
    app.values.set(SETTINGS_STORAGE_KEY, { ...defaults, accessMode: 'selected', sliderAccessMode: 'all' });
    await app.registration.reconcile();
    expect(app.registerContentScripts).toHaveBeenCalledWith([expect.objectContaining({ id: GLOBAL_SLIDER_REGISTRATION_ID, matches: [...GLOBAL_HTTP_ORIGINS] })]);
  });
});
