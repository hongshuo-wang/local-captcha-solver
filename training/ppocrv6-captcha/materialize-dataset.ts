import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { validateDatasetManifest } from './dataset';
import type { VerifiedPublicDataset } from './public-datasets';

export interface TrainingDatasetSample {
  readonly id: string;
  readonly split: 'train' | 'validation' | 'test';
  readonly source: 'synthetic' | 'public' | 'real';
  readonly group: string;
  readonly image: string;
  readonly label: string;
  readonly sha256: string;
  readonly licenseId: string;
}

export interface MaterializedTrainingSample {
  readonly manifest: TrainingDatasetSample;
  readonly bytes: Buffer;
}

export interface TrainingDatasetLicense {
  readonly id: string;
  readonly name: string;
  readonly url: string | null;
  readonly redistribution: boolean;
}

function object(value: unknown, context: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${context} must be an object`);
  }
  return value as Record<string, unknown>;
}

export async function mergeTrainingManifest(
  root: string,
  source: { readonly groups: ReadonlySet<string>; readonly license: TrainingDatasetLicense },
  imported: readonly TrainingDatasetSample[],
): Promise<{ readonly imported: number; readonly manifestPath: string }> {
  const dataDirectory = path.join(root, 'training', 'ppocrv6-captcha', 'data');
  const manifestPath = path.join(dataDirectory, 'manifest.json');
  const existing = object(JSON.parse(await readFile(manifestPath, 'utf8')), 'dataset manifest');
  if (!Array.isArray(existing.licenses) || !Array.isArray(existing.samples)) {
    throw new TypeError('Dataset manifest must contain licenses and samples arrays');
  }
  const licenses = [
    ...existing.licenses.filter((entry) => object(entry, 'license').id !== source.license.id),
    source.license,
  ];
  const samples = [
    ...existing.samples.filter((entry) => !source.groups.has(String(object(entry, 'sample').group))),
    ...imported,
  ];
  const manifest = { schemaVersion: 1, licenses, samples };
  const charset = (await readFile(
    path.join(root, 'training', 'ppocrv6-captcha', 'charset.txt'),
    'utf8',
  )).replace(/\r/g, '').split('\n').filter((character) => character !== '');
  if (charset.some((character) => Array.from(character).length !== 1)) {
    throw new TypeError('Training charset must contain exactly one character per line');
  }
  let frozenBenchmarkHashes = new Set<string>();
  try {
    const real = object(JSON.parse(await readFile(path.join(root, 'benchmark', 'corpus.real.json'), 'utf8')), 'real benchmark');
    if (Array.isArray(real.samples)) {
      frozenBenchmarkHashes = new Set(real.samples.map((entry) => String(object(entry, 'real sample').sha256)));
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  validateDatasetManifest(manifest, {
    alphabet: charset,
    maximumLabelLength: 12,
    frozenBenchmarkHashes,
  });

  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  await writeFile(
    path.join(dataDirectory, 'licenses.json'),
    `${JSON.stringify({ schemaVersion: 1, licenses }, null, 2)}\n`,
  );
  for (const split of ['train', 'validation'] as const) {
    const labels = samples
      .filter((sample) => object(sample, 'sample').split === split)
      .map((sample) => {
        const entry = object(sample, 'sample');
        return `training/ppocrv6-captcha/${entry.image}\t${entry.label}`;
      });
    await writeFile(path.join(dataDirectory, `${split}.txt`), labels.length ? `${labels.join('\n')}\n` : '');
  }
  return { imported: imported.length, manifestPath };
}

export async function mergeTrainingDataset(
  root: string,
  dataset: VerifiedPublicDataset,
  imported: readonly MaterializedTrainingSample[],
): Promise<{ readonly imported: number; readonly manifestPath: string }> {
  for (const sample of imported) {
    const target = path.join(root, 'training', 'ppocrv6-captcha', sample.manifest.image);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, sample.bytes);
  }
  return mergeTrainingManifest(
    root,
    {
      groups: new Set([dataset.group]),
      license: {
        id: dataset.licenseId,
        name: dataset.licenseName,
        url: dataset.licenseUrl,
        redistribution: dataset.redistribution,
      },
    },
    imported.map((sample) => sample.manifest),
  );
}
