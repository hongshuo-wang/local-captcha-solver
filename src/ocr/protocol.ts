import type { OcrResult, RecognitionMode } from '../core/types';
import {
  MAX_IMAGE_BYTES,
  MAX_IMAGE_DATA_URL_BYTES,
} from '../core/image-limits';

export {
  MAX_IMAGE_BYTES,
  MAX_IMAGE_DATA_URL_BYTES,
} from '../core/image-limits';

export type InferenceErrorCode =
  | 'image_unavailable'
  | 'model_unavailable'
  | 'recognition_failed';

export interface InferenceRequest {
  type: 'ocr:recognize';
  requestId: string;
  imageRevision: string;
  imageDataUrl: string;
  modes: readonly RecognitionMode[];
}

export interface InferenceSuccessResponse {
  type: 'ocr:result';
  requestId: string;
  imageRevision: string;
  results: readonly OcrResult[];
}

export interface InferenceErrorResponse {
  type: 'ocr:error';
  requestId: string;
  imageRevision: string;
  code: InferenceErrorCode;
  message: string;
}

export type InferenceResponse = InferenceSuccessResponse | InferenceErrorResponse;

const RECOGNITION_MODES = new Set<RecognitionMode>([
  'digits',
  'letters',
  'alphanumeric',
  'arithmetic',
]);
const INFERENCE_ERROR_CODES = new Set<InferenceErrorCode>([
  'image_unavailable',
  'model_unavailable',
  'recognition_failed',
]);
const DATA_URL_PATTERN = /^data:(image\/[a-z0-9][a-z0-9!#$&^_.+-]*);base64,([A-Za-z0-9+/]+={0,2})$/i;
const BASE64_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object';
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isRecognitionMode(value: unknown): value is RecognitionMode {
  return typeof value === 'string' && RECOGNITION_MODES.has(value as RecognitionMode);
}

function isImageDataUrl(value: unknown): value is string {
  if (typeof value !== 'string') {
    return false;
  }
  if (value.length > MAX_IMAGE_DATA_URL_BYTES) {
    return false;
  }

  const match = DATA_URL_PATTERN.exec(value);
  if (match === null) {
    return false;
  }

  const encoded = match[2];
  if (!BASE64_PATTERN.test(encoded)) {
    return false;
  }

  const paddingLength = encoded.endsWith('==') ? 2 : encoded.endsWith('=') ? 1 : 0;
  return (encoded.length / 4) * 3 - paddingLength <= MAX_IMAGE_BYTES;
}

function isOcrResult(value: unknown): value is OcrResult {
  return (
    isRecord(value) &&
    isRecognitionMode(value.mode) &&
    typeof value.text === 'string' &&
    typeof value.confidence === 'number' &&
    Number.isFinite(value.confidence)
  );
}

export function isInferenceRequest(value: unknown): value is InferenceRequest {
  if (!isRecord(value) || value.type !== 'ocr:recognize') {
    return false;
  }
  if (
    !isNonEmptyString(value.requestId) ||
    !isNonEmptyString(value.imageRevision) ||
    !isImageDataUrl(value.imageDataUrl) ||
    !Array.isArray(value.modes) ||
    value.modes.length === 0 ||
    !value.modes.every(isRecognitionMode)
  ) {
    return false;
  }

  return new Set(value.modes).size === value.modes.length;
}

export function isInferenceResponse(value: unknown): value is InferenceResponse {
  if (
    !isRecord(value) ||
    !isNonEmptyString(value.requestId) ||
    !isNonEmptyString(value.imageRevision)
  ) {
    return false;
  }

  if (value.type === 'ocr:result') {
    return Array.isArray(value.results) && value.results.every(isOcrResult);
  }

  return (
    value.type === 'ocr:error' &&
    typeof value.code === 'string' &&
    INFERENCE_ERROR_CODES.has(value.code as InferenceErrorCode) &&
    isNonEmptyString(value.message)
  );
}
