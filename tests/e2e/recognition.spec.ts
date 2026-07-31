import { chromium, expect, test, type BrowserContext, type Page, type Worker } from '@playwright/test';
import { execFile } from 'node:child_process';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';

import { parseArithmetic } from '../../src/core/arithmetic';
import type { OcrResult, RecognitionMode } from '../../src/core/types';
import type { InferenceResponse } from '../../src/ocr/protocol';
import type { ModelStatusSnapshot } from '../../src/background/model-status';
import { warmupDuration } from './recognition-support';

const execFileAsync = promisify(execFile);
const repositoryRoot = resolve(import.meta.dirname, '../..');
const target = process.env.CAPTCHA_E2E_TARGET === 'edge' ? 'edge' : 'chrome';
const extensionPath = join(repositoryRoot, '.output', `${target}-mv3`);
const harnessName = 'recognition-harness.html';
const edgeExecutable = process.env.CAPTCHA_EDGE_EXECUTABLE
  ?? '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge';

interface TimedResponse {
  readonly response: unknown;
  readonly durationMs: number;
}

interface RuntimeApi {
  lastError?: { message?: string };
  sendMessage(message: unknown, callback: (response: unknown) => void): void;
}

let context: BrowserContext;
let extensionPage: Page;
let worker: Worker;
let profileDirectory: string;
let coldModelReadyMs = 0;
const httpRequests: string[] = [];

async function extensionMessage(message: unknown): Promise<unknown> {
  return extensionPage.evaluate((payload) => new Promise((resolveResponse, reject) => {
    const runtime = (globalThis as typeof globalThis & {
      chrome?: { runtime?: RuntimeApi };
    }).chrome?.runtime;
    if (runtime === undefined) {
      reject(new Error('Extension runtime API unavailable'));
      return;
    }
    runtime.sendMessage(payload, (response) => {
      if (runtime.lastError !== undefined) {
        reject(new Error(runtime.lastError.message ?? 'Extension message failed'));
        return;
      }
      resolveResponse(response);
    });
  }), message);
}

async function recognize(
  fixture: string,
  mode: RecognitionMode,
  requestId: string,
): Promise<{ readonly result: OcrResult; readonly durationMs: number }> {
  const bytes = await readFile(join(repositoryRoot, fixture));
  const request = {
    type: 'ocr:recognize',
    requestId,
    imageRevision: requestId,
    imageDataUrl: `data:image/png;base64,${bytes.toString('base64')}`,
    modes: [mode],
  };
  const timed = await extensionPage.evaluate((payload) => new Promise<TimedResponse>((resolveResponse, reject) => {
    const runtime = (globalThis as typeof globalThis & {
      chrome?: { runtime?: RuntimeApi };
    }).chrome?.runtime;
    if (runtime === undefined) {
      reject(new Error('Extension runtime API unavailable'));
      return;
    }
    const startedAt = performance.now();
    runtime.sendMessage(payload, (response) => {
      if (runtime.lastError !== undefined) {
        reject(new Error(runtime.lastError.message ?? 'OCR message failed'));
        return;
      }
      resolveResponse({ response, durationMs: performance.now() - startedAt });
    });
  }), request);
  const response = timed.response as InferenceResponse;
  expect(response).toMatchObject({
    type: 'ocr:result',
    requestId,
    imageRevision: requestId,
  });
  if (response.type !== 'ocr:result' || response.results.length !== 1) {
    throw new Error('Expected one OCR result');
  }
  return { result: response.results[0], durationMs: timed.durationMs };
}

function percentile95(values: readonly number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.ceil(sorted.length * 0.95) - 1];
}

test.beforeAll(async () => {
  await execFileAsync('npm', ['run', target === 'edge' ? 'build:edge' : 'build'], { cwd: repositoryRoot });
  await writeFile(
    join(extensionPath, harnessName),
    '<!doctype html><html lang="en"><meta charset="utf-8"><title>OCR recognition harness</title></html>\n',
    'utf8',
  );
  profileDirectory = await mkdtemp(join(tmpdir(), `local-captcha-solver-${target}-recognition-`));

  context = await chromium.launchPersistentContext(profileDirectory, {
    headless: false,
    offline: true,
    ...(target === 'edge' ? { executablePath: edgeExecutable } : {}),
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
    ],
  });
  context.on('request', (request) => {
    if (/^https?:/i.test(request.url())) httpRequests.push(request.url());
  });
  worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
  const extensionId = new URL(worker.url()).host;
  extensionPage = await context.newPage();
  await extensionPage.goto(`chrome-extension://${extensionId}/${harnessName}`);
  let modelStatus: ModelStatusSnapshot | undefined;
  await expect.poll(async () => {
    try {
      modelStatus = await extensionMessage({ type: 'captcha:get-model-status' }) as ModelStatusSnapshot;
      return modelStatus;
    } catch (error) {
      if (error instanceof Error && error.message.includes('Receiving end does not exist')) {
        return undefined;
      }
      throw error;
    }
  }, {
    timeout: 30_000,
  }).toMatchObject({ status: 'ready' });
  coldModelReadyMs = warmupDuration(modelStatus as ModelStatusSnapshot);
});

test.afterAll(async () => {
  await context?.close();
  if (profileDirectory !== undefined) {
    await rm(profileDirectory, { recursive: true, force: true });
  }
  await rm(join(extensionPath, harnessName), { force: true });
});

test(`runs the candidate model fully offline in ${target}`, async () => {
  const firstDigits = await recognize(
    'benchmark/fixtures/generated/digits-002.png',
    'digits',
    'digits-002',
  );
  expect(firstDigits.result).toMatchObject({ mode: 'digits', text: '14975' });
  expect(firstDigits.result.confidence).toBeGreaterThanOrEqual(0.86);

  const secondDigits = await recognize(
    'benchmark/fixtures/generated/digits-017.png',
    'digits',
    'digits-017',
  );
  expect(secondDigits.result).toMatchObject({ mode: 'digits', text: '99067' });
  expect(secondDigits.result.confidence).toBeGreaterThanOrEqual(0.86);

  const arithmetic = await recognize(
    'benchmark/fixtures/real/bd055d362cf75d551777b939e8e64614601cd5bad9c7962ae63c42eb10acaa43.png',
    'arithmetic',
    'real-arithmetic',
  );
  expect(arithmetic.result).toMatchObject({ mode: 'arithmetic', text: '7*3=?' });
  expect(arithmetic.result.confidence).toBeGreaterThanOrEqual(0.62);
  expect(parseArithmetic(arithmetic.result.text)).toEqual({ expression: '7*3', value: '21' });

  const warmLatencies: number[] = [];
  for (let index = 0; index < 20; index += 1) {
    const warm = await recognize(
      'benchmark/fixtures/generated/digits-002.png',
      'digits',
      `warm-${index}`,
    );
    expect(warm.result.text).toBe('14975');
    warmLatencies.push(warm.durationMs);
  }
  const warmP95Ms = percentile95(warmLatencies);

  console.log(JSON.stringify({ target, coldModelReadyMs, warmP95Ms, warmSamples: warmLatencies.length }));
  expect(httpRequests).toEqual([]);
  expect(coldModelReadyMs).toBeLessThan(3_000);
  expect(warmP95Ms).toBeLessThan(500);
});
