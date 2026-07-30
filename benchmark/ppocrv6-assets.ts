import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { promisify } from 'node:util';

import { replaceAtomically } from './atomic-files';

const execFileAsync = promisify(execFile);

export type PpOcrV6Variant = 'tiny' | 'small';

export interface PpOcrV6Asset {
  readonly modelName: string;
  readonly url: string;
  readonly archiveBytes: number;
  readonly archiveSha256: string;
  readonly modelBytes: number;
  readonly modelSha256: string;
  readonly configBytes: number;
  readonly configSha256: string;
}

export const PPOCRV6_ASSETS = {
  tiny: {
    modelName: 'PP-OCRv6_tiny_rec',
    url: 'https://paddle-model-ecology.bj.bcebos.com/paddlex/official_inference_model/paddle3.0.0/PP-OCRv6_tiny_rec_onnx_infer.tar',
    archiveBytes: 4_526_080,
    archiveSha256: '1e13b22717b1edd89d4cde4fda272b6c17d5b505c97c2baea99da1a3a2d54b29',
    modelBytes: 4_462_639,
    modelSha256: '9ef676d6ed3c88256a2d92c640c44f25b0c40947e111b14b8be8f594091563e6',
    configBytes: 55_571,
    configSha256: '66170210bad538e83fff3c4a3867e547d6bf20b50d64b20347c4b913f3034ea1',
  },
  small: {
    modelName: 'PP-OCRv6_small_rec',
    url: 'https://paddle-model-ecology.bj.bcebos.com/paddlex/official_inference_model/paddle3.0.0/PP-OCRv6_small_rec_onnx_infer.tar',
    archiveBytes: 21_319_680,
    archiveSha256: 'd267ab077a44a0eedb1ea8f8c542d263f211de8e9d7a029bf9fcfff7e5a88fb1',
    modelBytes: 21_159_378,
    modelSha256: '5435fd747c9e0efe15a96d0b378d5bd157e9492ed8fd80edf08f30d02fa24634',
    configBytes: 150_579,
    configSha256: 'ab078671bb49f06228eadccd34f1bb501e157f7a047095ffb943ba81512c77d1',
  },
} as const satisfies Record<PpOcrV6Variant, PpOcrV6Asset>;

export function assetPaths(root: string, variant: PpOcrV6Variant) {
  const directory = path.join(root, 'benchmark', 'models', 'ppocrv6', variant);
  return {
    directory,
    archive: path.join(directory, 'archive.tar'),
    model: path.join(directory, 'inference.onnx'),
    config: path.join(directory, 'inference.yml'),
  };
}

export function verifyAssetBytes(
  bytes: Uint8Array,
  expectedBytes: number,
  expectedSha256: string,
  label: string,
): void {
  if (bytes.byteLength !== expectedBytes) {
    throw new Error(`${label} bytes mismatch: expected ${expectedBytes}, received ${bytes.byteLength}`);
  }
  const actualSha256 = createHash('sha256').update(bytes).digest('hex');
  if (actualSha256 !== expectedSha256) {
    throw new Error(`${label} SHA-256 mismatch: expected ${expectedSha256}, received ${actualSha256}`);
  }
}

export function validateArchiveEntries(entries: readonly string[], modelName: string): void {
  const prefix = `${modelName}_onnx_infer/`;
  const expected = new Set([
    prefix,
    `${prefix}inference.onnx`,
    `${prefix}inference.yml`,
  ]);
  if (entries.length !== expected.size || entries.some((entry) => !expected.has(entry))) {
    throw new Error(`Official ${modelName} archive contains unexpected entries`);
  }
}

export async function installPpOcrV6Archive(
  root: string,
  variant: PpOcrV6Variant,
  asset: PpOcrV6Asset,
  archiveBytes: Uint8Array,
): Promise<void> {
  verifyAssetBytes(
    archiveBytes,
    asset.archiveBytes,
    asset.archiveSha256,
    `${asset.modelName} archive`,
  );
  const target = assetPaths(root, variant);
  const parent = path.dirname(target.directory);
  const stage = path.join(parent, `.${variant}.stage-${randomUUID()}`);
  const unpack = path.join(stage, 'unpack');
  const stagedArchive = path.join(stage, 'archive.tar');
  try {
    await mkdir(unpack, { recursive: true });
    await writeFile(stagedArchive, archiveBytes);
    const listing = await execFileAsync('tar', ['-tf', stagedArchive], { maxBuffer: 1_000_000 });
    validateArchiveEntries(listing.stdout.split('\n').filter(Boolean), asset.modelName);
    await execFileAsync('tar', [
      '-xf', stagedArchive,
      '-C', unpack,
      '--no-same-owner',
      '--no-same-permissions',
    ]);
    const archiveRoot = path.join(unpack, `${asset.modelName}_onnx_infer`);
    const modelBytes = await readFile(path.join(archiveRoot, 'inference.onnx'));
    const configBytes = await readFile(path.join(archiveRoot, 'inference.yml'));
    verifyAssetBytes(modelBytes, asset.modelBytes, asset.modelSha256, `${asset.modelName} model`);
    verifyAssetBytes(configBytes, asset.configBytes, asset.configSha256, `${asset.modelName} config`);
    await copyFile(path.join(archiveRoot, 'inference.onnx'), path.join(stage, 'inference.onnx'));
    await copyFile(path.join(archiveRoot, 'inference.yml'), path.join(stage, 'inference.yml'));
    await rm(unpack, { recursive: true, force: true });
    await replaceAtomically([{ stagedPath: stage, targetPath: target.directory }]);
  } catch (error) {
    await rm(stage, { recursive: true, force: true });
    throw error;
  }
}
