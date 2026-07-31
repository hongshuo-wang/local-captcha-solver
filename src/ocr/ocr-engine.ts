import type { RecognitionMode } from '../core/types';

export interface OcrSession {
  run(
    feeds: Record<string, unknown>,
  ): Promise<Record<string, { data: Float32Array; dims: number[] }>>;
}

export interface OcrSessionFactory {
  create(modelUrl: string): Promise<OcrSession>;
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

export const ALLOWED_BY_MODE: Readonly<Record<RecognitionMode, ReadonlySet<string>>> = {
  digits: new Set(DIGITS),
  letters: new Set(`${LOWERCASE}${UPPERCASE}`),
  alphanumeric: new Set(`${LOWERCASE}${UPPERCASE}${DIGITS}`),
  arithmetic: new Set(`${DIGITS}+-*/xX×÷=?`),
};
