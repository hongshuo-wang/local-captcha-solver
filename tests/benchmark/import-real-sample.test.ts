import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { createCanvas } from '@napi-rs/canvas';
import { afterEach, describe, expect, it } from 'vitest';

import {
  importRealSample,
  parseImportArguments,
} from '../../benchmark/import-real-sample';

const temporaryRoots = new Set<string>();

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'captcha-import-'));
  temporaryRoots.add(root);
  return root;
}

async function image(root: string, valid = true): Promise<string> {
  const imagePath = path.join(root, 'source.png');
  if (valid) {
    const canvas = createCanvas(30, 20);
    canvas.getContext('2d').fillRect(0, 0, 30, 20);
    await writeFile(imagePath, canvas.toBuffer('image/png'));
  } else {
    await writeFile(imagePath, 'not an image');
  }
  return imagePath;
}

function request(root: string, sourceImage: string) {
  return {
    root,
    sourceImage,
    answer: 'IlOo',
    category: 'letters' as const,
    provenance: 'authorized fixture',
    license: 'permission granted',
  };
}

afterEach(async () => {
  await Promise.all([...temporaryRoots].map((root) => rm(root, { recursive: true, force: true })));
  temporaryRoots.clear();
});

describe('parseImportArguments', () => {
  it('rejects unknown, duplicate, missing, and empty fields', () => {
    expect(() => parseImportArguments(['--image', 'a.png', '--answer', '1234', '--category', 'digits', '--provenance', 'p', '--license', 'l', '--note', 'x'])).toThrow(/unknown/i);
    expect(() => parseImportArguments(['--image', 'a.png', '--image', 'b.png'])).toThrow(/duplicate/i);
    expect(() => parseImportArguments(['--image', 'a.png'])).toThrow(/required/i);
    expect(() => parseImportArguments(['--image', ' ', '--answer', '1234', '--category', 'digits', '--provenance', 'p', '--license', 'l'])).toThrow(/image/i);
  });
});

describe('importRealSample', () => {
  it('decodes the image, preserves label case, and SHA-256 deduplicates', async () => {
    const root = await temporaryRoot();
    const sourceImage = await image(root);

    const first = await importRealSample(request(root, sourceImage));
    const second = await importRealSample(request(root, sourceImage));
    const manifest = JSON.parse(await readFile(path.join(root, 'benchmark', 'corpus.real.json'), 'utf8'));

    expect(first.status).toBe('imported');
    expect(second.status).toBe('duplicate');
    expect(manifest.samples).toHaveLength(1);
    expect(manifest.samples[0].answer).toBe('IlOo');
    expect(await readdir(path.join(root, 'benchmark', 'fixtures', 'real'))).toHaveLength(1);
  });

  it('serializes concurrent same-image imports without overwriting', async () => {
    const root = await temporaryRoot();
    const sourceImage = await image(root);

    await Promise.all([
      importRealSample(request(root, sourceImage)),
      importRealSample(request(root, sourceImage)),
    ]);

    const manifest = JSON.parse(await readFile(path.join(root, 'benchmark', 'corpus.real.json'), 'utf8'));
    expect(manifest.samples).toHaveLength(1);
  });

  it.each([
    ['digits', '12A4', undefined],
    ['letters', 'Ab1d', undefined],
    ['alphanumeric', 'A-12', undefined],
    ['digits', '123', undefined],
    ['digits', '1234567', undefined],
    ['arithmetic', '7÷2', '3.5'],
    ['arithmetic', '8÷2', '5'],
  ] as const)('rejects invalid %s label %s', async (category, answer, fill) => {
    const root = await temporaryRoot();
    const sourceImage = await image(root);
    await expect(importRealSample({
      root,
      sourceImage,
      answer,
      category,
      ...(fill === undefined ? {} : { fill }),
      provenance: 'authorized fixture',
      license: 'permission granted',
    })).rejects.toThrow();
  });

  it('rejects bytes that do not decode to a positive-size image', async () => {
    const root = await temporaryRoot();
    const sourceImage = await image(root, false);
    await expect(importRealSample(request(root, sourceImage))).rejects.toThrow(/decode|image/i);
  });

  it('cleans staged image, lock, and manifest artifacts after partial failure', async () => {
    const root = await temporaryRoot();
    const sourceImage = await image(root);
    await expect(importRealSample(request(root, sourceImage), {
      beforeManifestCommit() {
        throw new Error('injected manifest failure');
      },
    })).rejects.toThrow(/injected/);

    const benchmarkDirectory = path.join(root, 'benchmark');
    const entries = await readdir(benchmarkDirectory, { recursive: true }).catch(() => []);
    expect(entries.some((entry) => /real-.*\.(png|tmp)|lock|stage|corpus\.real\.json/.test(String(entry)))).toBe(false);
  });
});
