import { describe, expect, it, vi } from 'vitest';

import { startOnboarding, type OnboardingBrowser } from '../../entrypoints/onboarding/main';
import { SETTINGS_STORAGE_KEY } from '../../src/platform/settings-store';

function harness() {
  const values = new Map<string, unknown>();
  const request = vi.fn(async () => true);
  const remove = vi.fn(async () => true);
  const contains = vi.fn(async () => false);
  const sendMessage = vi.fn(async (message: { type?: string }) => message.type === 'captcha:recognize'
    ? [{ mode: 'arithmetic', text: '20+22', confidence: .97 }]
    : { reconciled: true });
  const extension: OnboardingBrowser = {
    storage: { local: {
      async get(key) { return { [key]: values.get(key) }; },
      async set(next) { for (const [key, value] of Object.entries(next)) values.set(key, value); },
    } },
    permissions: { request, remove, contains },
    runtime: { sendMessage, getURL: (path) => `chrome-extension://test/${path}` },
    i18n: { getUILanguage: () => 'zh-CN' },
  };
  return { extension, values, request, remove, sendMessage };
}

describe('onboarding entrypoint', () => {
  it('runs the standalone setup flow and opens settings when complete', async () => {
    const app = harness();
    const navigate = vi.fn();
    const root = document.createElement('div');
    document.body.append(root);

    await startOnboarding(root, app.extension, navigate);
    expect(root.textContent).toContain('先用一分钟完成本地识别设置');
    expect(root.textContent).toContain('选择网站访问范围');

    (root.querySelector('[data-onboarding-mode="selected"]') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(app.remove).toHaveBeenCalledWith({ origins: ['http://*/*', 'https://*/*'] }));
    await vi.waitFor(() => expect(app.values.get(SETTINGS_STORAGE_KEY)).toMatchObject({ accessMode: 'selected' }));

    (root.querySelector('[data-next]') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(root.textContent).toContain('设置识别行为'));
    (root.querySelector('[data-next]') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(root.textContent).toContain('配置完成，可以开始使用'));
    (root.querySelector('[data-run-demo]') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(root.textContent).toContain('识别结果：20+22'));
    expect(app.sendMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'captcha:recognize', modes: ['arithmetic'] }));
    (root.querySelector('[data-finish-guide]') as HTMLButtonElement).click();

    await vi.waitFor(() => expect(navigate).toHaveBeenCalledWith('chrome-extension://test/options.html'));
    expect(app.values.get(SETTINGS_STORAGE_KEY)).toMatchObject({ onboardingComplete: true });
    root.remove();
  });
});
