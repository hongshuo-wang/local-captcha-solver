import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  generateCorpus,
  TARGET_ALPHABETS,
} from '../../benchmark/generate-corpus';

const temporaryRoots = new Set<string>();

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'captcha-corpus-'));
  temporaryRoots.add(root);
  return root;
}

async function corpusHashes(root: string): Promise<Record<string, string>> {
  const fixtureDirectory = path.join(root, 'benchmark', 'fixtures', 'generated');
  const files = await readdir(fixtureDirectory);
  const paths = [
    path.join(root, 'benchmark', 'corpus.generated.json'),
    ...files.sort().map((file) => path.join(fixtureDirectory, file)),
  ];
  return Object.fromEntries(
    await Promise.all(paths.map(async (file) => [
      path.relative(root, file),
      createHash('sha256').update(await readFile(file)).digest('hex'),
    ])),
  );
}

afterEach(async () => {
  await Promise.all([...temporaryRoots].map((root) => rm(root, { recursive: true, force: true })));
  temporaryRoots.clear();
});

describe('generateCorpus', () => {
  it('records the pinned deterministic font dependency and its license', async () => {
    const notice = await readFile(path.resolve('THIRD_PARTY_NOTICES.md'), 'utf8');
    expect(notice).toContain('dejavu-fonts-ttf@2.37.3');
    expect(notice).toContain('Bitstream Vera Fonts Copyright');
  });

  it('is byte deterministic and atomically removes stale generated images', async () => {
    const root = await temporaryRoot();
    await generateCorpus(root);
    const first = await corpusHashes(root);
    const stale = path.join(root, 'benchmark', 'fixtures', 'generated', 'stale.png');
    await writeFile(stale, 'stale');

    await generateCorpus(root);

    expect(await corpusHashes(root)).toEqual(first);
    await expect(readFile(stale)).rejects.toMatchObject({ code: 'ENOENT' });
    expect((await readdir(path.join(root, 'benchmark'))).some((name) => /stage|backup/.test(name))).toBe(false);
  });

  it('generates exact categories, complete alphabets, contrast bands, and integral division', async () => {
    const root = await temporaryRoot();
    const manifest = await generateCorpus(root);

    expect(manifest.schemaVersion).toBe(1);
    expect(manifest.samples).toHaveLength(200);
    for (const category of ['digits', 'letters', 'alphanumeric', 'arithmetic'] as const) {
      expect(manifest.samples.filter((sample) => sample.category === category)).toHaveLength(50);
    }
    for (const category of ['digits', 'letters', 'alphanumeric'] as const) {
      const corpusCharacters = new Set(
        manifest.samples
          .filter((sample) => sample.category === category)
          .flatMap((sample) => [...sample.answer]),
      );
      expect([...TARGET_ALPHABETS[category]].every((character) => corpusCharacters.has(character))).toBe(true);
    }

    const generation = manifest.samples.map((sample) => sample.generation);
    expect(new Set(generation.map((item) => item.fontFamily)).size).toBeGreaterThanOrEqual(4);
    expect(generation.every((item) => item.fontFile.startsWith('node_modules/dejavu-fonts-ttf/'))).toBe(true);
    expect([...new Set(generation.map((item) => item.contrastBand))].sort()).toEqual([
      '12:1',
      '18:1',
      '4.5:1',
      '7:1',
    ]);
    expect(new Set(generation.map((item) => item.interferenceLines)).size).toBe(2);
    expect(Math.min(...generation.map((item) => item.rotationDegrees))).toBe(-2);
    expect(Math.max(...generation.map((item) => item.rotationDegrees))).toBe(2);

    const divisions = manifest.samples.filter(
      (sample) => sample.category === 'arithmetic' && sample.answer.includes('÷'),
    );
    expect(divisions.length).toBeGreaterThan(0);
    expect(divisions.every((sample) => {
      const [left, right] = sample.answer.split('÷').map(Number);
      return Number.isInteger(left / right) && String(left / right) === sample.fill;
    })).toBe(true);
  });
});
