import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { createCanvas, loadImage } from '@napi-rs/canvas';
import * as ort from 'onnxruntime-web';

import type { ImagePayload, ImagePreprocessor, ModelInput } from '../src/core/types';
import { DdddOcrEngine } from '../src/ocr/ddddocr-engine';
import { rgbaToModelTensor } from '../src/ocr/image-preprocessor';
import {
  parseGeneratedManifest,
  parseRealManifest,
} from './corpus';
import type {
  CorpusSample,
  RealCorpusManifest,
} from './corpus';
import { evaluateHardGate, gateExitCode } from './gate';
import type { HardGateResult } from './gate';
import { buildReport } from './report';
import type {
  BenchmarkEngine,
  BenchmarkMetrics,
  BenchmarkPrediction,
} from './report';
import {
  calculateFootprint,
  engineFootprintEntries,
  ManagedOnnxSessionFactory,
  PACKAGE_SIZE_SCOPE,
  predictionFromRecognition,
  validateLocalResources,
  writeReportPair,
} from './runner-support';
import { runTesseractChild } from './tesseract-lifecycle';

interface EngineResult {
  readonly metrics: BenchmarkMetrics;
  readonly predictions: readonly BenchmarkPrediction[];
}

const ROOT = process.cwd();
const GENERATED_MANIFEST = path.join(ROOT, 'benchmark', 'corpus.generated.json');
const REAL_MANIFEST = path.join(ROOT, 'benchmark', 'corpus.real.json');
const RESULT_DIRECTORY = path.join(ROOT, 'benchmark', 'results');
const MODEL_PATH = path.join(ROOT, 'public', 'models', 'common_old.onnx');
const CHARSET_PATH = path.join(ROOT, 'public', 'models', 'common_old.json');
const ORT_MODULE_PATH = path.join(ROOT, 'public', 'ort', 'ort-wasm-simd-threaded.mjs');
const ORT_WASM_PATH = path.join(ROOT, 'public', 'ort', 'ort-wasm-simd-threaded.wasm');
const ORT_PACKAGE_PATH = path.join(ROOT, 'node_modules', 'onnxruntime-web', 'package.json');
const TESSERACT_WORKER_PATH = path.join(
  ROOT,
  'node_modules',
  'tesseract.js',
  'src',
  'worker-script',
  'node',
  'index.js',
);
const TESSERACT_CORE_PATH = path.join(ROOT, 'node_modules', 'tesseract.js-core');
const TESSERACT_LANGUAGE_PATH = path.join(
  ROOT,
  'node_modules',
  '@tesseract.js-data',
  'eng',
  '4.0.0',
);

class NodeCanvasPreprocessor implements ImagePreprocessor {
  async prepare(image: ImagePayload): Promise<ModelInput> {
    if (image.bytes.length === 0 || !image.mimeType.startsWith('image/')) {
      throw new TypeError('Benchmark image must be a nonempty supported image');
    }
    const decoded = await loadImage(Buffer.from(image.bytes));
    if (decoded.width <= 0 || decoded.height <= 0) throw new RangeError('Decoded image dimensions must be positive');
    const targetWidth = Math.max(1, Math.floor((decoded.width * 64) / decoded.height));
    const canvas = createCanvas(targetWidth, 64);
    const context = canvas.getContext('2d');
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, targetWidth, 64);
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.drawImage(decoded, 0, 0, targetWidth, 64);
    const rgba = context.getImageData(0, 0, targetWidth, 64).data;
    return {
      data: rgbaToModelTensor(rgba, targetWidth, 64),
      dims: [1, 1, 64, targetWidth],
    };
  }
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
    throw new TypeError('All corpus sample ids must be unique');
  }
  await validateLocalResources(ROOT, samples.map((sample) => path.resolve(ROOT, sample.image)));
  return samples;
}

async function imagePayload(sample: CorpusSample): Promise<ImagePayload> {
  const extension = path.extname(sample.image).toLowerCase();
  const mimeTypes: Readonly<Record<string, string>> = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
  };
  const mimeType = mimeTypes[extension];
  if (!mimeType) throw new Error(`Unsupported corpus image extension: ${extension || '<none>'}`);
  return {
    bytes: new Uint8Array(await readFile(path.resolve(ROOT, sample.image))),
    mimeType,
    revision: sample.id,
  };
}

async function runDdddocr(
  samples: readonly CorpusSample[],
  packageSizeBytes: number,
): Promise<EngineResult> {
  const charset = JSON.parse(await readFile(CHARSET_PATH, 'utf8')) as string[];
  const sessionFactory = new ManagedOnnxSessionFactory(
    async (modelPath) => {
      const session = await ort.InferenceSession.create(modelPath, {
        executionProviders: ['wasm'],
        graphOptimizationLevel: 'all',
      });
      return {
        async run(feeds) {
          const outputs = await session.run(feeds as ort.InferenceSession.FeedsType);
          return Object.fromEntries(Object.entries(outputs).map(([name, output]) => [
            name,
            {
              type: output.type,
              data: 'data' in output ? output.data : undefined,
              dims: 'dims' in output ? output.dims : [],
            },
          ]));
        },
        async release() {
          await session.release();
        },
      };
    },
    (input) => new ort.Tensor('float32', input.data, [...input.dims]),
  );

  try {
    const coldStart = performance.now();
    await sessionFactory.create(MODEL_PATH);
    const coldInitMs = performance.now() - coldStart;
    const engine = new DdddOcrEngine(
      sessionFactory,
      MODEL_PATH,
      charset,
      new NodeCanvasPreprocessor(),
    );
    const predictions: BenchmarkPrediction[] = [];
    for (const [index, sample] of samples.entries()) {
      const start = performance.now();
      const [result] = await engine.recognize(await imagePayload(sample), [sample.category]);
      predictions.push(predictionFromRecognition(
        sample,
        result,
        'ddddocr',
        coldInitMs,
        performance.now() - start,
      ));
      if ((index + 1) % 25 === 0) console.log(`ddddocr: ${index + 1}/${samples.length}`);
    }
    return {
      predictions,
      metrics: buildReport(predictions, { packageSizeBytes, packageSizeScope: PACKAGE_SIZE_SCOPE }),
    };
  } finally {
    await sessionFactory.release();
  }
}

async function runTesseract(
  samples: readonly CorpusSample[],
  packageSizeBytes: number,
): Promise<EngineResult> {
  const childResult = await runTesseractChild({
    root: ROOT,
    samples,
    workerPath: TESSERACT_WORKER_PATH,
    corePath: TESSERACT_CORE_PATH,
    langPath: TESSERACT_LANGUAGE_PATH,
  });
  if (childResult.recognitions.length !== samples.length) {
    throw new Error('Tesseract child recognition count does not match corpus');
  }
  const predictions = samples.map((sample, index) => {
    const recognition = childResult.recognitions[index];
    return predictionFromRecognition(
      sample,
      { mode: sample.category, text: recognition.text, confidence: recognition.confidence },
      'tesseract',
      childResult.coldInitMs,
      recognition.warmLatencyMs,
    );
  });
  return {
    predictions,
    metrics: buildReport(predictions, { packageSizeBytes, packageSizeScope: PACKAGE_SIZE_SCOPE }),
  };
}

function percent(value: number): string {
  return `${(value * 100).toFixed(2)}%`;
}

function markdown(
  sampleCount: number,
  ddddocr: EngineResult,
  tesseract: EngineResult,
  gate: HardGateResult,
): string {
  const rows = ([['ddddocr', ddddocr], ['tesseract', tesseract]] as const).map(
    ([name, result]) =>
      `| ${name} | ${percent(result.metrics.wholeStringAccuracy)} | ${percent(result.metrics.categories.arithmetic.fillAccuracy ?? 0)} | ${percent(result.metrics.characterAccuracy)} | ${result.metrics.coldInitMs.toFixed(2)} | ${result.metrics.medianWarmLatencyMs.toFixed(2)} | ${result.metrics.p95WarmLatencyMs.toFixed(2)} | ${result.metrics.packageSizeBytes} | ${percent(result.metrics.falseHighConfidenceRate)} |`,
  );
  return `# Local OCR Feasibility Benchmark\n\nProcessed samples: ${sampleCount}\n\nPackage-size scope: ${PACKAGE_SIZE_SCOPE}.\n\n| Engine | Whole-string | Arithmetic fill | Character | Cold init ms | Median warm ms | P95 warm ms | Package bytes | False high confidence |\n| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |\n${rows.join('\n')}\n\n## Hard Gate\n\n- ddddocr digits/letters/alphanumeric aggregate whole-string accuracy: ${percent(gate.ordinaryWholeStringAccuracy)}\n- ddddocr arithmetic final-answer accuracy: ${percent(gate.arithmeticFillAccuracy)}\n- Decision: **${gate.passed ? 'PASS' : 'BLOCKED'}**\n`;
}

export async function main(): Promise<number> {
  const footprintEntries = engineFootprintEntries(ROOT);
  const resources = [
    MODEL_PATH,
    CHARSET_PATH,
    ORT_MODULE_PATH,
    ORT_WASM_PATH,
    ORT_PACKAGE_PATH,
    TESSERACT_WORKER_PATH,
    TESSERACT_CORE_PATH,
    TESSERACT_LANGUAGE_PATH,
    ...Object.values(footprintEntries).flatMap((entries) => entries.map((entry) => entry.path)),
  ];
  await validateLocalResources(ROOT, resources);
  const samples = await loadCorpus();
  ort.env.wasm.wasmPaths = { mjs: ORT_MODULE_PATH, wasm: ORT_WASM_PATH };
  const [ddddocrPackageSize, tesseractPackageSize] = await Promise.all([
    calculateFootprint(footprintEntries.ddddocr),
    calculateFootprint(footprintEntries.tesseract),
  ]);
  const ddddocr = await runDdddocr(samples, ddddocrPackageSize);
  const tesseract = await runTesseract(samples, tesseractPackageSize);
  const gate = evaluateHardGate(ddddocr.predictions);
  const packageFootprints = Object.fromEntries(
    (['ddddocr', 'tesseract'] as const).map((engine) => [engine, {
      scope: PACKAGE_SIZE_SCOPE,
      entries: footprintEntries[engine].map((entry) => ({
        label: entry.label,
        path: path.relative(ROOT, entry.path),
      })),
      totalBytes: engine === 'ddddocr' ? ddddocrPackageSize : tesseractPackageSize,
    }]),
  );
  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    sampleCount: samples.length,
    resources: {
      ddddocr: {
        engine: 'production DdddOcrEngine',
        model: path.relative(ROOT, MODEL_PATH),
        charset: path.relative(ROOT, CHARSET_PATH),
        onnxRuntimePackage: path.relative(ROOT, ORT_PACKAGE_PATH),
        onnxRuntimeModule: path.relative(ROOT, ORT_MODULE_PATH),
        onnxRuntimeWasm: path.relative(ROOT, ORT_WASM_PATH),
        preprocessor: '@napi-rs/canvas injected into production engine',
      },
      tesseract: {
        workerPath: path.relative(ROOT, TESSERACT_WORKER_PATH),
        corePath: path.relative(ROOT, TESSERACT_CORE_PATH),
        langPath: path.relative(ROOT, TESSERACT_LANGUAGE_PATH),
        workerCount: 1,
        processIsolation: 'controlled child process',
        cacheMethod: 'none',
      },
    },
    packageFootprints,
    gates: gate,
    engines: { ddddocr, tesseract } satisfies Record<BenchmarkEngine, EngineResult>,
  };

  await mkdir(RESULT_DIRECTORY, { recursive: true });
  await writeReportPair(
    RESULT_DIRECTORY,
    `${JSON.stringify(report, null, 2)}\n`,
    markdown(samples.length, ddddocr, tesseract, gate),
  );
  console.log(
    `Hard gate: ordinary=${percent(gate.ordinaryWholeStringAccuracy)}, arithmetic-fill=${percent(gate.arithmeticFillAccuracy)} => ${gate.passed ? 'PASS' : 'BLOCKED'}`,
  );
  return gateExitCode(gate);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  process.exitCode = await main();
}
