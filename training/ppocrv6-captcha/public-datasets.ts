import { createHash } from 'node:crypto';
import path from 'node:path';

export type PublicDatasetCategory = 'digits' | 'letters' | 'alphanumeric' | 'arithmetic';

interface PublicDatasetBase {
  readonly id: string;
  readonly title: string;
  readonly pageUrl: string;
  readonly kaggleRef: string;
  readonly version: number;
  readonly archiveBytes: number;
  readonly licenseId: string;
  readonly licenseName: string;
  readonly licenseUrl: string;
  readonly redistribution: boolean;
  readonly categories: readonly PublicDatasetCategory[];
  readonly group: string;
  readonly limitations: readonly string[];
}

export interface VerifiedPublicDataset extends PublicDatasetBase {
  readonly status: 'verified';
  readonly archiveSha256: string;
}

export interface CandidatePublicDataset extends PublicDatasetBase {
  readonly status: 'candidate';
  readonly reviewBlocker: string;
}

export type PublicDataset = VerifiedPublicDataset | CandidatePublicDataset;

export const PUBLIC_DATASETS: readonly PublicDataset[] = Object.freeze([
  {
    id: 'mathcaptcha10k-v6',
    title: 'MathCaptcha10k',
    pageUrl: 'https://www.kaggle.com/datasets/atalaydenknalbant/mathcaptcha10k',
    kaggleRef: 'atalaydenknalbant/mathcaptcha10k',
    version: 6,
    archiveBytes: 267_310_995,
    archiveSha256: 'fa20dd01ffc6ab29e7e033732891580cf6a8070c96dbccea2c5660031ecedc35',
    licenseId: 'CC-BY-4.0',
    licenseName: 'Creative Commons Attribution 4.0 International',
    licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
    redistribution: true,
    categories: ['arithmetic'],
    group: 'public-kaggle-mathcaptcha10k-v6',
    limitations: [
      'One CaptchaMvc.Mvc5 generator family; training-only, not independent validation.',
      'Contains 10,000 labeled one- or two-digit addition/subtraction expressions only.',
      'Does not cover multiplication, division, alternative operators, or suffix variants.',
    ],
    status: 'verified',
  },
  {
    id: 'parsasam-captcha-v1',
    title: 'CAPTCHA Dataset',
    pageUrl: 'https://www.kaggle.com/datasets/parsasam/captcha-dataset',
    kaggleRef: 'parsasam/captcha-dataset',
    version: 1,
    archiveBytes: 373_215_334,
    archiveSha256: '457fa927cede0aca83170f9178e784eee0262f48fed4ce8e857836d0d5326756',
    licenseId: 'CC0-1.0',
    licenseName: 'CC0 1.0 Universal',
    licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
    redistribution: true,
    categories: ['alphanumeric'],
    group: 'public-kaggle-parsasam-captcha-v1',
    limitations: [
      'One Gregwar/PHP generator family with 113,062 fixed five-character labels.',
      'Training-only; filename labels and all JPEG payloads were audited with no duplicate hashes.',
    ],
    status: 'verified',
  },
  {
    id: 'huthayfahodeb-captcha-v2',
    title: 'Captcha Dataset',
    pageUrl: 'https://www.kaggle.com/datasets/huthayfahodeb/captcha-dataset',
    kaggleRef: 'huthayfahodeb/captcha-dataset',
    version: 2,
    archiveBytes: 148_853_394,
    archiveSha256: '39a611c62722e22fe8819d5b00028019fdb62195cf3dd6bcd1b5f4b3cbaa907c',
    licenseId: 'CC0-1.0',
    licenseName: 'CC0 1.0 Universal',
    licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
    redistribution: true,
    categories: ['digits'],
    group: 'public-kaggle-huthayfahodeb-captcha-v2',
    limitations: [
      'One undocumented visual generator family with 10,000 fixed six-digit labels.',
      'Training-only; upstream train/validation/test folders are intentionally merged into one group.',
      'CSV paths, PNG payloads, labels, and hashes were audited with no duplicate images.',
    ],
    status: 'verified',
  },
  {
    id: 'daniilnxy-math-problem-captcha-v1',
    title: 'Math problem CAPTCHA images',
    pageUrl: 'https://www.kaggle.com/datasets/daniilnxy/math-problem-captcha-images',
    kaggleRef: 'daniilnxy/math-problem-captcha-images',
    version: 1,
    archiveBytes: 139_708_774,
    archiveSha256: '192fe17f39ffe3f9876b18fda11b0d3e4102ed7ded6f37c29df7c24f0a5dca32',
    licenseId: 'Apache-2.0',
    licenseName: 'Apache License 2.0',
    licenseUrl: 'https://www.apache.org/licenses/LICENSE-2.0',
    redistribution: true,
    categories: ['arithmetic'],
    group: 'public-kaggle-daniilnxy-math-problem-captcha-v1',
    limitations: [
      'One undocumented visual generator family; training-only, not independent validation.',
      'Kaggle declares Apache-2.0 for the dataset; the archive contains no separate license or generator source file.',
      'Contains 16,192 labeled addition/subtraction images; 4,071 negative-result subtractions are excluded, leaving 12,121 supported samples.',
      'Does not cover multiplication, division, alternative operators, or suffix variants.',
    ],
    status: 'verified',
  },
]);

export function publicDatasetById(
  id: string,
  datasets: readonly PublicDataset[] = PUBLIC_DATASETS,
): PublicDataset {
  const dataset = datasets.find((entry) => entry.id === id);
  if (!dataset) throw new Error(`Unknown public dataset: ${id}`);
  return dataset;
}

export function publicDatasetDownloadUrl(dataset: PublicDataset): string {
  return `https://www.kaggle.com/api/v1/datasets/download/${dataset.kaggleRef}?datasetVersionNumber=${dataset.version}`;
}

export function publicDatasetArchivePath(root: string, dataset: PublicDataset): string {
  return path.join(
    root,
    'training',
    'ppocrv6-captcha',
    'downloads',
    `${dataset.id}.zip`,
  );
}

export function verifyPublicDatasetArchive(
  bytes: Uint8Array,
  dataset: VerifiedPublicDataset,
): void {
  if (bytes.byteLength !== dataset.archiveBytes) {
    throw new Error(
      `${dataset.id} archive bytes mismatch: expected ${dataset.archiveBytes}, received ${bytes.byteLength}`,
    );
  }
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  if (sha256 !== dataset.archiveSha256) {
    throw new Error(
      `${dataset.id} archive SHA-256 mismatch: expected ${dataset.archiveSha256}, received ${sha256}`,
    );
  }
}

export function validatePublicDatasetCatalog(
  datasets: readonly PublicDataset[] = PUBLIC_DATASETS,
): void {
  const ids = new Set<string>();
  const groups = new Set<string>();
  for (const dataset of datasets) {
    if (!/^[a-z0-9-]+$/.test(dataset.id) || ids.has(dataset.id)) {
      throw new TypeError(`Invalid or duplicate public dataset id: ${dataset.id}`);
    }
    if (!dataset.pageUrl.startsWith('https://') || !dataset.licenseUrl.startsWith('https://')) {
      throw new TypeError(`${dataset.id} URLs must use HTTPS`);
    }
    if (!/^[-A-Za-z0-9]+\/[-A-Za-z0-9]+$/.test(dataset.kaggleRef)) {
      throw new TypeError(`${dataset.id} has an invalid Kaggle reference`);
    }
    if (!Number.isSafeInteger(dataset.version) || dataset.version <= 0) {
      throw new TypeError(`${dataset.id} version must be a positive integer`);
    }
    if (!Number.isSafeInteger(dataset.archiveBytes) || dataset.archiveBytes <= 0) {
      throw new TypeError(`${dataset.id} archiveBytes must be a positive integer`);
    }
    if (groups.has(dataset.group)) {
      throw new TypeError(`Duplicate public dataset group: ${dataset.group}`);
    }
    if (dataset.categories.length === 0 || dataset.limitations.length === 0) {
      throw new TypeError(`${dataset.id} must record categories and limitations`);
    }
    if (dataset.status === 'verified' && !/^[0-9a-f]{64}$/.test(dataset.archiveSha256)) {
      throw new TypeError(`${dataset.id} must pin a lowercase SHA-256`);
    }
    if (dataset.status === 'candidate' && dataset.reviewBlocker.trim() === '') {
      throw new TypeError(`${dataset.id} candidate must record a review blocker`);
    }
    ids.add(dataset.id);
    groups.add(dataset.group);
  }
}
