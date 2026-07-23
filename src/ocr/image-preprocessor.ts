import type {
  ImagePayload,
  ImagePreprocessor,
  ModelInput,
} from '../core/types';

const TARGET_HEIGHT = 64;

interface BrowserImageBitmap {
  readonly width: number;
  readonly height: number;
  close(): void;
}

interface BrowserCanvasContext {
  fillStyle: string;
  imageSmoothingEnabled: boolean;
  imageSmoothingQuality: ImageSmoothingQuality;
  fillRect(x: number, y: number, width: number, height: number): void;
  drawImage(
    image: BrowserImageBitmap,
    dx: number,
    dy: number,
    dWidth: number,
    dHeight: number,
  ): void;
  getImageData(x: number, y: number, width: number, height: number): {
    data: Uint8ClampedArray;
  };
}

interface BrowserOffscreenCanvas {
  getContext(type: '2d'): BrowserCanvasContext | null;
}

export interface BrowserImagePrimitives {
  createImageBitmap(blob: Blob): Promise<BrowserImageBitmap>;
  createOffscreenCanvas(width: number, height: number): BrowserOffscreenCanvas;
}

const defaultBrowserPrimitives: BrowserImagePrimitives = {
  async createImageBitmap(blob) {
    if (typeof globalThis.createImageBitmap !== 'function') {
      throw new Error('createImageBitmap is unavailable');
    }
    return globalThis.createImageBitmap(blob);
  },
  createOffscreenCanvas(width, height) {
    if (typeof globalThis.OffscreenCanvas !== 'function') {
      throw new Error('OffscreenCanvas is unavailable');
    }
    return new globalThis.OffscreenCanvas(width, height) as unknown as BrowserOffscreenCanvas;
  },
};

function isPositiveInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

export function rgbaToModelTensor(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
): Float32Array {
  if (!isPositiveInteger(width) || !isPositiveInteger(height)) {
    throw new RangeError('RGBA dimensions must be positive integers');
  }

  const pixelCount = width * height;
  if (!Number.isSafeInteger(pixelCount) || rgba.length !== pixelCount * 4) {
    throw new RangeError('RGBA length must exactly match width * height * 4');
  }

  const tensor = new Float32Array(pixelCount);
  for (let pixelIndex = 0; pixelIndex < pixelCount; pixelIndex += 1) {
    const rgbaIndex = pixelIndex * 4;
    const alpha = rgba[rgbaIndex + 3] / 255;
    const inverseAlpha = 1 - alpha;
    const red = rgba[rgbaIndex] * alpha + 255 * inverseAlpha;
    const green = rgba[rgbaIndex + 1] * alpha + 255 * inverseAlpha;
    const blue = rgba[rgbaIndex + 2] * alpha + 255 * inverseAlpha;
    const luminance = 0.2126 * red + 0.7152 * green + 0.0722 * blue;
    tensor[pixelIndex] = (luminance / 255 - 0.5) / 0.5;
  }

  return tensor;
}

export class BrowserImagePreprocessor implements ImagePreprocessor {
  constructor(private readonly primitives: BrowserImagePrimitives = defaultBrowserPrimitives) {}

  async prepare(image: ImagePayload): Promise<ModelInput> {
    if (!(image.bytes instanceof Uint8Array) || image.bytes.length === 0) {
      throw new TypeError('Image bytes must be a nonempty Uint8Array');
    }
    if (typeof image.mimeType !== 'string' || image.mimeType.trim().length === 0) {
      throw new TypeError('Image MIME type must be nonempty');
    }

    const blob = new Blob([new Uint8Array(image.bytes)], { type: image.mimeType });
    const bitmap = await this.primitives.createImageBitmap(blob);

    try {
      if (!isPositiveInteger(bitmap.width) || !isPositiveInteger(bitmap.height)) {
        throw new RangeError('Decoded image dimensions must be positive integers');
      }

      const targetWidth = Math.max(
        1,
        Math.floor((bitmap.width * TARGET_HEIGHT) / bitmap.height),
      );
      if (!isPositiveInteger(targetWidth)) {
        throw new RangeError('Target image dimensions must be positive integers');
      }

      const canvas = this.primitives.createOffscreenCanvas(targetWidth, TARGET_HEIGHT);
      const context = canvas.getContext('2d');
      if (context === null) {
        throw new Error('OffscreenCanvas 2D context is unavailable');
      }

      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, targetWidth, TARGET_HEIGHT);
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = 'high';
      context.drawImage(bitmap, 0, 0, targetWidth, TARGET_HEIGHT);

      const rgba = context.getImageData(0, 0, targetWidth, TARGET_HEIGHT).data;
      return {
        data: rgbaToModelTensor(rgba, targetWidth, TARGET_HEIGHT),
        dims: [1, 1, TARGET_HEIGHT, targetWidth],
      };
    } finally {
      bitmap.close();
    }
  }
}
