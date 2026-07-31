import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { createCanvas, loadImage } from '@napi-rs/canvas';
import * as ort from 'onnxruntime-web';

import { parseArithmetic } from '../src/core/arithmetic';
import { AUTO_FILL_CONFIDENCE } from '../src/core/confidence-policy';
import { interpretResult } from '../src/core/result-interpreter';
import type { RecognitionMode } from '../src/core/types';
import { decodePpOcrV6ForMode } from '../src/ocr/ppocrv6-engine';
import { parseGeneratedManifest, parseRealManifest } from './corpus';
import type { CorpusSample } from './corpus';
import { preprocessRgbaForPpOcrV6 } from './ppocrv6-adapter';

const ROOT = process.cwd();
const CANDIDATE = process.env.CAPTCHA_CTC_CANDIDATE ?? 'ctc-v2';
const MODEL = path.join(ROOT, 'training', 'ppocrv6-captcha', 'output', CANDIDATE, 'exported', 'captcha-ctc.onnx');
const CONFIG = path.join(ROOT, 'training', 'ppocrv6-captcha', 'output', CANDIDATE, 'exported', 'captcha-ctc.json');
const MANIFEST = path.join(ROOT, 'training', 'ppocrv6-captcha', 'data', 'manifest.json');

interface EvaluationSample {
  readonly id: string;
  readonly image: string;
  readonly label: string;
  readonly mode: RecognitionMode;
  readonly expectedFill?: string;
  readonly source: 'validation' | 'generated' | 'real';
  readonly datasetSource?: 'synthetic' | 'public' | 'real';
  readonly group?: string;
}

export interface SelectivePoint {
  readonly threshold: number;
  readonly accepted: number;
  readonly total: number;
  readonly coverage: number;
  readonly precision: number;
}

interface Prediction extends EvaluationSample {
  readonly actual: string;
  readonly actualFill?: string;
  readonly confidence: number;
  readonly correct: boolean;
}

function modeFor(label: string): RecognitionMode {
  if (/^[0-9]+$/.test(label)) return 'digits';
  if (/^[A-Za-z]+$/.test(label)) return 'letters';
  if (/^[A-Za-z0-9]+$/.test(label)) return 'alphanumeric';
  if (parseArithmetic(label) !== null) return 'arithmetic';
  throw new TypeError(`Unsupported evaluation label: ${label}`);
}

export function bestSelectivePoint(
  values: readonly Pick<Prediction, 'confidence' | 'correct'>[],
  targetPrecision = 0.995,
): SelectivePoint | null {
  const sorted = [...values].sort((left, right) => right.confidence - left.confidence);
  let correct = 0;
  let best: SelectivePoint | null = null;
  for (let index = 0; index < sorted.length;) {
    const threshold = sorted[index].confidence;
    let end = index;
    while (end < sorted.length && sorted[end].confidence === threshold) {
      correct += Number(sorted[end].correct);
      end += 1;
    }
    const precision = correct / end;
    if (precision >= targetPrecision) {
      best = {
        threshold,
        accepted: end,
        total: sorted.length,
        coverage: end / sorted.length,
        precision,
      };
    }
    index = end;
  }
  return best;
}

export function selectivePointAtThreshold(
  values: readonly Pick<Prediction, 'confidence' | 'correct'>[],
  threshold: number,
): SelectivePoint {
  const accepted = values.filter((value) => value.confidence >= threshold);
  return {
    threshold,
    accepted: accepted.length,
    total: values.length,
    coverage: accepted.length / values.length,
    precision: accepted.length === 0
      ? 1
      : accepted.filter((value) => value.correct).length / accepted.length,
  };
}

async function inputFor(imagePath: string): Promise<Float32Array> {
  const decoded = await loadImage(await readFile(path.resolve(ROOT, imagePath)));
  const canvas = createCanvas(decoded.width, decoded.height);
  const context = canvas.getContext('2d');
  context.drawImage(decoded, 0, 0);
  const rgba = context.getImageData(0, 0, decoded.width, decoded.height).data;
  return preprocessRgbaForPpOcrV6(rgba, decoded.width, decoded.height, [3, 48, 320]).data;
}

async function predict(
  session: ort.InferenceSession,
  charset: readonly string[],
  samples: readonly EvaluationSample[],
  batchSize: number,
): Promise<Prediction[]> {
  const predictions: Prediction[] = [];
  const imageSize = 3 * 48 * 320;
  for (let offset = 0; offset < samples.length; offset += batchSize) {
    const batch = samples.slice(offset, offset + batchSize);
    const inputs = await Promise.all(batch.map((sample) => inputFor(sample.image)));
    const data = new Float32Array(batch.length * imageSize);
    inputs.forEach((input, index) => data.set(input, index * imageSize));
    const outputs = await session.run({ x: new ort.Tensor('float32', data, [batch.length, 3, 48, 320]) });
    const values = Object.values(outputs);
    if (values.length !== 1) throw new TypeError('Candidate model must return exactly one output');
    const output = values[0];
    if (!(output.data instanceof Float32Array) || output.dims.length !== 3 || output.dims[0] !== batch.length) {
      throw new TypeError('Candidate model returned an unexpected output');
    }
    const [, time, classes] = output.dims;
    for (const [index, sample] of batch.entries()) {
      const probabilities = output.data.subarray(index * time * classes, (index + 1) * time * classes);
      const recognition = decodePpOcrV6ForMode(probabilities, [1, time, classes], charset, sample.mode);
      const interpreted = interpretResult({ ...recognition, mode: sample.mode });
      const actualFill = interpreted.kind === 'plain' || interpreted.kind === 'arithmetic'
        ? interpreted.fillValue
        : undefined;
      const correct = sample.mode === 'arithmetic'
        ? actualFill === sample.expectedFill
        : recognition.text === sample.label;
      predictions.push({ ...sample, actual: recognition.text, actualFill, confidence: recognition.confidence, correct });
    }
  }
  return predictions;
}

function fromCorpus(sample: CorpusSample, source: 'generated' | 'real'): EvaluationSample {
  return {
    id: sample.id,
    image: sample.image,
    label: sample.answer,
    mode: sample.category,
    ...(sample.fill === undefined ? {} : { expectedFill: sample.fill }),
    source,
  };
}

function categorySummary(predictions: readonly Prediction[]) {
  return Object.fromEntries((['digits', 'letters', 'alphanumeric', 'arithmetic'] as const).map((mode) => {
    const category = predictions.filter((prediction) => prediction.mode === mode);
    return [mode, {
      samples: category.length,
      accuracy: category.filter((prediction) => prediction.correct).length / category.length,
      selective: bestSelectivePoint(category),
    }];
  }));
}

function groupedSummary(
  predictions: readonly Prediction[],
  keyFor: (prediction: Prediction) => string | undefined,
) {
  const keys = [...new Set(predictions.map(keyFor).filter((key): key is string => key !== undefined))].sort();
  return Object.fromEntries(keys.map((key) => {
    const matching = predictions.filter((prediction) => keyFor(prediction) === key);
    return [key, {
      samples: matching.length,
      accuracy: matching.filter((prediction) => prediction.correct).length / matching.length,
      selective: bestSelectivePoint(matching),
    }];
  }));
}

function arithmeticOperator(prediction: Prediction): string | undefined {
  if (prediction.mode !== 'arithmetic') return undefined;
  return /[+*/xX×÷-]/u.exec(prediction.label)?.[0];
}

export async function main(): Promise<void> {
  const config = JSON.parse(await readFile(CONFIG, 'utf8')) as { charset: string[] };
  const manifest = JSON.parse(await readFile(MANIFEST, 'utf8')) as {
    samples: Array<{
      id: string;
      image: string;
      label: string;
      split: string;
      source: 'synthetic' | 'public' | 'real';
      group: string;
    }>;
  };
  const validation = manifest.samples
    .filter((sample) => sample.split === 'validation')
    .map((sample): EvaluationSample => {
      const mode = modeFor(sample.label);
      const arithmetic = mode === 'arithmetic' ? parseArithmetic(sample.label) : null;
      return {
        ...sample,
        image: `training/ppocrv6-captcha/${sample.image}`,
        mode,
        ...(arithmetic === null ? {} : { expectedFill: arithmetic.value }),
        source: 'validation',
        datasetSource: sample.source,
        group: sample.group,
      };
    });
  const generated = parseGeneratedManifest(JSON.parse(await readFile(path.join(ROOT, 'benchmark', 'corpus.generated.json'), 'utf8')));
  const real = parseRealManifest(JSON.parse(await readFile(path.join(ROOT, 'benchmark', 'corpus.real.json'), 'utf8')));
  const frozen = [
    ...generated.samples.map((sample) => fromCorpus(sample, 'generated')),
    ...real.samples.map((sample) => fromCorpus(sample, 'real')),
  ];
  ort.env.wasm.wasmPaths = {
    mjs: path.join(ROOT, 'public', 'ort', 'ort-wasm-simd-threaded.mjs'),
    wasm: path.join(ROOT, 'public', 'ort', 'ort-wasm-simd-threaded.wasm'),
  };
  const started = performance.now();
  const session = await ort.InferenceSession.create(MODEL, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
  const coldInitMs = performance.now() - started;
  try {
    const validationPredictions = await predict(session, config.charset, validation, 64);
    const frozenPredictions = await predict(session, config.charset, frozen, 1);
    const overall = bestSelectivePoint(validationPredictions);
    const ordinary = bestSelectivePoint(validationPredictions.filter((prediction) => prediction.mode !== 'arithmetic'));
    const arithmetic = bestSelectivePoint(validationPredictions.filter((prediction) => prediction.mode === 'arithmetic'));
    const acceptedErrors = overall === null ? [] : validationPredictions
      .filter((prediction) => !prediction.correct && prediction.confidence >= overall.threshold)
      .sort((left, right) => right.confidence - left.confidence)
      .map(({ id, mode, datasetSource, group, label, actual, expectedFill, actualFill, confidence }) => ({
        id,
        mode,
        datasetSource,
        group,
        label,
        actual,
        expectedFill,
        actualFill,
        confidence,
      }));
    const configuredThresholds = AUTO_FILL_CONFIDENCE;
    const configuredAccepted = validationPredictions.filter(
      (prediction) => prediction.confidence >= configuredThresholds[prediction.mode],
    );
    const realPredictions = frozenPredictions.filter((prediction) => prediction.source === 'real');
    const report = {
      schemaVersion: 1,
      candidate: CANDIDATE,
      modelBytes: (await stat(MODEL)).size,
      coldInitMs,
      validation: {
        samples: validationPredictions.length,
        accuracy: validationPredictions.filter((prediction) => prediction.correct).length / validationPredictions.length,
        operatingPointAt995: { overall, ordinary, arithmetic },
        gatePassed: overall !== null && overall.coverage >= 0.8,
        categories: categorySummary(validationPredictions),
        datasetSources: groupedSummary(validationPredictions, (prediction) => prediction.datasetSource),
        groups: groupedSummary(validationPredictions, (prediction) => prediction.group),
        arithmeticOperators: groupedSummary(validationPredictions, arithmeticOperator),
        configuredPolicy: {
          thresholds: configuredThresholds,
          accepted: configuredAccepted.length,
          coverage: configuredAccepted.length / validationPredictions.length,
          precision: configuredAccepted.filter((prediction) => prediction.correct).length / configuredAccepted.length,
          categories: Object.fromEntries(Object.entries(configuredThresholds).map(([mode, threshold]) => [
            mode,
            selectivePointAtThreshold(
              validationPredictions.filter((prediction) => prediction.mode === mode),
              threshold,
            ),
          ])),
        },
        acceptedErrors,
      },
      frozen: {
        samples: frozenPredictions.length,
        accuracy: frozenPredictions.filter((prediction) => prediction.correct).length / frozenPredictions.length,
        categories: categorySummary(frozenPredictions),
        real: realPredictions,
      },
    };
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await session.release();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  await main();
}
