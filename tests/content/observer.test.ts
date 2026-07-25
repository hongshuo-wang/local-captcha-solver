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
  it('processes src, srcset, and load revisions independently', async () => {
    vi.useFakeTimers(); document.body.innerHTML = '<img id="image">'; const run = vi.fn(async () => ({ state: 'no_candidate' as const })); const observer = observeCaptchaImages({ run }); const image = document.querySelector('#image') as HTMLImageElement;
    for (const change of [() => image.setAttribute('src', 'a'), () => image.setAttribute('srcset', 'b'), () => image.dispatchEvent(new Event('load'))]) { change(); await vi.advanceTimersByTimeAsync(150); }
    expect(run).toHaveBeenCalledTimes(4); observer.disconnect(); vi.useRealTimers();
  });
  it('requeues an existing image when its input or ancestor visibility context changes', async () => {
    vi.useFakeTimers(); document.body.innerHTML = '<form id="wrap"><img id="image" alt="captcha" width="120" height="40"></form>';
    const run = vi.fn(async () => ({ state: 'no_candidate' as const })); const observer = observeCaptchaImages({ run }); const wrap = document.querySelector('#wrap') as HTMLElement;
    wrap.append(document.createElement('input')); await Promise.resolve(); await vi.advanceTimersByTimeAsync(150);
    wrap.className = 'changed'; await Promise.resolve(); await vi.advanceTimersByTimeAsync(150);
    expect(run).toHaveBeenCalledTimes(3); observer.disconnect(); vi.useRealTimers();
  });
  it('does not requeue processed images for unrelated DOM additions', async () => {
    vi.useFakeTimers(); document.body.innerHTML = '<img><img><img>'; const run = vi.fn(async () => ({ state: 'no_candidate' as const })); const observer = observeCaptchaImages({ run });
    expect(run).toHaveBeenCalledTimes(3); document.body.append(document.createElement('span')); await Promise.resolve(); await vi.advanceTimersByTimeAsync(150);
    expect(run).toHaveBeenCalledTimes(3); observer.disconnect(); vi.useRealTimers();
  });
  it('requeues the associated image for field eligibility, label, and replacement changes', async () => {
    vi.useFakeTimers(); document.body.innerHTML = '<form id="form"><img id="image"><label id="label" for="field">Answer</label><input id="field"></form>';
    const run = vi.fn(async () => ({ state: 'no_candidate' as const })); const observer = observeCaptchaImages({ run }); const field = document.querySelector('#field') as HTMLInputElement; const label = document.querySelector('#label') as HTMLLabelElement; const form = document.querySelector('#form') as HTMLFormElement;
    const mutate = async (change: () => void) => { change(); await Promise.resolve(); await vi.advanceTimersByTimeAsync(150); };
    await mutate(() => { field.className = 'visible-state'; }); await mutate(() => { field.style.display = 'none'; }); await mutate(() => { field.disabled = true; }); await mutate(() => { field.readOnly = true; }); await mutate(() => { label.firstChild!.textContent = 'Verification code'; }); await mutate(() => { field.remove(); }); await mutate(() => { const replacement = document.createElement('input'); replacement.id = 'field'; form.append(replacement); });
    expect(run).toHaveBeenCalledTimes(8); observer.disconnect(); vi.useRealTimers();
  });
  it('requeues an image when its field is removed without replacement', async () => {
    vi.useFakeTimers(); document.body.innerHTML = '<form id="form"><img><input id="field"></form>'; const run = vi.fn(async () => ({ state: 'no_candidate' as const })); const observer = observeCaptchaImages({ run });
    (document.querySelector('#field') as HTMLInputElement).remove(); await Promise.resolve(); await vi.advanceTimersByTimeAsync(150);
    expect(run).toHaveBeenCalledTimes(2); observer.disconnect(); vi.useRealTimers();
  });
  it('uses a bounded visible-image fallback for a changed field outside the image container', async () => {
    vi.useFakeTimers(); document.body.innerHTML = '<section><img id="captcha"></section><div><input id="field"></div>'; const run = vi.fn(async () => ({ state: 'no_candidate' as const })); const observer = observeCaptchaImages({ run });
    (document.querySelector('#field') as HTMLInputElement).setAttribute('aria-label', 'Verification code'); await Promise.resolve(); await vi.advanceTimersByTimeAsync(150);
    expect(run).toHaveBeenCalledWith(document.querySelector('#captcha'), 'automatic'); expect(run).toHaveBeenCalledTimes(2); observer.disconnect(); vi.useRealTimers();
  });
});
