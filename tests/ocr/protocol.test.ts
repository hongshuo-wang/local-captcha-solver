import { describe, expect, it } from 'vitest';

import {
  MAX_IMAGE_DATA_URL_BYTES,
  MAX_IMAGE_BYTES,
  isInferenceRequest,
  isInferenceResponse,
} from '../../src/ocr/protocol';

const validRequest = {
  type: 'ocr:recognize',
  requestId: 'request-1',
  imageRevision: 'revision-1',
  imageDataUrl: 'data:image/png;base64,AQID',
  modes: ['digits', 'arithmetic'],
} as const;

describe('OCR inference protocol', () => {
  it('accepts a valid recognition request', () => {
    expect(isInferenceRequest(validRequest)).toBe(true);
  });

  it.each([
    { ...validRequest, requestId: '' },
    { ...validRequest, requestId: '   ' },
    { ...validRequest, imageRevision: '' },
    { ...validRequest, imageRevision: '   ' },
  ])('rejects a request missing a usable identifier', (message) => {
    expect(isInferenceRequest(message)).toBe(false);
  });

  it.each([
    { ...validRequest, imageDataUrl: 'data:text/plain;base64,AQID' },
    { ...validRequest, imageDataUrl: 'data:image/;base64,AQID' },
    { ...validRequest, imageDataUrl: 'data:image/png;base64,' },
    { ...validRequest, imageDataUrl: 'data:image/png;base64,A' },
    { ...validRequest, imageDataUrl: 'data:image/png;base64,AAA' },
    { ...validRequest, imageDataUrl: 'data:image/png;base64,AA=A' },
    { ...validRequest, imageDataUrl: 'data:image/png;base64,AAAA=' },
    { ...validRequest, imageDataUrl: 'data:image/png,not-base64' },
    { ...validRequest, imageDataUrl: 'not-a-data-url' },
  ])('rejects invalid image data URLs', (message) => {
    expect(isInferenceRequest(message)).toBe(false);
  });

  it('rejects image data URLs larger than the full URL limit', () => {
    const oversizedMime = 'a'.repeat(MAX_IMAGE_DATA_URL_BYTES);

    expect(
      isInferenceRequest({
        ...validRequest,
        imageDataUrl: `data:image/${oversizedMime};base64,AA==`,
      }),
    ).toBe(false);
  });

  it('rejects data URLs whose decoded image would exceed the byte limit', () => {
    const oversizedPayload = 'A'.repeat((Math.floor(MAX_IMAGE_BYTES / 3) + 1) * 4);

    expect(
      isInferenceRequest({
        ...validRequest,
        imageDataUrl: `data:image/png;base64,${oversizedPayload}`,
      }),
    ).toBe(false);
  });

  it('accepts the exact raw image byte limit after base64 expansion', () => {
    const fullGroups = Math.floor(MAX_IMAGE_BYTES / 3);
    const remainder = MAX_IMAGE_BYTES % 3;
    const encoded = `${'A'.repeat(fullGroups * 4)}${remainder === 0 ? '' : remainder === 1 ? 'AA==' : 'AAA='}`;

    expect(isInferenceRequest({
      ...validRequest,
      imageDataUrl: `data:image/png;base64,${encoded}`,
    })).toBe(true);
  });

  it.each([
    { ...validRequest, modes: [] },
    { ...validRequest, modes: ['digits', 'digits'] },
    { ...validRequest, modes: ['unsupported'] },
  ])('rejects empty, duplicate, and unsupported modes', (message) => {
    expect(isInferenceRequest(message)).toBe(false);
  });

  it('accepts structured success and error responses', () => {
    expect(
      isInferenceResponse({
        type: 'ocr:result',
        requestId: 'request-1',
        imageRevision: 'revision-1',
        results: [{ mode: 'arithmetic', text: '7*3', confidence: 0.9, requiresConfirmation: true }],
      }),
    ).toBe(true);
    expect(
      isInferenceResponse({
        type: 'ocr:error',
        requestId: 'request-1',
        imageRevision: 'revision-1',
        code: 'model_unavailable',
        message: 'Model unavailable',
      }),
    ).toBe(true);
  });

  it.each([
    { type: 'ocr:result', requestId: '', imageRevision: 'revision-1', results: [] },
    { type: 'ocr:error', requestId: 'request-1', imageRevision: '', code: 'recognition_failed', message: 'Failed' },
    { type: 'ocr:error', requestId: 'request-1', imageRevision: 'revision-1', code: 'other', message: 'Failed' },
    {
      type: 'ocr:result',
      requestId: 'request-1',
      imageRevision: 'revision-1',
      results: [{ mode: 'unsupported', text: '42', confidence: 0.9 }],
    },
    {
      type: 'ocr:result',
      requestId: 'request-1',
      imageRevision: 'revision-1',
      results: [{ mode: 'arithmetic', text: '7*3', confidence: 0.9, requiresConfirmation: 'yes' }],
    },
  ])('rejects malformed responses', (message) => {
    expect(isInferenceResponse(message)).toBe(false);
  });
});
