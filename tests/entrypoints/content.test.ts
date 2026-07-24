import { afterEach, describe, expect, it, vi } from 'vitest';

const listener = vi.fn();
afterEach(() => { vi.resetModules(); vi.unstubAllGlobals(); listener.mockReset(); document.body.innerHTML = ''; });
describe('content runtime messages', () => {
  it('guards unknown messages and returns a serializable ambiguous image result', async () => {
    vi.stubGlobal('defineContentScript', (value: unknown) => value);
    const { createRuntimeContent } = await import('../../entrypoints/content');
    createRuntimeContent({ sendMessage: vi.fn(), onMessage: { addListener: listener } });
    const handle = listener.mock.calls[0]?.[0] as (message: unknown) => unknown;
    expect(handle({ type: 'unknown' })).toBeUndefined(); expect(handle({ type: 'captcha:context-image', srcUrl: 'missing' })).toEqual({ state: 'ambiguous_image', candidateIds: [] });
  });
});
