import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import AdmZip from 'adm-zip';
import { parse } from 'csv-parse/sync';

import { readMathCaptcha10kArchive } from './import-mathcaptcha10k';
import { mergeTrainingDataset } from './materialize-dataset';
import type { MaterializedTrainingSample } from './materialize-dataset';
import {
  PUBLIC_DATASETS,
  publicDatasetArchivePath,
  publicDatasetById,
  verifyPublicDatasetArchive,
} from './public-datasets';
import type { PublicDataset, VerifiedPublicDataset } from './public-datasets';

function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function compareNames(left: { readonly entryName: string }, right: { readonly entryName: string }): number {
  return left.entryName < right.entryName ? -1 : left.entryName > right.entryName ? 1 : 0;
}

export function readParsasamArchive(
  archiveBytes: Buffer,
  dataset: VerifiedPublicDataset,
  expectedSampleCount = 113_062,
): readonly MaterializedTrainingSample[] {
  verifyPublicDatasetArchive(archiveBytes, dataset);
  const entries = new AdmZip(archiveBytes).getEntries().filter((entry) => !entry.isDirectory).sort(compareNames);
  if (entries.length !== expectedSampleCount) {
    throw new RangeError(`Expected ${expectedSampleCount} parsasam samples, received ${entries.length}`);
  }
  const lowercaseNames = new Set<string>();
  return entries.map((entry) => {
    const match = /^([A-Za-z0-9]{5})\.jpg$/.exec(entry.entryName);
    if (match === null || lowercaseNames.has(entry.entryName.toLowerCase())) {
      throw new TypeError(`Invalid or case-colliding parsasam filename: ${entry.entryName}`);
    }
    const bytes = entry.getData();
    if (bytes[0] !== 0xff || bytes[1] !== 0xd8) {
      throw new TypeError(`Invalid JPEG payload: ${entry.entryName}`);
    }
    lowercaseNames.add(entry.entryName.toLowerCase());
    return {
      bytes,
      manifest: {
        id: `public-${dataset.id}-${match[1]}`,
        split: 'train',
        source: 'public',
        group: dataset.group,
        image: `data/images/public/${dataset.id}/${entry.entryName}`,
        label: match[1],
        sha256: sha256(bytes),
        licenseId: dataset.licenseId,
      },
    };
  });
}

interface DigitCaptchaRow {
  readonly image_path: string;
  readonly solution: string;
}

interface DaniilnxyMathRow {
  readonly image: string;
  readonly label: string;
}

export function readDaniilnxyMathArchive(
  archiveBytes: Buffer,
  dataset: VerifiedPublicDataset,
  expectedSourceCount = 16_192,
  expectedImportedCount = 12_121,
): readonly MaterializedTrainingSample[] {
  verifyPublicDatasetArchive(archiveBytes, dataset);
  const archive = new AdmZip(archiveBytes);
  const csv = archive.getEntry('math_problem_captcha_datt.csv');
  if (csv === null || csv.isDirectory) throw new Error('Missing math_problem_captcha_datt.csv');
  const rows = parse(csv.getData(), {
    bom: true,
    columns: true,
    skip_empty_lines: true,
    trim: true,
  }) as Record<string, string>[];
  if (rows.length !== expectedSourceCount) {
    throw new RangeError(`Expected ${expectedSourceCount} daniilnxy rows, received ${rows.length}`);
  }

  const sourceNames = new Set<string>();
  const imported: MaterializedTrainingSample[] = [];
  for (const [index, record] of rows.entries()) {
    if (Object.keys(record).sort().join(',') !== 'image,label') {
      throw new TypeError(`Unexpected daniilnxy CSV columns at row ${index + 2}`);
    }
    const row = record as unknown as DaniilnxyMathRow;
    const match = /^(\d{1,3})([+-])(\d{1,3})\.png$/.exec(row.image);
    if (match === null || sourceNames.has(row.image)) {
      throw new TypeError(`Invalid or duplicate daniilnxy row ${index + 2}`);
    }
    const left = Number(match[1]);
    const right = Number(match[3]);
    const result = match[2] === '+' ? left + right : left - right;
    if (row.label !== String(result)) {
      throw new TypeError(`Incorrect daniilnxy result at row ${index + 2}`);
    }
    const sourcePath = `math_problems_captcha_dt/${row.image}`;
    const entry = archive.getEntry(sourcePath);
    if (entry === null || entry.isDirectory) throw new Error(`Missing image: ${sourcePath}`);
    const bytes = entry.getData();
    if (bytes[0] !== 0x89 || bytes[1] !== 0x50 || bytes[2] !== 0x4e || bytes[3] !== 0x47) {
      throw new TypeError(`Invalid PNG payload: ${sourcePath}`);
    }
    sourceNames.add(row.image);
    if (result < 0) continue;

    const operatorName = match[2] === '+' ? 'plus' : 'minus';
    const targetName = `${left}-${operatorName}-${right}.png`;
    imported.push({
      bytes,
      manifest: {
        id: `public-${dataset.id}-${left}-${operatorName}-${right}`,
        split: 'train',
        source: 'public',
        group: dataset.group,
        image: `data/images/public/${dataset.id}/${targetName}`,
        label: `${left}${match[2]}${right}`,
        sha256: sha256(bytes),
        licenseId: dataset.licenseId,
      },
    });
  }
  const files = archive.getEntries().filter((entry) => !entry.isDirectory);
  if (files.length !== expectedSourceCount + 1) {
    throw new RangeError(`Expected ${expectedSourceCount + 1} daniilnxy archive files, received ${files.length}`);
  }
  if (imported.length !== expectedImportedCount) {
    throw new RangeError(`Expected ${expectedImportedCount} supported daniilnxy samples, received ${imported.length}`);
  }
  return imported;
}

export function readHuthayfahodebArchive(
  archiveBytes: Buffer,
  dataset: VerifiedPublicDataset,
  expectedSampleCount = 10_000,
): readonly MaterializedTrainingSample[] {
  verifyPublicDatasetArchive(archiveBytes, dataset);
  const archive = new AdmZip(archiveBytes);
  const csv = archive.getEntry('captcha_data.csv');
  if (csv === null || csv.isDirectory) throw new Error('Missing captcha_data.csv');
  const rows = parse(csv.getData(), {
    bom: true,
    columns: true,
    skip_empty_lines: true,
    trim: true,
  }) as Record<string, string>[];
  if (rows.length !== expectedSampleCount) {
    throw new RangeError(`Expected ${expectedSampleCount} huthayfahodeb samples, received ${rows.length}`);
  }
  const sourcePaths = new Set<string>();
  return rows.map((record, index) => {
    if (Object.keys(record).sort().join(',') !== 'image_path,solution') {
      throw new TypeError(`Unexpected huthayfahodeb CSV columns at row ${index + 2}`);
    }
    const row = record as unknown as DigitCaptchaRow;
    const match = /^(train|validation|test)-images\/(image_(?:train|validation|test)_\d+\.png)$/.exec(row.image_path);
    if (match === null || !/^\d{6}$/.test(row.solution) || sourcePaths.has(row.image_path)) {
      throw new TypeError(`Invalid huthayfahodeb row ${index + 2}`);
    }
    const sourcePath = `${match[1]}-images/${match[1]}-images/${match[2]}`;
    const entry = archive.getEntry(sourcePath);
    if (entry === null || entry.isDirectory) throw new Error(`Missing image: ${sourcePath}`);
    const bytes = entry.getData();
    if (bytes[0] !== 0x89 || bytes[1] !== 0x50 || bytes[2] !== 0x4e || bytes[3] !== 0x47) {
      throw new TypeError(`Invalid PNG payload: ${sourcePath}`);
    }
    sourcePaths.add(row.image_path);
    const targetName = `${match[1]}-${match[2]}`;
    return {
      bytes,
      manifest: {
        id: `public-${dataset.id}-${targetName.slice(0, -4)}`,
        split: 'train',
        source: 'public',
        group: dataset.group,
        image: `data/images/public/${dataset.id}/${targetName}`,
        label: row.solution,
        sha256: sha256(bytes),
        licenseId: dataset.licenseId,
      },
    };
  });
}

export async function importPublicDataset(
  root: string,
  id: string,
  datasets: readonly PublicDataset[] = PUBLIC_DATASETS,
): Promise<{ readonly imported: number; readonly manifestPath: string }> {
  const dataset = publicDatasetById(id, datasets);
  if (dataset.status !== 'verified') throw new Error(`${id} is not verified`);
  const bytes = await readFile(publicDatasetArchivePath(root, dataset));
  const imported = id === 'mathcaptcha10k-v6'
    ? readMathCaptcha10kArchive(bytes, dataset)
    : id === 'parsasam-captcha-v1'
      ? readParsasamArchive(bytes, dataset)
      : id === 'huthayfahodeb-captcha-v2'
        ? readHuthayfahodebArchive(bytes, dataset)
        : id === 'daniilnxy-math-problem-captcha-v1'
          ? readDaniilnxyMathArchive(bytes, dataset)
        : (() => { throw new Error(`No importer for public dataset: ${id}`); })();
  return mergeTrainingDataset(root, dataset, imported);
}

export async function main(argumentsList = process.argv.slice(2)): Promise<void> {
  if (argumentsList.length !== 1) {
    throw new Error('Usage: npm run training:public:import -- <dataset-id>');
  }
  const result = await importPublicDataset(process.cwd(), argumentsList[0]);
  console.log(`Imported ${result.imported} verified samples into ${result.manifestPath}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  await main();
}
