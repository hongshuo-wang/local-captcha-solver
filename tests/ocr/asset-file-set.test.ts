import * as nodeFs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

// @ts-expect-error The production helper is a Node ESM script without TypeScript declarations.
import { replaceAssetSet } from '../../scripts/asset-file-set.mjs';

const temporaryRoots = new Set<string>();
const defaultFs = {
  mkdir: nodeFs.mkdir,
  rename: nodeFs.rename,
  rm: nodeFs.rm,
  writeFile: nodeFs.writeFile,
};

async function createFixture() {
  const root = await nodeFs.mkdtemp(join(tmpdir(), 'asset-file-set-'));
  temporaryRoots.add(root);
  const first = join(root, 'first.bin');
  const second = join(root, 'second.bin');
  await nodeFs.writeFile(first, 'old-first');
  await nodeFs.writeFile(second, 'old-second');
  return {
    root,
    first,
    second,
    outputs: [
      { outputPath: first, bytes: Buffer.from('new-first') },
      { outputPath: second, bytes: Buffer.from('new-second') },
    ],
  };
}

async function expectFiles(root: string, first: string, second: string) {
  await expect(nodeFs.readFile(join(root, 'first.bin'), 'utf8')).resolves.toBe(first);
  await expect(nodeFs.readFile(join(root, 'second.bin'), 'utf8')).resolves.toBe(second);
  await expect(nodeFs.readdir(root).then((entries) => entries.sort())).resolves.toEqual([
    'first.bin',
    'second.bin',
  ]);
}

afterEach(async () => {
  await Promise.all(
    [...temporaryRoots].map((root) => nodeFs.rm(root, { recursive: true, force: true })),
  );
  temporaryRoots.clear();
});

describe('replaceAssetSet', () => {
  it('leaves every destination unchanged when staging fails', async () => {
    const fixture = await createFixture();
    let writes = 0;
    const fs = {
      ...defaultFs,
      async writeFile(...args: Parameters<typeof nodeFs.writeFile>) {
        writes += 1;
        if (writes === 2) {
          throw new Error('injected staging failure');
        }
        return nodeFs.writeFile(...args);
      },
    };

    await expect(
      replaceAssetSet(fixture.outputs, { fs, createId: () => String(writes) }),
    ).rejects.toThrow('injected staging failure');
    await expectFiles(fixture.root, 'old-first', 'old-second');
  });

  it('rolls back every destination when a later install rename fails', async () => {
    const fixture = await createFixture();
    const fs = {
      ...defaultFs,
      async rename(source: string, destination: string) {
        if (source.endsWith('.tmp') && destination === fixture.second) {
          throw new Error('injected install failure');
        }
        return nodeFs.rename(source, destination);
      },
    };

    await expect(
      replaceAssetSet(fixture.outputs, { fs, createId: () => 'rename-failure' }),
    ).rejects.toThrow('injected install failure');
    await expectFiles(fixture.root, 'old-first', 'old-second');
  });

  it('installs every new file and removes transaction artifacts on success', async () => {
    const fixture = await createFixture();

    await replaceAssetSet(fixture.outputs, { createId: () => 'success' });

    await expectFiles(fixture.root, 'new-first', 'new-second');
  });
});
