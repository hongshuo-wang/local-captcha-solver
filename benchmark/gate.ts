import type { BenchmarkPrediction } from './report';

export interface HardGateResult {
  readonly ordinaryWholeStringThreshold: 0.9;
  readonly arithmeticFillThreshold: 0.9;
  readonly ordinaryWholeStringAccuracy: number;
  readonly arithmeticFillAccuracy: number;
  readonly passed: boolean;
}

export function evaluateHardGate(
  predictions: readonly BenchmarkPrediction[],
): HardGateResult {
  const ordinaryCategories = ['digits', 'letters', 'alphanumeric'] as const;
  for (const category of ordinaryCategories) {
    if (!predictions.some((prediction) => prediction.category === category)) {
      throw new RangeError(`Missing or empty ordinary category: ${category}`);
    }
  }
  const ordinary = predictions.filter((prediction) => prediction.category !== 'arithmetic');
  const arithmetic = predictions.filter((prediction) => prediction.category === 'arithmetic');
  if (arithmetic.length === 0) throw new RangeError('Missing or empty arithmetic category');

  const ordinaryWholeStringAccuracy = ordinary.filter(
    (prediction) => prediction.expected === prediction.actual,
  ).length / ordinary.length;
  const arithmeticFillAccuracy = arithmetic.filter(
    (prediction) => prediction.expectedFill === prediction.actualFill,
  ).length / arithmetic.length;
  return {
    ordinaryWholeStringThreshold: 0.9,
    arithmeticFillThreshold: 0.9,
    ordinaryWholeStringAccuracy,
    arithmeticFillAccuracy,
    passed: ordinaryWholeStringAccuracy >= 0.9 && arithmeticFillAccuracy >= 0.9,
  };
}

export function gateExitCode(gate: HardGateResult): 0 | 2 {
  return gate.passed ? 0 : 2;
}
