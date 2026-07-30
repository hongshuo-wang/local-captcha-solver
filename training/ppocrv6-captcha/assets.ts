import { createHash } from 'node:crypto';
import path from 'node:path';

export const PPOCRV6_TRAINING_SOURCE = Object.freeze({
  paddleOcrTag: 'v3.7.0',
  paddleOcrCommit: 'b03f46425e8ff4442b268ce449e3eef758146cd4',
  checkpointUrl: 'https://paddle-model-ecology.bj.bcebos.com/paddlex/official_pretrained_model/PP-OCRv6_tiny_rec_pretrained.pdparams',
  checkpointBytes: 71_528_759,
  checkpointSha256: '960cb4aa5276e3ac235b7f671fb8c9a7c1c1423617da0f96da66a33d0ed53f84',
});

export function trainingAssetPaths(root: string) {
  const directory = path.join(root, 'training', 'ppocrv6-captcha', 'assets');
  return {
    directory,
    checkpoint: path.join(directory, 'PP-OCRv6_tiny_rec_pretrained.pdparams'),
  };
}

export function verifyTrainingCheckpoint(
  checkpoint: Uint8Array,
  expected: { readonly bytes: number; readonly sha256: string } = {
    bytes: PPOCRV6_TRAINING_SOURCE.checkpointBytes,
    sha256: PPOCRV6_TRAINING_SOURCE.checkpointSha256,
  },
): void {
  if (checkpoint.byteLength !== expected.bytes) {
    throw new Error(`Training checkpoint bytes mismatch: expected ${expected.bytes}, received ${checkpoint.byteLength}`);
  }
  const actual = createHash('sha256').update(checkpoint).digest('hex');
  if (actual !== expected.sha256) {
    throw new Error(`Training checkpoint SHA-256 mismatch: expected ${expected.sha256}, received ${actual}`);
  }
}
