import { describe, expect, it } from 'vitest';

import { evaluatePpOcrV6Gate } from '../../benchmark/ppocrv6-gate';
import { buildPpOcrV6Report } from '../../benchmark/ppocrv6-report';
import type { BenchmarkPrediction } from '../../benchmark/report';
import {
  ppocrv6ExitCode,
  renderPpOcrV6Markdown,
} from '../../benchmark/run-ppocrv6';

function predictions(engine: 'ppocrv6-tiny' | 'ppocrv6-small'): BenchmarkPrediction[] {
  return [
    { engine, category: 'digits', expected: '1234', actual: '1234', confidence: 0.9, coldInitMs: 10, warmLatencyMs: 5, source: 'generated' },
    { engine, category: 'letters', expected: 'Abcd', actual: 'Abcd', confidence: 0.9, coldInitMs: 10, warmLatencyMs: 6, source: 'generated' },
    { engine, category: 'alphanumeric', expected: 'A1b2', actual: 'A1b2', confidence: 0.9, coldInitMs: 10, warmLatencyMs: 7, source: 'generated' },
    { engine, category: 'arithmetic', expected: '3*8', expectedFill: '24', actual: '3*8', actualFill: '24', confidence: 0.9, coldInitMs: 10, warmLatencyMs: 8, source: 'generated' },
  ];
}

function variant(variantName: 'tiny' | 'small') {
  const modelBytes = variantName === 'tiny' ? 4_462_639 : 21_159_378;
  const metrics = buildPpOcrV6Report(predictions(`ppocrv6-${variantName}`), {
    modelBytes,
    sharedRuntimeBytes: 100,
  });
  return {
    variant: variantName,
    modelName: `PP-OCRv6_${variantName}_rec`,
    charsetAudit: { supported: variantName === 'tiny', missing: variantName === 'tiny' ? [] : ['÷'] },
    metrics,
    gate: evaluatePpOcrV6Gate({
      charsetSupported: variantName === 'tiny',
      realSampleCount: 0,
      realExactAccuracy: null,
      ordinaryWholeStringAccuracy: 1,
      arithmeticFillAccuracy: 1,
      modelBytes,
      p95WarmLatencyMs: 8,
    }),
    predictions: predictions(`ppocrv6-${variantName}`),
  } as const;
}

describe('PP-OCRv6 benchmark runner output', () => {
  it('renders both variants, explicit real sample absence, charset audit, and gate status', () => {
    const markdown = renderPpOcrV6Markdown(200, 0, [variant('tiny'), variant('small')]);
    expect(markdown).toContain('Generated samples: 200');
    expect(markdown).toContain('Real samples: 0');
    expect(markdown).toContain('| tiny |');
    expect(markdown).toContain('| small |');
    expect(markdown).toContain('INCOMPLETE');
    expect(markdown).toContain('÷');
  });

  it('uses distinct exit codes for pass, fail, and incomplete', () => {
    expect(ppocrv6ExitCode([{ status: 'pass' }])).toBe(0);
    expect(ppocrv6ExitCode([{ status: 'pass' }, { status: 'fail' }])).toBe(2);
    expect(ppocrv6ExitCode([{ status: 'fail' }, { status: 'incomplete' }])).toBe(3);
  });
});
