import { describe, expect, it, vi } from 'vitest';

import { MAX_IMAGE_BYTES } from '../../src/background/image-fetch';
import { acquireImage } from '../../src/content/image-source';

function image(src: string): HTMLImageElement {
  const element = document.createElement('img');
  element.src = src;
  return element;
}

describe('acquireImage', () => {
  it('acquires image data URLs and produces a stable SHA-256 revision', async () => {
    const result = await acquireImage(image('data:image/png;base64,AQID'));

    expect(result).toEqual({
      state: 'ready',
      dataUrl: 'data:image/png;base64,AQID',
      mimeType: 'image/png',
      revision: '039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81',
    });
  });

  it('accepts case-insensitive base64 data URLs and rejects malformed encoded data', async () => {
    await expect(acquireImage(image('data:image/png;BASE64,AQID'))).resolves.toMatchObject({
      state: 'ready', mimeType: 'image/png',
    });
    await expect(acquireImage(image('data:image/png,%zz'))).resolves.toEqual({
      state: 'image_unavailable', reason: 'type',
    });
  });

  it('acquires blob URLs through its injected fetch primitive', async () => {
    const fetch = vi.fn(async () => new Response(new Uint8Array([4, 5]), { headers: { 'content-type': 'image/gif' } }));

    await expect(acquireImage(image('blob:https://page.example.test/captcha'), { fetch })).resolves.toMatchObject({
      state: 'ready', dataUrl: 'data:image/gif;base64,BAU=', mimeType: 'image/gif',
    });
  });

  it('bounds blob streams before reading an oversized response into an ArrayBuffer', async () => {
    const cancel = vi.fn(async () => undefined);
    const reader = {
      read: vi.fn(async () => ({ done: false, value: new Uint8Array(MAX_IMAGE_BYTES + 1) })),
      cancel,
    };
    const response = {
      ok: true,
      headers: new Headers({ 'content-type': 'image/png' }),
      body: { getReader: () => reader },
      arrayBuffer: vi.fn(async () => { throw new Error('must not read whole body'); }),
    } as unknown as Response;

    await expect(acquireImage(image('blob:https://page.example.test/captcha'), { fetch: async () => response })).resolves.toEqual({
      state: 'image_unavailable', reason: 'size',
    });
    expect(cancel).toHaveBeenCalledOnce();
  });

  it('converts same-origin images with the injected canvas converter', async () => {
    const toDataUrl = vi.fn(() => 'data:image/jpeg;base64,Bgc=');

    await expect(acquireImage(image('https://page.example.test/captcha.jpg'), {
      pageOrigin: 'https://page.example.test', toDataUrl,
    })).resolves.toMatchObject({ state: 'ready', mimeType: 'image/jpeg' });
    expect(toDataUrl).toHaveBeenCalledOnce();
  });

  it('uses the permission-aware fallback after a same-origin canvas CORS failure', async () => {
    const fetchRemote = vi.fn(async () => ({ state: 'image_unavailable' as const, reason: 'permission' as const }));

    await expect(acquireImage(image('https://page.example.test/captcha.jpg'), {
      pageOrigin: 'https://page.example.test',
      toDataUrl: () => { throw new Error('tainted canvas'); },
      fetchRemote,
    })).resolves.toEqual({ state: 'image_unavailable', reason: 'permission' });
    expect(fetchRemote).toHaveBeenCalledWith('https://page.example.test/captcha.jpg');
  });

  it('routes remote origins only through the permission-aware fallback', async () => {
    const fetch = vi.fn();
    const fetchRemote = vi.fn(async () => ({ state: 'image_unavailable' as const, reason: 'cors' as const }));

    await expect(acquireImage(image('https://cdn.example.test/captcha.jpg'), {
      pageOrigin: 'https://page.example.test', fetch, fetchRemote,
    })).resolves.toEqual({ state: 'image_unavailable', reason: 'cors' });
    expect(fetch).not.toHaveBeenCalled();
    expect(fetchRemote).toHaveBeenCalledOnce();
  });

  it('does not trust a remote fallback result with a non-image MIME type', async () => {
    await expect(acquireImage(image('https://cdn.example.test/captcha'), {
      pageOrigin: 'https://page.example.test',
      fetchRemote: async () => ({ state: 'ready', bytes: new Uint8Array([1]), mimeType: 'text/plain' }),
    })).resolves.toEqual({ state: 'image_unavailable', reason: 'type' });
  });

  it.each([
    ['data:text/plain;base64,AA==', 'type'],
    [`data:image/png;base64,${'A'.repeat(MAX_IMAGE_BYTES + 1)}`, 'size'],
  ] as const)('rejects invalid data URL %s as %s', async (src, reason) => {
    await expect(acquireImage(image(src))).resolves.toEqual({ state: 'image_unavailable', reason });
  });
});
