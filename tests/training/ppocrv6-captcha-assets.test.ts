import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  PPOCRV6_TRAINING_SOURCE,
  trainingAssetPaths,
  verifyTrainingCheckpoint,
} from '../../training/ppocrv6-captcha/assets';
import { fetchTrainingCheckpoint } from '../../training/ppocrv6-captcha/fetch-assets';

const temporaryRoots = new Set<string>();

afterEach(async () => {
  await Promise.all([...temporaryRoots].map((root) => rm(root, { recursive: true, force: true })));
  temporaryRoots.clear();
});

describe('PP-OCRv6 trainable asset pins', () => {
  it('pins the exact official source revision and checkpoint', () => {
    expect(PPOCRV6_TRAINING_SOURCE).toEqual({
      paddleOcrTag: 'v3.7.0',
      paddleOcrCommit: 'b03f46425e8ff4442b268ce449e3eef758146cd4',
      checkpointUrl: 'https://paddle-model-ecology.bj.bcebos.com/paddlex/official_pretrained_model/PP-OCRv6_tiny_rec_pretrained.pdparams',
      checkpointBytes: 71_528_759,
      checkpointSha256: '960cb4aa5276e3ac235b7f671fb8c9a7c1c1423617da0f96da66a33d0ed53f84',
    });
  });

  it('keeps the checkpoint under the ignored training asset directory', () => {
    expect(trainingAssetPaths('/repo')).toEqual({
      directory: '/repo/training/ppocrv6-captcha/assets',
      checkpoint: '/repo/training/ppocrv6-captcha/assets/PP-OCRv6_tiny_rec_pretrained.pdparams',
    });
  });

  it('rejects checkpoint byte and SHA-256 mismatches', () => {
    const bytes = Buffer.from('checkpoint');
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    expect(() => verifyTrainingCheckpoint(bytes, { bytes: bytes.length, sha256 })).not.toThrow();
    expect(() => verifyTrainingCheckpoint(bytes, { bytes: bytes.length + 1, sha256 })).toThrow(/bytes/i);
    expect(() => verifyTrainingCheckpoint(bytes, { bytes: bytes.length, sha256: '0'.repeat(64) })).toThrow(/sha-256/i);
  });

  it('does not create a checkpoint for an unsuccessful response', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'ppocrv6-training-assets-'));
    temporaryRoots.add(root);
    await expect(fetchTrainingCheckpoint(
      root,
      async () => new Response('no', { status: 502 }),
    )).rejects.toThrow(/502/);
    await expect(readFile(trainingAssetPaths(root).checkpoint)).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
