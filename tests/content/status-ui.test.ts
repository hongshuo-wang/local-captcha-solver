import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearWorkflowStatus, showRecognizing, showSliderStatus, showWorkflowStatus } from '../../src/content/status-ui';

const host = () => document.querySelector<HTMLElement>('[data-local-captcha-status]');
const shadow = () => host()?.shadowRoot;

afterEach(() => { clearWorkflowStatus(); vi.useRealTimers(); });

describe('status UI', () => {
  it('isolates an accessible live region and keeps ambiguous states until dismissed', async () => {
    vi.useFakeTimers();
    showWorkflowStatus({ state: 'ambiguous_image', candidateIds: ['a', 'b'] });
    expect(host()?.style.pointerEvents).toBe('none');
    expect(shadow()?.querySelector('[role="status"]')?.getAttribute('aria-live')).toBe('polite');
    expect(shadow()?.textContent).toContain('找到多个匹配的验证码图片');
    await vi.advanceTimersByTimeAsync(4000);
    expect(host()).not.toBeNull();
  });

  it('anchors an actionable result and keeps it until the user acts', async () => {
    vi.useFakeTimers();
    const field = document.createElement('input');
    document.body.append(field);
    vi.spyOn(field, 'getBoundingClientRect').mockReturnValue({ left: 40, top: 60, right: 180, bottom: 96, width: 140, height: 36, x: 40, y: 60, toJSON: () => ({}) });
    const onConfirm = vi.fn();
    showWorkflowStatus({ state: 'needs_confirmation', candidateId: 'image-1', displayText: 'A8K2', fillValue: 'A8K2', fieldIds: ['field-1'] }, field, onConfirm);
    expect(shadow()?.textContent).toContain('A8K2');
    expect(shadow()?.textContent).toContain('填入');
    expect(Number.parseInt(host()?.style.left ?? '0', 10)).toBeGreaterThanOrEqual(12);
    await vi.advanceTimersByTimeAsync(20000);
    expect(host()).not.toBeNull();
    (shadow()?.querySelector('button.action') as HTMLButtonElement).click();
    await Promise.resolve();
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it('distinguishes model preparation from recognition and keeps running state visible', async () => {
    vi.useFakeTimers();
    showRecognizing(undefined, 'preparing');
    await vi.advanceTimersByTimeAsync(10000);
    expect(shadow()?.textContent).toContain('正在准备本地模型');
    showRecognizing();
    expect(shadow()?.textContent).toContain('正在识别验证码');
  });

  it('shows recognized value and automatic copy outcome without persisting text elsewhere', () => {
    showWorkflowStatus({ state: 'no_field', candidateId: 'image-1', displayText: 'A8K2', fillValue: 'A8K2' }, undefined, { copyOutcome: 'copied' });
    expect(shadow()?.textContent).toContain('识别完成并已复制');
    expect(shadow()?.textContent).toContain('A8K2');
    expect(shadow()?.textContent).toContain('已复制到剪贴板');
    expect(host()?.dataset.presentation).toBe('toast');
  });

  it('keeps raw confidence out of normal confirmation UI', () => {
    showWorkflowStatus({ state: 'needs_confirmation', candidateId: 'image-1', displayText: 'A8K2', fillValue: 'A8K2', confidence: .923, fieldIds: ['field-1'] });
    expect(shadow()?.textContent).toContain('A8K2');
    expect(shadow()?.textContent).not.toContain('92.3%');
    expect(shadow()?.textContent).not.toContain('置信度');
  });

  it('runs dismiss callbacks from the close control', () => {
    const onDismiss = vi.fn();
    showWorkflowStatus({ state: 'recognition_failed', candidateId: 'image-1' }, undefined, { onDismiss });
    (shadow()?.querySelector('.close') as HTMLButtonElement).click();
    expect(onDismiss).toHaveBeenCalledOnce();
    expect(host()).toBeNull();
  });

  it('shows slider takeover progress and replaces it with a short completion toast', async () => {
    vi.useFakeTimers();
    showSliderStatus({ state: 'running' });
    expect(shadow()?.textContent).toContain('Captcha Helper 正在接管滑块');
    expect(host()?.dataset.presentation).toBe('toast');
    await vi.advanceTimersByTimeAsync(5000);
    expect(host()).not.toBeNull();

    showSliderStatus({ state: 'success', confidence: .82 });
    expect(shadow()?.textContent).toContain('滑块已自动完成');
    await vi.advanceTimersByTimeAsync(2400);
    expect(host()).toBeNull();
  });

  it('explains when uncertain slider location prevents a drag', () => {
    showSliderStatus({ state: 'low-confidence', confidence: .41 });
    expect(shadow()?.textContent).toContain('未执行自动拖动');
    expect(shadow()?.textContent).toContain('为避免误操作已停止');
  });
});
