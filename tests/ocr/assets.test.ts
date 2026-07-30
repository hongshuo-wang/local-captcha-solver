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
    size: 11_905_541,
    sha256: '45eaee27761ad883742a8d4b8fce1538d60ce43b51adf1726fafccc59b8c1a15',
  },
  {
    path: 'public/ort/ort-wasm-simd-threaded.mjs',
    size: 20_321,
    sha256: '90a557d15c02bac4504d95b67f431d8594635ed2a0a62a7f2cd83d090ff91d3e',
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
