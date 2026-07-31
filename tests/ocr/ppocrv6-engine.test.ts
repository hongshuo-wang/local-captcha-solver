import { describe, expect, it, vi } from 'vitest';

import type { ImagePayload, ImagePreprocessor, ModelInput } from '../../src/core/types';
import type { OcrSession, OcrSessionFactory } from '../../src/ocr/ocr-engine';
import {
  BrowserPpOcrV6Preprocessor,
  PpOcrV6Engine,
  decodePpOcrV6ArithmeticCtc,
  decodePpOcrV6Ctc,
  decodePpOcrV6ForMode,
  parsePpOcrV6RuntimeConfig,
  rgbaToPpOcrV6Tensor,
} from '../../src/ocr/ppocrv6-engine';
import type { PpOcrV6ImagePrimitives } from '../../src/ocr/ppocrv6-engine';

const CHARSET = ['', '7', '3', '*', '=', '?', 'A', 'a', ' ', 'で'] as const;
const IMAGE: ImagePayload = {
  bytes: new Uint8Array([1, 2, 3]),
  mimeType: 'image/png',
  revision: 'r1',
};

function probabilitiesFor(...characters: readonly (typeof CHARSET)[number][]) {
  const rows = characters.map((character) => {
    const row = new Array<number>(CHARSET.length).fill(0.001);
    row[CHARSET.indexOf(character)] = 0.95;
    return row;
  });
  return { data: new Float32Array(rows.flat()), dims: [1, rows.length, CHARSET.length] };
}

function probabilityRows(rows: readonly Readonly<Record<string, number>>[]) {
  return {
    data: new Float32Array(rows.flatMap((overrides) => {
      const row = new Array<number>(CHARSET.length).fill(0.001);
      for (const [character, probability] of Object.entries(overrides)) {
        row[CHARSET.indexOf(character as (typeof CHARSET)[number])] = probability;
      }
      return row;
    })),
    dims: [1, rows.length, CHARSET.length],
  };
}

describe('PP-OCRv6 runtime config', () => {
  it('validates the generated browser config and blank-prefixed charset', () => {
    expect(parsePpOcrV6RuntimeConfig({
      schemaVersion: 1,
      modelName: 'captcha_ctc_tiny_71',
      imageShape: [3, 48, 320],
      charset: CHARSET,
    })).toEqual({
      modelName: 'captcha_ctc_tiny_71',
      imageShape: [3, 48, 320],
      charset: CHARSET,
    });
    expect(() => parsePpOcrV6RuntimeConfig({
      schemaVersion: 1,
      modelName: 'PP-OCRv6_small_rec',
      imageShape: [3, 48, 320],
      charset: ['7', ''],
    })).toThrow(/production/i);
    expect(parsePpOcrV6RuntimeConfig({
      schemaVersion: 1,
      modelName: 'captcha_ctc_tiny_71',
      imageShape: [3, 48, 320],
      charset: CHARSET,
    }).modelName).toBe('captcha_ctc_tiny_71');
  });
});

describe('PP-OCRv6 browser preprocessing', () => {
  it('writes BGR [-1,1] planes and leaves right padding at zero', () => {
    const tensor = rgbaToPpOcrV6Tensor(
      new Uint8ClampedArray([255, 128, 0, 255]),
      1,
      1,
      2,
    );
    expect(Array.from(tensor)).toEqual([
      -1, 0,
      expect.closeTo(128 / 127.5 - 1, 6), 0,
      1, 0,
    ]);
  });

  it('uses official 48px dynamic-width resize and closes the bitmap', async () => {
    const bitmap = { width: 203, height: 75, close: vi.fn() };
    const context = {
      fillStyle: '',
      imageSmoothingEnabled: false,
      imageSmoothingQuality: 'low',
      fillRect: vi.fn(),
      drawImage: vi.fn(),
      getImageData: vi.fn(() => ({ data: new Uint8ClampedArray(130 * 48 * 4).fill(255) })),
    };
    const primitives = {
      createImageBitmap: vi.fn(async () => bitmap),
      createOffscreenCanvas: vi.fn(() => ({ getContext: () => context })),
    } as unknown as PpOcrV6ImagePrimitives;

    const result = await new BrowserPpOcrV6Preprocessor([3, 48, 320], primitives).prepare(IMAGE);

    expect(primitives.createOffscreenCanvas).toHaveBeenCalledWith(130, 48);
    expect(context.drawImage).toHaveBeenCalledWith(bitmap, 0, 0, 130, 48);
    expect(result.dims).toEqual([1, 3, 48, 320]);
    expect(result.data).toHaveLength(3 * 48 * 320);
    expect(bitmap.close).toHaveBeenCalledOnce();
  });
});

describe('PP-OCRv6 CTC engine', () => {
  it('decodes probabilities, collapses duplicates, and filters by recognition mode', () => {
    const output = probabilitiesFor('で', '7', '7', '', '*', '3');
    expect(decodePpOcrV6Ctc(output.data, output.dims, CHARSET, new Set('0123456789*'))).toEqual({
      text: '7*3',
      confidence: expect.closeTo(0.95, 6),
    });
  });

  it('runs one inference for all requested modes and reuses the session', async () => {
    const input: ModelInput = { data: new Float32Array(3 * 48 * 320), dims: [1, 3, 48, 320] };
    const preprocessor: ImagePreprocessor = { prepare: vi.fn(async () => input) };
    const output = probabilitiesFor('7', '*', '3');
    const session: OcrSession = { run: vi.fn(async () => ({ output })) };
    const factory: OcrSessionFactory = { create: vi.fn(async () => session) };
    const engine = new PpOcrV6Engine(factory, '/models/small.onnx', CHARSET, preprocessor);

    await expect(engine.recognize(IMAGE, ['arithmetic', 'digits'])).resolves.toMatchObject([
      { mode: 'arithmetic', text: '7*3' },
      { mode: 'digits', text: '73' },
    ]);
    await engine.recognize(IMAGE, ['digits']);

    expect(preprocessor.prepare).toHaveBeenCalledTimes(2);
    expect(factory.create).toHaveBeenCalledOnce();
    expect(session.run).toHaveBeenNthCalledWith(1, { x: input });
  });

  it('recovers an arithmetic operator hidden by the CTC blank probability', async () => {
    const input: ModelInput = { data: new Float32Array(3 * 48 * 320), dims: [1, 3, 48, 320] };
    const preprocessor: ImagePreprocessor = { prepare: vi.fn(async () => input) };
    const output = probabilityRows([
      { '7': 0.95 },
      { '': 0.55, '*': 0.35 },
      { '3': 0.95 },
    ]);
    const session: OcrSession = { run: vi.fn(async () => ({ output })) };
    const factory: OcrSessionFactory = { create: vi.fn(async () => session) };
    const engine = new PpOcrV6Engine(factory, '/models/small.onnx', CHARSET, preprocessor);

    expect(decodePpOcrV6Ctc(output.data, output.dims, CHARSET, new Set('0123456789+-*/xX=?')))
      .toMatchObject({ text: '73' });
    expect(decodePpOcrV6ForMode(output.data, output.dims, CHARSET, 'arithmetic'))
      .toMatchObject({ text: '7*3' });
    await expect(engine.recognize(IMAGE, ['arithmetic', 'digits'])).resolves.toMatchObject([
      { mode: 'arithmetic', text: '7*3' },
      { mode: 'digits', text: '73' },
    ]);
  });

  it('falls back to greedy text when no complete arithmetic expression exists', async () => {
    const input: ModelInput = { data: new Float32Array(3 * 48 * 320), dims: [1, 3, 48, 320] };
    const preprocessor: ImagePreprocessor = { prepare: vi.fn(async () => input) };
    const output = probabilitiesFor('7', '3');
    const session: OcrSession = { run: vi.fn(async () => ({ output })) };
    const factory: OcrSessionFactory = { create: vi.fn(async () => session) };
    const engine = new PpOcrV6Engine(factory, '/models/small.onnx', CHARSET, preprocessor);

    expect(decodePpOcrV6ArithmeticCtc(output.data, output.dims, CHARSET)).toBeNull();
    await expect(engine.recognize(IMAGE, ['arithmetic'])).resolves.toMatchObject([
      { mode: 'arithmetic', text: '73' },
    ]);
  });
});
