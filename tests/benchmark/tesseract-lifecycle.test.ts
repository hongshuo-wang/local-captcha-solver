import { EventEmitter } from 'node:events';

import { describe, expect, it, vi } from 'vitest';

import { runWorkerLoop } from '../../benchmark/tesseract-child';
import { runTesseractChild } from '../../benchmark/tesseract-lifecycle';

class FakeChild extends EventEmitter {
  readonly send = vi.fn();
  readonly kill = vi.fn(() => true);
  killed = false;
}

const request = {
  root: '/repo',
  samples: [{ id: 'digits-001', category: 'digits' as const, image: 'a.png', answer: '1234' }],
  workerPath: '/repo/node_modules/tesseract.js/worker.js',
  corePath: '/repo/node_modules/tesseract.js-core',
  langPath: '/repo/node_modules/@tesseract.js-data/eng/4.0.0',
};

describe('runTesseractChild', () => {
  it.each(['init', 'loop'])('kills the controlled child after %s failure', async (phase) => {
    const child = new FakeChild();
    const promise = runTesseractChild(request, () => child);
    child.emit('message', { type: 'error', phase, error: `${phase} failed` });
    await expect(promise).rejects.toThrow(`${phase} failed`);
    expect(child.kill).toHaveBeenCalledOnce();
  });

  it('kills the child after a parent-observed process error', async () => {
    const child = new FakeChild();
    const promise = runTesseractChild(request, () => child);
    child.emit('error', new Error('child process failed'));
    await expect(promise).rejects.toThrow(/child process failed/);
    expect(child.kill).toHaveBeenCalledOnce();
  });

  it('returns a successful response and still closes the controlled child', async () => {
    const child = new FakeChild();
    const promise = runTesseractChild(request, () => child);
    child.emit('message', { type: 'success', coldInitMs: 10, recognitions: [] });
    await expect(promise).resolves.toMatchObject({ coldInitMs: 10 });
    expect(child.send).toHaveBeenCalledWith({ type: 'run', request });
    expect(child.kill).toHaveBeenCalledOnce();
  });
});

describe('runWorkerLoop', () => {
  it('uses one worker and terminates it when recognition fails', async () => {
    const worker = {
      setParameters: vi.fn(async () => undefined),
      recognize: vi.fn(async () => { throw new Error('recognition failed'); }),
      terminate: vi.fn(async () => undefined),
    };
    const createWorker = vi.fn(async () => worker);

    await expect(runWorkerLoop(request, createWorker)).rejects.toThrow(/recognition failed/);

    expect(createWorker).toHaveBeenCalledOnce();
    expect(worker.terminate).toHaveBeenCalledOnce();
  });
});
