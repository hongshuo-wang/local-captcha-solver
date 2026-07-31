import { createHash } from 'node:crypto';
import { readFile, readdir, stat } from 'node:fs/promises';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const assets = [
  {
    path: 'public/models/captcha-ctc.onnx',
    size: 2_242_324,
    sha256: 'bce3e791636f369dd8bbac9b4eee2a0d9515f001b89b422f6d250c33ee6bbc28',
  },
  {
    path: 'public/models/captcha-ctc.json',
    size: 768,
    sha256: 'efebc4c5e6a9de3d3cdf0a58d482a869f801352dd2ab8da73dc6f2baa8f29a5a',
  },
  {
    path: 'public/ort/ort-wasm-simd-threaded.wasm',
    size: 13_479_978,
    sha256: 'd1ab1b94b16a65b29d710d0b587b29e7bed336827577623913479b8afe8113e6',
  },
  {
    path: 'public/ort/ort-wasm-simd-threaded.mjs',
    size: 24_180,
    sha256: '0a1e718d99c41b22c21f2520ff4f9e883a6b5533856e398d21816ee8eb8185d3',
  },
  {
    path: 'third_party/onnxruntime-ThirdPartyNotices.txt',
    size: 326_866,
    gitBlobSha: '7b2bbdd2094d14e40338c7645b25a78ae8cd5364',
  },
] as const;

describe('pinned OCR assets', () => {
  for (const asset of assets) {
    it(`${asset.path} has the pinned identity`, async () => {
      const absolutePath = resolve(asset.path);
      const file = await stat(absolutePath);

      expect(file.isFile()).toBe(true);
      expect(file.size).toBe(asset.size);

      if ('gitBlobSha' in asset) {
        const bytes = await readFile(absolutePath);
        const hash = createHash('sha1')
          .update(`blob ${bytes.byteLength}\0`)
          .update(bytes)
          .digest('hex');

        expect(hash).toBe(asset.gitBlobSha);
      }

      if ('sha256' in asset) {
        const bytes = await readFile(absolutePath);
        expect(createHash('sha256').update(bytes).digest('hex')).toBe(asset.sha256);
      }
    });
  }

  it('contains only the selected ONNX Runtime pair', async () => {
    await expect(readdir(resolve('public/ort')).then((entries) => entries.sort())).resolves.toEqual([
      'ort-wasm-simd-threaded.mjs',
      'ort-wasm-simd-threaded.wasm',
    ]);
  });

  it('contains only the selected production OCR model pair', async () => {
    await expect(readdir(resolve('public/models')).then((entries) => entries.sort())).resolves.toEqual([
      'captcha-ctc.json',
      'captcha-ctc.onnx',
    ]);
  });
});
