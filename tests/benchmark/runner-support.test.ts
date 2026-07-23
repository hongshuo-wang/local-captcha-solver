import * as nodeFs from 'node:fs/promises';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  calculateFootprint,
  engineFootprintEntries,
  ManagedOnnxSessionFactory,
  PACKAGE_SIZE_SCOPE,
  predictionFromRecognition,
  validateLocalResources,
  writeReportPair,
} from '../../benchmark/runner-support';

const temporaryRoots = new Set<string>();

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'benchmark-support-'));
  temporaryRoots.add(root);
  return root;
}

afterEach(async () => {
  await Promise.all([...temporaryRoots].map((root) => rm(root, { recursive: true, force: true })));
  temporaryRoots.clear();
});

describe('local resources and package footprint', () => {
  it('requires absolute existing resources contained by the checkout', async () => {
    const root = await temporaryRoot();
    const local = path.join(root, 'local.bin');
    await writeFile(local, 'ok');
    await expect(validateLocalResources(root, [local])).resolves.toBeUndefined();
    await expect(validateLocalResources(root, ['https://cdn.example/model'])).rejects.toThrow(/local|absolute/i);
    await expect(validateLocalResources(root, ['relative.bin'])).rejects.toThrow(/absolute/i);
    await expect(validateLocalResources(root, [path.dirname(root)])).rejects.toThrow(/checkout|root/i);
  });

  it('uses symmetric install-footprint inventories and recursively sums every byte', async () => {
    const inventory = engineFootprintEntries('/repo');
    expect(inventory.ddddocr.map((entry) => path.relative('/repo', entry.path))).toEqual([
      'public/models/common_old.onnx',
      'public/models/common_old.json',
      'node_modules/onnxruntime-web',
    ]);
    expect(inventory.tesseract.map((entry) => path.relative('/repo', entry.path))).toEqual([
      'node_modules/tesseract.js',
      'node_modules/tesseract.js-core',
      'node_modules/@tesseract.js-data/eng',
    ]);
    expect(PACKAGE_SIZE_SCOPE).toMatch(/complete.*package|install-footprint/i);

    const root = await temporaryRoot();
    const directory = path.join(root, 'tree');
    await mkdir(path.join(directory, 'nested'), { recursive: true });
    await writeFile(path.join(directory, 'a'), '123');
    await writeFile(path.join(directory, 'nested', 'b'), '45678');
    expect(await calculateFootprint([{ label: 'tree', path: directory }])).toBe(8);
  });
});

describe('writeReportPair', () => {
  it('rolls both report files back when the second staged rename fails', async () => {
    const root = await temporaryRoot();
    await writeReportPair(root, 'old-json', 'old-markdown');
    await expect(writeReportPair(root, 'new-json', 'new-markdown', {
      ...nodeFs,
      async rename(source: string, destination: string) {
        if (source.includes('.latest.md.stage-')) throw new Error('second rename failed');
        await nodeFs.rename(source, destination);
      },
    })).rejects.toThrow(/second rename/);

    expect(await readFile(path.join(root, 'latest.json'), 'utf8')).toBe('old-json');
    expect(await readFile(path.join(root, 'latest.md'), 'utf8')).toBe('old-markdown');
    expect((await nodeFs.readdir(root)).sort()).toEqual(['latest.json', 'latest.md']);
  });
});

describe('ManagedOnnxSessionFactory', () => {
  it('reuses and releases the underlying inference session exactly once', async () => {
    const rawSession = {
      run: vi.fn(async () => ({ output: { type: 'float32', data: new Float32Array([1]), dims: [1, 1, 1] } })),
      release: vi.fn(async () => undefined),
    };
    const createSession = vi.fn(async () => rawSession);
    const factory = new ManagedOnnxSessionFactory(createSession, (input) => input);

    expect(await factory.create('/model.onnx')).toBe(await factory.create('/model.onnx'));
    await factory.release();
    await factory.release();

    expect(createSession).toHaveBeenCalledOnce();
    expect(rawSession.release).toHaveBeenCalledOnce();
  });
});

describe('predictionFromRecognition', () => {
  it('interprets one recognition result exactly once', () => {
    const interpret = vi.fn(() => ({
      kind: 'arithmetic' as const,
      displayText: '8*2 = 16',
      fillValue: '16',
      confidence: 0.9,
    }));
    const result = predictionFromRecognition(
      { id: 'arithmetic-001', category: 'arithmetic', image: 'x.png', answer: '8x2', fill: '16' },
      { mode: 'arithmetic', text: '8x2', confidence: 0.9 },
      'ddddocr',
      10,
      2,
      interpret,
    );

    expect(interpret).toHaveBeenCalledOnce();
    expect(result.actualFill).toBe('16');
  });
});
