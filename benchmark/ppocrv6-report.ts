import { buildReport } from './report';
import type { BenchmarkMetrics, BenchmarkPrediction } from './report';

export const PPOCRV6_TARGET_SYMBOLS = ['*', '/', '×', '÷', '=', '?', 'x', 'X'] as const;
export type PpOcrV6TargetSymbol = typeof PPOCRV6_TARGET_SYMBOLS[number];

export interface SymbolMetrics {
  readonly expectedCount: number;
  readonly correctCount: number;
  readonly recall: number | null;
  readonly confusions: Readonly<Record<string, number>>;
}

export interface PpOcrV6BenchmarkReport {
  readonly base: BenchmarkMetrics;
  readonly sourceCounts: { readonly generated: number; readonly real: number };
  readonly rawArithmeticTextAccuracy: number;
  readonly realExactAccuracy: number | null;
  readonly symbols: Readonly<Record<PpOcrV6TargetSymbol, SymbolMetrics>>;
  readonly modelBytes: number;
  readonly sharedRuntimeBytes: number;
}

function alignedCharacters(expected: string, actual: string): Array<readonly [string, string | null]> {
  const rows = expected.length + 1;
  const columns = actual.length + 1;
  const costs = Array.from({ length: rows }, () => new Array<number>(columns).fill(0));
  for (let row = 0; row < rows; row += 1) costs[row][0] = row;
  for (let column = 0; column < columns; column += 1) costs[0][column] = column;
  for (let row = 1; row < rows; row += 1) {
    for (let column = 1; column < columns; column += 1) {
      costs[row][column] = Math.min(
        costs[row - 1][column] + 1,
        costs[row][column - 1] + 1,
        costs[row - 1][column - 1] + (expected[row - 1] === actual[column - 1] ? 0 : 1),
      );
    }
  }
  const reversed: Array<readonly [string, string | null]> = [];
  let row = expected.length;
  let column = actual.length;
  while (row > 0 || column > 0) {
    if (
      row > 0 && column > 0
      && costs[row][column] === costs[row - 1][column - 1]
        + (expected[row - 1] === actual[column - 1] ? 0 : 1)
    ) {
      reversed.push([expected[row - 1], actual[column - 1]]);
      row -= 1;
      column -= 1;
    } else if (row > 0 && costs[row][column] === costs[row - 1][column] + 1) {
      reversed.push([expected[row - 1], null]);
      row -= 1;
    } else {
      column -= 1;
    }
  }
  return reversed.reverse();
}

function buildSymbolMetrics(
  predictions: readonly BenchmarkPrediction[],
): Record<PpOcrV6TargetSymbol, SymbolMetrics> {
  const result = {} as Record<PpOcrV6TargetSymbol, SymbolMetrics>;
  for (const symbol of PPOCRV6_TARGET_SYMBOLS) {
    let expectedCount = 0;
    let correctCount = 0;
    const confusions: Record<string, number> = {};
    for (const prediction of predictions) {
      for (const [expected, actual] of alignedCharacters(prediction.expected, prediction.actual)) {
        if (expected !== symbol) continue;
        expectedCount += 1;
        if (actual === symbol) {
          correctCount += 1;
        } else {
          const label = actual ?? '<deleted>';
          confusions[label] = (confusions[label] ?? 0) + 1;
        }
      }
    }
    result[symbol] = {
      expectedCount,
      correctCount,
      recall: expectedCount === 0 ? null : correctCount / expectedCount,
      confusions,
    };
  }
  return result;
}

export function buildPpOcrV6Report(
  predictions: readonly BenchmarkPrediction[],
  sizes: { readonly modelBytes: number; readonly sharedRuntimeBytes: number },
): PpOcrV6BenchmarkReport {
  if (predictions.some((prediction) => prediction.source === undefined)) {
    throw new TypeError('PP-OCRv6 predictions must identify generated or real source');
  }
  const arithmetic = predictions.filter((prediction) => prediction.category === 'arithmetic');
  const real = predictions.filter((prediction) => prediction.source === 'real');
  return {
    base: buildReport(predictions, {
      packageSizeBytes: sizes.modelBytes,
      packageSizeScope: 'model-only bytes; shared runtime reported separately',
    }),
    sourceCounts: {
      generated: predictions.filter((prediction) => prediction.source === 'generated').length,
      real: real.length,
    },
    rawArithmeticTextAccuracy: arithmetic.length === 0
      ? 0
      : arithmetic.filter((prediction) => prediction.expected === prediction.actual).length / arithmetic.length,
    realExactAccuracy: real.length === 0
      ? null
      : real.filter((prediction) => (
        prediction.expected === prediction.actual
        && (prediction.category !== 'arithmetic' || prediction.expectedFill === prediction.actualFill)
      )).length / real.length,
    symbols: buildSymbolMetrics(predictions),
    modelBytes: sizes.modelBytes,
    sharedRuntimeBytes: sizes.sharedRuntimeBytes,
  };
}
