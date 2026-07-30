import { randomUUID } from 'node:crypto';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { createCanvas, loadImage } from '@napi-rs/canvas';
import * as ort from 'onnxruntime-web';

import type { ImagePayload } from '../src/core/types';
import { decodePpOcrV6ForMode } from '../src/ocr/ppocrv6-engine';
import { replaceAtomically } from './atomic-files';
import { parseGeneratedManifest, parseRealManifest } from './corpus';
import type { CorpusSample, RealCorpusManifest } from './corpus';
import {
  auditCaptchaCharset,
  parsePpOcrV6Config,
  preprocessRgbaForPpOcrV6,
} from './ppocrv6-adapter';
import { PPOCRV6_ASSETS, assetPaths } from './ppocrv6-assets';
import type { PpOcrV6Variant } from './ppocrv6-assets';
import { evaluatePpOcrV6Gate } from './ppocrv6-gate';
import type { PpOcrV6GateResult } from './ppocrv6-gate';
import { PPOCRV6_TARGET_SYMBOLS, buildPpOcrV6Report } from './ppocrv6-report';
import type { PpOcrV6BenchmarkReport } from './ppocrv6-report';
import type { BenchmarkPrediction } from './report';
import {
  calculateFootprint,
  predictionFromRecognition,
  validateLocalResources,
} from './runner-support';

const ROOT = process.cwd();
const GENERATED_MANIFEST = path.join(ROOT, 'benchmark', 'corpus.generated.json');
const REAL_MANIFEST = path.join(ROOT, 'benchmark', 'corpus.real.json');
const RESULT_DIRECTORY = path.join(ROOT, 'benchmark', 'results');
const ORT_MODULE_PATH = path.join(ROOT, 'public', 'ort', 'ort-wasm-simd-threaded.mjs');
const ORT_WASM_PATH = path.join(ROOT, 'public', 'ort', 'ort-wasm-simd-threaded.wasm');
const ORT_PACKAGE_PATH = path.join(ROOT, 'node_modules', 'onnxruntime-web');

export interface PpOcrV6VariantResult {
  readonly variant: PpOcrV6Variant;
  readonly modelName: string;
  readonly charsetAudit: ReturnType<typeof auditCaptchaCharset>;
  readonly metrics: PpOcrV6BenchmarkReport;
  readonly gate: PpOcrV6GateResult;
  readonly predictions: readonly BenchmarkPrediction[];
}

async function readOptionalRealManifest(): Promise<RealCorpusManifest> {
  try {
    return parseRealManifest(JSON.parse(await readFile(REAL_MANIFEST, 'utf8')));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { schemaVersion: 1, samples: [] };
    throw error;
  }
}

async function loadCorpus(): Promise<readonly CorpusSample[]> {
  const generated = parseGeneratedManifest(JSON.parse(await readFile(GENERATED_MANIFEST, 'utf8')));
  const real = await readOptionalRealManifest();
  const samples = [...generated.samples, ...real.samples];
  if (new Set(samples.map((sample) => sample.id)).size !== samples.length) {
    throw new TypeError('All PP-OCRv6 corpus sample ids must be unique');
  }
  await validateLocalResources(ROOT, samples.map((sample) => path.resolve(ROOT, sample.image)));
  return samples;
}

function mimeTypeFor(sample: CorpusSample): ImagePayload['mimeType'] {
  const extension = path.extname(sample.image).toLowerCase();
  if (extension === '.png') return 'image/png';
  if (extension === '.jpg' || extension === '.jpeg') return 'image/jpeg';
  if (extension === '.webp') return 'image/webp';
  throw new Error(`Unsupported corpus image extension: ${extension || '<none>'}`);
}

async function preprocessSample(sample: CorpusSample, imageShape: readonly [3, number, number]) {
  const bytes = await readFile(path.resolve(ROOT, sample.image));
  const payload: ImagePayload = { bytes, mimeType: mimeTypeFor(sample), revision: sample.id };
  const decoded = await loadImage(Buffer.from(payload.bytes));
  const canvas = createCanvas(decoded.width, decoded.height);
  const context = canvas.getContext('2d');
  context.drawImage(decoded, 0, 0);
  const rgba = context.getImageData(0, 0, decoded.width, decoded.height).data;
  return preprocessRgbaForPpOcrV6(rgba, decoded.width, decoded.height, imageShape);
}

async function runVariant(
  variant: PpOcrV6Variant,
  samples: readonly CorpusSample[],
  sharedRuntimeBytes: number,
): Promise<PpOcrV6VariantResult> {
  const asset = PPOCRV6_ASSETS[variant];
  const resources = assetPaths(ROOT, variant);
  const config = parsePpOcrV6Config(await readFile(resources.config, 'utf8'));
  if (config.modelName !== asset.modelName) {
    throw new Error(`${variant} config model name does not match the pinned asset`);
  }
  const charsetAudit = auditCaptchaCharset(config.charset);
  const coldStart = performance.now();
  const session = await ort.InferenceSession.create(resources.model, {
    executionProviders: ['wasm'],
    graphOptimizationLevel: 'all',
  });
  const coldInitMs = performance.now() - coldStart;
  const predictions: BenchmarkPrediction[] = [];
  try {
    for (const [index, sample] of samples.entries()) {
      const start = performance.now();
      const input = await preprocessSample(sample, config.imageShape);
      const outputs = await session.run({
        [session.inputNames[0]]: new ort.Tensor('float32', input.data, [...input.dims]),
      });
      const output = outputs[session.outputNames[0]];
      if (output.type !== 'float32' || !(output.data instanceof Float32Array)) {
        throw new TypeError(`${asset.modelName} returned an unexpected output type`);
      }
      const recognition = decodePpOcrV6ForMode(
        output.data,
        output.dims,
        config.charset,
        sample.category,
      );
      const prediction = predictionFromRecognition(
        sample,
        { mode: sample.category, ...recognition },
        `ppocrv6-${variant}`,
        coldInitMs,
        performance.now() - start,
      );
      predictions.push({
        ...prediction,
        sampleId: sample.id,
        source: sample.sha256 === undefined ? 'generated' : 'real',
      });
      if ((index + 1) % 25 === 0) console.log(`${asset.modelName}: ${index + 1}/${samples.length}`);
    }
  } finally {
    await session.release();
  }
  const modelBytes = (await stat(resources.model)).size;
  const metrics = buildPpOcrV6Report(predictions, { modelBytes, sharedRuntimeBytes });
  const ordinary = predictions.filter((prediction) => prediction.category !== 'arithmetic');
  const ordinaryAccuracy = ordinary.filter(
    (prediction) => prediction.expected === prediction.actual,
  ).length / ordinary.length;
  const gate = evaluatePpOcrV6Gate({
    charsetSupported: charsetAudit.supported,
    realSampleCount: metrics.sourceCounts.real,
    realExactAccuracy: metrics.realExactAccuracy,
    ordinaryWholeStringAccuracy: ordinaryAccuracy,
    arithmeticFillAccuracy: metrics.base.categories.arithmetic.fillAccuracy ?? 0,
    modelBytes,
    p95WarmLatencyMs: metrics.base.p95WarmLatencyMs,
  });
  return { variant, modelName: asset.modelName, charsetAudit, metrics, gate, predictions };
}

function percent(value: number | null): string {
  return value === null ? 'n/a' : `${(value * 100).toFixed(2)}%`;
}

export function renderPpOcrV6Markdown(
  generatedSamples: number,
  realSamples: number,
  results: readonly PpOcrV6VariantResult[],
): string {
  const summary = results.map((result) => {
    const ordinary = ['digits', 'letters', 'alphanumeric'] as const;
    const ordinaryCount = ordinary.reduce(
      (sum, category) => sum + result.metrics.base.categories[category].sampleCount,
      0,
    );
    const ordinaryCorrect = ordinary.reduce(
      (sum, category) => sum
        + result.metrics.base.categories[category].wholeStringAccuracy
          * result.metrics.base.categories[category].sampleCount,
      0,
    );
    return `| ${result.variant} | ${result.charsetAudit.supported ? 'yes' : `no: ${result.charsetAudit.missing.join(' ')}`} | ${percent(ordinaryCount === 0 ? 0 : ordinaryCorrect / ordinaryCount)} | ${percent(result.metrics.rawArithmeticTextAccuracy)} | ${percent(result.metrics.base.categories.arithmetic.fillAccuracy ?? 0)} | ${percent(result.metrics.realExactAccuracy)} | ${result.metrics.modelBytes} | ${result.metrics.base.coldInitMs.toFixed(2)} | ${result.metrics.base.medianWarmLatencyMs.toFixed(2)} | ${result.metrics.base.p95WarmLatencyMs.toFixed(2)} | ${result.gate.status.toUpperCase()} |`;
  });
  const symbols = results.flatMap((result) => PPOCRV6_TARGET_SYMBOLS.map((symbol) => {
    const metric = result.metrics.symbols[symbol];
    return `| ${result.variant} | ${symbol} | ${metric.expectedCount} | ${percent(metric.recall)} | ${JSON.stringify(metric.confusions)} |`;
  }));
  return `# PP-OCRv6 Captcha Feasibility Benchmark\n\nGenerated samples: ${generatedSamples}\n\nReal samples: ${realSamples}\n\nBackend: onnxruntime-web WASM, recognition-only.\n\n| Variant | 70-char charset | Ordinary whole-string | Arithmetic raw text | Arithmetic fill | Real exact | Model bytes | Cold init ms | Median warm ms | P95 warm ms | Decision |\n| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |\n${summary.join('\n')}\n\n## Target Symbol Recall\n\n| Variant | Symbol | Expected | Recall | Confusions |\n| --- | --- | ---: | ---: | --- |\n${symbols.join('\n')}\n\nA decision of INCOMPLETE means no authorized real sample was available; it is not a pass.\n`;
}

export function ppocrv6ExitCode(
  gates: readonly Pick<PpOcrV6GateResult, 'status'>[],
): number {
  if (gates.some((gate) => gate.status === 'incomplete')) return 3;
  if (gates.some((gate) => gate.status === 'fail')) return 2;
  return 0;
}

async function writeResults(json: string, markdown: string): Promise<void> {
  await mkdir(RESULT_DIRECTORY, { recursive: true });
  const transaction = randomUUID();
  const stagedJson = path.join(RESULT_DIRECTORY, `.ppocrv6-latest.json.stage-${transaction}`);
  const stagedMarkdown = path.join(RESULT_DIRECTORY, `.ppocrv6-latest.md.stage-${transaction}`);
  await writeFile(stagedJson, json, { flag: 'wx' });
  await writeFile(stagedMarkdown, markdown, { flag: 'wx' });
  await replaceAtomically([
    { stagedPath: stagedJson, targetPath: path.join(RESULT_DIRECTORY, 'ppocrv6-latest.json') },
    { stagedPath: stagedMarkdown, targetPath: path.join(RESULT_DIRECTORY, 'ppocrv6-latest.md') },
  ]);
}

export async function main(): Promise<number> {
  const allAssets = (['tiny', 'small'] as const).flatMap((variant) => {
    const files = assetPaths(ROOT, variant);
    return [files.archive, files.model, files.config];
  });
  await validateLocalResources(ROOT, [
    GENERATED_MANIFEST,
    ORT_MODULE_PATH,
    ORT_WASM_PATH,
    ORT_PACKAGE_PATH,
    ...allAssets,
  ]);
  ort.env.wasm.wasmPaths = { mjs: ORT_MODULE_PATH, wasm: ORT_WASM_PATH };
  const samples = await loadCorpus();
  const generatedSamples = samples.filter((sample) => sample.sha256 === undefined).length;
  const realSamples = samples.length - generatedSamples;
  const sharedRuntimeBytes = await calculateFootprint([
    { label: 'onnxruntime-web package', path: ORT_PACKAGE_PATH },
  ]);
  const results: PpOcrV6VariantResult[] = [];
  for (const variant of ['tiny', 'small'] as const) {
    results.push(await runVariant(variant, samples, sharedRuntimeBytes));
  }
  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    backend: 'onnxruntime-web-wasm',
    generatedSamples,
    realSamples,
    officialSource: {
      paddleOcrTag: 'v3.7.0',
      assets: PPOCRV6_ASSETS,
    },
    results,
  };
  await writeResults(
    `${JSON.stringify(report, null, 2)}\n`,
    renderPpOcrV6Markdown(generatedSamples, realSamples, results),
  );
  for (const result of results) {
    console.log(`${result.modelName}: ${result.gate.status.toUpperCase()} (${result.gate.failedChecks.join(', ') || 'all checks passed'})`);
  }
  return ppocrv6ExitCode(results.map((result) => result.gate));
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  process.exitCode = await main();
}
