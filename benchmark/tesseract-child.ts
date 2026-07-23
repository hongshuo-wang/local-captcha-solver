import path from 'node:path';

import { createWorker, OEM, PSM } from 'tesseract.js';

import type { BenchmarkCategory } from './report';
import type {
  TesseractChildRequest,
  TesseractChildResult,
} from './tesseract-lifecycle';

interface WorkerLike {
  setParameters(parameters: Record<string, string>): Promise<unknown>;
  recognize(image: string): Promise<{ data: { text: string; confidence: number } }>;
  terminate(): Promise<unknown>;
}

type CreateWorker = (
  language: string,
  oem: OEM,
  options: Record<string, unknown>,
) => Promise<WorkerLike>;

class TesseractPhaseError extends Error {
  constructor(readonly phase: 'init' | 'loop', cause: unknown) {
    super(
      `Tesseract ${phase} failed: ${cause instanceof Error ? cause.message : String(cause)}`,
      { cause },
    );
  }
}

const WHITELISTS: Readonly<Record<BenchmarkCategory, string>> = {
  digits: '0123456789',
  letters: 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ',
  alphanumeric: 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',
  arithmetic: '0123456789+-xX*/×÷=',
};

export async function runWorkerLoop(
  request: TesseractChildRequest,
  create: CreateWorker = createWorker as unknown as CreateWorker,
): Promise<TesseractChildResult> {
  const coldStart = performance.now();
  let worker: WorkerLike;
  try {
    worker = await create('eng', OEM.LSTM_ONLY, {
      workerPath: request.workerPath,
      corePath: request.corePath,
      langPath: request.langPath,
      cacheMethod: 'none',
      gzip: true,
    });
  } catch (cause) {
    throw new TesseractPhaseError('init', cause);
  }
  const coldInitMs = performance.now() - coldStart;

  try {
    const recognitions = [];
    let activeWhitelist = '';
    for (const sample of request.samples) {
      const whitelist = WHITELISTS[sample.category];
      if (whitelist !== activeWhitelist) {
        await worker.setParameters({
          tessedit_pageseg_mode: PSM.SINGLE_LINE,
          tessedit_char_whitelist: whitelist,
          preserve_interword_spaces: '0',
        });
        activeWhitelist = whitelist;
      }
      const start = performance.now();
      const result = await worker.recognize(path.resolve(request.root, sample.image));
      recognitions.push({
        text: result.data.text.replace(/\s+/g, '').replace(/=$/, ''),
        confidence: Math.max(0, Math.min(1, result.data.confidence / 100)),
        warmLatencyMs: performance.now() - start,
      });
    }
    return { coldInitMs, recognitions };
  } catch (cause) {
    throw new TesseractPhaseError('loop', cause);
  } finally {
    await worker.terminate();
  }
}

function send(message: unknown): void {
  process.send?.(message, () => process.disconnect?.());
}

if (process.env.LOCAL_CAPTCHA_TESSERACT_CHILD === '1') {
  process.once('message', async (value: unknown) => {
    try {
      if (value === null || typeof value !== 'object' || (value as { type?: unknown }).type !== 'run') {
        throw new Error('Invalid Tesseract child request');
      }
      const request = (value as { request: TesseractChildRequest }).request;
      const result = await runWorkerLoop(request);
      send({ type: 'success', ...result });
    } catch (error) {
      send({
        type: 'error',
        phase: error instanceof TesseractPhaseError ? error.phase : 'parent',
        error: error instanceof Error ? `${error.message}: ${String(error.cause ?? '')}` : String(error),
      });
    }
  });
}
