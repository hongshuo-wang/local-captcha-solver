import { describe, expect, it, vi } from 'vitest';

import { startOptions, type OptionsBrowser } from '../../entrypoints/options/main';
import { DEFAULT_SETTINGS, SETTINGS_STORAGE_KEY } from '../../src/platform/settings-store';

function harness() {
  const values = new Map<string, unknown>();
  const request = vi.fn(async () => true);
  const remove = vi.fn(async () => true);
  const contains = vi.fn(async (_details: { origins: string[] }) => false);
  let retrying = false;
  const sendMessage = vi.fn(async (message: { type?: string }): Promise<unknown> => {
    if (message.type === 'captcha:retry-model-warmup') {
      retrying = true;
      return { status: 'loading', progress: 50, message: 'loading', logs: [] };
    }
    if (message.type === 'captcha:get-model-status') {
      if (retrying) retrying = false;
      return { status: 'ready', progress: 100, message: 'ready', logs: [] };
    }
    if (message.type === 'captcha:clear-diagnostics') {
      return { cleared: true, snapshot: { status: 'ready', progress: 100, message: 'ready', logs: [] } };
    }
    return { reconciled: true };
  });
  const extension: OptionsBrowser = {
    storage: { local: {
      async get(key) { return { [key]: values.get(key) }; },
      async set(next) { for (const [key, value] of Object.entries(next)) values.set(key, value); },
    } },
    permissions: { request, remove, contains },
    runtime: { sendMessage, getManifest: () => ({ version: '1.0.0' }), getURL: (path) => `chrome-extension://test/${path}` },
    i18n: { getUILanguage: () => 'zh-CN' },
  };
  return { extension, values, request, remove, contains, sendMessage };
}

describe('options entrypoint', () => {
  it('renders the privacy-first selected-site default and can switch access modes', async () => {
    const app = harness();
    const root = document.createElement('div');
    document.body.append(root);
    await startOptions(root, app.extension);
    expect(root.textContent).toContain('静态验证码');
    expect(root.textContent).toContain('访问模式');
    expect(root.querySelector('[data-mode="selected"]')?.getAttribute('aria-pressed')).toBe('true');
    (root.querySelector('[data-mode="all"]') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(app.request).toHaveBeenCalledWith({ origins: ['http://*/*', 'https://*/*'] }));
    await vi.waitFor(() => expect(app.values.get(SETTINGS_STORAGE_KEY)).toMatchObject({ accessMode: 'all' }));
    await vi.waitFor(() => expect(root.querySelector('[data-mode="selected"]')).not.toBeNull());
    (root.querySelector('[data-mode="selected"]') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(app.remove).toHaveBeenCalledWith({ origins: ['http://*/*', 'https://*/*'] }));
    expect(app.values.get(SETTINGS_STORAGE_KEY)).toMatchObject({ accessMode: 'selected' });
    root.remove();
  });

  it('adds an exact authorized hostname through a direct permission gesture', async () => {
    const app = harness();
    app.values.set(SETTINGS_STORAGE_KEY, { ...DEFAULT_SETTINGS, accessMode: 'selected', onboardingComplete: true });
    location.hash = 'settings';
    const root = document.createElement('div');
    document.body.append(root);
    await startOptions(root, app.extension);
    const form = root.querySelector('[data-site-form]') as HTMLFormElement;
    (form.elements.namedItem('hostname') as HTMLInputElement).value = 'Login.Example.test/path';
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await vi.waitFor(() => expect(app.request).toHaveBeenCalledWith({ origins: ['http://login.example.test/*', 'https://login.example.test/*'] }));
    await vi.waitFor(() => expect(app.values.get(SETTINGS_STORAGE_KEY)).toMatchObject({ selectedSites: [{ hostname: 'login.example.test', includeSubdomains: false }] }));
    root.remove();
  });

  it('polls a model retry through to its final status', async () => {
    const app = harness();
    location.hash = 'diagnostics';
    const root = document.createElement('div');
    document.body.append(root);
    await startOptions(root, app.extension);

    (root.querySelector('[data-retry-model]') as HTMLButtonElement).click();
    expect((root.querySelector('[data-retry-model]') as HTMLButtonElement).disabled).toBe(true);
    expect(root.textContent).toContain('正在重新加载');
    await vi.waitFor(() => expect(root.querySelector('.model-state')?.getAttribute('data-state')).toBe('ready'), { timeout: 1_500 });
    expect(app.sendMessage).toHaveBeenCalledWith({ type: 'captcha:retry-model-warmup' });
    expect(app.sendMessage).toHaveBeenCalledWith({ type: 'captcha:get-model-status' });

    root.remove();
    location.hash = '';
  });

  it('clears diagnostics from the full-tab options page', async () => {
    const app = harness();
    location.hash = 'diagnostics';
    const root = document.createElement('div');
    document.body.append(root);
    await startOptions(root, app.extension);

    (root.querySelector('[data-clear-diagnostics]') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(app.sendMessage).toHaveBeenCalledWith({ type: 'captcha:clear-diagnostics' }));
    await vi.waitFor(() => expect(root.textContent).toContain('暂无诊断记录'));

    root.remove();
    location.hash = '';
  });

  it('shows slider result and drag geometry in local diagnostics', async () => {
    const app = harness();
    app.sendMessage.mockImplementation(async (message: { type?: string }) => message.type === 'captcha:get-model-status'
      ? {
          status: 'ready', progress: 100, message: 'ready', logs: [{
            at: 1000,
            kind: 'slider',
            outcome: 'failure',
            message: '滑块验证未通过',
            site: '2captcha.com',
            trigger: 'automatic',
            sliderState: 'failed',
            provider: 'geetest-v4',
            confidence: .72,
            durationMs: 812,
            gapX: 184.25,
            gapY: 31,
            pieceOffsetX: 7.5,
            desiredPieceOffsetX: 184.25,
            actualPieceOffsetX: 184,
            pieceErrorX: .25,
            correctionX: 1,
            imageWidth: 300,
            imageHeight: 180,
            trackWidth: 300,
            handleWidth: 40,
            scaleX: 2,
            scaleY: 2,
            startX: 20,
            requestedEndX: 196.75,
            endX: 196.75,
            releaseX: 196.75,
          }],
        }
      : { reconciled: true });
    location.hash = 'diagnostics';
    const root = document.createElement('div');
    document.body.append(root);

    await startOptions(root, app.extension);

    expect(root.textContent).toContain('provider=geetest-v4');
    expect(root.textContent).toContain('result=failed');
    expect(root.textContent).toContain('gapX=184.25');
    expect(root.textContent).toContain('pieceErrorX=0.25');
    expect(root.textContent).toContain('correctionX=1');
    expect(root.textContent).toContain('requestedEndX=196.75');
    expect(root.textContent).toContain('releaseX=196.75');
    root.remove();
    location.hash = '';
  });

  it('shows effective selected-site permissions instead of the global grant', async () => {
    const app = harness();
    app.values.set(SETTINGS_STORAGE_KEY, {
      ...DEFAULT_SETTINGS,
      accessMode: 'selected',
      selectedSites: [{ hostname: 'portal.example.test', includeSubdomains: false }],
    });
    app.contains.mockImplementation(async (details) => details.origins.includes('https://portal.example.test/*'));
    const root = document.createElement('div');
    document.body.append(root);
    await startOptions(root, app.extension);

    const staticView = root.querySelector('[data-view="static"]') as HTMLElement;
    expect(staticView.textContent).toContain('已授权 1/1 个指定网站');
    expect(staticView.textContent).toContain('已授权 · 仅此主机名');
    expect(staticView.textContent).not.toContain('尚未获得网站访问权限');

    root.remove();
  });

  it('lists site CAPTCHA type overrides and restores automatic detection', async () => {
    const app = harness();
    app.values.set(SETTINGS_STORAGE_KEY, {
      ...DEFAULT_SETTINGS,
      siteRecognitionModes: [{ hostname: 'portal.example.test', mode: 'letters' }],
    });
    location.hash = 'static';
    const root = document.createElement('div');
    document.body.append(root);
    await startOptions(root, app.extension);
    expect(root.textContent).toContain('网站类型覆盖');
    expect(root.textContent).toContain('portal.example.test');
    expect(root.textContent).toContain('纯英文');
    (root.querySelector('[data-restore-mode]') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(app.values.get(SETTINGS_STORAGE_KEY)).toMatchObject({ siteRecognitionModes: [] }));
    root.remove();
    location.hash = '';
  });

  it('configures slider handling globally or for selected sites from Slider settings', async () => {
    const app = harness();
    app.values.set(SETTINGS_STORAGE_KEY, { ...DEFAULT_SETTINGS, accessMode: 'selected', sliderAccessMode: 'selected' });
    location.hash = 'slider';
    const root = document.createElement('div');
    document.body.append(root);
    await startOptions(root, app.extension);
    expect(root.textContent).toContain('拼图滑块处理');
    expect(root.querySelector('[data-slider-mode="selected"]')?.getAttribute('aria-pressed')).toBe('true');
    (root.querySelector('[data-slider-mode="all"]') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(app.request).toHaveBeenCalledWith({ origins: ['http://*/*', 'https://*/*'] }));
    await vi.waitFor(() => expect(app.values.get(SETTINGS_STORAGE_KEY)).toMatchObject({ sliderAccessMode: 'all' }));
    (root.querySelector('[data-slider-mode="selected"]') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(app.values.get(SETTINGS_STORAGE_KEY)).toMatchObject({ sliderAccessMode: 'selected' }));
    root.remove();
    location.hash = '';
  });

  it('opens the standalone slider upgrade guide from Settings without resetting OCR onboarding', async () => {
    const app = harness();
    app.values.set(SETTINGS_STORAGE_KEY, { ...DEFAULT_SETTINGS, onboardingComplete: true });
    const navigate = vi.fn();
    const createTab = vi.fn(async () => undefined);
    app.extension.tabs = { create: createTab };
    const root = document.createElement('div');
    document.body.append(root);
    await startOptions(root, app.extension, navigate);
    (root.querySelector('[data-open-guide]') as HTMLButtonElement).click();
    expect(createTab).toHaveBeenCalledWith({ url: 'chrome-extension://test/onboarding.html?flow=upgrade&version=1.0.0&manual=1' });
    expect(navigate).not.toHaveBeenCalled();
    expect(app.values.get(SETTINGS_STORAGE_KEY)).toMatchObject({ onboardingComplete: true });
    root.remove();
  });
});
