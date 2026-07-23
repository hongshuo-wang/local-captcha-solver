import { parseArithmetic } from '../src/core/arithmetic';
import type { BenchmarkCategory } from './report';

export interface GenerationMetadata {
  readonly fontFamily: string;
  readonly fontFile: string;
  readonly fontSizePx: number;
  readonly foreground: string;
  readonly background: string;
  readonly contrastBand: '4.5:1' | '7:1' | '12:1' | '18:1';
  readonly interferenceLines: 1 | 2;
  readonly rotationDegrees: number;
}

export interface CorpusSample {
  readonly id: string;
  readonly category: BenchmarkCategory;
  readonly image: string;
  readonly answer: string;
  readonly fill?: string;
  readonly generation?: GenerationMetadata;
  readonly sha256?: string;
  readonly provenance?: string;
  readonly license?: string;
}

export interface GeneratedCorpusManifest {
  readonly schemaVersion: 1;
  readonly seed: number;
  readonly samples: readonly (CorpusSample & { readonly generation: GenerationMetadata })[];
}

export interface RealCorpusManifest {
  readonly schemaVersion: 1;
  readonly samples: readonly (CorpusSample & {
    readonly sha256: string;
    readonly provenance: string;
    readonly license: string;
  })[];
}

const CATEGORIES = ['digits', 'letters', 'alphanumeric', 'arithmetic'] as const;
const PLAIN_PATTERNS = {
  digits: /^[0-9]{4,6}$/,
  letters: /^[A-Za-z]{4,6}$/,
  alphanumeric: /^[A-Za-z0-9]{4,6}$/,
} as const;
const CONTRAST_BANDS = new Set(['4.5:1', '7:1', '12:1', '18:1']);

function record(value: unknown, context: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${context} must be an object`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[] = [],
  context = 'value',
): void {
  const keys = Object.keys(value);
  const allowed = new Set([...required, ...optional]);
  const missing = required.find((key) => !Object.hasOwn(value, key));
  const unknown = keys.find((key) => !allowed.has(key));
  if (missing) throw new TypeError(`${context} is missing ${missing}`);
  if (unknown) throw new TypeError(`${context} has unknown field ${unknown}`);
}

function nonemptyString(value: unknown, context: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`${context} must be a nonempty string`);
  }
  return value;
}

export function isBenchmarkCategory(value: unknown): value is BenchmarkCategory {
  return typeof value === 'string' && CATEGORIES.includes(value as BenchmarkCategory);
}

export function validateLabel(category: BenchmarkCategory, answerValue: unknown, fillValue: unknown): void {
  const answer = nonemptyString(answerValue, `${category} answer`);
  if (category === 'arithmetic') {
    const parsed = parseArithmetic(answer);
    if (parsed === null) throw new TypeError('Arithmetic answer must be a supported integer expression');
    const fill = nonemptyString(fillValue, 'arithmetic fill');
    if (fill !== parsed.value) throw new TypeError('Arithmetic fill must equal the calculated answer');
    return;
  }
  if (fillValue !== undefined) throw new TypeError(`${category} samples must not define fill`);
  if (!PLAIN_PATTERNS[category].test(answer)) {
    throw new TypeError(`${category} answer must contain 4-6 category characters`);
  }
}

function parseGeneration(value: unknown): GenerationMetadata {
  const generation = record(value, 'generation');
  exactKeys(generation, [
    'fontFamily', 'fontFile', 'fontSizePx', 'foreground', 'background', 'contrastBand',
    'interferenceLines', 'rotationDegrees',
  ], [], 'generation');
  nonemptyString(generation.fontFamily, 'fontFamily');
  const fontFile = nonemptyString(generation.fontFile, 'fontFile');
  if (!/^node_modules\/dejavu-fonts-ttf\/ttf\/[A-Za-z0-9-]+\.ttf$/.test(fontFile)) {
    throw new TypeError('fontFile must reference the pinned DejaVu package');
  }
  if (!Number.isInteger(generation.fontSizePx) || (generation.fontSizePx as number) < 30 || (generation.fontSizePx as number) > 48) {
    throw new RangeError('fontSizePx is out of range');
  }
  for (const color of ['foreground', 'background'] as const) {
    if (typeof generation[color] !== 'string' || !/^#[0-9a-f]{6}$/i.test(generation[color])) {
      throw new TypeError(`${color} must be a hex color`);
    }
  }
  if (!CONTRAST_BANDS.has(generation.contrastBand as string)) throw new TypeError('Invalid contrastBand');
  if (generation.interferenceLines !== 1 && generation.interferenceLines !== 2) {
    throw new RangeError('interferenceLines must be 1 or 2');
  }
  if (typeof generation.rotationDegrees !== 'number' || !Number.isFinite(generation.rotationDegrees) || Math.abs(generation.rotationDegrees) > 2) {
    throw new RangeError('rotationDegrees must be between -2 and 2');
  }
  return generation as unknown as GenerationMetadata;
}

function parseGeneratedSample(value: unknown): CorpusSample & { readonly generation: GenerationMetadata } {
  const sample = record(value, 'generated sample');
  exactKeys(sample, ['id', 'category', 'image', 'answer', 'generation'], ['fill'], 'generated sample');
  const id = nonemptyString(sample.id, 'sample id');
  if (!isBenchmarkCategory(sample.category)) throw new TypeError('Invalid generated category');
  if (!new RegExp(`^${sample.category}-\\d{3}$`).test(id)) throw new TypeError('Generated id/category mismatch');
  if (sample.image !== `benchmark/fixtures/generated/${id}.png`) {
    throw new TypeError('Generated image path must match its id');
  }
  validateLabel(sample.category, sample.answer, sample.fill);
  parseGeneration(sample.generation);
  return sample as unknown as CorpusSample & { readonly generation: GenerationMetadata };
}

export function parseGeneratedManifest(value: unknown): GeneratedCorpusManifest {
  const manifest = record(value, 'generated manifest');
  exactKeys(manifest, ['schemaVersion', 'seed', 'samples'], [], 'generated manifest');
  if (manifest.schemaVersion !== 1) throw new TypeError('Generated schemaVersion must be 1');
  if (!Number.isSafeInteger(manifest.seed) || (manifest.seed as number) < 0) throw new TypeError('Generated seed must be a nonnegative integer');
  if (!Array.isArray(manifest.samples) || manifest.samples.length !== 200) {
    throw new RangeError('Generated manifest must contain exactly 200 samples');
  }
  const samples = manifest.samples.map(parseGeneratedSample);
  for (const category of CATEGORIES) {
    if (samples.filter((sample) => sample.category === category).length !== 50) {
      throw new RangeError(`Generated manifest must contain exactly 50 ${category} samples`);
    }
  }
  if (new Set(samples.map((sample) => sample.id)).size !== samples.length) {
    throw new TypeError('Generated sample ids must be unique');
  }
  return { schemaVersion: 1, seed: manifest.seed as number, samples };
}

function parseRealSample(value: unknown): RealCorpusManifest['samples'][number] {
  const sample = record(value, 'real sample');
  exactKeys(
    sample,
    ['id', 'category', 'image', 'answer', 'sha256', 'provenance', 'license'],
    ['fill'],
    'real sample',
  );
  if (!isBenchmarkCategory(sample.category)) throw new TypeError('Invalid real category');
  const sha256 = nonemptyString(sample.sha256, 'sha256');
  if (!/^[0-9a-f]{64}$/.test(sha256)) throw new TypeError('sha256 must be lowercase hexadecimal');
  if (sample.id !== `real-${sha256.slice(0, 16)}`) throw new TypeError('Real sample id must match sha256');
  const image = nonemptyString(sample.image, 'real image path');
  if (!new RegExp(`^benchmark/fixtures/real/${sha256}\\.(png|jpg|jpeg|webp)$`).test(image)) {
    throw new TypeError('Real image path must use its sha256 under the fixture directory');
  }
  validateLabel(sample.category, sample.answer, sample.fill);
  nonemptyString(sample.provenance, 'provenance');
  nonemptyString(sample.license, 'license');
  return sample as unknown as RealCorpusManifest['samples'][number];
}

export function parseRealManifest(value: unknown): RealCorpusManifest {
  const manifest = record(value, 'real manifest');
  exactKeys(manifest, ['schemaVersion', 'samples'], [], 'real manifest');
  if (manifest.schemaVersion !== 1) throw new TypeError('Real schemaVersion must be 1');
  if (!Array.isArray(manifest.samples)) throw new TypeError('Real samples must be an array');
  const samples = manifest.samples.map(parseRealSample);
  if (new Set(samples.map((sample) => sample.sha256)).size !== samples.length) {
    throw new TypeError('Real sample hashes must be unique');
  }
  return { schemaVersion: 1, samples };
}
