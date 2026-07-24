export const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

export type ImageUnavailableReason = 'cors' | 'permission' | 'type' | 'size' | 'network';

export type RemoteImageResult =
  | { state: 'ready'; bytes: Uint8Array; mimeType: string }
  | { state: 'image_unavailable'; reason: ImageUnavailableReason };

export type ImageAcquisitionResult =
  | { state: 'ready'; dataUrl: string; mimeType: string; revision: string }
  | { state: 'image_unavailable'; reason: ImageUnavailableReason };

export interface ImageSourcePrimitives {
  fetch?: (input: string) => Promise<Response>;
  fetchRemote?: (url: string) => Promise<RemoteImageResult>;
  pageOrigin?: string;
  toDataUrl?: (image: HTMLImageElement) => string;
  crypto?: Pick<Crypto, 'subtle'>;
}

function unavailable(reason: ImageUnavailableReason): ImageAcquisitionResult {
  return { state: 'image_unavailable', reason };
}

function validImageMimeType(value: string): string | undefined {
  const mimeType = value.trim().toLowerCase();
  return mimeType.startsWith('image/') && mimeType.length > 'image/'.length ? mimeType : undefined;
}

function decodeBase64(value: string): Uint8Array | undefined {
  try {
    const binary = globalThis.atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes;
  } catch {
    return undefined;
  }
}

function encodeBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return globalThis.btoa(binary);
}

function parseDataUrl(dataUrl: string): { bytes: Uint8Array; mimeType: string } | ImageAcquisitionResult {
  if (dataUrl.length > MAX_IMAGE_BYTES) return unavailable('size');
  const match = /^data:([^;,]+)(;base64)?,([\s\S]*)$/i.exec(dataUrl);
  if (match === null) return unavailable('type');
  const mimeType = validImageMimeType(match[1]);
  if (mimeType === undefined) return unavailable('type');

  let bytes: Uint8Array | undefined;
  if (match[2]?.toLowerCase() === ';base64') {
    bytes = decodeBase64(match[3]);
  } else {
    try {
      bytes = new TextEncoder().encode(decodeURIComponent(match[3]));
    } catch {
      return unavailable('type');
    }
  }
  if (bytes === undefined) return unavailable('type');
  if (bytes.length > MAX_IMAGE_BYTES) return unavailable('size');
  return { bytes, mimeType };
}

async function revisionFor(bytes: Uint8Array, crypto: Pick<Crypto, 'subtle'> | undefined): Promise<string | undefined> {
  if (crypto?.subtle === undefined) return undefined;
  try {
    const copy = new Uint8Array(bytes.length);
    copy.set(bytes);
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', copy.buffer));
    return [...digest].map((value) => value.toString(16).padStart(2, '0')).join('');
  } catch {
    return undefined;
  }
}

async function readyFromDataUrl(
  dataUrl: string,
  parsed: { bytes: Uint8Array; mimeType: string },
  crypto: Pick<Crypto, 'subtle'> | undefined,
): Promise<ImageAcquisitionResult> {
  const revision = await revisionFor(parsed.bytes, crypto);
  if (revision === undefined) return unavailable('network');
  return { state: 'ready', dataUrl, mimeType: parsed.mimeType, revision };
}

async function readBlobResponse(response: Response): Promise<{ bytes: Uint8Array; mimeType: string } | ImageAcquisitionResult> {
  const mimeType = validImageMimeType(response.headers.get('content-type') ?? '');
  if (!response.ok || mimeType === undefined) return unavailable('type');
  const declaredLength = response.headers.get('content-length');
  if (declaredLength !== null && (!/^\d+$/.test(declaredLength) || Number(declaredLength) > MAX_IMAGE_BYTES)) return unavailable('size');
  try {
    const reader = response.body?.getReader();
    if (reader === undefined) {
      const bytes = new Uint8Array(await response.arrayBuffer());
      return bytes.length <= MAX_IMAGE_BYTES ? { bytes, mimeType } : unavailable('size');
    }

    const chunks: Uint8Array[] = [];
    let length = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_IMAGE_BYTES) {
        await reader.cancel();
        return unavailable('size');
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return { bytes, mimeType };
  } catch {
    return unavailable('cors');
  }
}

function defaultCanvasDataUrl(image: HTMLImageElement): string {
  const width = image.naturalWidth || image.width;
  const height = image.naturalHeight || image.height;
  if (width <= 0 || height <= 0) throw new Error('Image dimensions are unavailable');
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (context === null) throw new Error('Canvas 2D context is unavailable');
  context.drawImage(image, 0, 0);
  return canvas.toDataURL();
}

async function readyFromBytes(bytes: Uint8Array, mimeType: string, crypto: Pick<Crypto, 'subtle'> | undefined): Promise<ImageAcquisitionResult> {
  if (bytes.length > MAX_IMAGE_BYTES) return unavailable('size');
  const imageMimeType = validImageMimeType(mimeType);
  if (imageMimeType === undefined) return unavailable('type');
  const dataUrl = `data:${imageMimeType};base64,${encodeBase64(bytes)}`;
  if (dataUrl.length > MAX_IMAGE_BYTES) return unavailable('size');
  const revision = await revisionFor(bytes, crypto);
  if (revision === undefined) return unavailable('network');
  return {
    state: 'ready',
    dataUrl,
    mimeType: imageMimeType,
    revision,
  };
}

function isUnavailable(result: { bytes: Uint8Array; mimeType: string } | ImageAcquisitionResult): result is ImageAcquisitionResult {
  return 'state' in result;
}

export async function acquireImage(image: HTMLImageElement, primitives: ImageSourcePrimitives = {}): Promise<ImageAcquisitionResult> {
  const src = image.currentSrc || image.src;
  if (src.length === 0) return unavailable('type');
  const crypto = primitives.crypto ?? globalThis.crypto;

  if (src.startsWith('data:')) {
    const parsed = parseDataUrl(src);
    if (isUnavailable(parsed)) return parsed;
    return readyFromDataUrl(src, parsed, crypto);
  }

  if (src.startsWith('blob:')) {
    if (src.length > MAX_IMAGE_BYTES) return unavailable('size');
    try {
      const response = await (primitives.fetch ?? globalThis.fetch)(src);
      const parsed = await readBlobResponse(response);
      return isUnavailable(parsed) ? parsed : readyFromBytes(parsed.bytes, parsed.mimeType, crypto);
    } catch {
      return unavailable('cors');
    }
  }

  let url: URL;
  try {
    url = new URL(src);
  } catch {
    return unavailable('type');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return unavailable('type');

  const pageOrigin = primitives.pageOrigin ?? globalThis.location?.origin;
  if (url.origin === pageOrigin) {
    try {
      const dataUrl = (primitives.toDataUrl ?? defaultCanvasDataUrl)(image);
      const parsed = parseDataUrl(dataUrl);
      if (isUnavailable(parsed)) return parsed;
      return readyFromDataUrl(dataUrl, parsed, crypto);
    } catch {
      // A tainted canvas must use the permission-aware background route.
    }
  }

  if (primitives.fetchRemote === undefined) return unavailable('cors');
  try {
    const remote = await primitives.fetchRemote(src);
    return remote.state === 'image_unavailable'
      ? remote
      : readyFromBytes(remote.bytes, remote.mimeType, crypto);
  } catch {
    return unavailable('network');
  }
}
