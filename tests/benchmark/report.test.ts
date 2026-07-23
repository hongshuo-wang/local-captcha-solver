import { describe, expect, it } from 'vitest';

import { renderMarkdown } from '../../benchmark/run';
import { ARITHMETIC_OPERATOR_GROUPS, buildReport } from '../../benchmark/report';
import type { BenchmarkPrediction } from '../../benchmark/report';
import type { HardGateResult } from '../../benchmark/gate';

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

  it('groups arithmetic expected labels by normalized operator and reports fill accuracy', () => {
    const report = buildReport(
      [
        prediction({ category: 'arithmetic', expected: '1+2', expectedFill: '3', actual: '1+2', actualFill: '3' }),
        prediction({ category: 'arithmetic', expected: '8-3', expectedFill: '5', actual: '8-8', actualFill: '5' }),
        prediction({ category: 'arithmetic', expected: '2x3', expectedFill: '6', actual: '2x3', actualFill: '6' }),
        prediction({ category: 'arithmetic', expected: '3X2', expectedFill: '6', actual: '3X2', actualFill: '4' }),
        prediction({ category: 'arithmetic', expected: '4×2', expectedFill: '8', actual: '4+4', actualFill: '8' }),
        prediction({ category: 'arithmetic', expected: '9*2', expectedFill: '18', actual: '9+9', actualFill: '18' }),
        prediction({ category: 'arithmetic', expected: '8÷2', expectedFill: '4', actual: '8÷2', actualFill: '4' }),
        prediction({ category: 'arithmetic', expected: '8/4', expectedFill: '2', actual: '8/4', actualFill: '7' }),
      ],
      PACKAGE_OPTIONS,
    );

    expect(report.arithmeticByOperator.addition).toMatchObject({
      sampleCount: 1,
      wholeStringAccuracy: 1,
      fillAccuracy: 1,
    });
    expect(report.arithmeticByOperator.subtraction).toMatchObject({
      sampleCount: 1,
      wholeStringAccuracy: 0,
      fillAccuracy: 1,
    });
    expect(report.arithmeticByOperator.multiplication).toMatchObject({
      sampleCount: 4,
      wholeStringAccuracy: 0.5,
      fillAccuracy: 0.75,
    });
    expect(report.arithmeticByOperator.division).toMatchObject({
      sampleCount: 2,
      wholeStringAccuracy: 1,
      fillAccuracy: 0.5,
    });
  });

  it('reports selective metrics at confidence 0.90 for ordinary and arithmetic scopes', () => {
    const report = buildReport(
      [
        prediction({ category: 'digits', expected: '1', actual: '1', confidence: 0.9 }),
        prediction({ category: 'letters', expected: 'A', actual: 'B', confidence: 0.91 }),
        prediction({ category: 'alphanumeric', expected: 'C1', actual: 'C1', confidence: 0.89 }),
        prediction({ category: 'arithmetic', expected: '1+2', expectedFill: '3', actual: '1+9', actualFill: '3', confidence: 0.9 }),
        prediction({ category: 'arithmetic', expected: '6/2', expectedFill: '3', actual: '6/2', actualFill: '2', confidence: 0.91 }),
        prediction({ category: 'arithmetic', expected: '2x2', expectedFill: '4', actual: '2x2', actualFill: '4', confidence: 0.89 }),
      ],
      PACKAGE_OPTIONS,
    );

    expect(report.selectiveAt90.ordinary).toEqual({
      threshold: 0.9,
      acceptedCount: 2,
      coverage: 2 / 3,
      precision: 0.5,
    });
    expect(report.selectiveAt90.arithmetic).toEqual({
      threshold: 0.9,
      acceptedCount: 2,
      coverage: 2 / 3,
      precision: 0.5,
    });
  });

  it('returns zeroed operator metrics and null precision for scopes with no accepted predictions', () => {
    const report = buildReport(
      [
        prediction({ category: 'digits', expected: '1', actual: '1', confidence: 0.89 }),
        prediction({ category: 'arithmetic', expected: '1+1', expectedFill: '2', actual: '1+1', actualFill: '2', confidence: 0.89 }),
      ],
      PACKAGE_OPTIONS,
    );

    expect(report.arithmeticByOperator.subtraction).toEqual({
      sampleCount: 0,
      wholeStringAccuracy: 0,
      fillAccuracy: 0,
    });
    expect(report.arithmeticByOperator.multiplication).toEqual({
      sampleCount: 0,
      wholeStringAccuracy: 0,
      fillAccuracy: 0,
    });
    expect(report.arithmeticByOperator.division).toEqual({
      sampleCount: 0,
      wholeStringAccuracy: 0,
      fillAccuracy: 0,
    });
    expect(report.selectiveAt90.ordinary).toEqual({
      threshold: 0.9,
      acceptedCount: 0,
      coverage: 0,
      precision: null,
    });
    expect(report.selectiveAt90.arithmetic).toEqual({
      threshold: 0.9,
      acceptedCount: 0,
      coverage: 0,
      precision: null,
    });
  });

  it('rejects arithmetic expected labels without a supported operator', () => {
    expect(() => buildReport([
      prediction({ category: 'arithmetic', expected: '12=12', expectedFill: '12', actual: '12=12', actualFill: '12' }),
    ], PACKAGE_OPTIONS)).toThrow(/operator/i);
  });
});

describe('renderMarkdown', () => {
  it('renders both engine operator rows and scoped selective metrics with n/a precision', () => {
    const ddddocrMetrics = buildReport(
      [
        prediction({ category: 'digits', expected: '1', actual: '1', confidence: 0.9 }),
        prediction({ category: 'arithmetic', expected: '1+1', expectedFill: '2', actual: '1+1', actualFill: '2', confidence: 0.89 }),
        prediction({ category: 'arithmetic', expected: '2-1', expectedFill: '1', actual: '2-1', actualFill: '1', confidence: 0.89 }),
        prediction({ category: 'arithmetic', expected: '2x2', expectedFill: '4', actual: '2x2', actualFill: '4', confidence: 0.89 }),
        prediction({ category: 'arithmetic', expected: '4/2', expectedFill: '2', actual: '4/2', actualFill: '2', confidence: 0.89 }),
      ],
      PACKAGE_OPTIONS,
    );
    const tesseractMetrics = buildReport(
      [
        prediction({ engine: 'tesseract', category: 'digits', expected: '1', actual: '1', confidence: 0.89 }),
        prediction({ engine: 'tesseract', category: 'arithmetic', expected: '1+1', expectedFill: '2', actual: '1+1', actualFill: '2', confidence: 0.9 }),
        prediction({ engine: 'tesseract', category: 'arithmetic', expected: '2-1', expectedFill: '1', actual: '2-1', actualFill: '1', confidence: 0.9 }),
        prediction({ engine: 'tesseract', category: 'arithmetic', expected: '2x2', expectedFill: '4', actual: '2x2', actualFill: '4', confidence: 0.9 }),
        prediction({ engine: 'tesseract', category: 'arithmetic', expected: '4/2', expectedFill: '2', actual: '4/2', actualFill: '2', confidence: 0.9 }),
      ],
      PACKAGE_OPTIONS,
    );
    const gate: HardGateResult = {
      ordinaryWholeStringThreshold: 0.9,
      arithmeticFillThreshold: 0.9,
      ordinaryWholeStringAccuracy: 1,
      arithmeticFillAccuracy: 1,
      passed: true,
    };

    const output = renderMarkdown(10, { metrics: ddddocrMetrics }, { metrics: tesseractMetrics }, gate);

    for (const engine of ['ddddocr', 'tesseract']) {
      for (const operator of ARITHMETIC_OPERATOR_GROUPS) {
        expect(output).toContain(`| ${engine} | ${operator} | 1 |`);
      }
    }
    expect(output).toContain('| ddddocr | ordinary | 1 | 100.00% | 100.00% |');
    expect(output).toContain('| ddddocr | arithmetic | 0 | 0.00% | n/a |');
    expect(output).toContain('| tesseract | ordinary | 0 | 0.00% | n/a |');
    expect(output).toContain('| tesseract | arithmetic | 4 | 100.00% | 100.00% |');
  });
});
