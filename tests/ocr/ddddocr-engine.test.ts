import { describe, expect, it, vi } from 'vitest';

import type {
  ImagePayload,
  ImagePreprocessor,
  ModelInput,
  RecognitionMode,
} from '../../src/core/types';
import {
  DdddOcrEngine,
  OcrEngineError,
} from '../../src/ocr/ddddocr-engine';
import type {
  OcrSession,
  OcrSessionFactory,
} from '../../src/ocr/ddddocr-engine';

const CHARSET = ['', 'a', 'A', 'z', 'Z', '1', '9', '+', 'x', '×', '÷', '='] as const;
const MODEL_INPUT: ModelInput = {
  data: new Float32Array([1, -1]),
  dims: [1, 1, 64, 2],
};
const IMAGE: ImagePayload = {
  bytes: new Uint8Array([1, 2, 3]),
  mimeType: 'image/png',
  revision: 'r1',
};

function logitsFor(...characters: readonly (typeof CHARSET)[number][]) {
  const rows = characters.map((character) => {
    const row = new Array<number>(CHARSET.length).fill(-10);
    row[0] = 0;
    row[CHARSET.indexOf(character)] = 10;
    return row;
  });
  return {
    data: new Float32Array(rows.flat()),
    dims: [1, rows.length, CHARSET.length],
  };
}

function createHarness(output = logitsFor('a', 'A', '1', '+')) {
  const preprocessor: ImagePreprocessor = {
    prepare: vi.fn(async () => MODEL_INPUT),
  };
  const session: OcrSession = {
    run: vi.fn(async () => ({ output })),
  };
  const factory: OcrSessionFactory = {
    create: vi.fn(async () => session),
  };
  const engine = new DdddOcrEngine(factory, '/assets/model.onnx', CHARSET, preprocessor);

  return { engine, factory, preprocessor, session };
}

async function capturedError(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('Expected promise to reject');
}

describe('DdddOcrEngine', () => {
  it('reuses one cached session across repeated recognition calls', async () => {
    const { engine, factory, session } = createHarness();

    await engine.recognize(IMAGE, ['digits']);
    await engine.recognize(IMAGE, ['letters']);

    expect(factory.create).toHaveBeenCalledOnce();
    expect(factory.create).toHaveBeenCalledWith('/assets/model.onnx');
    expect(session.run).toHaveBeenCalledTimes(2);
  });

  it('shares in-flight session creation between concurrent calls', async () => {
    let resolveSession!: (session: OcrSession) => void;
    const sessionPromise = new Promise<OcrSession>((resolve) => {
      resolveSession = resolve;
    });
    const session: OcrSession = { run: vi.fn(async () => ({ any: logitsFor('1') })) };
    const factory: OcrSessionFactory = { create: vi.fn(() => sessionPromise) };
    const preprocessor: ImagePreprocessor = { prepare: vi.fn(async () => MODEL_INPUT) };
    const engine = new DdddOcrEngine(factory, '/model.onnx', CHARSET, preprocessor);

    const first = engine.recognize(IMAGE, ['digits']);
    const second = engine.recognize(IMAGE, ['letters']);
    await Promise.resolve();
    await Promise.resolve();

    expect(factory.create).toHaveBeenCalledOnce();
    resolveSession(session);
    await Promise.all([first, second]);
    expect(session.run).toHaveBeenCalledTimes(2);
  });

  it('preprocesses and runs inference once for four modes', async () => {
    const { engine, preprocessor, session } = createHarness();

    const results = await engine.recognize(IMAGE, [
      'digits',
      'letters',
      'alphanumeric',
      'arithmetic',
    ]);

    expect(preprocessor.prepare).toHaveBeenCalledOnce();
    expect(session.run).toHaveBeenCalledOnce();
    expect(results.map(({ mode }) => mode)).toEqual([
      'digits',
      'letters',
      'alphanumeric',
      'arithmetic',
    ]);
  });

  it('deduplicates modes while preserving first-seen order', async () => {
    const { engine, session } = createHarness();
    const modes: readonly RecognitionMode[] = [
      'letters',
      'digits',
      'letters',
      'arithmetic',
      'digits',
    ];

    const results = await engine.recognize(IMAGE, modes);

    expect(results.map(({ mode }) => mode)).toEqual(['letters', 'digits', 'arithmetic']);
    expect(session.run).toHaveBeenCalledOnce();
  });

  it('returns immediately for empty modes without preprocessing or model work', async () => {
    const { engine, factory, preprocessor, session } = createHarness();

    await expect(engine.recognize(IMAGE, [])).resolves.toEqual([]);

    expect(preprocessor.prepare).not.toHaveBeenCalled();
    expect(factory.create).not.toHaveBeenCalled();
    expect(session.run).not.toHaveBeenCalled();
  });

  it('uses exact mode profiles, excluding letters from arithmetic and preserving case', async () => {
    const { engine } = createHarness();

    const results = await engine.recognize(IMAGE, ['arithmetic', 'alphanumeric']);

    expect(results).toMatchObject([
      { mode: 'arithmetic', text: '1+' },
      { mode: 'alphanumeric', text: 'aA1' },
    ]);
  });

  it('passes ModelInput through the named input1 session boundary', async () => {
    const { engine, session } = createHarness();

    await engine.recognize(IMAGE, ['digits']);

    expect(session.run).toHaveBeenCalledWith({ input1: MODEL_INPUT });
    const feeds = vi.mocked(session.run).mock.calls[0][0];
    expect(feeds.input1).toBe(MODEL_INPUT);
    expect((feeds.input1 as ModelInput).dims).toEqual([1, 1, 64, 2]);
  });

  it('accepts an arbitrary name for the single model output', async () => {
    const harness = createHarness();
    vi.mocked(harness.session.run).mockResolvedValueOnce({ captcha_logits: logitsFor('9') });

    await expect(harness.engine.recognize(IMAGE, ['digits'])).resolves.toMatchObject([
      { mode: 'digits', text: '9' },
    ]);
  });

  it.each([
    ['zero', {}],
    ['multiple', { first: logitsFor('1'), second: logitsFor('9') }],
  ])('wraps %s model outputs as model_unavailable', async (_name, outputs) => {
    const harness = createHarness();
    vi.mocked(harness.session.run).mockResolvedValueOnce(outputs);

    const error = await capturedError(harness.engine.recognize(IMAGE, ['digits']));

    expect(error).toBeInstanceOf(OcrEngineError);
    expect(error).toMatchObject({ code: 'model_unavailable' });
    expect((error as Error).cause).toBeInstanceOf(Error);
  });

  it.each([
    ['non-Float32 data', { data: [0, 1], dims: [1, 1, 2] }],
    ['non-array dimensions', { data: new Float32Array([0, 1]), dims: null }],
  ])('validates output with %s', async (_name, output) => {
    const harness = createHarness();
    vi.mocked(harness.session.run).mockResolvedValueOnce({ output } as never);

    const error = await capturedError(harness.engine.recognize(IMAGE, ['digits']));

    expect(error).toMatchObject({ code: 'model_unavailable' });
    expect((error as Error).cause).toBeInstanceOf(TypeError);
  });

  it('wraps session creation rejection with its cause and retries later', async () => {
    const cause = new Error('network unavailable');
    const harness = createHarness(logitsFor('1'));
    vi.mocked(harness.factory.create).mockRejectedValueOnce(cause);

    const firstError = await capturedError(harness.engine.recognize(IMAGE, ['digits']));

    expect(firstError).toBeInstanceOf(OcrEngineError);
    expect(firstError).toMatchObject({ code: 'model_unavailable', cause });
    await expect(harness.engine.recognize(IMAGE, ['digits'])).resolves.toMatchObject([
      { mode: 'digits', text: '1' },
    ]);
    expect(harness.factory.create).toHaveBeenCalledTimes(2);
  });

  it('wraps synchronous session creation errors with their cause and retries later', async () => {
    const cause = new Error('factory initialization failed');
    const harness = createHarness(logitsFor('1'));
    vi.mocked(harness.factory.create).mockImplementationOnce(() => {
      throw cause;
    });

    const firstError = await capturedError(harness.engine.recognize(IMAGE, ['digits']));

    expect(firstError).toBeInstanceOf(OcrEngineError);
    expect(firstError).toMatchObject({ code: 'model_unavailable', cause });
    await expect(harness.engine.recognize(IMAGE, ['digits'])).resolves.toMatchObject([
      { mode: 'digits', text: '1' },
    ]);
    expect(harness.factory.create).toHaveBeenCalledTimes(2);
  });

  it('wraps session run rejection as model_unavailable with its cause', async () => {
    const cause = new Error('wasm crashed');
    const harness = createHarness();
    vi.mocked(harness.session.run).mockRejectedValueOnce(cause);

    const error = await capturedError(harness.engine.recognize(IMAGE, ['digits']));

    expect(error).toBeInstanceOf(OcrEngineError);
    expect(error).toMatchObject({ code: 'model_unavailable', cause });
  });

  it('keeps preprocessing failures distinct as image_unavailable', async () => {
    const cause = new Error('decode failed');
    const harness = createHarness();
    vi.mocked(harness.preprocessor.prepare).mockRejectedValueOnce(cause);

    const error = await capturedError(harness.engine.recognize(IMAGE, ['digits']));

    expect(error).toBeInstanceOf(OcrEngineError);
    expect(error).toMatchObject({ code: 'image_unavailable', cause });
    expect(harness.factory.create).not.toHaveBeenCalled();
  });

  it('does not mutate modes, image, image bytes, or charset', async () => {
    const charset = [...CHARSET];
    const modes: RecognitionMode[] = ['letters', 'digits', 'letters'];
    const image: ImagePayload = {
      bytes: new Uint8Array(IMAGE.bytes),
      mimeType: IMAGE.mimeType,
      revision: IMAGE.revision,
    };
    const modesBefore = [...modes];
    const bytesBefore = new Uint8Array(image.bytes);
    const charsetBefore = [...charset];
    const harness = createHarness();
    const engine = new DdddOcrEngine(
      harness.factory,
      '/model.onnx',
      charset,
      harness.preprocessor,
    );

    await engine.recognize(image, modes);

    expect(modes).toEqual(modesBefore);
    expect(image).toEqual(IMAGE);
    expect(image.bytes).toEqual(bytesBefore);
    expect(charset).toEqual(charsetBefore);
  });
});
