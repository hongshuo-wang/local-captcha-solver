import { describe, expect, it, vi } from 'vitest';

import { contentScriptRegistrationId, createContentRegistration } from '../../src/background/content-registration';
import { createSettingsStore, SETTINGS_STORAGE_KEY } from '../../src/platform/settings-store';

function harness(options: { permitted?: boolean; registrations?: readonly { id: string; matches: readonly string[]; js: readonly string[]; persistAcrossSessions?: boolean }[]; setFails?: boolean } = {}) {
  const values = new Map<string, unknown>([[SETTINGS_STORAGE_KEY, { version: 1, allowlistedHosts: ['portal.example.test'] }]]);
  const registrations = [...(options.registrations ?? [])];
  const registerContentScripts = vi.fn(async (scripts: readonly { id: string; matches: readonly string[]; js: readonly string[]; persistAcrossSessions: boolean }[]) => { registrations.push(...scripts); });
  const unregisterContentScripts = vi.fn(async ({ ids }: { ids?: readonly string[] }) => { for (const id of ids ?? []) { const index = registrations.findIndex((script) => script.id === id); if (index >= 0) registrations.splice(index, 1); } });
  const executeScript = vi.fn(async () => undefined);
  const sendMessage = vi.fn(async () => undefined);
  const request = vi.fn(async () => true); const remove = vi.fn(async () => true); const contains = vi.fn(async () => options.permitted ?? true); const query = vi.fn(async () => [{ id: 7, url: 'https://portal.example.test/login' }]);
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
  it('derives a deterministic hostname ID and exact host matches', async () => {
    await expect(contentScriptRegistrationId('portal.example.test')).resolves.toBe('captcha-auto-aad516fbeda76e37');
    const app = harness();
    await app.registration.reconcile();
    expect(app.registerContentScripts).toHaveBeenCalledWith([{ id: 'captcha-auto-aad516fbeda76e37', matches: ['http://portal.example.test/*', 'https://portal.example.test/*'], js: ['content-scripts/content.js'], persistAcrossSessions: true }]);
  });

  it('removes stale or invalid registrations and skips allowlisted hosts lacking both permissions', async () => {
    const app = harness({ permitted: false, registrations: [
      { id: 'captcha-auto-old', matches: ['https://old.example.test/*'], js: ['content-scripts/content.js'], persistAcrossSessions: true },
      { id: 'captcha-auto-aad516fbeda76e37', matches: ['http://portal.example.test/*'], js: ['content-scripts/content.js'], persistAcrossSessions: true },
    ] });
    await app.registration.reconcile();
    expect(app.unregisterContentScripts).toHaveBeenCalledWith({ ids: ['captcha-auto-old', 'captcha-auto-aad516fbeda76e37'] });
    expect(app.registerContentScripts).not.toHaveBeenCalled();
  });

  it('enables permission-first, notifies matching tabs, and disables without depending on permission removal', async () => {
    const app = harness();
    app.values.set(SETTINGS_STORAGE_KEY, { version: 1, allowlistedHosts: [] });
    await expect(app.registration.enablePage('https://portal.example.test/login')).resolves.toEqual({ enabled: true });
    expect(app.sendMessage).toHaveBeenCalledWith(7, { type: 'captcha:auto-enable' });
    await expect(app.registration.disablePage('https://portal.example.test/login')).resolves.toMatchObject({ disabled: true });
    expect(app.sendMessage).toHaveBeenLastCalledWith(7, { type: 'captcha:auto-disable' });
    expect(app.values.get(SETTINGS_STORAGE_KEY)).toEqual({ version: 1, allowlistedHosts: [] });
  });

  it('does not reinject an already-loaded tab before enabling automatic observation', async () => {
    const app = harness();
    app.values.set(SETTINGS_STORAGE_KEY, { version: 1, allowlistedHosts: [] });
    await expect(app.registration.enablePage('https://portal.example.test/login')).resolves.toEqual({ enabled: true });
    expect(app.executeScript).not.toHaveBeenCalled();
    expect(app.sendMessage).toHaveBeenCalledOnce();
  });

  it('injects an unloaded tab after send failure and retries auto-enable once', async () => {
    const app = harness();
    app.values.set(SETTINGS_STORAGE_KEY, { version: 1, allowlistedHosts: [] });
    app.sendMessage.mockRejectedValueOnce(new Error('content client unavailable'));
    await expect(app.registration.enablePage('https://portal.example.test/login')).resolves.toEqual({ enabled: true });
    expect(app.executeScript).toHaveBeenCalledWith({ target: { tabId: 7 }, files: ['content-scripts/content.js'] });
    expect(app.sendMessage).toHaveBeenCalledTimes(2);
    const injectionCall = app.executeScript.mock.invocationCallOrder[0]!;
    const retryCall = app.sendMessage.mock.invocationCallOrder[1]!;
    expect(injectionCall).toBeLessThan(retryCall);
  });

  it('skips a second permission request for a popup-granted origin and rolls back that grant on failure', async () => {
    const app = harness({ permitted: true });
    app.values.set(SETTINGS_STORAGE_KEY, { version: 1, allowlistedHosts: [] });
    app.registerContentScripts.mockRejectedValueOnce(new Error('registration failed'));

    await expect(app.registration.enablePage('https://portal.example.test/login', { permissionAlreadyGranted: false })).resolves.toEqual({ enabled: false, reason: 'registration-failed' });
    expect(app.request).not.toHaveBeenCalled();
    expect(app.remove).toHaveBeenCalledWith({ origins: ['http://portal.example.test/*', 'https://portal.example.test/*'] });
  });

  it('continues disable cleanup when unregistering a runtime script fails', async () => {
    const app = harness();
    app.unregisterContentScripts.mockRejectedValueOnce(new Error('registration already gone'));
    await expect(app.registration.disablePage('https://portal.example.test/login')).resolves.toEqual({ disabled: true, permissionRemoved: true });
    expect(app.values.get(SETTINGS_STORAGE_KEY)).toEqual({ version: 1, allowlistedHosts: [] });
    expect(app.sendMessage).toHaveBeenCalledWith(7, { type: 'captcha:auto-disable' });
  });

  it('removes duplicate registrations and restores one canonical script', async () => {
    const id = await contentScriptRegistrationId('portal.example.test');
    const script = { id, matches: ['http://portal.example.test/*', 'https://portal.example.test/*'], js: ['content-scripts/content.js'], persistAcrossSessions: true };
    const app = harness({ registrations: [script, { ...script }] });
    await app.registration.reconcile();
    expect(app.unregisterContentScripts).toHaveBeenCalledWith({ ids: [id] });
    expect(app.registerContentScripts).toHaveBeenCalledWith([script]);
  });

  it('cleans up all potentially created IDs when a registration batch partially fails', async () => {
    const app = harness({ permitted: false });
    app.values.set(SETTINGS_STORAGE_KEY, { version: 1, allowlistedHosts: ['legacy.example.test'] });
    app.contains.mockResolvedValueOnce(false).mockResolvedValue(true);
    app.registerContentScripts.mockImplementationOnce(async (scripts) => { app.registrations.push(scripts[0]!); throw new Error('partial failure'); });
    await expect(app.registration.enablePage('https://portal.example.test/login')).resolves.toEqual({ enabled: false, reason: 'registration-failed' });
    expect(app.unregisterContentScripts).toHaveBeenCalledWith({ ids: expect.arrayContaining([
      await contentScriptRegistrationId('legacy.example.test'), await contentScriptRegistrationId('portal.example.test'),
    ]) });
    expect(app.remove).toHaveBeenCalledWith({ origins: ['http://portal.example.test/*', 'https://portal.example.test/*'] });
    expect(app.values.get(SETTINGS_STORAGE_KEY)).toEqual({ version: 1, allowlistedHosts: ['legacy.example.test'] });
  });

  it('removes optional permissions even when tab notification lookup fails', async () => {
    const app = harness();
    app.query.mockRejectedValueOnce(new Error('tabs unavailable'));
    await expect(app.registration.disablePage('https://portal.example.test/login')).resolves.toEqual({ disabled: true, permissionRemoved: true });
    expect(app.remove).toHaveBeenCalledWith({ origins: ['http://portal.example.test/*', 'https://portal.example.test/*'] });
  });

  it('keeps a successful enable when matching-tab notification lookup fails', async () => {
    const app = harness();
    app.values.set(SETTINGS_STORAGE_KEY, { version: 1, allowlistedHosts: [] });
    app.query.mockRejectedValueOnce(new Error('tabs unavailable'));
    await expect(app.registration.enablePage('https://portal.example.test/login')).resolves.toEqual({ enabled: true });
    expect(app.values.get(SETTINGS_STORAGE_KEY)).toEqual({ version: 1, allowlistedHosts: ['portal.example.test'] });
    expect(app.registerContentScripts).toHaveBeenCalledOnce();
  });

  it('does not revoke an origin that was granted before a registration rollback', async () => {
    const app = harness();
    app.values.set(SETTINGS_STORAGE_KEY, { version: 1, allowlistedHosts: [] });
    app.registerContentScripts.mockRejectedValueOnce(new Error('registration failed'));
    await expect(app.registration.enablePage('https://portal.example.test/login')).resolves.toEqual({ enabled: false, reason: 'registration-failed' });
    expect(app.request).not.toHaveBeenCalled();
    expect(app.remove).not.toHaveBeenCalled();
  });

  it('rolls back only a newly granted origin when settings persistence fails', async () => {
    const app = harness({ permitted: false, setFails: true });
    app.values.set(SETTINGS_STORAGE_KEY, { version: 1, allowlistedHosts: [] });
    await expect(app.registration.enablePage('https://portal.example.test/login')).resolves.toEqual({ enabled: false, reason: 'settings-failed' });
    expect(app.request).toHaveBeenCalledOnce();
    expect(app.remove).toHaveBeenCalledWith({ origins: ['http://portal.example.test/*', 'https://portal.example.test/*'] });
  });

  it('fails closed when existing permission state cannot be read', async () => {
    const app = harness();
    app.values.set(SETTINGS_STORAGE_KEY, { version: 1, allowlistedHosts: [] });
    app.contains.mockRejectedValueOnce(new Error('permission API unavailable'));
    await expect(app.registration.enablePage('https://portal.example.test/login')).resolves.toEqual({ enabled: false, reason: 'permission-unavailable' });
    expect(app.request).not.toHaveBeenCalled();
    expect(app.remove).not.toHaveBeenCalled();
    expect(app.values.get(SETTINGS_STORAGE_KEY)).toEqual({ version: 1, allowlistedHosts: [] });
  });

  it('serializes enable then disable so a delayed registration cannot survive disable', async () => {
    const app = harness();
    app.values.set(SETTINGS_STORAGE_KEY, { version: 1, allowlistedHosts: [] });
    let release!: () => void; const registered = new Promise<void>((resolve) => { release = resolve; });
    app.registerContentScripts.mockImplementationOnce(async (scripts) => { await registered; app.registrations.push(...scripts); });
    const enabling = app.registration.enablePage('https://portal.example.test/login');
    await Promise.resolve();
    const disabling = app.registration.disablePage('https://portal.example.test/login');
    expect(app.unregisterContentScripts).not.toHaveBeenCalled();
    release();
    await expect(enabling).resolves.toEqual({ enabled: true });
    await expect(disabling).resolves.toMatchObject({ disabled: true });
    expect(app.registrations).toEqual([]);
    expect(app.values.get(SETTINGS_STORAGE_KEY)).toEqual({ version: 1, allowlistedHosts: [] });
  });
});
