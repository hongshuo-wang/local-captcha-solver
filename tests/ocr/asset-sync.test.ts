import { spawnSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { expect, it } from 'vitest';

const repoRoot = resolve('.');
const pinnedAssetsFixture = resolve('tests/ocr/fixtures/pinned-assets-fetch.mjs');

function runSync(script: string, cwd: string) {
  return spawnSync(process.execPath, ['--import', pinnedAssetsFixture, script], {
    cwd,
    encoding: 'utf8',
    timeout: 30_000,
    env: { ...process.env, ASSET_FIXTURE_ROOT: repoRoot },
  });
}

it('validates an upstream base64 blob without overflowing the stack', () => {
  const result = spawnSync(
    process.execPath,
    [
      '--import',
      resolve('tests/ocr/fixtures/large-blob-fetch.mjs'),
      resolve('scripts/sync-third-party-assets.mjs'),
    ],
    { encoding: 'utf8', timeout: 30_000 },
  );

  expect(result.stderr).toContain('computed Git blob SHA-1');
});

it('rejects base64 with non-canonical pad bits', () => {
  const result = spawnSync(
    process.execPath,
    [
      '--import',
      resolve('tests/ocr/fixtures/noncanonical-base64-fetch.mjs'),
      resolve('scripts/sync-third-party-assets.mjs'),
    ],
    { encoding: 'utf8', timeout: 30_000 },
  );

  expect(result.stderr).toContain('malformed base64 blob content');
});

it('rejects same-size corruption in an ONNX Runtime source', async () => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'asset-sync-corrupt-'));

  try {
    await cp(resolve('scripts'), join(temporaryRoot, 'scripts'), { recursive: true });
    const ortDirectory = join(temporaryRoot, 'node_modules/onnxruntime-web/dist');
    await mkdir(ortDirectory, { recursive: true });

    const wasm = await readFile(
      resolve('node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.wasm'),
    );
    wasm[0] ^= 0xff;
    await writeFile(join(ortDirectory, 'ort-wasm-simd-threaded.wasm'), wasm);
    await cp(
      resolve('node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.mjs'),
      join(ortDirectory, 'ort-wasm-simd-threaded.mjs'),
    );

    const result = runSync(join(temporaryRoot, 'scripts/sync-third-party-assets.mjs'), temporaryRoot);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('source SHA-256');
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

it('uses the repository root when invoked from another working directory', async () => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'asset-sync-root-'));
  const foreignCwd = await mkdtemp(join(tmpdir(), 'asset-sync-cwd-'));

  try {
    await cp(resolve('scripts'), join(temporaryRoot, 'scripts'), { recursive: true });
    const ortDirectory = join(temporaryRoot, 'node_modules/onnxruntime-web/dist');
    await mkdir(ortDirectory, { recursive: true });
    await cp(
      resolve('node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.wasm'),
      join(ortDirectory, 'ort-wasm-simd-threaded.wasm'),
    );
    await cp(
      resolve('node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.mjs'),
      join(ortDirectory, 'ort-wasm-simd-threaded.mjs'),
    );

    const result = runSync(join(temporaryRoot, 'scripts/sync-third-party-assets.mjs'), foreignCwd);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
    await rm(foreignCwd, { recursive: true, force: true });
  }
});
