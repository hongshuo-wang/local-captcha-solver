import type { OcrResult, RecognitionMode } from '../core/types';
import {
  isInferenceRequest,
  isInferenceResponse,
} from '../ocr/protocol';
import type {
  InferenceErrorCode,
  InferenceRequest,
} from '../ocr/protocol';

interface OffscreenDocumentOptions {
  url: string;
  reasons: readonly ['WORKERS'];
  justification: string;
}

export interface InferenceBrowser {
  runtime: {
    getURL(path: string): string;
    sendMessage(message: InferenceRequest): Promise<unknown>;
    getContexts?: (filter: {
      contextTypes: readonly ['OFFSCREEN_DOCUMENT'];
      documentUrls: readonly string[];
    }) => Promise<readonly unknown[]>;
  };
  offscreen: {
    createDocument(options: OffscreenDocumentOptions): Promise<void>;
  };
}

export class InferenceHostError extends Error {
  readonly code: InferenceErrorCode;

  constructor(code: InferenceErrorCode, message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'InferenceHostError';
    this.code = code;
  }
}

export interface InferenceHost {
  recognize(
    imageDataUrl: string,
    imageRevision: string,
    modes: readonly RecognitionMode[],
  ): Promise<readonly OcrResult[]>;
  warmup?(): Promise<void>;
}

const DEFAULT_INFERENCE_TIMEOUT_MS = 15_000;

function createRequestId(): string {
  return globalThis.crypto.randomUUID();
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message.trim() !== '' ? error.message : String(error || 'unknown error');
}

class OffscreenInferenceHost implements InferenceHost {
  private documentPromise: Promise<void> | undefined;
  private warmupPromise: Promise<void> | undefined;

  constructor(
    private readonly browser: InferenceBrowser,
    private readonly requestIdFactory: () => string,
    private readonly inferenceTimeoutMs: number,
  ) {}

  async recognize(
    imageDataUrl: string,
    imageRevision: string,
    modes: readonly RecognitionMode[],
  ): Promise<readonly OcrResult[]> {
    const request: InferenceRequest = {
      type: 'ocr:recognize',
      requestId: this.requestIdFactory(),
      imageRevision,
      imageDataUrl,
      modes,
    };
    if (!isInferenceRequest(request)) {
      throw new InferenceHostError('recognition_failed', 'Invalid OCR inference request');
    }

    await this.ensureOffscreenDocument();

    let response: unknown;
    try {
      response = await this.sendWithTimeout(request);
    } catch (cause) {
      if (cause instanceof InferenceHostError) throw cause;
      throw new InferenceHostError('recognition_failed', `OCR inference message failed: ${errorMessage(cause)}`, cause);
    }

    if (
      !isInferenceResponse(response) ||
      response.requestId !== request.requestId ||
      response.imageRevision !== request.imageRevision
    ) {
      throw new InferenceHostError('recognition_failed', 'OCR inference response did not match request');
    }

    if (response.type === 'ocr:error') {
      throw new InferenceHostError(response.code, response.message);
    }

    return response.results;
  }

  warmup(): Promise<void> {
    if (this.warmupPromise !== undefined) return this.warmupPromise;
    const promise = this.recognize(
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
      '__local_captcha_warmup__',
      ['digits'],
    ).then(() => undefined);
    this.warmupPromise = promise;
    promise.then(
      () => { if (this.warmupPromise === promise) this.warmupPromise = undefined; },
      () => { if (this.warmupPromise === promise) this.warmupPromise = undefined; },
    );
    return promise;
  }

  private sendWithTimeout(request: InferenceRequest): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new InferenceHostError('model_unavailable', 'OCR inference timed out while loading the local model'));
      }, this.inferenceTimeoutMs);
      this.browser.runtime.sendMessage(request).then(
        (response) => { clearTimeout(timeout); resolve(response); },
        (cause: unknown) => { clearTimeout(timeout); reject(cause); },
      );
    });
  }

  private ensureOffscreenDocument(): Promise<void> {
    if (this.documentPromise !== undefined) {
      return this.documentPromise;
    }

    const documentPromise = this.openOffscreenDocument().catch((cause: unknown) => {
      if (this.documentPromise === documentPromise) {
        this.documentPromise = undefined;
      }
      throw new InferenceHostError('model_unavailable', `Could not start OCR inference document: ${errorMessage(cause)}`, cause);
    });
    this.documentPromise = documentPromise;
    return documentPromise;
  }

  private async openOffscreenDocument(): Promise<void> {
    const url = this.browser.runtime.getURL('offscreen.html');
    const contexts = this.browser.runtime.getContexts;
    if (contexts !== undefined) {
      const existing = await contexts({
        contextTypes: ['OFFSCREEN_DOCUMENT'],
        documentUrls: [url],
      });
      if (existing.length > 0) {
        return;
      }
    }

    await this.browser.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: ['WORKERS'],
      justification: 'Run local CAPTCHA OCR inference without network access.',
    });
  }
}

export function createInferenceHost(
  browser: InferenceBrowser,
  requestIdFactory: () => string = createRequestId,
  inferenceTimeoutMs = DEFAULT_INFERENCE_TIMEOUT_MS,
): InferenceHost {
  return new OffscreenInferenceHost(browser, requestIdFactory, inferenceTimeoutMs);
}
