import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import { afterEach, describe, expect, it } from 'vitest';

import {
  PPOCRV6_ASSETS,
  assetPaths,
  installPpOcrV6Archive,
  validateArchiveEntries,
  verifyAssetBytes,
} from '../../benchmark/ppocrv6-assets';
import { downloadPpOcrV6Variant } from '../../benchmark/fetch-ppocrv6-assets';

const execFileAsync = promisify(execFile);
const temporaryRoots = new Set<string>();

afterEach(async () => {
  await Promise.all([...temporaryRoots].map((root) => rm(root, { recursive: true, force: true })));
  temporaryRoots.clear();
});

describe('PP-OCRv6 official asset pins', () => {
  it('pins the v3.7.0 browser asset URLs and observed official hashes', () => {
    expect(PPOCRV6_ASSETS).toEqual({
      tiny: expect.objectContaining({
        modelName: 'PP-OCRv6_tiny_rec',
        url: 'https://paddle-model-ecology.bj.bcebos.com/paddlex/official_inference_model/paddle3.0.0/PP-OCRv6_tiny_rec_onnx_infer.tar',
        archiveBytes: 4_526_080,
        archiveSha256: '1e13b22717b1edd89d4cde4fda272b6c17d5b505c97c2baea99da1a3a2d54b29',
        modelBytes: 4_462_639,
        modelSha256: '9ef676d6ed3c88256a2d92c640c44f25b0c40947e111b14b8be8f594091563e6',
        configBytes: 55_571,
        configSha256: '66170210bad538e83fff3c4a3867e547d6bf20b50d64b20347c4b913f3034ea1',
      }),
      small: expect.objectContaining({
        modelName: 'PP-OCRv6_small_rec',
        url: 'https://paddle-model-ecology.bj.bcebos.com/paddlex/official_inference_model/paddle3.0.0/PP-OCRv6_small_rec_onnx_infer.tar',
        archiveBytes: 21_319_680,
        archiveSha256: 'd267ab077a44a0eedb1ea8f8c542d263f211de8e9d7a029bf9fcfff7e5a88fb1',
        modelBytes: 21_159_378,
        modelSha256: '5435fd747c9e0efe15a96d0b378d5bd157e9492ed8fd80edf08f30d02fa24634',
        configBytes: 150_579,
        configSha256: 'ab078671bb49f06228eadccd34f1bb501e157f7a047095ffb943ba81512c77d1',
      }),
    });
  });

  it('keeps benchmark assets outside the production model directory', () => {
    const paths = assetPaths('/repo', 'tiny');
    expect(paths.directory).toBe('/repo/benchmark/models/ppocrv6/tiny');
    expect(paths.archive).toBe('/repo/benchmark/models/ppocrv6/tiny/archive.tar');
    expect(paths.model).toBe('/repo/benchmark/models/ppocrv6/tiny/inference.onnx');
    expect(paths.config).toBe('/repo/benchmark/models/ppocrv6/tiny/inference.yml');
    expect(path.relative('/repo/public/models', paths.model)).toMatch(/^\.\./);
  });

  it('rejects wrong byte counts and SHA-256 values', () => {
    const bytes = Buffer.from('official');
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    expect(() => verifyAssetBytes(bytes, bytes.length, sha256, 'fixture')).not.toThrow();
    expect(() => verifyAssetBytes(bytes, bytes.length + 1, sha256, 'fixture')).toThrow(/bytes/i);
    expect(() => verifyAssetBytes(bytes, bytes.length, '0'.repeat(64), 'fixture')).toThrow(/sha-256/i);
  });

  it('accepts only the expected model directory and two files', () => {
    const prefix = 'PP-OCRv6_tiny_rec_onnx_infer/';
    expect(() => validateArchiveEntries([
      prefix,
      `${prefix}inference.onnx`,
      `${prefix}inference.yml`,
    ], 'PP-OCRv6_tiny_rec')).not.toThrow();
    expect(() => validateArchiveEntries([
      prefix,
      `${prefix}inference.onnx`,
      `${prefix}inference.yml`,
      `${prefix}unexpected.bin`,
    ], 'PP-OCRv6_tiny_rec')).toThrow(/unexpected/i);
    expect(() => validateArchiveEntries([
      '../escape',
      `${prefix}inference.onnx`,
      `${prefix}inference.yml`,
    ], 'PP-OCRv6_tiny_rec')).toThrow(/unexpected/i);
  });

  it('verifies and atomically installs an archive into the benchmark-only directory', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'ppocrv6-assets-'));
    temporaryRoots.add(root);
    const source = path.join(root, 'source');
    const modelName = 'Fixture_rec';
    const archiveDirectory = path.join(source, `${modelName}_onnx_infer`);
    await mkdir(archiveDirectory, { recursive: true });
    const model = Buffer.from('fixture-model');
    const config = Buffer.from('Global:\n  model_name: Fixture_rec\n');
    await writeFile(path.join(archiveDirectory, 'inference.onnx'), model);
    await writeFile(path.join(archiveDirectory, 'inference.yml'), config);
    const archivePath = path.join(root, 'fixture.tar');
    await execFileAsync('tar', ['-cf', archivePath, '-C', source, `${modelName}_onnx_infer`]);
    const archive = await readFile(archivePath);
    const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

    await installPpOcrV6Archive(root, 'tiny', {
      modelName,
      url: 'https://example.invalid/fixture.tar',
      archiveBytes: archive.byteLength,
      archiveSha256: sha256(archive),
      modelBytes: model.byteLength,
      modelSha256: sha256(model),
      configBytes: config.byteLength,
      configSha256: sha256(config),
    }, archive);

    const installed = assetPaths(root, 'tiny');
    expect(await readFile(installed.archive)).toEqual(archive);
    expect(await readFile(installed.model)).toEqual(model);
    expect(await readFile(installed.config)).toEqual(config);
  });

  it('rejects an unsuccessful official download before installation', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'ppocrv6-download-'));
    temporaryRoots.add(root);
    const fetchImpl = async () => new Response('unavailable', { status: 503 });

    await expect(downloadPpOcrV6Variant(root, 'tiny', fetchImpl)).rejects.toThrow(/503/);
    await expect(readFile(assetPaths(root, 'tiny').archive)).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
