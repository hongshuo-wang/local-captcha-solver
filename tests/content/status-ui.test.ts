import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearWorkflowStatus, showRecognizing, showWorkflowStatus } from '../../src/content/status-ui';

afterEach(() => { clearWorkflowStatus(); vi.useRealTimers(); });
describe('status UI', () => {
  it('uses an accessible fixed-size non-interactive live region and removes it', async () => {
    vi.useFakeTimers(); showRecognizing();
    const region = document.querySelector('[data-local-captcha-status]') as HTMLElement;
    expect(region.getAttribute('aria-live')).toBe('polite'); expect(region.style.pointerEvents).toBe('none'); expect(region.style.width).toBeTruthy(); expect(region.style.minHeight || region.style.height).toBeTruthy();
    showWorkflowStatus({ state: 'ambiguous_image', candidateIds: ['a', 'b'] }); await vi.advanceTimersByTimeAsync(4000);
    expect(document.querySelector('[data-local-captcha-status]')).toBeNull();
  });

  it('anchors the result beside the target field and exposes an explicit fill action', () => {
    const field = document.createElement('input');
    document.body.append(field);
    vi.spyOn(field, 'getBoundingClientRect').mockReturnValue({ left: 40, top: 60, right: 180, bottom: 96, width: 140, height: 36, x: 40, y: 60, toJSON: () => ({}) });
    const onConfirm = vi.fn();
    showWorkflowStatus({ state: 'needs_confirmation', candidateId: 'image-1', displayText: 'A8K2', fillValue: 'A8K2', fieldIds: ['field-1'] }, field, onConfirm);
    const region = document.querySelector('[data-local-captcha-status]') as HTMLElement;
    expect(region.textContent).toContain('A8K2');
    expect(region.textContent).toContain('填充');
    expect(region.style.position).toBe('fixed');
    expect(region.style.left).toBe('40px');
    (region.querySelector('button') as HTMLButtonElement).click();
    expect(onConfirm).toHaveBeenCalledOnce();
  });
});
