import { describe, expect, it } from 'vitest';

import {
  buildPpOcrV6Report,
} from '../../benchmark/ppocrv6-report';
import type { BenchmarkPrediction } from '../../benchmark/report';

function prediction(overrides: Partial<BenchmarkPrediction> = {}): BenchmarkPrediction {
  return {
    engine: 'ppocrv6-tiny',
    category: 'digits',
    expected: '1234',
    actual: '1234',
    confidence: 0.9,
    coldInitMs: 10,
    warmLatencyMs: 5,
    sampleId: 'digits-001',
    source: 'generated',
    ...overrides,
  };
}

describe('PP-OCRv6 benchmark report', () => {
  it('reports generated/real counts and raw arithmetic accuracy separately', () => {
    const report = buildPpOcrV6Report([
      prediction(),
      prediction({
        sampleId: 'arithmetic-001',
        category: 'arithmetic',
        expected: '3*8=?',
        expectedFill: '24',
        actual: '3x8=?',
        actualFill: '24',
      }),
      prediction({
        sampleId: 'real-a',
        source: 'real',
        category: 'arithmetic',
        expected: '8÷2',
        expectedFill: '4',
        actual: '8/2',
        actualFill: '4',
      }),
    ], { modelBytes: 4_462_639, sharedRuntimeBytes: 100 });

    expect(report.sourceCounts).toEqual({ generated: 2, real: 1 });
    expect(report.rawArithmeticTextAccuracy).toBe(0);
    expect(report.realExactAccuracy).toBe(0);
    expect(report.base.categories.arithmetic.fillAccuracy).toBe(1);
    expect(report.modelBytes).toBe(4_462_639);
    expect(report.sharedRuntimeBytes).toBe(100);
  });

  it('aligns target symbols and records substitutions without normalizing them away', () => {
    const report = buildPpOcrV6Report([
      prediction({
        category: 'arithmetic',
        expected: '3*8=?',
        expectedFill: '24',
        actual: '3x8=?',
        actualFill: '24',
      }),
      prediction({
        category: 'arithmetic',
        expected: '8÷2',
        expectedFill: '4',
        actual: '8/2',
        actualFill: '4',
      }),
    ], { modelBytes: 1, sharedRuntimeBytes: 2 });

    expect(report.symbols['*']).toEqual({ expectedCount: 1, correctCount: 0, recall: 0, confusions: { x: 1 } });
    expect(report.symbols['÷']).toEqual({ expectedCount: 1, correctCount: 0, recall: 0, confusions: { '/': 1 } });
    expect(report.symbols['=']).toMatchObject({ expectedCount: 1, correctCount: 1, recall: 1 });
    expect(report.symbols['?']).toMatchObject({ expectedCount: 1, correctCount: 1, recall: 1 });
    expect(report.symbols['X']).toEqual({ expectedCount: 0, correctCount: 0, recall: null, confusions: {} });
  });
});
