export type BenchmarkCategory = 'digits' | 'letters' | 'alphanumeric' | 'arithmetic';
export type BenchmarkEngine = 'ddddocr' | 'tesseract';

export interface BenchmarkPrediction {
  readonly engine: BenchmarkEngine;
  readonly category: BenchmarkCategory;
  readonly expected: string;
  readonly expectedFill?: string;
  readonly actual: string;
  readonly actualFill?: string;
  readonly confidence: number;
  readonly coldInitMs: number;
  readonly warmLatencyMs: number;
}

export interface CategoryMetrics {
  readonly sampleCount: number;
  readonly wholeStringAccuracy: number;
  readonly characterAccuracy: number;
  readonly fillAccuracy?: number;
}

export interface BenchmarkMetrics {
  readonly sampleCount: number;
  readonly categories: Record<BenchmarkCategory, CategoryMetrics>;
  readonly wholeStringAccuracy: number;
  readonly characterAccuracy: number;
  readonly falseHighConfidenceCount: number;
  readonly falseHighConfidenceRate: number;
  readonly coldInitMs: number;
  readonly medianWarmLatencyMs: number;
  readonly p95WarmLatencyMs: number;
  readonly packageSizeBytes: number;
}

function levenshteinDistance(left: string, right: string): number {
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);

  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = [leftIndex];
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      current[rightIndex] = Math.min(
        current[rightIndex - 1] + 1,
        previous[rightIndex] + 1,
        previous[rightIndex - 1] + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1),
      );
    }
    previous = current;
  }

  return previous[right.length];
}

function characterAccuracy(predictions: readonly BenchmarkPrediction[]): number {
  const expectedCharacters = predictions.reduce((sum, item) => sum + item.expected.length, 0);
  if (expectedCharacters === 0) {
    return 0;
  }

  const edits = predictions.reduce(
    (sum, item) => sum + levenshteinDistance(item.expected, item.actual),
    0,
  );
  return Math.max(0, 1 - edits / expectedCharacters);
}

function percentile(sorted: readonly number[], percentileValue: number): number {
  if (sorted.length === 0) {
    return 0;
  }
  const index = Math.max(0, Math.ceil(percentileValue * sorted.length) - 1);
  return sorted[index];
}

function median(sorted: readonly number[]): number {
  if (sorted.length === 0) {
    return 0;
  }
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

function categoryMetrics(predictions: readonly BenchmarkPrediction[]): CategoryMetrics {
  const correctStrings = predictions.filter((item) => item.expected === item.actual).length;
  const arithmetic = predictions.filter((item) => item.category === 'arithmetic');
  const fillAccuracy = arithmetic.length === 0
    ? undefined
    : arithmetic.filter((item) => item.expectedFill === item.actualFill).length / arithmetic.length;

  return {
    sampleCount: predictions.length,
    wholeStringAccuracy: predictions.length === 0 ? 0 : correctStrings / predictions.length,
    characterAccuracy: characterAccuracy(predictions),
    ...(fillAccuracy === undefined ? {} : { fillAccuracy }),
  };
}

export function buildReport(
  predictions: readonly BenchmarkPrediction[],
  options: { readonly packageSizeBytes: number },
): BenchmarkMetrics {
  const categories = {} as Record<BenchmarkCategory, CategoryMetrics>;
  for (const category of ['digits', 'letters', 'alphanumeric', 'arithmetic'] as const) {
    const matches = predictions.filter((item) => item.category === category);
    categories[category] = categoryMetrics(matches);
  }

  const warmLatencies = predictions.map((item) => item.warmLatencyMs).sort((a, b) => a - b);
  const correctStrings = predictions.filter((item) => item.expected === item.actual).length;
  const falseHighConfidenceCount = predictions.filter(
    (item) => item.expected !== item.actual && item.confidence >= 0.9,
  ).length;

  return {
    sampleCount: predictions.length,
    categories,
    wholeStringAccuracy: predictions.length === 0 ? 0 : correctStrings / predictions.length,
    characterAccuracy: characterAccuracy(predictions),
    falseHighConfidenceCount,
    falseHighConfidenceRate:
      predictions.length === 0 ? 0 : falseHighConfidenceCount / predictions.length,
    coldInitMs: Math.max(0, ...predictions.map((item) => item.coldInitMs)),
    medianWarmLatencyMs: median(warmLatencies),
    p95WarmLatencyMs: percentile(warmLatencies, 0.95),
    packageSizeBytes: options.packageSizeBytes,
  };
}
