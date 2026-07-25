import * as ort from 'onnxruntime-web';

import type { ImagePayload, ModelInput } from '../src/core/types';
import {
  DdddOcrEngine,
  OcrEngineError,
} from '../src/ocr/ddddocr-engine';
import { isInferenceRequest } from '../src/ocr/protocol';
import type { OcrSessionFactory } from '../src/ocr/ddddocr-engine';
import type { InferenceErrorCode, InferenceResponse } from '../src/ocr/protocol';

const getExtensionUrl = browser.runtime.getURL as (path: string) => string;

ort.env.wasm.wasmPaths = getExtensionUrl('ort/');
ort.env.wasm.numThreads = 1;

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
      const session = await ort.InferenceSession.create(modelUrl);
      return {
        async run(feeds) {
          const input = feeds.input1 as ModelInput;
          const outputs = await session.run({
            input1: new ort.Tensor('float32', input.data, [...input.dims]),
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

async function loadCharset(): Promise<readonly string[]> {
  const response = await fetch(getExtensionUrl('models/common_old.json'));
  if (!response.ok) {
    throw new Error(`Could not load OCR charset (${response.status})`);
  }

  const charset: unknown = await response.json();
  if (!Array.isArray(charset) || !charset.every((value) => typeof value === 'string')) {
    throw new TypeError('OCR charset must be an array of strings');
  }
  return charset;
}

const enginePromise = loadCharset()
  .then(
    (charset) =>
      new DdddOcrEngine(
        createSessionFactory(),
        getExtensionUrl('models/common_old.onnx'),
        charset,
      ),
  )
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

browser.runtime.onMessage.addListener(async (message: unknown): Promise<InferenceResponse | undefined> => {
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
});
