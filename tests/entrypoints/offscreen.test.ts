import { afterEach, describe, expect, it, vi } from 'vitest';

const listener = vi.fn();

vi.mock('onnxruntime-web', () => ({
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
  it('maps charset initialization failures to model_unavailable', async () => {
    vi.stubGlobal('browser', {
      runtime: {
        getURL: (path: string) => `extension://${path}`,
        onMessage: { addListener: listener },
      },
    });
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('Charset asset could not load');
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
      message: 'Charset asset could not load',
    });
  });
});
