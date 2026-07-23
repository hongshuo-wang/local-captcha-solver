import { describe, expect, it, vi } from 'vitest';

import type { ImagePayload } from '../../src/core/types';
import {
  BrowserImagePreprocessor,
  rgbaToModelTensor,
} from '../../src/ocr/image-preprocessor';
import type { BrowserImagePrimitives } from '../../src/ocr/image-preprocessor';

describe('rgbaToModelTensor', () => {
  it('normalizes white and black pixels to one and negative one', () => {
    expect(
      Array.from(
        rgbaToModelTensor(new Uint8ClampedArray([255, 255, 255, 255, 0, 0, 0, 255]), 2, 1),
      ),
    ).toEqual([1, -1]);
  });

  it('uses Rec. 709 luminance for color pixels', () => {
    const result = rgbaToModelTensor(
      new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255]),
      3,
      1,
    );

    expect(result[0]).toBeCloseTo(2 * 0.2126 - 1, 6);
    expect(result[1]).toBeCloseTo(2 * 0.7152 - 1, 6);
    expect(result[2]).toBeCloseTo(2 * 0.0722 - 1, 6);
  });

  it('alpha-composites transparent and partially transparent pixels onto white', () => {
    const result = rgbaToModelTensor(
      new Uint8ClampedArray([0, 0, 0, 0, 0, 0, 0, 128]),
      2,
      1,
    );

    expect(result[0]).toBe(1);
    expect(result[1]).toBeCloseTo(2 * (127 / 255) - 1, 6);
  });

  it.each([
    [0, 1],
    [-1, 1],
    [1.5, 1],
    [Number.NaN, 1],
    [1, 0],
    [1, -1],
    [1, 1.5],
    [1, Number.POSITIVE_INFINITY],
  ])('rejects invalid dimensions %s by %s', (width, height) => {
    expect(() => rgbaToModelTensor(new Uint8ClampedArray(), width, height)).toThrow(RangeError);
  });

  it('rejects RGBA data whose length does not exactly match the dimensions', () => {
    expect(() => rgbaToModelTensor(new Uint8ClampedArray(7), 2, 1)).toThrow(/length/i);
    expect(() => rgbaToModelTensor(new Uint8ClampedArray(9), 2, 1)).toThrow(/length/i);
  });

  it('does not mutate RGBA input', () => {
    const rgba = new Uint8ClampedArray([10, 20, 30, 40]);
    const before = new Uint8ClampedArray(rgba);

    rgbaToModelTensor(rgba, 1, 1);

    expect(rgba).toEqual(before);
  });
});

describe('BrowserImagePreprocessor', () => {
  function createHarness(options?: {
    sourceWidth?: number;
    sourceHeight?: number;
    contextAvailable?: boolean;
    pixels?: Uint8ClampedArray;
  }) {
    const bitmap = {
      width: options?.sourceWidth ?? 10,
      height: options?.sourceHeight ?? 4,
      close: vi.fn(),
    };
    const context = {
      fillStyle: '',
      imageSmoothingEnabled: false,
      imageSmoothingQuality: 'low',
      fillRect: vi.fn(),
      drawImage: vi.fn(),
      getImageData: vi.fn(() => ({
        data: options?.pixels ?? new Uint8ClampedArray(160 * 64 * 4).fill(255),
      })),
    };
    const canvas = {
      getContext: vi.fn(() => (options?.contextAvailable === false ? null : context)),
    };
    const primitives = {
      createImageBitmap: vi.fn(async (_blob: Blob) => bitmap),
      createOffscreenCanvas: vi.fn((_width: number, _height: number) => canvas),
    } as unknown as BrowserImagePrimitives;

    return { bitmap, canvas, context, primitives };
  }

  const image: ImagePayload = {
    bytes: new Uint8Array([1, 2, 3]),
    mimeType: 'image/png',
    revision: 'r1',
  };

  it('decodes a Blob, scales to height 64, draws onto white, and returns deterministic dims', async () => {
    const harness = createHarness();
    const preprocessor = new BrowserImagePreprocessor(harness.primitives);

    const result = await preprocessor.prepare(image);

    expect(harness.primitives.createImageBitmap).toHaveBeenCalledOnce();
    const blob = vi.mocked(harness.primitives.createImageBitmap).mock.calls[0][0];
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe('image/png');
    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(image.bytes);
    expect(harness.primitives.createOffscreenCanvas).toHaveBeenCalledWith(160, 64);
    expect(harness.canvas.getContext).toHaveBeenCalledWith('2d');
    expect(harness.context.fillStyle).toBe('#ffffff');
    expect(harness.context.fillRect).toHaveBeenCalledWith(0, 0, 160, 64);
    expect(harness.context.imageSmoothingEnabled).toBe(true);
    expect(harness.context.imageSmoothingQuality).toBe('high');
    expect(harness.context.drawImage).toHaveBeenCalledWith(harness.bitmap, 0, 0, 160, 64);
    expect(harness.context.getImageData).toHaveBeenCalledWith(0, 0, 160, 64);
    expect(result.dims).toEqual([1, 1, 64, 160]);
    expect(result.data).toHaveLength(160 * 64);
    expect(result.data[0]).toBe(1);
    expect(harness.bitmap.close).toHaveBeenCalledOnce();
  });

  it('uses a minimum target width of one', async () => {
    const harness = createHarness({
      sourceWidth: 1,
      sourceHeight: 1000,
      pixels: new Uint8ClampedArray(64 * 4).fill(255),
    });

    const result = await new BrowserImagePreprocessor(harness.primitives).prepare(image);

    expect(result.dims).toEqual([1, 1, 64, 1]);
    expect(harness.primitives.createOffscreenCanvas).toHaveBeenCalledWith(1, 64);
  });

  it.each([
    [{ ...image, bytes: new Uint8Array() }, /bytes/i],
    [{ ...image, mimeType: '' }, /mime/i],
    [{ ...image, mimeType: '   ' }, /mime/i],
  ] as const)('rejects invalid image payloads before decoding', async (invalidImage, message) => {
    const harness = createHarness();

    await expect(
      new BrowserImagePreprocessor(harness.primitives).prepare(invalidImage),
    ).rejects.toThrow(message);
    expect(harness.primitives.createImageBitmap).not.toHaveBeenCalled();
  });

  it.each([
    [0, 10],
    [-1, 10],
    [1.5, 10],
    [10, 0],
    [10, Number.NaN],
  ])('rejects invalid decoded dimensions %s by %s and closes the bitmap', async (width, height) => {
    const harness = createHarness({ sourceWidth: width, sourceHeight: height });

    await expect(
      new BrowserImagePreprocessor(harness.primitives).prepare(image),
    ).rejects.toThrow(/dimensions/i);
    expect(harness.bitmap.close).toHaveBeenCalledOnce();
  });

  it('rejects an unavailable 2D context and still closes the bitmap', async () => {
    const harness = createHarness({ contextAvailable: false });

    await expect(
      new BrowserImagePreprocessor(harness.primitives).prepare(image),
    ).rejects.toThrow(/context/i);
    expect(harness.bitmap.close).toHaveBeenCalledOnce();
  });
});
