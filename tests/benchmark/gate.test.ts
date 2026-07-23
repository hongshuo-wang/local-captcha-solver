import { describe, expect, it } from 'vitest';

import { evaluateHardGate, gateExitCode } from '../../benchmark/gate';
import type { BenchmarkPrediction } from '../../benchmark/report';

function predictions(correctOrdinary: number, correctArithmetic: number): BenchmarkPrediction[] {
  const result: BenchmarkPrediction[] = [];
  for (const category of ['digits', 'letters', 'alphanumeric'] as const) {
    for (let index = 0; index < 10; index += 1) {
      result.push({
        engine: 'ddddocr',
        category,
        expected: `${category}-${index}`,
        actual: index < correctOrdinary ? `${category}-${index}` : 'wrong',
        confidence: 0.5,
        coldInitMs: 1,
        warmLatencyMs: 1,
      });
    }
  }
  for (let index = 0; index < 10; index += 1) {
    result.push({
      engine: 'ddddocr',
      category: 'arithmetic',
      expected: `${index}+1`,
      expectedFill: String(index + 1),
      actual: `${index}+1`,
      actualFill: index < correctArithmetic ? String(index + 1) : 'wrong',
      confidence: 0.5,
      coldInitMs: 1,
      warmLatencyMs: 1,
    });
  }
  return result;
}

describe('evaluateHardGate', () => {
  it('passes at the exact 0.90 boundaries', () => {
    const gate = evaluateHardGate(predictions(9, 9));
    expect(gate).toMatchObject({
      ordinaryWholeStringAccuracy: 0.9,
      arithmeticFillAccuracy: 0.9,
      passed: true,
    });
    expect(gateExitCode(gate)).toBe(0);
  });

  it('blocks below either fixed threshold', () => {
    const gate = evaluateHardGate(predictions(8, 9));
    expect(gate.passed).toBe(false);
    expect(gateExitCode(gate)).toBe(2);
  });

  it.each([
    ['ordinary categories', predictions(9, 9).filter((item) => item.category === 'arithmetic')],
    ['arithmetic category', predictions(9, 9).filter((item) => item.category !== 'arithmetic')],
    ['one ordinary category', predictions(9, 9).filter((item) => item.category !== 'letters')],
  ])('rejects missing %s instead of calculating an empty ratio', (_name, values) => {
    expect(() => evaluateHardGate(values)).toThrow(/empty|missing/i);
  });
});
