import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { replaceAtomically } from '../../benchmark/atomic-files';
import {
  PPOCRV6_TRAINING_SOURCE,
  trainingAssetPaths,
  verifyTrainingCheckpoint,
} from './assets';

export async function fetchTrainingCheckpoint(
  root: string,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const response = await fetchImpl(PPOCRV6_TRAINING_SOURCE.checkpointUrl);
  if (!response.ok) {
    throw new Error(`Failed to download PP-OCRv6 tiny training checkpoint: HTTP ${response.status}`);
  }
  const checkpoint = new Uint8Array(await response.arrayBuffer());
  verifyTrainingCheckpoint(checkpoint);
  const paths = trainingAssetPaths(root);
  await mkdir(paths.directory, { recursive: true });
  const staged = path.join(paths.directory, `.checkpoint.stage-${randomUUID()}`);
  await writeFile(staged, checkpoint, { flag: 'wx' });
  await replaceAtomically([{ stagedPath: staged, targetPath: paths.checkpoint }]);
}

export async function main(): Promise<void> {
  await fetchTrainingCheckpoint(process.cwd());
  console.log('Verified official PP-OCRv6 tiny training checkpoint');
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  await main();
}
