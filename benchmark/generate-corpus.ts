import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { createCanvas, GlobalFonts } from '@napi-rs/canvas';

import { replaceAtomically } from './atomic-files';
import type { BenchmarkCategory } from './report';

export interface CorpusSample {
  readonly id: string;
  readonly category: BenchmarkCategory;
  readonly image: string;
  readonly answer: string;
  readonly fill?: string;
  readonly generation: {
    readonly fontFamily: string;
    readonly fontFile: string;
    readonly fontSizePx: number;
    readonly foreground: string;
    readonly background: string;
    readonly contrastBand: '4.5:1' | '7:1' | '12:1' | '18:1';
    readonly interferenceLines: 1 | 2;
    readonly rotationDegrees: number;
  };
}

export interface GeneratedCorpusManifest {
  readonly schemaVersion: 2;
  readonly seed: number;
  readonly samples: readonly CorpusSample[];
}

export const TARGET_ALPHABETS = {
  digits: '0123456789',
  letters: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz',
  alphanumeric: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789',
} as const;

const SAMPLE_COUNT = 50;
const SEED = 0x4c43534d;
const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FONT_DIRECTORY = path.join(PACKAGE_ROOT, 'node_modules', 'dejavu-fonts-ttf', 'ttf');
const FONTS = [
  { family: 'Benchmark Sans', file: 'DejaVuSans.ttf' },
  { family: 'Benchmark Serif', file: 'DejaVuSerif.ttf' },
  { family: 'Benchmark Mono', file: 'DejaVuSansMono.ttf' },
  { family: 'Benchmark Condensed', file: 'DejaVuSansCondensed.ttf' },
] as const;
const PALETTES = [
  { band: '4.5:1', background: '#ffffff', foreground: '#767676', line: '#686868' },
  { band: '7:1', background: '#ffffff', foreground: '#595959', line: '#777777' },
  { band: '12:1', background: '#ffffff', foreground: '#333333', line: '#707070' },
  { band: '18:1', background: '#ffffff', foreground: '#111111', line: '#737373' },
] as const;
const FONT_SIZES = [34, 35, 36, 37, 38, 39, 40, 41, 42] as const;
const ROTATIONS = Array.from(
  { length: 21 },
  (_, index) => Math.round((-2 + index / 5) * 10) / 10,
);
const ARITHMETIC_OPERATORS = ['+', '-', 'x', '÷'] as const;
const CATEGORY_SEED_SALTS = {
  digits: 0x44544753,
  letters: 0x4c545253,
  alphanumeric: 0x414c5048,
  arithmetic: 0x41524954,
} as const;
const ASSIGNMENT_SEED_SALTS = {
  operator: 0x4f504552,
  font: 0x464f4e54,
  fontSize: 0x53495a45,
  palette: 0x50414c45,
  interferenceLines: 0x4c494e45,
  rotation: 0x524f5441,
} as const;
const MAX_ARITHMETIC_STYLE_ATTEMPTS = 1000;

type ArithmeticOperator = typeof ARITHMETIC_OPERATORS[number];

interface StyleAssignments {
  readonly fonts: readonly (typeof FONTS)[number][];
  readonly fontSizes: readonly number[];
  readonly palettes: readonly (typeof PALETTES)[number][];
  readonly interferenceLines: readonly (1 | 2)[];
  readonly rotations: readonly number[];
}

function mulberry32(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value = (value + 0x6d2b79f5) >>> 0;
    let mixed = value;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function integer(random: () => number, minimum: number, maximum: number): number {
  return minimum + Math.floor(random() * (maximum - minimum + 1));
}

function shuffle<T>(random: () => number, values: readonly T[]): T[] {
  const shuffled = [...values];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = integer(random, 0, index);
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }
  return shuffled;
}

function derivedSeed(...values: readonly number[]): number {
  let seed = SEED;
  for (const value of values) {
    seed = Math.imul(seed ^ value, 0x45d9f3b) >>> 0;
    seed ^= seed >>> 16;
  }
  return seed >>> 0;
}

function balancedSequence<T>(values: readonly T[], seed: number): T[] {
  const random = mulberry32(seed);
  const balanced: T[] = [];
  while (balanced.length < SAMPLE_COUNT) {
    balanced.push(...shuffle(random, values));
  }
  return shuffle(random, balanced.slice(0, SAMPLE_COUNT));
}

function styleAssignments(category: BenchmarkCategory, attempt: number): StyleAssignments {
  const categorySalt = CATEGORY_SEED_SALTS[category];
  return {
    fonts: balancedSequence(
      FONTS,
      derivedSeed(categorySalt, ASSIGNMENT_SEED_SALTS.font, attempt),
    ),
    fontSizes: balancedSequence(
      FONT_SIZES,
      derivedSeed(categorySalt, ASSIGNMENT_SEED_SALTS.fontSize, attempt),
    ),
    palettes: balancedSequence(
      PALETTES,
      derivedSeed(categorySalt, ASSIGNMENT_SEED_SALTS.palette, attempt),
    ),
    interferenceLines: balancedSequence(
      [1, 2] as const,
      derivedSeed(categorySalt, ASSIGNMENT_SEED_SALTS.interferenceLines, attempt),
    ),
    rotations: balancedSequence(
      ROTATIONS,
      derivedSeed(categorySalt, ASSIGNMENT_SEED_SALTS.rotation, attempt),
    ),
  };
}

function coversArithmeticStyles(
  operators: readonly ArithmeticOperator[],
  styles: StyleAssignments,
): boolean {
  return ARITHMETIC_OPERATORS.every((operator) => {
    const indices = operators.flatMap((assignedOperator, index) => (
      assignedOperator === operator ? [index] : []
    ));
    return indices.length >= 12
      && new Set(indices.map((index) => styles.fonts[index].family)).size >= 3
      && new Set(indices.map((index) => styles.palettes[index].band)).size === PALETTES.length
      && new Set(indices.map((index) => styles.interferenceLines[index])).size === 2;
  });
}

function arithmeticStyleAssignments(operators: readonly ArithmeticOperator[]): StyleAssignments {
  for (let attempt = 0; attempt < MAX_ARITHMETIC_STYLE_ATTEMPTS; attempt += 1) {
    const styles = styleAssignments('arithmetic', attempt);
    if (coversArithmeticStyles(operators, styles)) return styles;
  }
  throw new Error(`Could not satisfy arithmetic style coverage after ${MAX_ARITHMETIC_STYLE_ATTEMPTS} attempts`);
}

function coveredAnswers(random: () => number, alphabet: string): readonly string[] {
  const lengths = Array.from({ length: SAMPLE_COUNT }, (_, index) => 4 + index % 3);
  const required = lengths.reduce((sum, length) => sum + length, 0);
  const stream: string[] = [];
  while (stream.length < required) {
    stream.push(...shuffle(random, [...alphabet]));
  }
  let offset = 0;
  return lengths.map((length) => {
    const answer = stream.slice(offset, offset + length).join('');
    offset += length;
    return answer;
  });
}

function arithmetic(random: () => number, operator: ArithmeticOperator): { answer: string; fill: string } {
  if (operator === '÷') {
    const divisor = integer(random, 2, 9);
    const quotient = integer(random, 2, 12);
    return { answer: `${divisor * quotient}÷${divisor}`, fill: String(quotient) };
  }
  let left = integer(random, 2, 49);
  let right = integer(random, 2, 29);
  if (operator === '-' && right > left) {
    [left, right] = [right, left];
  }
  const fill = operator === '+' ? left + right : operator === '-' ? left - right : left * right;
  return { answer: `${left}${operator}${right}`, fill: String(fill) };
}

function registerFonts(): void {
  for (const font of FONTS) {
    const registered = GlobalFonts.registerFromPath(path.join(FONT_DIRECTORY, font.file), font.family);
    const available = GlobalFonts.families.some((entry) => entry.family === font.family);
    if (!registered && !available) {
      throw new Error(`Failed to register deterministic benchmark font: ${font.file}`);
    }
  }
}

export async function generateCorpus(root: string): Promise<GeneratedCorpusManifest> {
  registerFonts();
  const benchmarkDirectory = path.join(root, 'benchmark');
  const outputDirectory = path.join(benchmarkDirectory, 'fixtures', 'generated');
  const manifestPath = path.join(benchmarkDirectory, 'corpus.generated.json');
  const transaction = randomUUID();
  const stagedDirectory = path.join(benchmarkDirectory, `.generated.stage-${transaction}`);
  const stagedManifest = path.join(benchmarkDirectory, `.corpus.generated.stage-${transaction}.json`);
  await mkdir(stagedDirectory, { recursive: true });

  const random = mulberry32(SEED);
  const plainAnswers = {
    digits: coveredAnswers(random, TARGET_ALPHABETS.digits),
    letters: coveredAnswers(random, TARGET_ALPHABETS.letters),
    alphanumeric: coveredAnswers(random, TARGET_ALPHABETS.alphanumeric),
  };
  const arithmeticOperators = balancedSequence(
    ARITHMETIC_OPERATORS,
    derivedSeed(CATEGORY_SEED_SALTS.arithmetic, ASSIGNMENT_SEED_SALTS.operator),
  );
  const stylesByCategory = {
    digits: styleAssignments('digits', 0),
    letters: styleAssignments('letters', 0),
    alphanumeric: styleAssignments('alphanumeric', 0),
    arithmetic: arithmeticStyleAssignments(arithmeticOperators),
  } as const;
  const samples: CorpusSample[] = [];
  for (const category of ['digits', 'letters', 'alphanumeric', 'arithmetic'] as const) {
    const styles = stylesByCategory[category];
    for (let index = 0; index < SAMPLE_COUNT; index += 1) {
      const id = `${category}-${String(index + 1).padStart(3, '0')}`;
      const answerData = category === 'arithmetic'
        ? arithmetic(random, arithmeticOperators[index])
        : { answer: plainAnswers[category][index] };
      const font = styles.fonts[index];
      const fontSizePx = styles.fontSizes[index];
      const palette = styles.palettes[index];
      const interferenceLines = styles.interferenceLines[index];
      const rotationDegrees = styles.rotations[index];
      const canvas = createCanvas(180, 64);
      const context = canvas.getContext('2d');

      context.fillStyle = palette.background;
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.save();
      context.translate(canvas.width / 2, canvas.height / 2);
      context.rotate((rotationDegrees * Math.PI) / 180);
      context.font = `${fontSizePx}px "${font.family}"`;
      context.textAlign = 'center';
      context.textBaseline = 'middle';
      context.fillStyle = palette.foreground;
      context.fillText(answerData.answer, 0, 1);
      context.restore();

      context.strokeStyle = palette.line;
      context.lineWidth = 1;
      for (let line = 0; line < interferenceLines; line += 1) {
        context.beginPath();
        context.moveTo(integer(random, 2, 24), integer(random, 10, 54));
        context.lineTo(integer(random, 156, 178), integer(random, 10, 54));
        context.stroke();
      }

      const relativeImage = `benchmark/fixtures/generated/${id}.png`;
      await writeFile(path.join(stagedDirectory, `${id}.png`), canvas.toBuffer('image/png'));
      samples.push({
        id,
        category,
        image: relativeImage,
        answer: answerData.answer,
        ...('fill' in answerData ? { fill: answerData.fill } : {}),
        generation: {
          fontFamily: font.family,
          fontFile: `node_modules/dejavu-fonts-ttf/ttf/${font.file}`,
          fontSizePx,
          foreground: palette.foreground,
          background: palette.background,
          contrastBand: palette.band,
          interferenceLines,
          rotationDegrees,
        },
      });
    }
  }

  const manifest: GeneratedCorpusManifest = { schemaVersion: 2, seed: SEED, samples };
  await writeFile(stagedManifest, `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' });
  await mkdir(path.dirname(outputDirectory), { recursive: true });
  await replaceAtomically([
    { stagedPath: stagedDirectory, targetPath: outputDirectory },
    { stagedPath: stagedManifest, targetPath: manifestPath },
  ]);
  return manifest;
}

async function main(): Promise<void> {
  const root = process.cwd();
  const manifest = await generateCorpus(root);
  console.log(
    `Generated ${manifest.samples.length} deterministic samples at benchmark/fixtures/generated`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  await main();
}
