import { describe, expect, it, vi } from 'vitest';

import { createPopupView, startPopup } from '../../entrypoints/popup/main';
import type { ModelStatusSnapshot } from '../../src/background/model-status';
import type { PopupControllerAdapter } from '../../src/popup/controller';

describe('popup view', () => {
  it('renders product identity, global onboarding, site controls, preferences, and diagnostics', () => {
    const root = document.createElement('main');
    document.body.append(root);
    const view = createPopupView(root);
    expect(root.textContent).toContain('本地验证码识别器');
    expect(root.textContent).toContain('启用全站访问');
    expect(root.textContent).toContain('自动填充');
    expect(root.textContent).toContain('自动复制');
    expect(root.textContent).toContain('诊断信息');
    expect(view.shortcutSelect.value).toBe('middle');
    expect(view.checkbox.type).toBe('checkbox');
    expect(view.autoFillCheckbox.type).toBe('checkbox');
    expect(view.copyCheckbox.type).toBe('checkbox');
    expect(root.querySelector('[data-popup-status]')?.getAttribute('role')).toBe('status');
    root.remove();
  });

  it('switches between the first-run access panel and enabled controls', () => {
    const root = document.createElement('main');
    document.body.append(root);
    const view = createPopupView(root);
    const access = root.querySelector<HTMLElement>('[data-access-panel]')!;
    const controls = root.querySelectorAll<HTMLElement>('[data-controls-panel]');

    view.render({ hostname: 'portal.example.test', checked: false, disabled: true, accessGranted: false, status: '启用全站访问后开始自动识别。' });
    expect(access.hidden).toBe(false);
    expect([...controls].every((control) => control.hidden)).toBe(true);

    view.render({ hostname: 'portal.example.test', checked: true, disabled: false, accessGranted: true, status: '此网站已开启自动识别。' });
    expect(access.hidden).toBe(true);
    expect([...controls].every((control) => !control.hidden)).toBe(true);
    view.checkbox.focus();
    expect(document.activeElement).toBe(view.checkbox);
    expect(view.checkbox.checked).toBe(true);
    root.remove();
  });

  it('renders model error, latest activity, progress, retry, and collapsed diagnostic logs', () => {
    const root = document.createElement('main');
    document.body.append(root);
    const view = createPopupView(root);
    view.renderModelStatus({
      status: 'error', progress: 0, message: '本地识别模型不可用',
      logs: [{ at: 1000, kind: 'recognition', outcome: 'success', message: '识别成功（高置信度）', durationMs: 42 }],
    });

    expect(root.querySelector('[data-model-summary]')?.textContent).toContain('本地识别模型不可用');
    expect(root.querySelector('[data-latest-activity]')?.textContent).toContain('识别成功（高置信度）');
    expect((root.querySelector('[data-model-progress]') as HTMLProgressElement).value).toBe(0);
    expect((root.querySelector('[data-model-retry]') as HTMLButtonElement).hidden).toBe(false);
    expect((root.querySelector('.diagnostics') as HTMLDetailsElement).open).toBe(true);
    expect(root.querySelector('[data-model-logs]')?.textContent).toContain('42 ms');
    root.remove();
  });

  it('uses an empty state and keeps diagnostics closed when the model is healthy', () => {
    const root = document.createElement('main');
    document.body.append(root);
    const view = createPopupView(root);
    view.renderModelStatus({ status: 'ready', progress: 100, message: '本地识别模型已就绪', logs: [] });
    expect(root.querySelector('[data-latest-activity]')?.textContent).toBe('暂无执行记录');
    expect(root.querySelector('[data-model-logs]')?.textContent).toContain('暂无诊断记录');
    expect((root.querySelector('.diagnostics') as HTMLDetailsElement).open).toBe(false);
    root.remove();
  });

  it('renders only the 10 most recent diagnostic records', () => {
    const root = document.createElement('main');
    document.body.append(root);
    const view = createPopupView(root);
    const logs = Array.from({ length: 31 }, (_, index) => ({ at: index, kind: 'recognition' as const, outcome: 'success' as const, message: `记录 ${index}` }));
    view.renderModelStatus({ status: 'ready', progress: 100, message: '本地识别模型已就绪', logs });
    expect(root.querySelectorAll('[data-model-logs] li')).toHaveLength(10);
    expect(root.querySelector('[data-model-logs]')?.textContent).not.toContain('记录 20');
    expect(root.querySelector('[data-model-logs]')?.textContent).toContain('记录 30');
    root.remove();
  });

  it('wires model, site, preference startup, and retry through the popup runtime', async () => {
    const root = document.createElement('main');
    document.body.append(root);
    const sendMessage = vi.fn(async (message: { type: string }) => {
      if (message.type === 'captcha:get-model-status' || message.type === 'captcha:retry-model-warmup') return { status: 'error', progress: 0, message: '本地识别模型不可用', logs: [] } satisfies ModelStatusSnapshot;
      if (message.type === 'captcha:get-site-state') return { enabled: false };
      if (message.type === 'captcha:get-preferences') return { autoFill: true, copyOnNoField: false, recognitionShortcut: 'middle' };
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
    expect((root.querySelector('#auto-fill') as HTMLInputElement).checked).toBe(true);
    expect((root.querySelector('#copy-on-no-field') as HTMLInputElement).checked).toBe(false);
    (root.querySelector('[data-model-retry]') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(sendMessage).toHaveBeenCalledWith({ type: 'captcha:retry-model-warmup' }));
    root.remove();
  });
});
