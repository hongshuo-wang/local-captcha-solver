import type {
  ImagePayload,
  ImagePreprocessor,
  ModelInput,
  OcrEngine,
  OcrResult,
  RecognitionMode,
} from '../core/types';
import { decodeArithmeticCtc } from './arithmetic-ctc-decoder';
import { decodeCtc } from './ctc-decoder';
import { BrowserImagePreprocessor } from './image-preprocessor';

export interface OcrSession {
  run(
    feeds: Record<string, unknown>,
  ): Promise<Record<string, { data: Float32Array; dims: number[] }>>;
}

export interface OcrSessionFactory {
  create(modelUrl: string): Promise<OcrSession>;
}

export interface DdddOcrSessionFeeds extends Record<string, unknown> {
  input1: ModelInput;
}

export function createDdddOcrSessionFeeds(input: ModelInput): DdddOcrSessionFeeds {
  return { input1: input };
}

export type OcrEngineErrorCode = 'image_unavailable' | 'model_unavailable';

export class OcrEngineError extends Error {
  readonly code: OcrEngineErrorCode;

  constructor(code: OcrEngineErrorCode, message: string, cause: unknown) {
    super(message, { cause });
    this.name = 'OcrEngineError';
    this.code = code;
  }
}

const LOWERCASE = 'abcdefghijklmnopqrstuvwxyz';
const UPPERCASE = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const DIGITS = '0123456789';

const ALLOWED_BY_MODE: Readonly<Record<RecognitionMode, ReadonlySet<string>>> = {
  digits: new Set(DIGITS),
  letters: new Set(`${LOWERCASE}${UPPERCASE}`),
  alphanumeric: new Set(`${LOWERCASE}${UPPERCASE}${DIGITS}`),
  arithmetic: new Set(`${DIGITS}+-*/xX×÷=?`),
};

function extractSingleOutput(
  outputs: Record<string, { data: Float32Array; dims: number[] }>,
): { data: Float32Array; dims: number[] } {
  if (outputs === null || typeof outputs !== 'object') {
    throw new TypeError('OCR session outputs must be an object');
  }

  const values = Object.values(outputs);
  if (values.length !== 1) {
    throw new RangeError('OCR session must return exactly one output');
  }

  const output = values[0];
  if (output === null || typeof output !== 'object') {
    throw new TypeError('OCR session output must be an object');
  }
  if (!(output.data instanceof Float32Array)) {
    throw new TypeError('OCR session output data must be a Float32Array');
  }
  if (!Array.isArray(output.dims)) {
    throw new TypeError('OCR session output dimensions must be an array');
  }

  return output;
}

export class DdddOcrEngine implements OcrEngine {
  private readonly charset: readonly string[];
  private readonly preprocessor: ImagePreprocessor;
  private sessionPromise: Promise<OcrSession> | undefined;

  constructor(
    private readonly sessionFactory: OcrSessionFactory,
    private readonly modelUrl: string,
    charset: readonly string[],
    preprocessor: ImagePreprocessor = new BrowserImagePreprocessor(),
  ) {
    this.charset = [...charset];
    this.preprocessor = preprocessor;
  }

  async recognize(
    image: ImagePayload,
    modes: readonly RecognitionMode[],
  ): Promise<readonly OcrResult[]> {
    const uniqueModes = [...new Set(modes)];
    if (uniqueModes.length === 0) {
      return [];
    }

    let input: ModelInput;
    try {
      input = await this.preprocessor.prepare(image);
    } catch (cause) {
      throw new OcrEngineError('image_unavailable', 'Image preprocessing failed', cause);
    }

    const session = await this.getSession();
    try {
      const outputs = await session.run(createDdddOcrSessionFeeds(input));
      const output = extractSingleOutput(outputs);

      return uniqueModes.map((mode) => {
        const greedy = decodeCtc(
          output.data,
          output.dims,
          this.charset,
          ALLOWED_BY_MODE[mode],
        );
        const result =
          mode === 'arithmetic'
            ? (decodeArithmeticCtc(output.data, output.dims, this.charset) ?? greedy)
            : greedy;

        return { ...result, mode };
      });
    } catch (cause) {
      throw new OcrEngineError('model_unavailable', 'OCR model inference failed', cause);
    }
  }

  private getSession(): Promise<OcrSession> {
    if (this.sessionPromise !== undefined) {
      return this.sessionPromise;
    }

    const sessionPromise = Promise.resolve()
      .then(() => this.sessionFactory.create(this.modelUrl))
      .catch((cause: unknown) => {
        if (this.sessionPromise === sessionPromise) {
          this.sessionPromise = undefined;
        }
        throw new OcrEngineError('model_unavailable', 'OCR model creation failed', cause);
      });
    this.sessionPromise = sessionPromise;
    return sessionPromise;
  }
}
