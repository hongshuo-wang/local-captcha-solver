import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const assets = [
  {
    path: 'public/models/common_old.onnx',
    size: 13_606_051,
    gitBlobSha: '8ce4807e1e68c3fa5c1344d281cc7d1623a020cc',
  },
  {
    path: 'public/models/common_old.json',
    size: 90_091,
    gitBlobSha: 'bc50c087ee50455d364eaebd48a3a75fb58fee20',
  },
  {
    path: 'public/ort/ort-wasm-simd-threaded.wasm',
    size: 11_905_541,
  },
  {
    path: 'public/ort/ort-wasm-simd-threaded.mjs',
    size: 20_321,
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
    });
  }
});
