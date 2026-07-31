import { access, readdir, stat } from 'node:fs/promises';
import path from 'node:path';

import { interpretResult } from '../src/core/result-interpreter';
import type { InterpretedResult, OcrResult } from '../src/core/types';
import type { CorpusSample } from './corpus';
import type { BenchmarkEngine, BenchmarkPrediction } from './report';

export interface FootprintEntry {
  readonly label: string;
  readonly path: string;
}

async function treeSize(filePath: string): Promise<number> {
  const metadata = await stat(filePath);
  if (metadata.isFile()) return metadata.size;
  if (!metadata.isDirectory()) return 0;
  const entries = await readdir(filePath);
  const sizes = await Promise.all(entries.map((entry) => treeSize(path.join(filePath, entry))));
  return sizes.reduce((sum, size) => sum + size, 0);
}

export async function calculateFootprint(entries: readonly FootprintEntry[]): Promise<number> {
  const sizes = await Promise.all(entries.map((entry) => treeSize(entry.path)));
  return sizes.reduce((sum, size) => sum + size, 0);
}

export async function validateLocalResources(
  root: string,
  resources: readonly string[],
): Promise<void> {
  const resolvedRoot = path.resolve(root);
  for (const resource of resources) {
    if (!path.isAbsolute(resource) || /^[a-z]+:\/\//i.test(resource)) {
      throw new Error(`Benchmark resource must be an absolute local path: ${resource}`);
    }
    const resolved = path.resolve(resource);
    const relative = path.relative(resolvedRoot, resolved);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new Error(`Benchmark resource must stay within checkout root: ${resource}`);
    }
    await access(resolved);
  }
}

type Interpret = (result: OcrResult) => InterpretedResult;

export function predictionFromRecognition(
  sample: CorpusSample,
  result: OcrResult,
  engine: BenchmarkEngine,
  coldInitMs: number,
  warmLatencyMs: number,
  interpret: Interpret = interpretResult,
): BenchmarkPrediction {
  const interpreted = interpret(result);
  const actualFill = interpreted.kind === 'plain' || interpreted.kind === 'arithmetic'
    ? interpreted.fillValue
    : undefined;
  return {
    engine,
    category: sample.category,
    expected: sample.answer,
    ...(sample.fill === undefined ? {} : { expectedFill: sample.fill }),
    actual: result.text,
    ...(actualFill === undefined ? {} : { actualFill }),
    confidence: result.confidence,
    coldInitMs,
    warmLatencyMs,
  };
}
