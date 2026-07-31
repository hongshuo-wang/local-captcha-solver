export const PPOCRV6_THRESHOLDS = Object.freeze({
  legacyOrdinaryBaseline: 0.6466666666666666,
  maximumOrdinaryRegression: 0.005,
  arithmeticFillAccuracy: 0.99,
  modelSizeTargetBytes: 5 * 1024 * 1024,
  p95WarmLatencyMs: 100,
});

export interface PpOcrV6GateInput {
  readonly charsetSupported: boolean;
  readonly realSampleCount: number;
  readonly realExactAccuracy: number | null;
  readonly ordinaryWholeStringAccuracy: number;
  readonly arithmeticFillAccuracy: number;
  readonly modelBytes: number;
  readonly p95WarmLatencyMs: number;
}

export interface PpOcrV6GateResult {
  readonly status: 'pass' | 'fail' | 'incomplete';
  readonly failedChecks: readonly string[];
  readonly thresholds: typeof PPOCRV6_THRESHOLDS;
}

export function evaluatePpOcrV6Gate(input: PpOcrV6GateInput): PpOcrV6GateResult {
  const failedChecks: string[] = [];
  if (!input.charsetSupported) failedChecks.push('charset');
  if (input.realSampleCount === 0) {
    failedChecks.push('real-samples-missing');
  } else if (input.realExactAccuracy !== 1) {
    failedChecks.push('real-exact-accuracy');
  }
  if (
    input.ordinaryWholeStringAccuracy
    < PPOCRV6_THRESHOLDS.legacyOrdinaryBaseline - PPOCRV6_THRESHOLDS.maximumOrdinaryRegression
  ) failedChecks.push('ordinary-regression');
  if (input.arithmeticFillAccuracy < PPOCRV6_THRESHOLDS.arithmeticFillAccuracy) {
    failedChecks.push('arithmetic-fill-accuracy');
  }
  if (input.p95WarmLatencyMs > PPOCRV6_THRESHOLDS.p95WarmLatencyMs) {
    failedChecks.push('warm-p95');
  }
  return {
    status: input.realSampleCount === 0 ? 'incomplete' : failedChecks.length === 0 ? 'pass' : 'fail',
    failedChecks,
    thresholds: PPOCRV6_THRESHOLDS,
  };
}
