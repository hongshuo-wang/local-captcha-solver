import type {
  ImagePayload,
  ImagePreprocessor,
  ModelInput,
  OcrEngine,
  OcrResult,
  RecognitionMode,
} from '../core/types';
import { decodeArithmeticCtc } from './arithmetic-ctc-decoder';
import {
  ALLOWED_BY_MODE,
  OcrEngineError,
} from './ddddocr-engine';
import type { OcrSession, OcrSessionFactory } from './ddddocr-engine';

export interface PpOcrV6RuntimeConfig {
  readonly modelName: string;
  readonly imageShape: readonly [3, number, number];
  readonly charset: readonly string[];
}

const SUPPORTED_MODEL_NAMES = new Set(['PP-OCRv6_small_rec', 'captcha_ctc_tiny_71']);

function object(value: unknown, context: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${context} must be an object`);
  }
  return value as Record<string, unknown>;
}

export function parsePpOcrV6RuntimeConfig(value: unknown): PpOcrV6RuntimeConfig {
  const config = object(value, 'PP-OCRv6 runtime config');
  if (config.schemaVersion !== 1) throw new TypeError('PP-OCRv6 config schemaVersion must be 1');
  if (typeof config.modelName !== 'string' || !SUPPORTED_MODEL_NAMES.has(config.modelName)) {
    throw new TypeError('PP-OCRv6 config selects an unsupported model');
  }
  if (
    !Array.isArray(config.imageShape)
    || config.imageShape.length !== 3
    || config.imageShape[0] !== 3
    || config.imageShape.slice(1).some((dimension) => !Number.isSafeInteger(dimension) || dimension <= 0)
  ) {
    throw new TypeError('PP-OCRv6 imageShape must be [3, height, width]');
  }
  if (
    !Array.isArray(config.charset)
    || config.charset.length < 2
    || config.charset.some((character) => typeof character !== 'string')
    || config.charset[0] !== ''
  ) {
    throw new TypeError('PP-OCRv6 charset must be a blank-prefixed string array');
  }
  return {
    modelName: config.modelName,
    imageShape: config.imageShape as [3, number, number],
    charset: [...config.charset] as string[],
  };
}

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
  drawImage(image: BrowserImageBitmap, dx: number, dy: number, width: number, height: number): void;
  getImageData(x: number, y: number, width: number, height: number): { data: Uint8ClampedArray };
}

interface BrowserOffscreenCanvas {
  getContext(type: '2d'): BrowserCanvasContext | null;
}

export interface PpOcrV6ImagePrimitives {
  createImageBitmap(blob: Blob): Promise<BrowserImageBitmap>;
  createOffscreenCanvas(width: number, height: number): BrowserOffscreenCanvas;
}

const defaultPrimitives: PpOcrV6ImagePrimitives = {
  async createImageBitmap(blob) {
    if (typeof globalThis.createImageBitmap !== 'function') throw new Error('createImageBitmap is unavailable');
    return globalThis.createImageBitmap(blob);
  },
  createOffscreenCanvas(width, height) {
    if (typeof globalThis.OffscreenCanvas !== 'function') throw new Error('OffscreenCanvas is unavailable');
    return new globalThis.OffscreenCanvas(width, height) as unknown as BrowserOffscreenCanvas;
  },
};

function positiveInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

export function rgbaToPpOcrV6Tensor(
  rgba: Uint8ClampedArray,
  resizedWidth: number,
  height: number,
  targetWidth: number,
): Float32Array {
  if (!positiveInteger(resizedWidth) || !positiveInteger(height) || !positiveInteger(targetWidth)) {
    throw new RangeError('PP-OCRv6 tensor dimensions must be positive integers');
  }
  if (resizedWidth > targetWidth || rgba.length !== resizedWidth * height * 4) {
    throw new RangeError('PP-OCRv6 RGBA data must match the resized dimensions');
  }
  const plane = height * targetWidth;
  const tensor = new Float32Array(3 * plane);
  for (let row = 0; row < height; row += 1) {
    for (let column = 0; column < resizedWidth; column += 1) {
      const source = (row * resizedWidth + column) * 4;
      const target = row * targetWidth + column;
      const alpha = rgba[source + 3] / 255;
      const inverseAlpha = 1 - alpha;
      const red = rgba[source] * alpha + 255 * inverseAlpha;
      const green = rgba[source + 1] * alpha + 255 * inverseAlpha;
      const blue = rgba[source + 2] * alpha + 255 * inverseAlpha;
      tensor[target] = blue / 127.5 - 1;
      tensor[plane + target] = green / 127.5 - 1;
      tensor[2 * plane + target] = red / 127.5 - 1;
    }
  }
  return tensor;
}

export class BrowserPpOcrV6Preprocessor implements ImagePreprocessor {
  constructor(
    private readonly imageShape: readonly [3, number, number],
    private readonly primitives: PpOcrV6ImagePrimitives = defaultPrimitives,
  ) {}

  async prepare(image: ImagePayload): Promise<ModelInput> {
    if (!(image.bytes instanceof Uint8Array) || image.bytes.length === 0) {
      throw new TypeError('Image bytes must be a nonempty Uint8Array');
    }
    if (typeof image.mimeType !== 'string' || image.mimeType.trim() === '') {
      throw new TypeError('Image MIME type must be nonempty');
    }
    const [, targetHeight, baseWidth] = this.imageShape;
    const blob = new Blob([new Uint8Array(image.bytes)], { type: image.mimeType });
    const bitmap = await this.primitives.createImageBitmap(blob);
    try {
      if (!positiveInteger(bitmap.width) || !positiveInteger(bitmap.height)) {
        throw new RangeError('Decoded image dimensions must be positive integers');
      }
      const ratio = bitmap.width / bitmap.height;
      const targetWidth = Math.min(3200, Math.max(baseWidth, Math.trunc(targetHeight * ratio)));
      const resizedWidth = Math.min(targetWidth, Math.ceil(targetHeight * ratio));
      const canvas = this.primitives.createOffscreenCanvas(resizedWidth, targetHeight);
      const context = canvas.getContext('2d');
      if (context === null) throw new Error('OffscreenCanvas 2D context is unavailable');
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, resizedWidth, targetHeight);
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = 'high';
      context.drawImage(bitmap, 0, 0, resizedWidth, targetHeight);
      const rgba = context.getImageData(0, 0, resizedWidth, targetHeight).data;
      return {
        data: rgbaToPpOcrV6Tensor(rgba, resizedWidth, targetHeight, targetWidth),
        dims: [1, 3, targetHeight, targetWidth],
      };
    } finally {
      bitmap.close();
    }
  }
}

export function decodePpOcrV6Ctc(
  probabilities: Float32Array,
  dims: readonly number[],
  charset: readonly string[],
  allowed: ReadonlySet<string>,
): { readonly text: string; readonly confidence: number } {
  if (dims.length !== 3 || dims[0] !== 1) {
    throw new RangeError('PP-OCRv6 output dimensions must be [1, time, classes]');
  }
  const [, time, classes] = dims;
  if (!positiveInteger(time) || !positiveInteger(classes)) {
    throw new RangeError('PP-OCRv6 time and class dimensions must be positive integers');
  }
  if (charset.length !== classes || probabilities.length !== time * classes || charset[0] !== '') {
    throw new RangeError('PP-OCRv6 probabilities and charset must match the class dimension');
  }
  const candidates = [0];
  for (let index = 1; index < classes; index += 1) {
    if (allowed.has(charset[index])) candidates.push(index);
  }
  let previous = 0;
  const characters: string[] = [];
  const confidences: number[] = [];
  for (let step = 0; step < time; step += 1) {
    const offset = step * classes;
    let selected = candidates[0];
    let probability = probabilities[offset + selected];
    for (let index = 0; index < classes; index += 1) {
      if (!Number.isFinite(probabilities[offset + index])) {
        throw new RangeError('PP-OCRv6 probabilities must be finite');
      }
    }
    for (let index = 1; index < candidates.length; index += 1) {
      const candidate = candidates[index];
      if (probabilities[offset + candidate] > probability) {
        selected = candidate;
        probability = probabilities[offset + candidate];
      }
    }
    if (selected === 0) {
      previous = 0;
    } else if (selected === previous) {
      confidences[confidences.length - 1] = Math.max(confidences.at(-1) ?? 0, probability);
    } else {
      characters.push(charset[selected]);
      confidences.push(probability);
      previous = selected;
    }
  }
  return {
    text: characters.join(''),
    confidence: confidences.length === 0
      ? 0
      : confidences.reduce((sum, value) => sum + value, 0) / confidences.length,
  };
}

export function decodePpOcrV6ArithmeticCtc(
  probabilities: Float32Array,
  dims: readonly number[],
  charset: readonly string[],
): { readonly text: string; readonly confidence: number; readonly requiresConfirmation?: boolean } | null {
  const logProbabilities = new Float32Array(probabilities.length);
  for (let index = 0; index < probabilities.length; index += 1) {
    const probability = probabilities[index];
    if (!Number.isFinite(probability) || probability < 0) {
      throw new RangeError('PP-OCRv6 probabilities must be finite and nonnegative');
    }
    logProbabilities[index] = Math.log(Math.max(probability, Number.MIN_VALUE));
  }
  return decodeArithmeticCtc(logProbabilities, dims, charset);
}

export function decodePpOcrV6ForMode(
  probabilities: Float32Array,
  dims: readonly number[],
  charset: readonly string[],
  mode: RecognitionMode,
): { readonly text: string; readonly confidence: number; readonly requiresConfirmation?: boolean } {
  const greedy = decodePpOcrV6Ctc(probabilities, dims, charset, ALLOWED_BY_MODE[mode]);
  return mode === 'arithmetic'
    ? (decodePpOcrV6ArithmeticCtc(probabilities, dims, charset) ?? greedy)
    : greedy;
}

function singleOutput(outputs: Awaited<ReturnType<OcrSession['run']>>) {
  const values = Object.values(outputs);
  if (values.length !== 1) throw new RangeError('PP-OCRv6 session must return exactly one output');
  return values[0];
}

export class PpOcrV6Engine implements OcrEngine {
  private sessionPromise: Promise<OcrSession> | undefined;

  constructor(
    private readonly sessionFactory: OcrSessionFactory,
    private readonly modelUrl: string,
    private readonly charset: readonly string[],
    private readonly preprocessor: ImagePreprocessor,
  ) {}

  async recognize(image: ImagePayload, modes: readonly RecognitionMode[]): Promise<readonly OcrResult[]> {
    const uniqueModes = [...new Set(modes)];
    if (uniqueModes.length === 0) return [];
    let input: ModelInput;
    try {
      input = await this.preprocessor.prepare(image);
    } catch (cause) {
      throw new OcrEngineError('image_unavailable', 'Image preprocessing failed', cause);
    }
    try {
      const session = await this.getSession();
      const output = singleOutput(await session.run({ x: input }));
      return uniqueModes.map((mode) => ({
        ...decodePpOcrV6ForMode(output.data, output.dims, this.charset, mode),
        mode,
      }));
    } catch (cause) {
      if (cause instanceof OcrEngineError) throw cause;
      throw new OcrEngineError('model_unavailable', 'PP-OCRv6 model inference failed', cause);
    }
  }

  private getSession(): Promise<OcrSession> {
    if (this.sessionPromise !== undefined) return this.sessionPromise;
    const promise = Promise.resolve()
      .then(() => this.sessionFactory.create(this.modelUrl))
      .catch((cause: unknown) => {
        if (this.sessionPromise === promise) this.sessionPromise = undefined;
        throw new OcrEngineError('model_unavailable', 'PP-OCRv6 model creation failed', cause);
      });
    this.sessionPromise = promise;
    return promise;
  }
}
