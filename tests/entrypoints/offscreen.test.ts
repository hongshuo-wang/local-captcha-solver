import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const listener = vi.fn();

vi.mock('onnxruntime-web/wasm', () => ({
  env: { wasm: {} },
  InferenceSession: { create: vi.fn() },
  Tensor: class Tensor {},
}));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
  listener.mockReset();
});

describe('offscreen OCR entrypoint', () => {
  it('uses the wasm-only ONNX Runtime entrypoint for the bundled runtime assets', async () => {
    const source = await readFile(resolve('src/ocr/inference-service.ts'), 'utf8');
    expect(source).toContain("from 'onnxruntime-web/wasm'");
  });

  it('maps model configuration initialization failures to model_unavailable', async () => {
    vi.stubGlobal('browser', {
      runtime: {
        getURL: (path: string) => `extension://${path}`,
        onMessage: { addListener: listener },
      },
    });
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('Model configuration could not load');
    }));

    await import('../../entrypoints/offscreen');

    const handler = listener.mock.calls[0]?.[0] as (message: unknown) => Promise<unknown>;
    await expect(
      handler({
        type: 'ocr:recognize',
        requestId: 'request-1',
        imageRevision: 'revision-1',
        imageDataUrl: 'data:image/png;base64,AQ==',
        modes: ['digits'],
      }),
    ).resolves.toMatchObject({
      type: 'ocr:error',
      requestId: 'request-1',
      imageRevision: 'revision-1',
      code: 'model_unavailable',
      message: 'Model configuration could not load',
    });
  });

  it('responds through sendResponse for callback-only extension runtimes', async () => {
    vi.stubGlobal('browser', {
      runtime: {
        getURL: (path: string) => `extension://${path}`,
        onMessage: { addListener: listener },
      },
    });
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('Model configuration could not load');
    }));

    await import('../../entrypoints/offscreen');

    const handler = listener.mock.calls[0]?.[0] as (message: unknown, sender: unknown, sendResponse: (response: unknown) => void) => unknown;
    const response = vi.fn();
    const returned = handler({
      type: 'ocr:recognize',
      requestId: 'request-1',
      imageRevision: 'revision-1',
      imageDataUrl: 'data:image/png;base64,AQ==',
      modes: ['digits'],
    }, {}, response);

    expect(returned).toBe(true);
    await vi.waitFor(() => expect(response).toHaveBeenCalledWith(expect.objectContaining({ code: 'model_unavailable' })));
  });

  it('does not respond to messages outside the OCR protocol', async () => {
    vi.stubGlobal('browser', {
      runtime: {
        getURL: (path: string) => `extension://${path}`,
        onMessage: { addListener: listener },
      },
    });
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({
      schemaVersion: 1, modelName: 'captcha_ctc_tiny_71', imageShape: [3, 48, 320], charset: ['', 'a'],
    }) })));

    await import('../../entrypoints/offscreen');

    const handler = listener.mock.calls[0]?.[0] as (message: unknown, sender: unknown, sendResponse: (response: unknown) => void) => unknown;
    const response = vi.fn();
    const returned = handler({ type: 'captcha:get-model-status' }, {}, response);

    expect(returned).toBeUndefined();
    await Promise.resolve();
    expect(response).not.toHaveBeenCalled();
  });

  it('uses normalized extension-relative asset URLs for Edge offscreen loading', async () => {
    const urls: string[] = [];
    vi.stubGlobal('browser', {
      runtime: {
        getURL: (path: string) => { urls.push(path); return `extension://${path}`; },
        onMessage: { addListener: listener },
      },
    });
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({
      schemaVersion: 1, modelName: 'captcha_ctc_tiny_71', imageShape: [3, 48, 320], charset: ['', 'a'],
    }) })));

    await import('../../entrypoints/offscreen');
    const ort = await import('onnxruntime-web/wasm');
    expect(ort.env.logLevel).toBe('error');
    expect(ort.env.wasm.numThreads).toBe(1);
    expect(urls).toContain('ort/');
    await vi.waitFor(() => {
      expect(urls).toContain('models/captcha-ctc.json');
      expect(urls).toContain('models/captcha-ctc.onnx');
    });
  });

  it('suppresses non-actionable native ORT warnings at the session level', async () => {
    vi.stubGlobal('browser', {
      runtime: {
        getURL: (path: string) => `extension://${path}`,
        onMessage: { addListener: listener },
      },
    });
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({
      schemaVersion: 1, modelName: 'captcha_ctc_tiny_71', imageShape: [3, 48, 320], charset: ['', '0'],
    }) })));
    vi.stubGlobal('createImageBitmap', vi.fn(async () => ({
      width: 1,
      height: 1,
      close: vi.fn(),
    })));
    vi.stubGlobal('OffscreenCanvas', class {
      getContext() {
        return {
          fillStyle: '',
          fillRect: vi.fn(),
          imageSmoothingEnabled: false,
          imageSmoothingQuality: 'low',
          drawImage: vi.fn(),
          getImageData: (_x: number, _y: number, width: number, height: number) => ({
            data: new Uint8ClampedArray(width * height * 4),
          }),
        };
      }
    });

    const ort = await import('onnxruntime-web/wasm');
    vi.mocked(ort.InferenceSession.create).mockRejectedValueOnce(new Error('stop after session creation'));
    await import('../../entrypoints/offscreen');

    const handler = listener.mock.calls[0]?.[0] as (message: unknown) => Promise<unknown>;
    await handler({
      type: 'ocr:recognize',
      requestId: 'request-1',
      imageRevision: 'revision-1',
      imageDataUrl: 'data:image/png;base64,AQ==',
      modes: ['digits'],
    });

    expect(ort.InferenceSession.create).toHaveBeenCalledWith(
      'extension://models/captcha-ctc.onnx',
      { executionProviders: ['wasm'], logSeverityLevel: 3 },
    );
  });
});
