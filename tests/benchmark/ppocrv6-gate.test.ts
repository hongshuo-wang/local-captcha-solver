import { describe, expect, it } from 'vitest';

import { evaluatePpOcrV6Gate } from '../../benchmark/ppocrv6-gate';

function candidate(overrides: Record<string, unknown> = {}) {
  return {
    charsetSupported: true,
    realSampleCount: 2,
    realExactAccuracy: 1,
    ordinaryWholeStringAccuracy: 0.6467,
    arithmeticFillAccuracy: 0.99,
    modelBytes: 4_462_639,
    p95WarmLatencyMs: 90,
    ...overrides,
  };
}

describe('PP-OCRv6 release gate', () => {
  it('passes only when every fixed acceptance threshold is met', () => {
    const gate = evaluatePpOcrV6Gate(candidate());
    expect(gate.status).toBe('pass');
    expect(gate.failedChecks).toEqual([]);
  });

  it('is incomplete when no authorized real sample exists even if other checks pass', () => {
    const gate = evaluatePpOcrV6Gate(candidate({ realSampleCount: 0, realExactAccuracy: null }));
    expect(gate.status).toBe('incomplete');
    expect(gate.failedChecks).toContain('real-samples-missing');
  });

  it('fails missing characters, accuracy regressions, and slow P95', () => {
    const gate = evaluatePpOcrV6Gate(candidate({
      charsetSupported: false,
      realExactAccuracy: 0.5,
      ordinaryWholeStringAccuracy: 0.63,
      arithmeticFillAccuracy: 0.98,
      modelBytes: 9 * 1024 * 1024,
      p95WarmLatencyMs: 101,
    }));
    expect(gate.status).toBe('fail');
    expect(gate.failedChecks).toEqual([
      'charset',
      'real-exact-accuracy',
      'ordinary-regression',
      'arithmetic-fill-accuracy',
      'warm-p95',
    ]);
  });

  it('reports model size without treating the optimization target as a hard gate', () => {
    const gate = evaluatePpOcrV6Gate(candidate({ modelBytes: 100 * 1024 * 1024 }));
    expect(gate.status).toBe('pass');
    expect(gate.thresholds.modelSizeTargetBytes).toBe(5 * 1024 * 1024);
  });
});
