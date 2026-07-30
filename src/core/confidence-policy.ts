import type { RecognitionMode } from './types';
import { ACTIVE_OCR_ENGINE } from '../ocr/engine-selection';
import type { LocalOcrEngine } from '../ocr/engine-selection';

export function confidenceThresholdsForEngine(
  engine: LocalOcrEngine,
): Readonly<Record<RecognitionMode, number>> {
  if (engine === 'ppocrv6-small') {
    return { digits: 0.85, letters: 0.85, alphanumeric: 0.85, arithmetic: 0.85 };
  }
  if (engine === 'captcha-ctc') {
    return { digits: 0.86, letters: 0.984, alphanumeric: 0.994, arithmetic: 0.62 };
  }
  return { digits: 0.9, letters: 0.95, alphanumeric: 0.95, arithmetic: 0.95 };
}

export const AUTO_FILL_CONFIDENCE = confidenceThresholdsForEngine(ACTIVE_OCR_ENGINE);

export type ConfidenceCandidate =
  | { kind: 'invalid'; reason: string }
  | { kind: 'plain' | 'arithmetic'; displayText: string; fillValue: string; confidence: number; mode: RecognitionMode };

/** Confidence boundaries are inclusive; structurally invalid results are never eligible. */
export function canAutoFill(result: ConfidenceCandidate): boolean {
  return result.kind !== 'invalid' && Number.isFinite(result.confidence) && result.confidence >= AUTO_FILL_CONFIDENCE[result.mode];
}
