import { OcrEngineError } from '../src/ocr/ocr-engine';
import { isInferenceRequest } from '../src/ocr/protocol';
import type { InferenceErrorCode, InferenceResponse } from '../src/ocr/protocol';
import { createOcrInferenceService } from '../src/ocr/inference-service';
import { createRuntimeMessageListener } from '../src/platform/runtime-messaging';

const getExtensionUrl = browser.runtime.getURL as (path: string) => string;

const inferenceService = createOcrInferenceService(getExtensionUrl);

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
    const results = await inferenceService.recognize(
      message.imageDataUrl,
      message.imageRevision,
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

browser.runtime.onMessage.addListener(createRuntimeMessageListener((message: unknown) => {
  if (!isInferenceRequest(message)) return undefined;
  return handleInferenceMessage(message);
}));
