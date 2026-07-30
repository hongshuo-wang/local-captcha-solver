import { MAX_IMAGE_BYTES } from '../core/image-limits';

export { MAX_IMAGE_BYTES } from '../core/image-limits';

export type ImageUnavailableReason = 'cors' | 'permission' | 'type' | 'size' | 'network';

export type FetchedImage =
  | { state: 'ready'; bytes: Uint8Array; mimeType: string }
  | { state: 'image_unavailable'; reason: ImageUnavailableReason };

export interface ImageFetchAdapter {
  permissions: {
    contains(details: { origins: readonly string[] }): Promise<boolean>;
  };
  fetch(input: string, init: RequestInit): Promise<Response>;
}

export interface ImageFetcher {
  fetch(url: string): Promise<FetchedImage>;
}

function unavailable(reason: ImageUnavailableReason): FetchedImage {
  return { state: 'image_unavailable', reason };
}

function imageMimeType(contentType: string | null): string | undefined {
  const mimeType = contentType?.split(';', 1)[0]?.trim().toLowerCase();
  return mimeType?.startsWith('image/') && mimeType.length > 'image/'.length ? mimeType : undefined;
}

async function readBoundedBody(response: Response): Promise<Uint8Array | 'size' | 'network'> {
  const length = response.headers.get('content-length');
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > MAX_IMAGE_BYTES)) return 'size';

  try {
    const reader = response.body?.getReader();
    if (reader === undefined) {
      const bytes = new Uint8Array(await response.arrayBuffer());
      return bytes.length <= MAX_IMAGE_BYTES ? bytes : 'size';
    }

    const chunks: Uint8Array[] = [];
    let lengthRead = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      lengthRead += value.byteLength;
      if (lengthRead > MAX_IMAGE_BYTES) {
        await reader.cancel();
        return 'size';
      }
      chunks.push(value);
    }

    const bytes = new Uint8Array(lengthRead);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return bytes;
  } catch {
    return 'network';
  }
}

export function createImageFetcher(adapter: ImageFetchAdapter): ImageFetcher {
  return {
    async fetch(rawUrl: string): Promise<FetchedImage> {
      let url: URL;
      try {
        url = new URL(rawUrl);
      } catch {
        return unavailable('type');
      }
      if (url.protocol !== 'http:' && url.protocol !== 'https:') return unavailable('type');

      // Chromium match patterns cover every port and therefore use hostname, not host.
      const origin = `${url.protocol}//${url.hostname}/*`;
      try {
        if (!await adapter.permissions.contains({ origins: [origin] })) return unavailable('permission');
      } catch {
        return unavailable('permission');
      }

      let response: Response;
      try {
        response = await adapter.fetch(rawUrl, {
          credentials: 'include',
          cache: 'no-store',
          redirect: 'manual',
        });
      } catch {
        return unavailable('network');
      }
      if (response.redirected || response.type === 'opaqueredirect' || response.status >= 300 && response.status < 400 || !response.ok) {
        return unavailable('network');
      }

      const mimeType = imageMimeType(response.headers.get('content-type'));
      if (mimeType === undefined) return unavailable('type');

      const bytes = await readBoundedBody(response);
      if (bytes === 'size' || bytes === 'network') return unavailable(bytes);
      return { state: 'ready', bytes, mimeType };
    },
  };
}
