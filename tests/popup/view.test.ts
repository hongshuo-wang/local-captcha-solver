import { describe, expect, it, vi } from 'vitest';

import { createPopupView, formatDiagnosticSnapshot, startPopup } from '../../entrypoints/popup/main';
import type { ModelStatusSnapshot } from '../../src/background/model-status';
import type { PopupControllerAdapter } from '../../src/popup/controller';

describe('popup view', () => {
  it('renders product identity, current-site controls, model state, and a settings command', () => {
    const root = document.createElement('main');
    document.body.append(root);
    const view = createPopupView(root);
    expect(root.textContent).toContain('Captcha Helper');
    expect(root.textContent).toContain('本地验证码助手');
    expect(root.textContent).toContain('当前网站');
    expect(root.textContent).toContain('最近状态');
    expect(root.textContent).toContain('立即识别当前页');
    expect(root.textContent).toContain('设置');
    expect(root.textContent).not.toContain('自动复制');
    expect(root.querySelector<HTMLImageElement>('.brand-mark')?.src).toContain('/icons/icon-48.png');
    expect(view.checkbox.type).toBe('checkbox');
    expect(view.modeSelect.value).toBe('auto');
    expect(view.modeSelect.options).toHaveLength(5);
    expect(root.querySelector('[data-popup-status]')?.getAttribute('role')).toBe('status');
    root.remove();
  });

  it('adapts the permission action to all-site and selected-site modes', () => {
    const root = document.createElement('main');
    document.body.append(root);
    const view = createPopupView(root);
    view.render({ hostname: 'portal.example.test', accessMode: 'all', checked: false, disabled: true, accessGranted: false, recognitionAvailable: true, status: '启用全站访问后开始自动识别。' });
    expect(view.accessButton.textContent).toBe('授权所有网站');
    view.render({ hostname: 'portal.example.test', accessMode: 'selected', checked: false, disabled: true, accessGranted: false, recognitionAvailable: true, status: '允许访问此网站后开始自动识别。' });
    expect(view.accessButton.textContent).toBe('添加网站');
    view.render({ hostname: 'portal.example.test', accessMode: 'selected', checked: true, disabled: false, accessGranted: true, recognitionAvailable: true, status: '此网站已开启自动识别。' });
    expect(root.querySelector<HTMLElement>('[data-access-panel]')?.hidden).toBe(true);
    expect(view.checkbox.checked).toBe(true);
    root.remove();
  });

  it('renders localized English chrome and guarded model activity', () => {
    const root = document.createElement('main');
    document.body.append(root);
    const view = createPopupView(root, 'en');
    view.renderModelStatus({ status: 'error', progress: 0, message: '本地识别模型不可用', logs: [{ at: 1000, kind: 'recognition', outcome: 'failure', message: '识别失败' }] });
    expect(root.textContent).toContain('Local CAPTCHA helper');
    expect(root.querySelector('[data-model-summary]')?.textContent).toBe('Model unavailable');
    expect(root.querySelector('[data-latest-activity]')?.textContent).toBe('Recognition failed');
    expect(view.modelRetry.hidden).toBe(false);
    root.remove();
  });

  it('exports diagnostics without changing stored values', () => {
    const snapshot: ModelStatusSnapshot = { status: 'ready', progress: 100, message: 'ready', logs: [{ at: 1000, kind: 'workflow', outcome: 'success', message: 'done', site: 'portal.example.test' }] };
    expect(JSON.parse(formatDiagnosticSnapshot(snapshot))).toEqual(snapshot);
  });

  it('wires model retry, site state, and the options-page command', async () => {
    const root = document.createElement('main');
    document.body.append(root);
    const sendMessage = vi.fn(async (message: { type: string }) => {
      if (message.type === 'captcha:get-model-status' || message.type === 'captcha:retry-model-warmup') return { status: 'error', progress: 0, message: 'model unavailable', logs: [] } satisfies ModelStatusSnapshot;
      if (message.type === 'captcha:get-site-state') return { enabled: false };
      return { enabled: true };
    });
    const adapter: PopupControllerAdapter = {
      tabs: {
        query: vi.fn(async () => [{ id: 7, url: 'https://portal.example.test/login' }]),
        sendMessage: vi.fn(async () => ({ state: 'no_candidate' })),
      },
      runtime: { sendMessage },
      permissions: { contains: vi.fn(async () => true), request: vi.fn(async () => true) },
    };
    const openSettings = vi.fn(async () => undefined);
    const closePopup = vi.fn();
    startPopup(root, adapter, 'zh_CN', openSettings, closePopup);
    await vi.waitFor(() => expect(sendMessage).toHaveBeenCalledWith({ type: 'captcha:get-model-status' }));
    await vi.waitFor(() => expect(sendMessage).toHaveBeenCalledWith({ type: 'captcha:get-site-state' }));
    (root.querySelector('[data-model-retry]') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(sendMessage).toHaveBeenCalledWith({ type: 'captcha:retry-model-warmup' }));
    (root.querySelector('[data-open-settings]') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(openSettings).toHaveBeenCalledOnce());
    (root.querySelector('[data-recognize-page]') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(adapter.tabs.sendMessage).toHaveBeenCalledWith(7, { type: 'captcha:recognize-page' }));
    await vi.waitFor(() => expect(closePopup).toHaveBeenCalledOnce());
    root.remove();
  });

  it('loads and persists the current site CAPTCHA type', async () => {
    const root = document.createElement('main');
    document.body.append(root);
    const sendMessage = vi.fn(async (message: { type: string }) => message.type === 'captcha:get-model-status'
      ? { status: 'ready', progress: 100, message: 'ready', logs: [] } satisfies ModelStatusSnapshot
      : { enabled: true });
    const adapter: PopupControllerAdapter = {
      tabs: { query: vi.fn(async () => [{ id: 7, url: 'https://portal.example.test/login' }]), sendMessage: vi.fn(async () => ({ state: 'no_candidate' })) },
      runtime: { sendMessage },
      permissions: { contains: vi.fn(async () => true), request: vi.fn(async () => true) },
    };
    const read = vi.fn(async () => 'letters' as const);
    const write = vi.fn(async (_mode: 'auto' | 'digits' | 'letters' | 'alphanumeric' | 'arithmetic') => undefined);
    startPopup(root, adapter, 'zh_CN', undefined, undefined, { read, write });
    await vi.waitFor(() => expect(root.querySelector<HTMLSelectElement>('[data-captcha-mode]')?.value).toBe('letters'));
    const select = root.querySelector<HTMLSelectElement>('[data-captcha-mode]')!;
    select.value = 'alphanumeric';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    await vi.waitFor(() => expect(write).toHaveBeenCalledWith('alphanumeric'));
    root.remove();
  });

  it('prepares the slider content script before manual handling and site enablement', async () => {
    const root = document.createElement('main');
    document.body.append(root);
    const runtimeMessages: string[] = [];
    let injected = false;
    const sendMessage = vi.fn(async (message: { type: string }) => {
      runtimeMessages.push(message.type);
      if (message.type === 'captcha:get-model-status') return { status: 'ready', progress: 100, message: 'ready', logs: [] } satisfies ModelStatusSnapshot;
      if (message.type === 'captcha:get-site-state') return { enabled: true };
      if (message.type === 'captcha:get-slider-state') return { supported: true, enabled: false, debuggerGranted: true, hostname: 'portal.example.test' };
      if (message.type === 'captcha:set-slider-enabled') return { supported: true, enabled: true, debuggerGranted: true, hostname: 'portal.example.test' };
      if (message.type === 'captcha:run-slider') return { state: 'success' };
      return { reconciled: true };
    });
    const tabSendMessage = vi.fn(async (_tabId: number, message: { type: string }) => {
      if (message.type === 'captcha:ping') return injected ? { ok: true } : undefined;
      return undefined;
    });
    const executeScript = vi.fn(async () => { injected = true; });
    const adapter: PopupControllerAdapter = {
      tabs: {
        query: vi.fn(async () => [{ id: 7, url: 'https://portal.example.test/login' }]),
        sendMessage: tabSendMessage,
      },
      scripting: { executeScript },
      runtime: { sendMessage },
      permissions: { contains: vi.fn(async () => true), request: vi.fn(async () => true) },
    };
    startPopup(root, adapter, 'zh_CN');
    await vi.waitFor(() => expect((root.querySelector('[data-slider-enabled]') as HTMLInputElement | null)?.disabled).toBe(false));
    expect(root.querySelector('[data-slider-state-title]')?.textContent).toBe('未接管此网站');

    (root.querySelector('[data-slider-enabled]') as HTMLInputElement).click();
    await vi.waitFor(() => expect(sendMessage).toHaveBeenCalledWith({ type: 'captcha:set-slider-enabled', enabled: true, hostname: 'portal.example.test' }));
    await vi.waitFor(() => expect(executeScript).toHaveBeenCalledWith({ target: { tabId: 7 }, files: ['content-scripts/content.js'] }));
    expect(root.querySelector('[data-slider-state-title]')?.textContent).toBe('已接管本站');

    (root.querySelector('[data-run-slider]') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(sendMessage).toHaveBeenCalledWith({ type: 'captcha:run-slider' }));
    await vi.waitFor(() => expect(root.querySelector('[data-slider-status]')?.textContent).toBe('滑块验证已通过。'));
    expect(runtimeMessages).toContain('captcha:reconcile-access');
    root.remove();
  });

  it('shows automatic takeover progress and completion without a manual click', async () => {
    const root = document.createElement('main');
    document.body.append(root);
    let sliderReadCount = 0;
    const sendMessage = vi.fn(async (message: { type: string }) => {
      if (message.type === 'captcha:get-model-status') return { status: 'ready', progress: 100, message: 'ready', logs: [] } satisfies ModelStatusSnapshot;
      if (message.type === 'captcha:get-site-state') return { enabled: true };
      if (message.type === 'captcha:get-slider-state') {
        sliderReadCount += 1;
        return {
          supported: true,
          enabled: true,
          debuggerGranted: true,
          hostname: 'portal.example.test',
          activity: sliderReadCount === 1
            ? { state: 'running', trigger: 'automatic', at: 1000 }
            : { state: 'success', trigger: 'automatic', at: 1100 },
        };
      }
      return { enabled: true };
    });
    const adapter: PopupControllerAdapter = {
      tabs: { query: vi.fn(async () => [{ id: 7, url: 'https://portal.example.test/login' }]), sendMessage: vi.fn(async () => ({ ok: true })) },
      runtime: { sendMessage },
      permissions: { contains: vi.fn(async () => true), request: vi.fn(async () => true) },
    };
    startPopup(root, adapter, 'zh_CN');

    await vi.waitFor(() => expect(root.querySelector('[data-slider-state-title]')?.textContent).toBe('正在自动拖动'));
    expect(root.querySelector('[data-slider-panel]')?.getAttribute('data-state')).toBe('running');
    expect(root.querySelector('[data-slider-state-mode]')?.textContent).toBe('自动接管');
    await vi.waitFor(() => expect(root.querySelector('[data-slider-state-title]')?.textContent).toBe('已自动完成拖动'), { timeout: 1200 });
    expect(root.querySelector('[data-slider-panel]')?.getAttribute('data-state')).toBe('success');
    root.remove();
  });
});
