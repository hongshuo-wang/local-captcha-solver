import { access, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

import { interpretResult } from '../src/core/result-interpreter';
import type {
  InterpretedResult,
  ModelInput,
  OcrResult,
} from '../src/core/types';
import type {
  OcrSession,
  OcrSessionFactory,
} from '../src/ocr/ddddocr-engine';
import { replaceAtomically } from './atomic-files';
import type { AtomicFileOperations } from './atomic-files';
import type { CorpusSample } from './corpus';
import type {
  BenchmarkEngine,
  LegacyBenchmarkEngine,
  BenchmarkPrediction,
} from './report';

export const PACKAGE_SIZE_SCOPE =
  'install-footprint: complete local runtime package tree plus model and charset or language data';

export interface FootprintEntry {
  readonly label: string;
  readonly path: string;
}

export function engineFootprintEntries(
  root: string,
): Record<LegacyBenchmarkEngine, readonly FootprintEntry[]> {
  return {
    ddddocr: [
      { label: 'model', path: path.join(root, 'public', 'models', 'common_old.onnx') },
      { label: 'charset', path: path.join(root, 'public', 'models', 'common_old.json') },
      { label: 'onnxruntime-web package', path: path.join(root, 'node_modules', 'onnxruntime-web') },
    ],
    tesseract: [
      { label: 'tesseract.js package', path: path.join(root, 'node_modules', 'tesseract.js') },
      { label: 'tesseract.js-core package', path: path.join(root, 'node_modules', 'tesseract.js-core') },
      { label: 'English language data', path: path.join(root, 'node_modules', '@tesseract.js-data', 'eng') },
    ],
  };
}

async function treeSize(filePath: string): Promise<number> {
  const metadata = await stat(filePath);
  if (metadata.isFile()) return metadata.size;
  if (!metadata.isDirectory()) return 0;
  const entries = await readdir(filePath);
  const sizes = await Promise.all(entries.map((entry) => treeSize(path.join(filePath, entry))));
  return sizes.reduce((sum, size) => sum + size, 0);
}

export async function calculateFootprint(entries: readonly FootprintEntry[]): Promise<number> {
  const sizes = await Promise.all(entries.map((entry) => treeSize(entry.path)));
  return sizes.reduce((sum, size) => sum + size, 0);
}

export async function validateLocalResources(
  root: string,
  resources: readonly string[],
): Promise<void> {
  const resolvedRoot = path.resolve(root);
  for (const resource of resources) {
    if (!path.isAbsolute(resource) || /^[a-z]+:\/\//i.test(resource)) {
      throw new Error(`Benchmark resource must be an absolute local path: ${resource}`);
    }
    const resolved = path.resolve(resource);
    const relative = path.relative(resolvedRoot, resolved);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new Error(`Benchmark resource must stay within checkout root: ${resource}`);
    }
    await access(resolved);
  }
}

export async function writeReportPair(
  resultDirectory: string,
  json: string,
  markdown: string,
  operations?: AtomicFileOperations,
): Promise<void> {
  const transaction = randomUUID();
  const stagedJson = path.join(resultDirectory, `.latest.json.stage-${transaction}`);
  const stagedMarkdown = path.join(resultDirectory, `.latest.md.stage-${transaction}`);
  await writeFile(stagedJson, json, { flag: 'wx' });
  await writeFile(stagedMarkdown, markdown, { flag: 'wx' });
  await replaceAtomically([
    { stagedPath: stagedJson, targetPath: path.join(resultDirectory, 'latest.json') },
    { stagedPath: stagedMarkdown, targetPath: path.join(resultDirectory, 'latest.md') },
  ], operations);
}

interface RawOnnxOutput {
  readonly type: string;
  readonly data: unknown;
  readonly dims: readonly number[];
}

interface RawOnnxSession {
  run(feeds: Record<string, unknown>): Promise<Record<string, RawOnnxOutput>>;
  release(): Promise<void>;
}

type CreateRawSession = (modelPath: string) => Promise<RawOnnxSession>;
type TensorFactory = (input: ModelInput) => unknown;

export class ManagedOnnxSessionFactory implements OcrSessionFactory {
  private rawSessionPromise: Promise<RawOnnxSession> | undefined;
  private wrappedSessionPromise: Promise<OcrSession> | undefined;
  private released = false;

  constructor(
    private readonly createRawSession: CreateRawSession,
    private readonly createTensor: TensorFactory,
  ) {}

  create(modelPath: string): Promise<OcrSession> {
    if (this.released) throw new Error('ONNX session factory has been released');
    this.rawSessionPromise ??= this.createRawSession(modelPath);
    this.wrappedSessionPromise ??= this.rawSessionPromise.then((session) => ({
      run: async (feeds) => {
        const input = feeds.input1 as ModelInput;
        const outputs = await session.run({ input1: this.createTensor(input) });
        return Object.fromEntries(Object.entries(outputs).map(([name, output]) => {
          if (output.type !== 'float32' || !(output.data instanceof Float32Array)) {
            throw new TypeError(`Unexpected ONNX output type for ${name}: ${output.type}`);
          }
          return [name, { data: output.data, dims: [...output.dims] }];
        }));
      },
    }));
    return this.wrappedSessionPromise;
  }

  async release(): Promise<void> {
    if (this.released) return;
    this.released = true;
    if (this.rawSessionPromise) {
      const session = await this.rawSessionPromise;
      await session.release();
    }
  }
}

type Interpret = (result: OcrResult) => InterpretedResult;

export function predictionFromRecognition(
  sample: CorpusSample,
  result: OcrResult,
  engine: BenchmarkEngine,
  coldInitMs: number,
  warmLatencyMs: number,
  interpret: Interpret = interpretResult,
): BenchmarkPrediction {
  const interpreted = interpret(result);
  const actualFill = interpreted.kind === 'plain' || interpreted.kind === 'arithmetic'
    ? interpreted.fillValue
    : undefined;
  return {
    engine,
    category: sample.category,
    expected: sample.answer,
    ...(sample.fill === undefined ? {} : { expectedFill: sample.fill }),
    actual: result.text,
    ...(actualFill === undefined ? {} : { actualFill }),
    confidence: result.confidence,
    coldInitMs,
    warmLatencyMs,
  };
}
