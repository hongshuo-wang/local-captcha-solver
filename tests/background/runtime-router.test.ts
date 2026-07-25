import { describe, expect, it, vi } from 'vitest';

import { createRuntimeRouter } from '../../src/background/runtime-router';

function harness(options: { pagePermission?: boolean; stateEnabled?: boolean } = {}) {
  const fetch = vi.fn(async () => ({ state: 'ready' as const, bytes: new Uint8Array([1]), mimeType: 'image/png' }));
  const recognize = vi.fn(async () => [{ mode: 'digits' as const, text: '42', confidence: .9 }]);
  const contains = vi.fn(async () => options.pagePermission ?? true);
  const activeTab = vi.fn(async () => ({ id: 4, url: 'https://portal.example.test/login' }));
  const enablePage = vi.fn(async () => ({ enabled: true }));
  const disablePage = vi.fn(async () => ({ disabled: true, permissionRemoved: true }));
  return { fetch, recognize, contains, activeTab, enablePage, disablePage, router: createRuntimeRouter({
    permissions: { contains }, imageFetcher: { fetch }, inferenceHost: { recognize },
    siteState: { isEnabled: vi.fn(async () => options.stateEnabled ?? false), enablePage, disablePage },
    activeTab,
  }) };
}

const sender = { tab: { id: 4, url: 'https://portal.example.test/login' }, url: 'https://portal.example.test/login' };

describe('background runtime router', () => {
  it('rejects image acquisition from a sender page without origin permission and never requests it', async () => {
    const app = harness({ pagePermission: false });
    await expect(app.router.handle({ type: 'captcha:acquire-image', url: 'https://cdn.example.test/captcha.png' }, sender)).resolves.toEqual({ state: 'image_unavailable', reason: 'permission' });
    expect(app.fetch).not.toHaveBeenCalled();
    expect(app.contains).toHaveBeenCalledWith({ origins: ['https://portal.example.test/*'] });
  });

  it('maps a rejected page-permission check to the typed acquisition denial', async () => {
    const app = harness();
    app.contains.mockRejectedValueOnce(new Error('permission API unavailable'));
    await expect(app.router.handle({ type: 'captcha:acquire-image', url: 'https://cdn.example.test/captcha.png' }, sender)).resolves.toEqual({ state: 'image_unavailable', reason: 'permission' });
    expect(app.fetch).not.toHaveBeenCalled();
  });

  it('routes validated acquisition and OCR requests without result cross-talk', async () => {
    const app = harness();
    await expect(app.router.handle({ type: 'captcha:acquire-image', url: 'https://cdn.example.test/captcha.png' }, sender)).resolves.toMatchObject({ state: 'ready' });
    await expect(app.router.handle({ type: 'captcha:recognize', imageDataUrl: 'data:image/png;base64,AQ==', revision: 'r1', modes: ['digits'] }, sender)).resolves.toEqual([{ mode: 'digits', text: '42', confidence: .9 }]);
    expect(app.recognize).toHaveBeenCalledWith('data:image/png;base64,AQ==', 'r1', ['digits']);
  });

  it('accepts same-origin iframe/path senders but rejects cross-origin sender URLs', async () => {
    const app = harness();
    await expect(app.router.handle({ type: 'captcha:acquire-image', url: 'https://cdn.example.test/captcha.png' }, { tab: { id: 4, url: 'https://portal.example.test/login' }, url: 'https://portal.example.test/frame/captcha' })).resolves.toMatchObject({ state: 'ready' });
    await expect(app.router.handle({ type: 'captcha:acquire-image', url: 'https://cdn.example.test/captcha.png' }, { tab: { id: 4, url: 'https://portal.example.test/login' }, url: 'https://other.example.test/frame/captcha' })).resolves.toEqual({ state: 'image_unavailable', reason: 'permission' });
  });

  it('does not report an allowlisted site as enabled after its exact permission is removed', async () => {
    const app = harness({ pagePermission: false, stateEnabled: true });
    await expect(app.router.handle({ type: 'captcha:get-site-state' }, sender)).resolves.toEqual({ enabled: false });
  });

  it('never falls back to activeTab for malformed or cross-origin tab senders', async () => {
    const app = harness({ stateEnabled: true });
    await expect(app.router.handle({ type: 'captcha:get-site-state' }, { tab: { id: 99, url: 'not a page' }, url: 'not a page' })).resolves.toEqual({ enabled: false });
    await expect(app.router.handle({ type: 'captcha:set-site-enabled', enabled: true }, { tab: { id: 99, url: 'https://portal.example.test/' }, url: 'https://other.example.test/' })).resolves.toEqual({ enabled: false, reason: 'invalid-request' });
    expect(app.activeTab).not.toHaveBeenCalled();
  });

  it('rejects a popup toggle after the active tab changes without mutating either site', async () => {
    const app = harness();
    app.activeTab.mockResolvedValueOnce({ id: 8, url: 'https://other.example.test/login' });

    await expect(app.router.handle({ type: 'captcha:set-site-enabled', enabled: true, hostname: 'portal.example.test' }, {})).resolves.toEqual({ enabled: false, reason: 'site-changed' });

    expect(app.enablePage).not.toHaveBeenCalled();
    expect(app.disablePage).not.toHaveBeenCalled();
  });

  it('maps malformed and inference errors to guarded OCR failures', async () => {
    const app = harness();
    await expect(app.router.handle({ type: 'captcha:recognize', imageDataUrl: 'not a data URL', revision: '', modes: ['invalid'] }, sender)).resolves.toEqual({ type: 'captcha:recognition-error', code: 'recognition_failed' });
    app.recognize.mockRejectedValueOnce(Object.assign(new Error('offline'), { code: 'model_unavailable' }));
    await expect(app.router.handle({ type: 'captcha:recognize', imageDataUrl: 'data:image/png;base64,AQ==', revision: 'r1', modes: ['digits'] }, sender)).resolves.toEqual({ type: 'captcha:recognition-error', code: 'model_unavailable' });
    expect(await app.router.handle({ type: 'other' }, sender)).toBeUndefined();
  });
});
