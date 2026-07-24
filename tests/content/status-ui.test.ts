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
});
