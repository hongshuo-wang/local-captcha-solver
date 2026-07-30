import { describe, expect, it, vi } from 'vitest';
import { observeCaptchaImages } from '../../src/content/observer';

function captcha(id: string, extra = ''): string {
  return `<form id="${id}-form"><img id="${id}" alt="captcha" width="120" height="40"><label for="${id}-field">Answer</label><input id="${id}-field">${extra}</form>`;
}

describe('captcha observer', () => {
  it('runs only the highest-scoring matching candidate', () => {
    document.body.innerHTML = `${captcha('first')}<form><img id="best" alt="captcha" width="120" height="40"><label for="best-field">Verification code</label><input id="best-field"></form>`;
    const run = vi.fn(async () => ({ state: 'recognition_failed' as const, candidateId: 'best' }));
    const observer = observeCaptchaImages({ run });
    expect(run).toHaveBeenCalledOnce();
    expect(run).toHaveBeenCalledWith(document.querySelector('#best'), 'automatic');
    observer.disconnect();
  });

  it('uses document order to break equal-score ties', () => {
    document.body.innerHTML = `${captcha('first')}${captcha('second')}`;
    const run = vi.fn(async () => ({ state: 'recognition_failed' as const, candidateId: 'first' }));
    const observer = observeCaptchaImages({ run });
    expect(run).toHaveBeenCalledWith(document.querySelector('#first'), 'automatic');
    expect(run).toHaveBeenCalledOnce();
    observer.disconnect();
  });

  it('does not cascade to the second candidate after recognition fails', async () => {
    document.body.innerHTML = `${captcha('first')}${captcha('second')}`;
    const run = vi.fn(async () => ({ state: 'recognition_failed' as const, candidateId: 'first' }));
    const observer = observeCaptchaImages({ run });
    await Promise.resolve();
    expect(run).toHaveBeenCalledOnce();
    observer.disconnect();
  });

  it('re-evaluates when a materially stronger candidate appears later', async () => {
    vi.useFakeTimers();
    document.body.innerHTML = captcha('first');
    const run = vi.fn(async () => ({ state: 'recognition_failed' as const, candidateId: 'candidate' }));
    const observer = observeCaptchaImages({ run });
    const wrapper = document.createElement('div');
    wrapper.innerHTML = '<form><img id="stronger" alt="captcha" width="120" height="40"><label for="stronger-field">Verification code</label><input id="stronger-field"></form>';
    document.body.append(wrapper);
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(150);
    expect(run).toHaveBeenCalledTimes(2);
    expect(run).toHaveBeenLastCalledWith(document.querySelector('#stronger'), 'automatic');
    observer.disconnect();
    vi.useRealTimers();
  });

  it('keeps a successfully filled candidate locked until its image changes', async () => {
    vi.useFakeTimers();
    document.body.innerHTML = captcha('first');
    const run = vi.fn(async () => ({ state: 'filled' as const, candidateId: 'first', fieldId: 'field', displayText: '1', fillValue: '1' }));
    const observer = observeCaptchaImages({ run });
    await Promise.resolve();
    const wrapper = document.createElement('div');
    wrapper.innerHTML = '<form><img id="stronger" alt="captcha" width="120" height="40"><label for="stronger-field">Verification code</label><input id="stronger-field"></form>';
    document.body.append(wrapper);
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(150);
    expect(run).toHaveBeenCalledOnce();
    const first = document.querySelector('#first') as HTMLImageElement;
    first.src = 'next.png';
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(150);
    expect(run).toHaveBeenCalledTimes(2);
    observer.disconnect();
    vi.useRealTimers();
  });

  it('ignores unrelated DOM mutations and hidden images', async () => {
    vi.useFakeTimers();
    document.body.innerHTML = captcha('first');
    const run = vi.fn(async () => ({ state: 'recognition_failed' as const, candidateId: 'first' }));
    const observer = observeCaptchaImages({ run });
    document.body.append(document.createElement('span'));
    const hidden = document.createElement('img');
    hidden.hidden = true;
    hidden.alt = 'captcha';
    document.body.append(hidden);
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(150);
    expect(run).toHaveBeenCalledOnce();
    observer.disconnect();
    vi.useRealTimers();
  });

  it('stops scheduled work and cancels active workflow work on disconnect', async () => {
    vi.useFakeTimers();
    document.body.innerHTML = captcha('first');
    const run = vi.fn(async () => ({ state: 'recognition_failed' as const, candidateId: 'first' }));
    const cancelAll = vi.fn();
    const observer = observeCaptchaImages({ run, cancelAll });
    (document.querySelector('#first') as HTMLImageElement).src = 'next.png';
    observer.disconnect();
    await vi.advanceTimersByTimeAsync(150);
    expect(run).toHaveBeenCalledOnce();
    expect(cancelAll).toHaveBeenCalledOnce();
    vi.useRealTimers();
  });
});
