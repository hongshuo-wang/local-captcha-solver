import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  calculateFootprint,
  predictionFromRecognition,
  validateLocalResources,
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

  it('recursively sums every file in a footprint', async () => {
    const root = await temporaryRoot();
    const directory = path.join(root, 'tree');
    await mkdir(path.join(directory, 'nested'), { recursive: true });
    await writeFile(path.join(directory, 'a'), '123');
    await writeFile(path.join(directory, 'nested', 'b'), '45678');
    expect(await calculateFootprint([{ label: 'tree', path: directory }])).toBe(8);
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
      'captcha-ctc',
      10,
      2,
      interpret,
    );

    expect(interpret).toHaveBeenCalledOnce();
    expect(result.actualFill).toBe('16');
  });
});
