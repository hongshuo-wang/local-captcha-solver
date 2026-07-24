import { describe, expect, it, vi } from 'vitest';
import { observeCaptchaImages } from '../../src/content/observer';

describe('captcha observer', () => {
  it('scans initial and added images, debounces source/load changes, and stops after disconnect', async () => {
    vi.useFakeTimers();
    document.body.innerHTML = '<img id="first">';
    const run = vi.fn(async () => ({ state: 'no_candidate' as const })); const cancelAll = vi.fn();
    const observer = observeCaptchaImages({ run, cancelAll });
    expect(run).toHaveBeenCalledWith(document.querySelector('#first'), 'automatic');
    const added = document.createElement('div'); added.innerHTML = '<img id="second">'; document.body.append(added);
    await Promise.resolve();
    const second = document.querySelector('#second') as HTMLImageElement;
    second.setAttribute('src', 'a'); second.dispatchEvent(new Event('load')); second.setAttribute('srcset', 'b');
    await vi.advanceTimersByTimeAsync(150);
    expect(run).toHaveBeenCalledWith(second, 'automatic');
    const count = run.mock.calls.length; observer.disconnect(); second.setAttribute('src', 'c'); await vi.advanceTimersByTimeAsync(150);
    expect(run).toHaveBeenCalledTimes(count); vi.useRealTimers();
  });
  it('ignores dynamically hidden images and removes its capture listener', async () => {
    vi.useFakeTimers(); document.body.innerHTML = '';
    const run = vi.fn(async () => ({ state: 'no_candidate' as const })); const cancelAll = vi.fn();
    const remove = vi.spyOn(document, 'removeEventListener');
    const observer = observeCaptchaImages({ run, cancelAll });
    const hidden = document.createElement('img'); hidden.hidden = true; document.body.append(hidden); await Promise.resolve(); await vi.advanceTimersByTimeAsync(150);
    expect(run).not.toHaveBeenCalled(); observer.disconnect();
    expect(remove).toHaveBeenCalledWith('load', expect.any(Function), true); expect(cancelAll).toHaveBeenCalledOnce(); vi.useRealTimers();
  });
});
