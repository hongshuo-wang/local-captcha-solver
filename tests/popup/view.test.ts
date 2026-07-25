import { describe, expect, it, vi } from 'vitest';

import { createPopupView, startPopup } from '../../entrypoints/popup/main';
import type { ModelStatusSnapshot } from '../../src/background/model-status';
import type { PopupControllerAdapter } from '../../src/popup/controller';

describe('popup view', () => {
  it('renders a native labelled checkbox with product, hostname, and status regions', () => {
    const root = document.createElement('main');
    document.body.append(root);
    const view = createPopupView(root);
    const label = root.querySelector<HTMLLabelElement>('label[for="site-enabled"]');
    const hostname = root.querySelector<HTMLElement>('[data-popup-hostname]');
    const status = root.querySelector<HTMLElement>('[data-popup-status]');

    expect(root.textContent).toContain('Local CAPTCHA Solver');
    expect(label?.textContent).toContain('Automatically recognize on this site');
    expect(view.checkbox.type).toBe('checkbox');
    expect(label?.control).toBe(view.checkbox);
    expect(hostname).not.toBeNull();
    expect(status?.getAttribute('role')).toBe('status');
    root.remove();
  });

  it('keeps the toggle focusable and reflects disabled loading states without changing layout hooks', () => {
    const root = document.createElement('main');
    document.body.append(root);
    const view = createPopupView(root);
    const row = root.querySelector('.toggle-row');
    const status = root.querySelector<HTMLElement>('[data-popup-status]');

    view.render({ hostname: 'portal.example.test', checked: false, disabled: true, status: 'Checking site setting...' });
    expect(view.checkbox.disabled).toBe(true);
    expect(row).not.toBeNull();
    expect(status?.classList.contains('status')).toBe(true);

    view.render({ hostname: 'portal.example.test', checked: true, disabled: false, status: 'Automatic recognition is on.' });
    view.checkbox.focus();
    expect(document.activeElement).toBe(view.checkbox);
    expect(view.checkbox.checked).toBe(true);
    expect(view.checkbox.disabled).toBe(false);
    root.remove();
  });

  it('renders model readiness, labelled progress, retry, and user-facing logs', () => {
    const root = document.createElement('main');
    document.body.append(root);
    const view = createPopupView(root);
    const snapshot: ModelStatusSnapshot = {
      status: 'error',
      progress: 0,
      message: '本地识别模型不可用',
      logs: [
        { at: 1000, kind: 'recognition', outcome: 'success', message: '识别成功（高置信度）', durationMs: 42 },
      ],
    };

    view.renderModelStatus(snapshot);

    const status = root.querySelector<HTMLElement>('[data-model-status]');
    const progress = root.querySelector<HTMLProgressElement>('[data-model-progress]');
    const retry = root.querySelector<HTMLButtonElement>('[data-model-retry]');
    const logs = root.querySelector<HTMLElement>('[data-model-logs]');
    expect(status?.textContent).toContain('本地识别模型不可用');
    expect(status?.getAttribute('role')).toBe('status');
    expect(progress?.getAttribute('role')).toBe('progressbar');
    expect(progress?.value).toBe(0);
    expect(retry?.hidden).toBe(false);
    expect(logs?.textContent).toContain('识别成功（高置信度）');
    expect(logs?.textContent).toContain('42 ms');
    expect(logs?.textContent).not.toContain('secret');
    root.remove();
  });

  it('hides retry for ready/loading and shows the empty log message', () => {
    const root = document.createElement('main');
    document.body.append(root);
    const view = createPopupView(root);
    const retry = root.querySelector<HTMLButtonElement>('[data-model-retry]');
    const logs = root.querySelector<HTMLElement>('[data-model-logs]');

    view.renderModelStatus({ status: 'loading', progress: 50, message: '正在加载本地识别模型', logs: [] });
    expect(retry?.hidden).toBe(true);
    expect(logs?.textContent).toContain('暂无执行记录');
    view.renderModelStatus({ status: 'ready', progress: 100, message: '本地识别模型已就绪', logs: [] });
    expect(retry?.hidden).toBe(true);
    root.remove();
  });

  it('renders only the 30 most recent user-facing records', () => {
    const root = document.createElement('main');
    document.body.append(root);
    const view = createPopupView(root);
    const logs = Array.from({ length: 31 }, (_, index) => ({
      at: index,
      kind: 'recognition' as const,
      outcome: 'success' as const,
      message: `记录 ${index}`,
    }));

    view.renderModelStatus({ status: 'ready', progress: 100, message: '本地识别模型已就绪', logs });

    const items = root.querySelectorAll('[data-model-logs] li');
    expect(items).toHaveLength(30);
    expect(root.querySelector('[data-model-logs]')?.textContent).not.toContain('记录 0');
    expect(root.querySelector('[data-model-logs]')?.textContent).toContain('记录 30');
    root.remove();
  });

  it('wires model startup, site startup, and retry clicks through the popup runtime', async () => {
    const root = document.createElement('main');
    document.body.append(root);
    const sendMessage = vi.fn(async (message: { type: string }) => {
      if (message.type === 'captcha:get-model-status') return { status: 'error', progress: 0, message: '本地识别模型不可用', logs: [] } satisfies ModelStatusSnapshot;
      if (message.type === 'captcha:retry-model-warmup') return { status: 'error', progress: 0, message: '本地识别模型不可用', logs: [] } satisfies ModelStatusSnapshot;
      if (message.type === 'captcha:get-site-state') return { enabled: false };
      return { enabled: true };
    });
    const adapter: PopupControllerAdapter = {
      tabs: { query: vi.fn(async () => [{ url: 'https://portal.example.test/login' }]) },
      runtime: { sendMessage },
      permissions: { contains: vi.fn(async () => true), request: vi.fn(async () => true) },
    };

    startPopup(root, adapter);
    await vi.waitFor(() => expect(sendMessage).toHaveBeenCalledWith({ type: 'captcha:get-model-status' }));
    await vi.waitFor(() => expect(sendMessage).toHaveBeenCalledWith({ type: 'captcha:get-site-state' }));

    const retry = root.querySelector<HTMLButtonElement>('[data-model-retry]');
    expect(retry?.hidden).toBe(false);
    retry?.click();
    await vi.waitFor(() => expect(sendMessage).toHaveBeenCalledWith({ type: 'captcha:retry-model-warmup' }));

    root.remove();
  });
});
