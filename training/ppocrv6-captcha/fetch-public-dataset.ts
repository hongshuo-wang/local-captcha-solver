import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { replaceAtomically } from '../../benchmark/atomic-files';
import {
  PUBLIC_DATASETS,
  publicDatasetArchivePath,
  publicDatasetById,
  publicDatasetDownloadUrl,
  verifyPublicDatasetArchive,
} from './public-datasets';
import type { PublicDataset } from './public-datasets';

export async function fetchPublicDataset(
  root: string,
  id: string,
  fetchImpl: typeof fetch = fetch,
  datasets: readonly PublicDataset[] = PUBLIC_DATASETS,
): Promise<{ readonly path: string; readonly downloaded: boolean }> {
  const dataset = publicDatasetById(id, datasets);
  if (dataset.status !== 'verified') {
    throw new Error(`${dataset.id} is not approved for download: ${dataset.reviewBlocker}`);
  }
  const archivePath = publicDatasetArchivePath(root, dataset);
  try {
    verifyPublicDatasetArchive(new Uint8Array(await readFile(archivePath)), dataset);
    return { path: archivePath, downloaded: false };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }

  const response = await fetchImpl(publicDatasetDownloadUrl(dataset));
  if (!response.ok) {
    throw new Error(`Failed to download ${dataset.id}: HTTP ${response.status}`);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  verifyPublicDatasetArchive(bytes, dataset);
  await mkdir(path.dirname(archivePath), { recursive: true });
  const staged = path.join(path.dirname(archivePath), `.${dataset.id}.stage-${randomUUID()}`);
  await writeFile(staged, bytes, { flag: 'wx' });
  await replaceAtomically([{ stagedPath: staged, targetPath: archivePath }]);
  return { path: archivePath, downloaded: true };
}

export async function main(argumentsList = process.argv.slice(2)): Promise<void> {
  if (argumentsList.length !== 1) {
    throw new Error('Usage: npm run training:public:fetch -- <dataset-id>');
  }
  const result = await fetchPublicDataset(process.cwd(), argumentsList[0]);
  console.log(`${result.downloaded ? 'Downloaded and verified' : 'Already verified'} ${argumentsList[0]} at ${result.path}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  await main();
}
