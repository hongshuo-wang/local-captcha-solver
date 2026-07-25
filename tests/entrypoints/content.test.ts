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
});
