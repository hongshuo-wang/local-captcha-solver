import { describe, expect, it } from 'vitest';

import { buildReport } from '../../benchmark/report';
import type { BenchmarkPrediction } from '../../benchmark/report';

const PACKAGE_OPTIONS = {
  packageSizeBytes: 1,
  packageSizeScope: 'install-footprint',
} as const;

function prediction(
  overrides: Partial<BenchmarkPrediction> &
    Pick<BenchmarkPrediction, 'category' | 'expected' | 'actual'>,
): BenchmarkPrediction {
  return {
    engine: 'ddddocr',
    confidence: 0.5,
    coldInitMs: 125,
    warmLatencyMs: 20,
    ...overrides,
  };
}

describe('buildReport', () => {
  it('rejects empty predictions instead of emitting synthetic zero metrics', () => {
    expect(() => buildReport([], {
      packageSizeBytes: 1,
      packageSizeScope: 'install-footprint',
    })).toThrow(/empty/i);
  });

  it('computes category whole-string accuracy and arithmetic fill accuracy', () => {
    const report = buildReport(
      [
        prediction({
          category: 'digits',
          expected: '1234',
          actual: '1234',
          confidence: 0.98,
        }),
        prediction({
          category: 'digits',
          expected: '5678',
          actual: '567B',
          confidence: 0.95,
        }),
        prediction({
          category: 'arithmetic',
          expected: '8x3',
          expectedFill: '24',
          actual: '8x3',
          actualFill: '24',
          confidence: 0.97,
        }),
        prediction({
          category: 'arithmetic',
          expected: '9-4',
          expectedFill: '5',
          actual: '9-4',
          actualFill: '6',
        }),
      ],
      { ...PACKAGE_OPTIONS, packageSizeBytes: 13_500_000 },
    );

    expect(report.categories.digits.wholeStringAccuracy).toBe(0.5);
    expect(report.categories.arithmetic.wholeStringAccuracy).toBe(1);
    expect(report.categories.arithmetic.fillAccuracy).toBe(0.5);
  });

  it('computes character accuracy from aggregate Levenshtein distance', () => {
    const report = buildReport(
      [
        prediction({ category: 'letters', expected: 'kitten', actual: 'sitting' }),
        prediction({ category: 'letters', expected: 'abc', actual: 'abc' }),
      ],
      PACKAGE_OPTIONS,
    );

    expect(report.categories.letters.characterAccuracy).toBeCloseTo(2 / 3);
    expect(report.characterAccuracy).toBeCloseTo(2 / 3);
  });

  it('reports median and nearest-rank p95 warm latency', () => {
    const warmLatencies = [40, 10, 30, 20, 100];
    const report = buildReport(
      warmLatencies.map((warmLatencyMs, index) =>
        prediction({
          category: 'alphanumeric',
          expected: String(index),
          actual: String(index),
          warmLatencyMs,
        }),
      ),
      PACKAGE_OPTIONS,
    );

    expect(report.medianWarmLatencyMs).toBe(30);
    expect(report.p95WarmLatencyMs).toBe(100);
  });

  it('averages the two middle values for an even warm-latency sample count', () => {
    const report = buildReport(
      [10, 20, 30, 40].map((warmLatencyMs, index) => prediction({
        category: 'digits',
        expected: String(index),
        actual: String(index),
        warmLatencyMs,
      })),
      { packageSizeBytes: 1, packageSizeScope: 'install-footprint' },
    );
    expect(report.medianWarmLatencyMs).toBe(25);
  });

  it('reports cold initialization and package-size contribution', () => {
    const report = buildReport(
      [
        prediction({
          category: 'digits',
          expected: '1',
          actual: '1',
          coldInitMs: 321.5,
        }),
      ],
      { ...PACKAGE_OPTIONS, packageSizeBytes: 24_000_000 },
    );

    expect(report.coldInitMs).toBe(321.5);
    expect(report.packageSizeBytes).toBe(24_000_000);
    expect(report.packageSizeScope).toBe('install-footprint');
  });

  it('defines false high confidence as wrong strings at least 0.90 over all predictions', () => {
    const report = buildReport(
      [
        prediction({ category: 'digits', expected: '1', actual: '7', confidence: 0.9 }),
        prediction({ category: 'letters', expected: 'A', actual: 'B', confidence: 0.99 }),
        prediction({ category: 'letters', expected: 'C', actual: 'D', confidence: 0.89 }),
        prediction({ category: 'digits', expected: '2', actual: '2', confidence: 0.99 }),
      ],
      PACKAGE_OPTIONS,
    );

    expect(report.falseHighConfidenceCount).toBe(2);
    expect(report.falseHighConfidenceRate).toBe(0.5);
  });
});
