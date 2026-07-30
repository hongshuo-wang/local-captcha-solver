import { describe, expect, it } from 'vitest';

import {
  bestSelectivePoint,
  selectivePointAtThreshold,
} from '../../benchmark/run-captcha-ctc';

describe('CAPTCHA CTC selective operating point', () => {
  it('selects the highest coverage threshold satisfying target precision', () => {
    expect(bestSelectivePoint([
      { confidence: 0.99, correct: true },
      { confidence: 0.98, correct: true },
      { confidence: 0.97, correct: false },
    ], 1)).toEqual({ threshold: 0.98, accepted: 2, total: 3, coverage: 2 / 3, precision: 1 });
  });

  it('keeps equal-confidence predictions in one indivisible bucket', () => {
    expect(bestSelectivePoint([
      { confidence: 0.9, correct: true },
      { confidence: 0.9, correct: false },
    ], 0.75)).toBeNull();
  });

  it('reports the fixed runtime threshold without optimizing it on evaluation data', () => {
    expect(selectivePointAtThreshold([
      { confidence: 0.99, correct: true },
      { confidence: 0.98, correct: false },
      { confidence: 0.5, correct: true },
    ], 0.98)).toEqual({
      threshold: 0.98,
      accepted: 2,
      total: 3,
      coverage: 2 / 3,
      precision: 0.5,
    });
  });
});
