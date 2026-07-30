import { describe, expect, it, vi } from 'vitest';

import { MAX_IMAGE_BYTES, createImageFetcher } from '../../src/background/image-fetch';

function imageResponse(bytes = new Uint8Array([1, 2, 3]), init: ResponseInit = {}): Response {
  return new Response(bytes, {
    status: 200,
    headers: { 'content-type': 'image/png', ...init.headers },
    ...init,
  });
}

function harness(response: Response | Error, granted = true) {
  const fetch = vi.fn(async () => {
    if (response instanceof Error) throw response;
    return response;
  });
  const contains = vi.fn(async () => granted);
  return {
    fetch,
    contains,
    fetcher: createImageFetcher({
      permissions: { contains },
      fetch,
    }),
  };
}

describe('createImageFetcher', () => {
  it('fetches a granted http image with credential-preserving, uncached, manual redirects', async () => {
    const { fetcher, fetch, contains } = harness(imageResponse());

    await expect(fetcher.fetch('https://captcha.example.test/image.png')).resolves.toMatchObject({
      state: 'ready', mimeType: 'image/png', bytes: new Uint8Array([1, 2, 3]),
    });
    expect(contains).toHaveBeenCalledWith({ origins: ['https://captcha.example.test/*'] });
    expect(fetch).toHaveBeenCalledWith('https://captcha.example.test/image.png', {
      credentials: 'include', cache: 'no-store', redirect: 'manual',
    });
  });

  it('checks a port page image with a valid portless Chromium match pattern', async () => {
    const { fetcher, fetch, contains } = harness(imageResponse());

    await expect(fetcher.fetch('http://172.26.54.105:9000/12345Branch/oauth/code/id')).resolves.toMatchObject({ state: 'ready' });
    expect(contains).toHaveBeenCalledWith({ origins: ['http://172.26.54.105/*'] });
    expect(fetch).toHaveBeenCalledWith('http://172.26.54.105:9000/12345Branch/oauth/code/id', expect.objectContaining({ credentials: 'include' }));
  });

  it.each([
    ['ftp://captcha.example.test/image.png', true, imageResponse(), 'type'],
    ['https://captcha.example.test/image.png', false, imageResponse(), 'permission'],
    ['https://captcha.example.test/image.png', true, new Response('not an image', { headers: { 'content-type': 'text/html' } }), 'type'],
    ['https://captcha.example.test/image.png', true, new Response('not an image', { headers: { 'content-type': 'image/' } }), 'type'],
    ['https://captcha.example.test/image.png', true, new Response(null, { status: 302, headers: { location: 'https://elsewhere.test/' } }), 'network'],
    ['https://captcha.example.test/image.png', true, new Error('offline'), 'network'],
  ] as const)('maps %s failures to %s', async (url, granted, response, reason) => {
    const { fetcher } = harness(response, granted);
    await expect(fetcher.fetch(url)).resolves.toEqual({ state: 'image_unavailable', reason });
  });

  it('rejects declared and streamed bodies larger than the 2 MiB limit', async () => {
    const declared = harness(imageResponse(new Uint8Array([1]), { headers: { 'content-type': 'image/png', 'content-length': String(MAX_IMAGE_BYTES + 1) } }));
    await expect(declared.fetcher.fetch('https://captcha.example.test/image.png')).resolves.toEqual({ state: 'image_unavailable', reason: 'size' });
    expect(declared.fetch).toHaveBeenCalledOnce();

    const oversized = harness(imageResponse(new Uint8Array(MAX_IMAGE_BYTES + 1)));
    await expect(oversized.fetcher.fetch('https://captcha.example.test/image.png')).resolves.toEqual({ state: 'image_unavailable', reason: 'size' });
  });
});
