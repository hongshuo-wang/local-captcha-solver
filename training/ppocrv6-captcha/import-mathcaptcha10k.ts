import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import AdmZip from 'adm-zip';
import { parse } from 'csv-parse/sync';

import { parseArithmetic } from '../../src/core/arithmetic';
import { mergeTrainingDataset } from './materialize-dataset';
import type { MaterializedTrainingSample } from './materialize-dataset';
import {
  PUBLIC_DATASETS,
  publicDatasetArchivePath,
  publicDatasetById,
  verifyPublicDatasetArchive,
} from './public-datasets';
import type { PublicDataset, VerifiedPublicDataset } from './public-datasets';

const DATASET_ID = 'mathcaptcha10k-v6';
const CSV_PATH = 'mathcaptcha10k.csv';
const IMAGE_PREFIX = 'Captcha_Images/';
const EXPECTED_SAMPLE_COUNT = 10_000;
const VERIFIED_RESULT_CORRECTIONS = new Map([
  [
    '15e46f2baf9a47289b900d66fc7a8cec.png',
    { label: '50+50=?', upstreamResult: '0', correctedResult: '100' },
  ],
]);

interface MathCaptchaRow {
  readonly filename: string;
  readonly ocr_text: string;
  readonly result: string;
}

function parseRows(csv: Buffer): readonly MathCaptchaRow[] {
  const records = parse(csv, {
    bom: true,
    columns: true,
    skip_empty_lines: true,
    trim: true,
  }) as Record<string, string>[];
  return records.map((record, index) => {
    const keys = Object.keys(record).sort();
    if (keys.join(',') !== 'filename,ocr_text,result') {
      throw new TypeError(`MathCaptcha10k row ${index + 2} has unexpected columns`);
    }
    return record as unknown as MathCaptchaRow;
  });
}

export function readMathCaptcha10kArchive(
  archiveBytes: Buffer,
  dataset: VerifiedPublicDataset,
  expectedSampleCount = EXPECTED_SAMPLE_COUNT,
): readonly MaterializedTrainingSample[] {
  verifyPublicDatasetArchive(archiveBytes, dataset);
  const archive = new AdmZip(archiveBytes);
  const csv = archive.getEntry(CSV_PATH);
  if (csv === null || csv.isDirectory) throw new Error(`Missing ${CSV_PATH}`);
  const rows = parseRows(csv.getData());
  if (rows.length !== expectedSampleCount) {
    throw new RangeError(`Expected ${expectedSampleCount} MathCaptcha10k labels, received ${rows.length}`);
  }

  const filenames = new Set<string>();
  return rows.map((row, index) => {
    if (!/^[0-9a-f]{32}\.png$/.test(row.filename) || filenames.has(row.filename)) {
      throw new TypeError(`Invalid or duplicate MathCaptcha10k filename at row ${index + 2}`);
    }
    if (!/^\d{1,2}[+-]\d{1,2}=\?$/.test(row.ocr_text)) {
      throw new TypeError(`Unsupported MathCaptcha10k label at row ${index + 2}: ${row.ocr_text}`);
    }
    const arithmetic = parseArithmetic(row.ocr_text);
    const correction = VERIFIED_RESULT_CORRECTIONS.get(row.filename);
    const verifiedCorrection = correction !== undefined
      && correction.label === row.ocr_text
      && correction.upstreamResult === row.result
      && correction.correctedResult === arithmetic?.value;
    if (arithmetic === null || (arithmetic.value !== row.result && !verifiedCorrection)) {
      throw new TypeError(`Incorrect MathCaptcha10k result at row ${index + 2}`);
    }
    const entry = archive.getEntry(`${IMAGE_PREFIX}${row.filename}`);
    if (entry === null || entry.isDirectory) {
      throw new Error(`Missing labeled MathCaptcha10k image: ${row.filename}`);
    }
    const bytes = entry.getData();
    filenames.add(row.filename);
    return {
      bytes,
      manifest: {
        id: `public-${DATASET_ID}-${row.filename.slice(0, -4)}`,
        split: 'train',
        source: 'public',
        group: dataset.group,
        image: `data/images/public/${DATASET_ID}/${row.filename}`,
        label: row.ocr_text,
        sha256: createHash('sha256').update(bytes).digest('hex'),
        licenseId: dataset.licenseId,
      },
    };
  });
}

export async function importMathCaptcha10k(
  root: string,
  datasets: readonly PublicDataset[] = PUBLIC_DATASETS,
): Promise<{ readonly imported: number; readonly manifestPath: string }> {
  const dataset = publicDatasetById(DATASET_ID, datasets);
  if (dataset.status !== 'verified') throw new Error(`${DATASET_ID} is not verified`);
  const archivePath = publicDatasetArchivePath(root, dataset);
  const imported = readMathCaptcha10kArchive(await readFile(archivePath), dataset);
  return mergeTrainingDataset(root, dataset, imported);
}

export async function main(): Promise<void> {
  const result = await importMathCaptcha10k(process.cwd());
  console.log(`Imported ${result.imported} verified samples into ${result.manifestPath}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  await main();
}
