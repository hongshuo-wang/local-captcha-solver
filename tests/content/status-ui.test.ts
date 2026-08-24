import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearSliderStatus, clearWorkflowStatus, showRecognizing, showSliderStatus, showWorkflowStatus } from '../../src/content/status-ui';

const host = () => document.querySelector<HTMLElement>('[data-local-captcha-status]');
const shadow = () => host()?.shadowRoot;

afterEach(() => { clearWorkflowStatus(); clearSliderStatus(); vi.useRealTimers(); });

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

  it('clears workflow and slider feedback independently', () => {
    showSliderStatus({ state: 'running' });
    clearWorkflowStatus();
    expect(shadow()?.textContent).toContain('Captcha Helper 正在接管滑块');
    clearSliderStatus();
    expect(host()).toBeNull();

    showWorkflowStatus({ state: 'recognition_failed', candidateId: 'image-1' });
    clearSliderStatus();
    expect(shadow()?.textContent).toContain('验证码识别失败');
  });

  it('explains when uncertain slider location prevents a drag', () => {
    showSliderStatus({ state: 'low-confidence', confidence: .41 });
    expect(shadow()?.textContent).toContain('未执行自动拖动');
    expect(shadow()?.textContent).toContain('为避免误操作已停止');
  });

  it('highlights the current slider without intercepting user input', () => {
    const challenge = document.createElement('div');
    challenge.dataset.sliderCaptcha = 'true';
    const image = document.createElement('img');
    image.dataset.sliderImage = 'true';
    const track = document.createElement('div');
    track.dataset.sliderTrack = 'true';
    const handle = document.createElement('button');
    handle.dataset.sliderHandle = 'true';
    challenge.append(image, track, handle);
    document.body.append(challenge);
    image.getBoundingClientRect = () => ({ left: 40, top: 20, right: 300, bottom: 120, width: 260, height: 100, x: 40, y: 20, toJSON: () => ({}) });
    track.getBoundingClientRect = () => ({ left: 40, top: 130, right: 300, bottom: 170, width: 260, height: 40, x: 40, y: 130, toJSON: () => ({}) });
    handle.getBoundingClientRect = () => ({ left: 80, top: 120, right: 132, bottom: 172, width: 52, height: 52, x: 80, y: 120, toJSON: () => ({}) });

    showSliderStatus({ state: 'user-active' });

    expect(shadow()?.textContent).toContain('已暂停自动拖动');
    expect(shadow()?.textContent).toContain('停止操作后会继续检测滑块');
    expect(host()?.dataset.presentation).toBe('panel');
    expect(host()?.style.pointerEvents).toBe('none');
    expect(shadow()?.querySelector('[data-status-kind="slider-user-active"]')).not.toBeNull();
    expect(document.querySelector('[data-local-captcha-slider-highlight]')).not.toBeNull();

    clearSliderStatus();
    expect(document.querySelector('[data-local-captcha-slider-highlight]')).toBeNull();
  });
});
