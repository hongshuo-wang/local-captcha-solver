import * as ort from 'onnxruntime-web/wasm';

import type { ImagePayload, ModelInput, OcrResult, RecognitionMode } from '../core/types';
import type { InferenceHost } from '../background/inference-host';
import { OcrEngineError } from './ocr-engine';
import type { OcrSessionFactory } from './ocr-engine';
import {
  BrowserPpOcrV6Preprocessor,
  PpOcrV6Engine,
  parsePpOcrV6RuntimeConfig,
} from './ppocrv6-engine';

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

export function createOcrInferenceService(getExtensionUrl: (path: string) => string): InferenceHost {
  ort.env.logLevel = 'error';
  ort.env.wasm.wasmPaths = getExtensionUrl('ort/');
  ort.env.wasm.numThreads = 1;

  const enginePromise = fetch(getExtensionUrl('models/captcha-ctc.json'))
    .then(async (response) => {
      if (!response.ok) throw new Error(`Could not load PP-OCRv6 config (${response.status})`);
      const config = parsePpOcrV6RuntimeConfig(await response.json());
      return new PpOcrV6Engine(
        createSessionFactory(),
        getExtensionUrl('models/captcha-ctc.onnx'),
        config.charset,
        new BrowserPpOcrV6Preprocessor(config.imageShape),
      );
    })
    .catch((cause: unknown) => {
      throw new OcrEngineError(
        'model_unavailable',
        cause instanceof Error ? cause.message : 'OCR model initialization failed',
        cause,
      );
    });

  const recognize = async (
    imageDataUrl: string,
    imageRevision: string,
    modes: readonly RecognitionMode[],
  ): Promise<readonly OcrResult[]> => {
    const engine = await enginePromise;
    return engine.recognize(decodeImageDataUrl(imageDataUrl, imageRevision), modes);
  };

  return {
    recognize,
    async warmup() {
      await recognize(
        'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
        '__local_captcha_warmup__',
        ['digits'],
      );
    },
  };
}
