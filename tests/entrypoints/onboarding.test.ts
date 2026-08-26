import { describe, expect, it, vi } from 'vitest';

import { startOnboarding, type OnboardingBrowser } from '../../entrypoints/onboarding/main';
import { SETTINGS_STORAGE_KEY } from '../../src/platform/settings-store';

function harness() {
  const values = new Map<string, unknown>();
  const request = vi.fn(async () => true);
  const remove = vi.fn(async () => true);
  const contains = vi.fn(async (_details: { origins?: string[]; permissions?: string[] }) => false);
  const sendMessage = vi.fn(async (message: { type?: string }) => message.type === 'captcha:recognize'
    ? [{ mode: 'arithmetic', text: '20+22', confidence: .97 }]
    : { reconciled: true });
  const extension: OnboardingBrowser = {
    storage: { local: {
      async get(key) { return { [key]: values.get(key) }; },
      async set(next) { for (const [key, value] of Object.entries(next)) values.set(key, value); },
    } },
    permissions: { request, remove, contains },
    runtime: {
      sendMessage,
      getURL: (path) => `chrome-extension://test/${path}`,
      getManifest: () => ({ permissions: ['debugger'] }),
    },
    i18n: { getUILanguage: () => 'zh-CN' },
  };
  return { extension, values, request, remove, sendMessage, contains };
}

describe('onboarding entrypoint', () => {
  it('uses the three-page static recognition flow when the browser has no slider capability', async () => {
    const app = harness();
    app.extension.runtime.getManifest = () => ({ permissions: [] });
    const closeGuide = vi.fn();
    const root = document.createElement('div');
    document.body.append(root);

    await startOnboarding(root, app.extension, closeGuide);
    expect(root.querySelectorAll('.capability-card')).toHaveLength(1);
    expect(root.querySelectorAll('.setup-progress li')).toHaveLength(3);
    expect(root.querySelector('[data-slider-unavailable]')?.textContent).toContain('Firefox 暂不支持拼图滑块验证码');
    expect(root.querySelector('[data-slider-unavailable]')?.textContent).toContain('推荐使用 Chrome 或 Edge 体验完整插件功能');
    expect(app.contains.mock.calls.some(([details]) => details.permissions?.includes('debugger'))).toBe(false);
    (root.querySelector('[data-primary]') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(root.querySelector('[data-page="static-settings"]')).not.toBeNull());
    (root.querySelector('[data-onboarding-mode="selected"]') as HTMLButtonElement).click();
    await vi.waitFor(() => expect((root.querySelector('[data-primary]') as HTMLButtonElement).disabled).toBe(false));
    (root.querySelector('[data-primary]') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(root.querySelector('[data-page="static-demo"]')).not.toBeNull());
    (root.querySelector('[data-primary]') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(closeGuide).toHaveBeenCalledOnce());
    expect(root.querySelector('[data-page="slider-settings"]')).toBeNull();
    root.remove();
  });

  it('walks the five-page welcome flow with separate static and slider paths', async () => {
    const app = harness();
    const closeGuide = vi.fn();
    const root = document.createElement('div');
    document.body.append(root);

    await startOnboarding(root, app.extension, closeGuide);
    expect(root.querySelector('[data-page="overview"] h1')?.textContent).toBe('先用一分钟完成本地识别设置');
    expect(root.querySelectorAll('.capability-card')).toHaveLength(2);
    (root.querySelector('[data-primary]') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(root.querySelector('[data-page="static-settings"]')).not.toBeNull());
    expect((root.querySelector('[data-primary]') as HTMLButtonElement).disabled).toBe(true);

    (root.querySelector('[data-onboarding-mode="selected"]') as HTMLButtonElement).click();
    await vi.waitFor(() => expect((root.querySelector('[data-primary]') as HTMLButtonElement).disabled).toBe(false));
    (root.querySelector('[data-primary]') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(root.querySelector('[data-page="static-demo"]')).not.toBeNull());
    (root.querySelector('[data-run-demo]') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(root.querySelector('[data-demo-status]')?.textContent).toContain('识别结果：20+22'));

    (root.querySelector('[data-primary]') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(root.querySelector('[data-page="slider-settings"]')).not.toBeNull());
    expect(root.querySelector('[data-slider-choice="all"]')?.getAttribute('aria-pressed')).toBe('false');
    expect(root.querySelector('[data-slider-choice="selected"]')?.getAttribute('aria-pressed')).toBe('false');
    (root.querySelector('[data-skip-slider]') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(root.querySelector('[data-page="slider-demo"]')).not.toBeNull());
    expect(root.textContent).toContain('滑块暂未开启');
    (root.querySelector('[data-primary]') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(closeGuide).toHaveBeenCalledOnce());
    expect(app.values.get(SETTINGS_STORAGE_KEY)).toMatchObject({ accessMode: 'selected', onboardingComplete: true });
    root.remove();
  });

  it('opens the upgrade flow without replaying static setup and records the guide version', async () => {
    const app = harness();
    const closeGuide = vi.fn();
    const root = document.createElement('div');
    document.body.append(root);
    window.history.pushState({}, '', '/onboarding.html?flow=upgrade&version=1.2.0');

    await startOnboarding(root, app.extension, closeGuide);
    expect(root.querySelector('[data-page="upgrade"] h1')?.textContent).toBe('现在可以处理拼图滑块了');
    (root.querySelector('[data-primary]') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(root.querySelector('[data-page="slider-settings"]')).not.toBeNull());
    (root.querySelector('[data-skip-slider]') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(root.querySelector('[data-page="slider-demo"]')).not.toBeNull());
    (root.querySelector('[data-primary]') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(closeGuide).toHaveBeenCalledOnce());
    expect(app.values.get(SETTINGS_STORAGE_KEY)).toMatchObject({ lastSeenUpgradeGuide: '1.2.0', onboardingComplete: false });
    root.remove();
    window.history.pushState({}, '', '/onboarding.html');
  });
});
