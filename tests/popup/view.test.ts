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
});
