import { afterEach, describe, expect, it, vi } from 'vitest';

const listener = vi.fn();
afterEach(() => { vi.resetModules(); vi.unstubAllGlobals(); listener.mockReset(); document.body.innerHTML = ''; });
describe('content runtime messages', () => {
  it('guards unknown messages and distinguishes zero from ambiguous visible image matches', async () => {
    vi.stubGlobal('defineContentScript', (value: unknown) => value);
    const { createRuntimeContent } = await import('../../entrypoints/content');
    createRuntimeContent({ sendMessage: vi.fn(), onMessage: { addListener: listener } });
    const handle = listener.mock.calls[0]?.[0] as (message: unknown) => unknown;
    expect(handle({ type: 'unknown' })).toBeUndefined(); expect(handle({ type: 'captcha:context-image', srcUrl: 'missing' })).toEqual({ state: 'no_candidate' });
    document.body.innerHTML = '<img src="https://example.test/captcha"><img hidden src="https://example.test/captcha"><img src="https://example.test/captcha">';
    expect(handle({ type: 'captcha:context-image', srcUrl: 'https://example.test/captcha' })).toMatchObject({ state: 'ambiguous_image', candidateIds: expect.any(Array) });
  });
  it('resolves one visible context image even when a hidden duplicate exists', async () => {
    vi.stubGlobal('defineContentScript', (value: unknown) => value); document.body.innerHTML = '<img src="data:image/png;base64,AQ=="><img hidden src="data:image/png;base64,AQ==">';
    const { createRuntimeContent } = await import('../../entrypoints/content'); createRuntimeContent({ sendMessage: vi.fn(async (message: { type: string }) => message.type === 'captcha:recognize' ? [{ mode: 'digits', text: '1', confidence: .9 }] : undefined), onMessage: { addListener: listener } });
    const handle = listener.mock.calls[0]?.[0] as (message: unknown) => Promise<unknown>;
    await expect(handle({ type: 'captcha:context-image', srcUrl: 'data:image/png;base64,AQ==' })).resolves.toMatchObject({ state: 'no_field' });
  });
  it('starts automatic observation only after an explicit enable message and stops it on disable', async () => {
    vi.useFakeTimers(); vi.stubGlobal('defineContentScript', (value: unknown) => value); document.body.innerHTML = '<img alt="captcha" width="120" height="40">';
    const { createRuntimeContent } = await import('../../entrypoints/content'); createRuntimeContent({ sendMessage: vi.fn(), onMessage: { addListener: listener } }); const handle = listener.mock.calls[0]?.[0] as (message: unknown) => unknown;
    expect(handle({ type: 'captcha:get-status' })).toEqual({ enabled: false }); expect(handle({ type: 'captcha:auto-enable' })).toEqual({ enabled: true }); expect(handle({ type: 'captcha:auto-disable' })).toEqual({ enabled: false }); vi.useRealTimers();
  });
  it('keeps the explicit status when an older automatic request finishes later', async () => {
    vi.stubGlobal('defineContentScript', (value: unknown) => value); document.body.innerHTML = '<form><img id="image" alt="captcha" width="120" height="40" src="data:image/png;base64,AQ=="><input aria-label="captcha"></form>';
    let release!: (value: unknown) => void; let signal!: () => void; const started = new Promise<void>((resolve) => { signal = resolve; }); let calls = 0; const sendMessage = vi.fn(() => { calls += 1; if (calls === 1) return new Promise((resolve) => { release = resolve; signal(); }); return Promise.resolve([{ mode: 'digits', text: '2', confidence: .9 }]); });
    const { createRuntimeContent } = await import('../../entrypoints/content'); const content = createRuntimeContent({ sendMessage, onMessage: { addListener: listener } }); const image = document.querySelector('#image') as HTMLImageElement;
    content.enable(); const automatic = content.workflow.run(image, 'automatic'); await started; expect(sendMessage).toHaveBeenCalledOnce();
    await content.workflow.run(image, 'explicit'); release([{ mode: 'digits', text: '1', confidence: .9 }]); await automatic;
    expect(document.querySelector('[data-local-captcha-status]')?.textContent).toBe('CAPTCHA answer filled.');
  });
  it('does not restore status when a pending explicit request resolves after disable', async () => {
    vi.stubGlobal('defineContentScript', (value: unknown) => value); document.body.innerHTML = '<img id="image" src="data:image/png;base64,AQ==">'; let release!: (value: unknown) => void; let signal!: () => void; const started = new Promise<void>((resolve) => { signal = resolve; });
    const sendMessage = vi.fn(() => new Promise((resolve) => { release = resolve; signal(); })); const { createRuntimeContent } = await import('../../entrypoints/content'); const content = createRuntimeContent({ sendMessage, onMessage: { addListener: listener } }); const image = document.querySelector('#image') as HTMLImageElement;
    const pending = content.workflow.run(image, 'explicit'); await started; content.disable(); release([{ mode: 'digits', text: '5', confidence: .9 }]); await pending;
    expect(document.querySelector('[data-local-captcha-status]')).toBeNull();
  });
});
