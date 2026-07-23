import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type { BenchmarkCategory } from './report';

interface RealSample {
  readonly id: string;
  readonly category: BenchmarkCategory;
  readonly image: string;
  readonly answer: string;
  readonly fill?: string;
  readonly sha256: string;
  readonly provenance: string;
  readonly license: string;
}

interface RealCorpus {
  readonly schemaVersion: 1;
  readonly samples: readonly RealSample[];
}

const ROOT = process.cwd();
const FIXTURE_DIRECTORY = path.join(ROOT, 'benchmark', 'fixtures', 'real');
const LABELS_PATH = path.join(ROOT, 'benchmark', 'corpus.real.json');
const CATEGORIES = new Set<BenchmarkCategory>([
  'digits',
  'letters',
  'alphanumeric',
  'arithmetic',
]);
const EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp']);

function parseArguments(argumentsList: readonly string[]): Record<string, string> {
  const values: Record<string, string> = {};
  for (let index = 0; index < argumentsList.length; index += 2) {
    const flag = argumentsList[index];
    const value = argumentsList[index + 1];
    if (!flag?.startsWith('--') || value === undefined || value.startsWith('--')) {
      throw new Error(`Expected --name value arguments; invalid token: ${flag ?? '<missing>'}`);
    }
    const name = flag.slice(2);
    if (values[name] !== undefined) {
      throw new Error(`Duplicate argument: --${name}`);
    }
    values[name] = value;
  }
  return values;
}

function required(values: Record<string, string>, name: string): string {
  const value = values[name]?.trim();
  if (!value) {
    throw new Error(`Missing required --${name}`);
  }
  return value;
}

async function loadCorpus(): Promise<RealCorpus> {
  try {
    return JSON.parse(await readFile(LABELS_PATH, 'utf8')) as RealCorpus;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { schemaVersion: 1, samples: [] };
    }
    throw error;
  }
}

async function main(): Promise<void> {
  const values = parseArguments(process.argv.slice(2));
  const allowedArguments = new Set(['image', 'answer', 'category', 'fill', 'provenance', 'license']);
  const unknown = Object.keys(values).find((name) => !allowedArguments.has(name));
  if (unknown) {
    throw new Error(`Unknown argument: --${unknown}`);
  }

  const sourceImage = path.resolve(required(values, 'image'));
  const answer = required(values, 'answer');
  const categoryValue = required(values, 'category');
  const provenance = required(values, 'provenance');
  const license = required(values, 'license');
  if (!CATEGORIES.has(categoryValue as BenchmarkCategory)) {
    throw new Error(`Invalid --category: ${categoryValue}`);
  }
  const category = categoryValue as BenchmarkCategory;
  const fill = values.fill?.trim();
  if (category === 'arithmetic' && !fill) {
    throw new Error('Arithmetic samples require --fill');
  }
  if (category !== 'arithmetic' && fill) {
    throw new Error('--fill is only valid for arithmetic samples');
  }

  const extension = path.extname(sourceImage).toLowerCase();
  if (!EXTENSIONS.has(extension)) {
    throw new Error(`Unsupported image extension: ${extension || '<none>'}`);
  }
  const bytes = await readFile(sourceImage);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const corpus = await loadCorpus();
  const existing = corpus.samples.find((sample) => sample.sha256 === sha256);
  if (existing) {
    const requested = { category, answer, fill, provenance, license };
    const recorded = {
      category: existing.category,
      answer: existing.answer,
      fill: existing.fill,
      provenance: existing.provenance,
      license: existing.license,
    };
    if (JSON.stringify(requested) !== JSON.stringify(recorded)) {
      throw new Error(`Image already exists with different labels or usage metadata: ${existing.id}`);
    }
    console.log(`Sample already imported: ${existing.id}`);
    return;
  }

  const id = `real-${sha256.slice(0, 16)}`;
  const destination = path.join(FIXTURE_DIRECTORY, `${sha256}${extension}`);
  const image = path.relative(ROOT, destination).split(path.sep).join('/');
  const sample: RealSample = {
    id,
    category,
    image,
    answer,
    ...(fill ? { fill } : {}),
    sha256,
    provenance,
    license,
  };

  await mkdir(FIXTURE_DIRECTORY, { recursive: true });
  await copyFile(sourceImage, destination);
  await writeFile(
    LABELS_PATH,
    `${JSON.stringify({ schemaVersion: 1, samples: [...corpus.samples, sample] }, null, 2)}\n`,
  );
  console.log(`Imported ${id} (${sha256})`);
}

await main();
