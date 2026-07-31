import * as ort from 'onnxruntime-web/wasm';

import type { ImagePayload, ModelInput } from '../src/core/types';
import { OcrEngineError } from '../src/ocr/ocr-engine';
import { isInferenceRequest } from '../src/ocr/protocol';
import type { OcrSessionFactory } from '../src/ocr/ocr-engine';
import {
  BrowserPpOcrV6Preprocessor,
  PpOcrV6Engine,
  parsePpOcrV6RuntimeConfig,
} from '../src/ocr/ppocrv6-engine';
import type { InferenceErrorCode, InferenceResponse } from '../src/ocr/protocol';

const getExtensionUrl = browser.runtime.getURL as (path: string) => string;

// Extension pages do not rely on cross-origin isolation. Keep the WASM runtime single-threaded
// across Chrome and Edge. ORT also needs a per-session severity because its session default is
// warning even when the runtime environment is configured for errors only.
ort.env.logLevel = 'error';
ort.env.wasm.wasmPaths = getExtensionUrl('ort/');
ort.env.wasm.numThreads = 1;

const OCR_SESSION_OPTIONS: ort.InferenceSession.SessionOptions = {
  executionProviders: ['wasm'],
  logSeverityLevel: 3,
};

function decodeImageDataUrl(imageDataUrl: string, revision: string): ImagePayload {
  const separator = imageDataUrl.indexOf(',');
  const mimeType = imageDataUrl.slice('data:'.length, imageDataUrl.indexOf(';'));
  const encoded = imageDataUrl.slice(separator + 1);
  const binary = atob(encoded);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));

  return { bytes, mimeType, revision };
}

function createSessionFactory(): OcrSessionFactory {
  return {
    async create(modelUrl) {
      const session = await ort.InferenceSession.create(modelUrl, OCR_SESSION_OPTIONS);
      return {
        async run(feeds) {
          const values = Object.values(feeds);
          if (values.length !== 1) throw new RangeError('OCR session requires exactly one input');
          const input = values[0] as ModelInput;
          const outputs = await session.run({
            [session.inputNames[0]]: new ort.Tensor('float32', input.data, [...input.dims]),
          });

          return Object.fromEntries(
            Object.entries(outputs).map(([name, output]) => {
              if (!(output.data instanceof Float32Array)) {
                throw new TypeError('OCR model output must use Float32 data');
              }
              return [name, { data: output.data, dims: [...output.dims] }];
            }),
          );
        },
      };
    },
  };
}

async function loadPpOcrV6Config() {
  const response = await fetch(getExtensionUrl('models/captcha-ctc.json'));
  if (!response.ok) throw new Error(`Could not load PP-OCRv6 config (${response.status})`);
  return parsePpOcrV6RuntimeConfig(await response.json());
}

const enginePromise = loadPpOcrV6Config().then((config) => new PpOcrV6Engine(
  createSessionFactory(),
  getExtensionUrl('models/captcha-ctc.onnx'),
  config.charset,
  new BrowserPpOcrV6Preprocessor(config.imageShape),
))
  .catch((cause: unknown) => {
    throw new OcrEngineError(
      'model_unavailable',
      cause instanceof Error ? cause.message : 'OCR model initialization failed',
      cause,
    );
  });

function failure(
  requestId: string,
  imageRevision: string,
  error: unknown,
): InferenceResponse {
  const code: InferenceErrorCode =
    error instanceof OcrEngineError ? error.code : 'recognition_failed';
  return {
    type: 'ocr:error',
    requestId,
    imageRevision,
    code,
    message: error instanceof Error ? error.message : 'OCR inference failed',
  };
}

async function handleInferenceMessage(message: unknown): Promise<InferenceResponse | undefined> {
  if (!isInferenceRequest(message)) {
    return undefined;
  }

  try {
    const engine = await enginePromise;
    const results = await engine.recognize(
      decodeImageDataUrl(message.imageDataUrl, message.imageRevision),
      message.modes,
    );
    return {
      type: 'ocr:result',
      requestId: message.requestId,
      imageRevision: message.imageRevision,
      results,
    };
  } catch (error) {
    return failure(message.requestId, message.imageRevision, error);
  }
}

browser.runtime.onMessage.addListener((message: unknown, _sender: unknown, sendResponse?: (response: InferenceResponse | undefined) => void) => {
  if (!isInferenceRequest(message)) return undefined;
  const response = handleInferenceMessage(message);
  if (sendResponse === undefined) return response;
  void response.then(sendResponse);
  return true;
});
