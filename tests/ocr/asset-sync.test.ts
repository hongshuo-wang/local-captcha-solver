import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

import { expect, it } from 'vitest';

it('validates a model-sized base64 blob without overflowing the stack', () => {
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
