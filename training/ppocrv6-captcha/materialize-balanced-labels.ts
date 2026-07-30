import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import type { TrainingDatasetSample } from './materialize-dataset';

const DEFAULT_TARGET_PER_CATEGORY = 80_000;
const SEED = 0x4d7a91c3;
const ARITHMETIC = /^(?:\d+)([+*/xX×÷-])(?:\d+)(?:=\?|=|\?)?$/;
const OPERATORS = ['+', '-', '*', '/', 'x', 'X', '×', '÷'] as const;

function mulberry32(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value = (value + 0x6d2b79f5) >>> 0;
    let mixed = value;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function shuffle<T>(values: readonly T[], random: () => number): T[] {
  const shuffled = [...values];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const selected = Math.floor(random() * (index + 1));
    [shuffled[index], shuffled[selected]] = [shuffled[selected], shuffled[index]];
  }
  return shuffled;
}

export function trainingBucket(label: string): string {
  const arithmetic = ARITHMETIC.exec(label);
  if (arithmetic !== null) return `arithmetic:${arithmetic[1]}`;
  if (/^\d+$/.test(label)) return 'digits';
  if (/^[A-Za-z]+$/.test(label)) return 'letters';
  if (/^[A-Za-z0-9]+$/.test(label)) return 'alphanumeric';
  throw new TypeError(`Unsupported training label: ${label}`);
}

function select(
  source: readonly TrainingDatasetSample[],
  count: number,
  random: () => number,
): TrainingDatasetSample[] {
  if (source.length === 0) throw new RangeError('Cannot balance an empty training bucket');
  const selected: TrainingDatasetSample[] = [];
  while (selected.length < count) {
    selected.push(...shuffle(source, random).slice(0, count - selected.length));
  }
  return selected;
}

export function balancedTrainingSamples(
  samples: readonly TrainingDatasetSample[],
  targetPerCategory = DEFAULT_TARGET_PER_CATEGORY,
  seed = SEED,
): readonly TrainingDatasetSample[] {
  if (!Number.isSafeInteger(targetPerCategory) || targetPerCategory <= 0 || targetPerCategory % OPERATORS.length !== 0) {
    throw new RangeError('Target per category must be a positive multiple of eight');
  }
  const training = samples.filter((sample) => sample.split === 'train');
  const buckets = new Map<string, TrainingDatasetSample[]>();
  for (const sample of training) {
    const bucket = trainingBucket(sample.label);
    buckets.set(bucket, [...(buckets.get(bucket) ?? []), sample]);
  }
  const random = mulberry32(seed);
  const arithmeticTarget = targetPerCategory / OPERATORS.length;
  const balanced = [
    ...select(buckets.get('digits') ?? [], targetPerCategory, random),
    ...select(buckets.get('letters') ?? [], targetPerCategory, random),
    ...select(buckets.get('alphanumeric') ?? [], targetPerCategory, random),
    ...OPERATORS.flatMap((operator) => select(
      buckets.get(`arithmetic:${operator}`) ?? [],
      arithmeticTarget,
      random,
    )),
  ];
  return shuffle(balanced, random);
}

export async function materializeBalancedLabels(
  root: string,
  targetPerCategory = DEFAULT_TARGET_PER_CATEGORY,
): Promise<{ readonly samples: number; readonly outputPath: string }> {
  const dataDirectory = path.join(root, 'training', 'ppocrv6-captcha', 'data');
  const manifest = JSON.parse(await readFile(path.join(dataDirectory, 'manifest.json'), 'utf8')) as {
    readonly samples: TrainingDatasetSample[];
  };
  const balanced = balancedTrainingSamples(manifest.samples, targetPerCategory);
  const outputPath = path.join(dataDirectory, 'train-balanced.txt');
  const labels = balanced.map((sample) => `training/ppocrv6-captcha/${sample.image}\t${sample.label}`);
  await writeFile(outputPath, `${labels.join('\n')}\n`);
  return { samples: balanced.length, outputPath };
}

export async function main(argumentsList = process.argv.slice(2)): Promise<void> {
  if (argumentsList.length > 1) throw new Error('Usage: materialize-balanced-labels.ts [target-per-category]');
  const target = argumentsList[0] === undefined ? DEFAULT_TARGET_PER_CATEGORY : Number(argumentsList[0]);
  const result = await materializeBalancedLabels(process.cwd(), target);
  console.log(`Materialized ${result.samples} balanced labels at ${result.outputPath}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  await main();
}
