import { access, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { createCanvas, loadImage } from '@napi-rs/canvas';
import * as ort from 'onnxruntime-web';
import { createWorker, OEM, PSM } from 'tesseract.js';

import { interpretResult } from '../src/core/result-interpreter';
import type { ImagePayload, ImagePreprocessor, ModelInput } from '../src/core/types';
import { DdddOcrEngine } from '../src/ocr/ddddocr-engine';
import type { OcrSession, OcrSessionFactory } from '../src/ocr/ddddocr-engine';
import { rgbaToModelTensor } from '../src/ocr/image-preprocessor';
import { buildReport } from './report';
import type {
  BenchmarkCategory,
  BenchmarkEngine,
  BenchmarkMetrics,
  BenchmarkPrediction,
} from './report';

interface CorpusSample {
  readonly id: string;
  readonly category: BenchmarkCategory;
  readonly image: string;
  readonly answer: string;
  readonly fill?: string;
}

interface CorpusManifest {
  readonly schemaVersion: number;
  readonly samples: readonly CorpusSample[];
}

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

const WHITELISTS: Readonly<Record<BenchmarkCategory, string>> = {
  digits: '0123456789',
  letters: 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ',
  alphanumeric: 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',
  arithmetic: '0123456789+-xX*/×÷=',
};

class NodeCanvasPreprocessor implements ImagePreprocessor {
  async prepare(image: ImagePayload): Promise<ModelInput> {
    if (image.bytes.length === 0 || !image.mimeType.startsWith('image/')) {
      throw new TypeError('Benchmark image must be a nonempty supported image');
    }
    const decoded = await loadImage(Buffer.from(image.bytes));
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

class LocalOnnxSessionFactory implements OcrSessionFactory {
  private sessionPromise: Promise<OcrSession> | undefined;

  async create(modelPath: string): Promise<OcrSession> {
    this.sessionPromise ??= ort.InferenceSession.create(modelPath, {
      executionProviders: ['wasm'],
      graphOptimizationLevel: 'all',
    }).then((session) => ({
      async run(feeds) {
        const input = feeds.input1 as ModelInput;
        const outputs = await session.run({
          input1: new ort.Tensor('float32', input.data, [...input.dims]),
        });
        return Object.fromEntries(
          Object.entries(outputs).map(([name, output]) => {
            if (output.type !== 'float32' || !(output.data instanceof Float32Array)) {
              throw new TypeError(`Unexpected ONNX output type for ${name}: ${output.type}`);
            }
            return [name, { data: output.data, dims: [...output.dims] }];
          }),
        );
      },
    }));
    return this.sessionPromise;
  }
}

async function readManifest(filePath: string, required: boolean): Promise<CorpusManifest> {
  try {
    return JSON.parse(await readFile(filePath, 'utf8')) as CorpusManifest;
  } catch (error) {
    if (!required && (error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { schemaVersion: 1, samples: [] };
    }
    throw error;
  }
}

async function loadCorpus(): Promise<readonly CorpusSample[]> {
  const generated = await readManifest(GENERATED_MANIFEST, true);
  const real = await readManifest(REAL_MANIFEST, false);
  const samples = [...generated.samples, ...real.samples];
  if (generated.samples.length < 200 || samples.length < 200) {
    throw new Error(`Benchmark requires at least 200 generated samples; found ${generated.samples.length}`);
  }
  const uniqueIds = new Set(samples.map((sample) => sample.id));
  if (uniqueIds.size !== samples.length) {
    throw new Error('Corpus sample IDs must be unique');
  }
  for (const sample of samples) {
    if (sample.category === 'arithmetic' && sample.fill === undefined) {
      throw new Error(`Arithmetic sample ${sample.id} is missing its fill answer`);
    }
    const imagePath = path.resolve(ROOT, sample.image);
    if (!imagePath.startsWith(`${ROOT}${path.sep}`)) {
      throw new Error(`Corpus image escapes repository root: ${sample.image}`);
    }
    await access(imagePath);
  }
  return samples;
}

async function fileTreeSize(filePath: string): Promise<number> {
  const metadata = await stat(filePath);
  if (metadata.isFile()) {
    return metadata.size;
  }
  const { readdir } = await import('node:fs/promises');
  const entries = await readdir(filePath);
  return (await Promise.all(entries.map((entry) => fileTreeSize(path.join(filePath, entry))))).reduce(
    (sum, size) => sum + size,
    0,
  );
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
  if (!mimeType) {
    throw new Error(`Unsupported corpus image extension: ${extension || '<none>'}`);
  }
  return {
    bytes: new Uint8Array(await readFile(path.resolve(ROOT, sample.image))),
    mimeType,
    revision: sample.id,
  };
}

function interpretedFill(category: BenchmarkCategory, text: string, confidence: number): string | undefined {
  const interpreted = interpretResult({ mode: category, text, confidence });
  return interpreted.kind === 'plain' || interpreted.kind === 'arithmetic'
    ? interpreted.fillValue
    : undefined;
}

async function runDdddocr(
  samples: readonly CorpusSample[],
  packageSizeBytes: number,
): Promise<EngineResult> {
  const charset = JSON.parse(await readFile(CHARSET_PATH, 'utf8')) as string[];
  const sessionFactory = new LocalOnnxSessionFactory();
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
    const warmLatencyMs = performance.now() - start;
    predictions.push({
      engine: 'ddddocr',
      category: sample.category,
      expected: sample.answer,
      ...(sample.fill === undefined ? {} : { expectedFill: sample.fill }),
      actual: result.text,
      ...(interpretedFill(sample.category, result.text, result.confidence) === undefined
        ? {}
        : { actualFill: interpretedFill(sample.category, result.text, result.confidence) }),
      confidence: result.confidence,
      coldInitMs,
      warmLatencyMs,
    });
    if ((index + 1) % 25 === 0) {
      console.log(`ddddocr: ${index + 1}/${samples.length}`);
    }
  }
  return { predictions, metrics: buildReport(predictions, { packageSizeBytes }) };
}

async function runTesseract(
  samples: readonly CorpusSample[],
  packageSizeBytes: number,
): Promise<EngineResult> {
  const coldStart = performance.now();
  const worker = await createWorker('eng', OEM.LSTM_ONLY, {
    workerPath: TESSERACT_WORKER_PATH,
    corePath: TESSERACT_CORE_PATH,
    langPath: TESSERACT_LANGUAGE_PATH,
    cacheMethod: 'none',
    gzip: true,
  });
  const coldInitMs = performance.now() - coldStart;
  const predictions: BenchmarkPrediction[] = [];
  let activeWhitelist = '';
  try {
    for (const [index, sample] of samples.entries()) {
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
      const result = await worker.recognize(path.resolve(ROOT, sample.image));
      const warmLatencyMs = performance.now() - start;
      const actual = result.data.text.replace(/\s+/g, '').replace(/=$/, '');
      const confidence = Math.max(0, Math.min(1, result.data.confidence / 100));
      const fill = interpretedFill(sample.category, actual, confidence);
      predictions.push({
        engine: 'tesseract',
        category: sample.category,
        expected: sample.answer,
        ...(sample.fill === undefined ? {} : { expectedFill: sample.fill }),
        actual,
        ...(fill === undefined ? {} : { actualFill: fill }),
        confidence,
        coldInitMs,
        warmLatencyMs,
      });
      if ((index + 1) % 25 === 0) {
        console.log(`tesseract: ${index + 1}/${samples.length}`);
      }
    }
  } finally {
    await worker.terminate();
  }
  return { predictions, metrics: buildReport(predictions, { packageSizeBytes }) };
}

function percent(value: number | undefined): string {
  return `${((value ?? 0) * 100).toFixed(2)}%`;
}

function markdown(
  sampleCount: number,
  ddddocr: EngineResult,
  tesseract: EngineResult,
  ordinaryAccuracy: number,
  arithmeticFillAccuracy: number,
  passed: boolean,
): string {
  const rows = ([['ddddocr', ddddocr], ['tesseract', tesseract]] as const).map(
    ([name, result]) =>
      `| ${name} | ${percent(result.metrics.wholeStringAccuracy)} | ${percent(result.metrics.categories.arithmetic?.fillAccuracy)} | ${percent(result.metrics.characterAccuracy)} | ${result.metrics.coldInitMs.toFixed(2)} | ${result.metrics.medianWarmLatencyMs.toFixed(2)} | ${result.metrics.p95WarmLatencyMs.toFixed(2)} | ${result.metrics.packageSizeBytes} | ${percent(result.metrics.falseHighConfidenceRate)} |`,
  );
  return `# Local OCR Feasibility Benchmark\n\nProcessed samples: ${sampleCount}\n\n| Engine | Whole-string | Arithmetic fill | Character | Cold init ms | Median warm ms | P95 warm ms | Package bytes | False high confidence |\n| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |\n${rows.join('\n')}\n\n## Hard Gate\n\n- ddddocr digits/letters/alphanumeric aggregate whole-string accuracy: ${percent(ordinaryAccuracy)}\n- ddddocr arithmetic final-answer accuracy: ${percent(arithmeticFillAccuracy)}\n- Decision: **${passed ? 'PASS' : 'BLOCKED'}**\n`;
}

async function main(): Promise<void> {
  for (const resource of [
    MODEL_PATH,
    CHARSET_PATH,
    ORT_MODULE_PATH,
    ORT_WASM_PATH,
    ORT_PACKAGE_PATH,
    TESSERACT_WORKER_PATH,
    TESSERACT_CORE_PATH,
    TESSERACT_LANGUAGE_PATH,
  ]) {
    await access(resource);
    if (!path.isAbsolute(resource) || !resource.startsWith(`${ROOT}${path.sep}`)) {
      throw new Error(`Benchmark resource is not local to the checkout: ${resource}`);
    }
  }

  const samples = await loadCorpus();
  ort.env.wasm.wasmPaths = {
    mjs: ORT_MODULE_PATH,
    wasm: ORT_WASM_PATH,
  };
  const ddddocrPackageSize = await Promise.all([
    MODEL_PATH,
    CHARSET_PATH,
    ORT_MODULE_PATH,
    ORT_WASM_PATH,
  ].map(fileTreeSize)).then((sizes) => sizes.reduce((sum, size) => sum + size, 0));
  const tesseractPackageSize = await Promise.all([
    path.join(ROOT, 'node_modules', 'tesseract.js'),
    TESSERACT_CORE_PATH,
    path.join(ROOT, 'node_modules', '@tesseract.js-data', 'eng'),
  ].map(fileTreeSize)).then((sizes) => sizes.reduce((sum, size) => sum + size, 0));

  const ddddocr = await runDdddocr(samples, ddddocrPackageSize);
  const tesseract = await runTesseract(samples, tesseractPackageSize);
  const ordinary = ddddocr.predictions.filter((item) => item.category !== 'arithmetic');
  const ordinaryAccuracy = ordinary.filter((item) => item.expected === item.actual).length / ordinary.length;
  const arithmeticFillAccuracy = ddddocr.metrics.categories.arithmetic?.fillAccuracy ?? 0;
  const passed = ordinaryAccuracy >= 0.9 && arithmeticFillAccuracy >= 0.9;
  const resources = {
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
      cacheMethod: 'none',
    },
  };
  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    sampleCount: samples.length,
    resources,
    gates: {
      ordinaryWholeStringThreshold: 0.9,
      arithmeticFillThreshold: 0.9,
      ordinaryWholeStringAccuracy: ordinaryAccuracy,
      arithmeticFillAccuracy,
      passed,
    },
    engines: { ddddocr, tesseract } satisfies Record<BenchmarkEngine, EngineResult>,
  };

  await mkdir(RESULT_DIRECTORY, { recursive: true });
  await writeFile(path.join(RESULT_DIRECTORY, 'latest.json'), `${JSON.stringify(report, null, 2)}\n`);
  await writeFile(
    path.join(RESULT_DIRECTORY, 'latest.md'),
    markdown(samples.length, ddddocr, tesseract, ordinaryAccuracy, arithmeticFillAccuracy, passed),
  );
  console.log(
    `Hard gate: ordinary=${percent(ordinaryAccuracy)}, arithmetic-fill=${percent(arithmeticFillAccuracy)} => ${passed ? 'PASS' : 'BLOCKED'}`,
  );
  if (!passed) {
    process.exitCode = 2;
  }
}

await main();
