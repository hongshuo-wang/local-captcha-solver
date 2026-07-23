import { createHash, randomUUID } from 'node:crypto';
import {
  link,
  mkdir,
  open,
  readFile,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { loadImage } from '@napi-rs/canvas';

import {
  parseRealManifest,
  validateLabel,
} from './corpus';
import type { RealCorpusManifest } from './corpus';
import type { BenchmarkCategory } from './report';

export interface ImportRequest {
  readonly root: string;
  readonly sourceImage: string;
  readonly answer: string;
  readonly category: BenchmarkCategory;
  readonly fill?: string;
  readonly provenance: string;
  readonly license: string;
}

export interface ImportHooks {
  beforeManifestCommit?(): void | Promise<void>;
}

export interface ImportResult {
  readonly status: 'imported' | 'duplicate';
  readonly id: string;
  readonly sha256: string;
}

const ALLOWED_ARGUMENTS = new Set(['image', 'answer', 'category', 'fill', 'provenance', 'license']);
const CATEGORIES = new Set<BenchmarkCategory>(['digits', 'letters', 'alphanumeric', 'arithmetic']);
const EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp']);

function required(values: Record<string, string>, name: string): string {
  const value = values[name]?.trim();
  if (!value) throw new Error(`Missing required --${name}`);
  return value;
}

export function parseImportArguments(argumentsList: readonly string[]): Omit<ImportRequest, 'root'> {
  const values: Record<string, string> = {};
  for (let index = 0; index < argumentsList.length; index += 2) {
    const flag = argumentsList[index];
    const value = argumentsList[index + 1];
    if (!flag?.startsWith('--') || value === undefined || value.startsWith('--')) {
      throw new Error(`Expected --name value arguments; invalid token: ${flag ?? '<missing>'}`);
    }
    const name = flag.slice(2);
    if (!ALLOWED_ARGUMENTS.has(name)) throw new Error(`Unknown argument: --${name}`);
    if (values[name] !== undefined) throw new Error(`Duplicate argument: --${name}`);
    values[name] = value;
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
  if (values.fill !== undefined && !fill) throw new Error('--fill must be nonempty');
  validateLabel(category, answer, fill);
  return {
    sourceImage,
    answer,
    category,
    ...(fill === undefined ? {} : { fill }),
    provenance,
    license,
  };
}

async function acquireLock(lockPath: string): Promise<() => Promise<void>> {
  for (let attempt = 0; attempt < 500; attempt += 1) {
    try {
      const handle = await open(lockPath, 'wx');
      await handle.writeFile(`${process.pid}\n`);
      await handle.close();
      return async () => rm(lockPath, { force: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      await new Promise<void>((resolve) => setTimeout(resolve, 10));
    }
  }
  throw new Error('Timed out waiting for real-sample import lock');
}

async function readManifest(labelsPath: string): Promise<RealCorpusManifest> {
  try {
    return parseRealManifest(JSON.parse(await readFile(labelsPath, 'utf8')));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { schemaVersion: 1, samples: [] };
    }
    throw error;
  }
}

async function decodeImage(bytes: Buffer): Promise<void> {
  let decoded;
  try {
    decoded = await loadImage(bytes);
  } catch (cause) {
    throw new Error('Image decode failed', { cause });
  }
  if (!Number.isSafeInteger(decoded.width) || decoded.width <= 0 || !Number.isSafeInteger(decoded.height) || decoded.height <= 0) {
    throw new Error('Decoded image dimensions must be positive');
  }
}

export async function importRealSample(
  request: ImportRequest,
  hooks: ImportHooks = {},
): Promise<ImportResult> {
  const provenance = request.provenance.trim();
  const license = request.license.trim();
  if (!provenance) throw new Error('Missing required provenance');
  if (!license) throw new Error('Missing required license');
  validateLabel(request.category, request.answer, request.fill);

  const sourceImage = path.resolve(request.sourceImage);
  const extension = path.extname(sourceImage).toLowerCase();
  if (!EXTENSIONS.has(extension)) throw new Error(`Unsupported image extension: ${extension || '<none>'}`);
  const bytes = await readFile(sourceImage);
  await decodeImage(bytes);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const id = `real-${sha256.slice(0, 16)}`;
  const benchmarkDirectory = path.join(request.root, 'benchmark');
  const fixtureDirectory = path.join(benchmarkDirectory, 'fixtures', 'real');
  const labelsPath = path.join(benchmarkDirectory, 'corpus.real.json');
  const lockPath = path.join(benchmarkDirectory, '.corpus.real.lock');
  await mkdir(fixtureDirectory, { recursive: true });
  const releaseLock = await acquireLock(lockPath);
  const transaction = randomUUID();
  const destination = path.join(fixtureDirectory, `${sha256}${extension}`);
  const stagedImage = path.join(fixtureDirectory, `.${sha256}.stage-${transaction}${extension}`);
  const stagedManifest = path.join(benchmarkDirectory, `.corpus.real.stage-${transaction}.json`);
  let createdDestination = false;

  try {
    const corpus = await readManifest(labelsPath);
    const existing = corpus.samples.find((sample) => sample.sha256 === sha256);
    if (existing) {
      if (
        existing.category !== request.category ||
        existing.answer !== request.answer ||
        existing.fill !== request.fill ||
        existing.provenance !== provenance ||
        existing.license !== license
      ) {
        throw new Error(`Image already exists with different labels or usage metadata: ${existing.id}`);
      }
      return { status: 'duplicate', id, sha256 };
    }

    await writeFile(stagedImage, bytes, { flag: 'wx' });
    try {
      await link(stagedImage, destination);
      createdDestination = true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      const existingHash = createHash('sha256').update(await readFile(destination)).digest('hex');
      if (existingHash !== sha256) throw new Error('Hash destination exists with unexpected content');
    }
    await rm(stagedImage, { force: true });

    const image = path.relative(request.root, destination).split(path.sep).join('/');
    const sample = {
      id,
      category: request.category,
      image,
      answer: request.answer,
      ...(request.fill === undefined ? {} : { fill: request.fill }),
      sha256,
      provenance,
      license,
    };
    const next = parseRealManifest({ schemaVersion: 1, samples: [...corpus.samples, sample] });
    await writeFile(stagedManifest, `${JSON.stringify(next, null, 2)}\n`, { flag: 'wx' });
    await hooks.beforeManifestCommit?.();
    await rename(stagedManifest, labelsPath);
    return { status: 'imported', id, sha256 };
  } catch (error) {
    if (createdDestination) await rm(destination, { force: true });
    throw error;
  } finally {
    await Promise.all([
      rm(stagedImage, { force: true }),
      rm(stagedManifest, { force: true }),
    ]);
    await releaseLock();
  }
}

async function main(): Promise<void> {
  const request = parseImportArguments(process.argv.slice(2));
  const result = await importRealSample({ root: process.cwd(), ...request });
  console.log(`${result.status === 'imported' ? 'Imported' : 'Sample already imported'} ${result.id} (${result.sha256})`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  await main();
}
