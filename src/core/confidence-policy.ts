import type { RecognitionMode } from './types';

export const AUTO_FILL_CONFIDENCE: Readonly<Record<RecognitionMode, number>> = {
  digits: 0.86,
  letters: 0.984,
  alphanumeric: 0.994,
  arithmetic: 0.62,
};

export type ConfidenceCandidate =
  | { kind: 'invalid'; reason: string }
  | { kind: 'plain' | 'arithmetic'; displayText: string; fillValue: string; confidence: number; mode: RecognitionMode };

/** Confidence boundaries are inclusive; structurally invalid results are never eligible. */
export function canAutoFill(result: ConfidenceCandidate): boolean {
  return result.kind !== 'invalid' && Number.isFinite(result.confidence) && result.confidence >= AUTO_FILL_CONFIDENCE[result.mode];
}
