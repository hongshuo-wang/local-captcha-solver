import { describe, expect, it, vi } from 'vitest';

import {
  createInferenceHost,
  InferenceHostError,
} from '../../src/background/inference-host';
import type { InferenceRequest } from '../../src/ocr/protocol';

function createBrowserHarness(options?: {
  contexts?: readonly unknown[];
  createDocument?: () => Promise<void>;
  respond?: (request: InferenceRequest) => Promise<unknown>;
}) {
  const createDocument = vi.fn(options?.createDocument ?? (async () => undefined));
  const sendMessage = vi.fn(
    options?.respond ??
      (async (request: InferenceRequest) => ({
        type: 'ocr:result',
        requestId: request.requestId,
        imageRevision: request.imageRevision,
        results: [{ mode: request.modes[0], text: request.imageRevision, confidence: 0.9 }],
      })),
  );
  const getContexts = vi.fn(async () => options?.contexts ?? []);

  return {
    browser: {
      runtime: {
        getURL: vi.fn((path: string) => `extension://${path}`),
        getContexts,
        sendMessage,
      },
      offscreen: { createDocument },
    },
    createDocument,
    getContexts,
    sendMessage,
  };
}

describe('InferenceHost', () => {
  it('creates one offscreen document for concurrent recognition requests', async () => {
    let createDocument!: () => void;
    const documentReady = new Promise<void>((resolve) => {
      createDocument = resolve;
    });
    const harness = createBrowserHarness({ createDocument: () => documentReady });
    const host = createInferenceHost(harness.browser, () => 'request');

    const first = host.recognize('data:image/png;base64,AQ==', 'first', ['digits']);
    const second = host.recognize('data:image/png;base64,Ag==', 'second', ['letters']);
    await Promise.resolve();

    expect(harness.createDocument).toHaveBeenCalledOnce();
    createDocument();
    await Promise.all([first, second]);
    expect(harness.sendMessage).toHaveBeenCalledTimes(2);
  });

  it('reuses an existing offscreen client without creating another document', async () => {
    const harness = createBrowserHarness({ contexts: [{}] });
    const host = createInferenceHost(harness.browser, () => 'request');

    await host.recognize('data:image/png;base64,AQ==', 'revision', ['digits']);

    expect(harness.getContexts).toHaveBeenCalledWith({
      contextTypes: ['OFFSCREEN_DOCUMENT'],
      documentUrls: ['extension://offscreen.html'],
    });
    expect(harness.createDocument).not.toHaveBeenCalled();
  });

  it('retries offscreen document creation after a failed attempt', async () => {
    const createDocument = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error('creation failed'))
      .mockResolvedValueOnce(undefined);
    const harness = createBrowserHarness({ createDocument });
    const host = createInferenceHost(harness.browser, () => 'request');

    await expect(host.recognize('data:image/png;base64,AQ==', 'revision', ['digits'])).rejects.toMatchObject({
      code: 'model_unavailable',
    });
    await expect(host.recognize('data:image/png;base64,AQ==', 'revision', ['digits'])).resolves.toEqual([
      { mode: 'digits', text: 'revision', confidence: 0.9 },
    ]);

    expect(createDocument).toHaveBeenCalledTimes(2);
  });

  it('isolates concurrent results by request ID and image revision', async () => {
    const harness = createBrowserHarness({
      respond: async (request) => ({
        type: 'ocr:result',
        requestId: request.requestId,
        imageRevision: request.imageRevision,
        results: [{ mode: request.modes[0], text: request.imageDataUrl.endsWith('AQ==') ? 'one' : 'two', confidence: 0.9 }],
      }),
    });
    let sequence = 0;
    const host = createInferenceHost(harness.browser, () => `request-${++sequence}`);

    await expect(
      Promise.all([
        host.recognize('data:image/png;base64,AQ==', 'revision-1', ['digits']),
        host.recognize('data:image/png;base64,Ag==', 'revision-2', ['letters']),
      ]),
    ).resolves.toEqual([
      [{ mode: 'digits', text: 'one', confidence: 0.9 }],
      [{ mode: 'letters', text: 'two', confidence: 0.9 }],
    ]);
  });

  it('rejects a response with a mismatched request ID or image revision', async () => {
    const harness = createBrowserHarness({
      respond: async (request) => ({
        type: 'ocr:result',
        requestId: `${request.requestId}-wrong`,
        imageRevision: request.imageRevision,
        results: [],
      }),
    });
    const host = createInferenceHost(harness.browser, () => 'request');

    await expect(host.recognize('data:image/png;base64,AQ==', 'revision', ['digits'])).rejects.toMatchObject({
      code: 'recognition_failed',
    });
  });

  it('maps structured model errors to typed host errors', async () => {
    const harness = createBrowserHarness({
      respond: async (request) => ({
        type: 'ocr:error',
        requestId: request.requestId,
        imageRevision: request.imageRevision,
        code: 'model_unavailable',
        message: 'The model could not load',
      }),
    });
    const host = createInferenceHost(harness.browser, () => 'request');

    const error = await host
      .recognize('data:image/png;base64,AQ==', 'revision', ['digits'])
      .catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(InferenceHostError);
    expect(error).toMatchObject({ code: 'model_unavailable', message: 'The model could not load' });
  });
});
