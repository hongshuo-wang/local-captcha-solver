import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { createCanvas } from '@napi-rs/canvas';

import type { BenchmarkCategory } from './report';

export interface CorpusSample {
  readonly id: string;
  readonly category: BenchmarkCategory;
  readonly image: string;
  readonly answer: string;
  readonly fill?: string;
  readonly generation: {
    readonly fontFamily: string;
    readonly fontSizePx: number;
    readonly foreground: string;
    readonly background: string;
    readonly interferenceLines: 1 | 2;
    readonly rotationDegrees: number;
  };
}

const ROOT = process.cwd();
const OUTPUT_DIRECTORY = path.join(ROOT, 'benchmark', 'fixtures', 'generated');
const MANIFEST_PATH = path.join(ROOT, 'benchmark', 'corpus.generated.json');
const SAMPLE_COUNT = 50;
const SEED = 0x4c43534d;
const FONTS = ['Arial', 'Helvetica', 'Verdana', 'Georgia', 'Courier New'] as const;
const PALETTES = [
  { background: '#ffffff', foreground: '#111827', line: '#64748b' },
  { background: '#f8fafc', foreground: '#172554', line: '#475569' },
  { background: '#fff7ed', foreground: '#3f1d0b', line: '#9a3412' },
  { background: '#f0fdf4', foreground: '#14261b', line: '#52715d' },
] as const;

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

function pick<T>(random: () => number, values: readonly T[]): T {
  return values[integer(random, 0, values.length - 1)];
}

function randomText(random: () => number, alphabet: string, length: number): string {
  return Array.from({ length }, () => alphabet[integer(random, 0, alphabet.length - 1)]).join('');
}

function arithmetic(random: () => number, index: number): { answer: string; fill: string } {
  const operator = ['+', '-', 'x', '÷'][index % 4];
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

function sampleAnswer(
  random: () => number,
  category: BenchmarkCategory,
  index: number,
): { answer: string; fill?: string } {
  switch (category) {
    case 'digits':
      return { answer: randomText(random, '23456789', integer(random, 4, 5)) };
    case 'letters':
      return { answer: randomText(random, 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz', 4) };
    case 'alphanumeric':
      return { answer: randomText(random, 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789', 4) };
    case 'arithmetic':
      return arithmetic(random, index);
  }
}

async function main(): Promise<void> {
  const random = mulberry32(SEED);
  const samples: CorpusSample[] = [];
  await mkdir(OUTPUT_DIRECTORY, { recursive: true });

  for (const category of ['digits', 'letters', 'alphanumeric', 'arithmetic'] as const) {
    for (let index = 0; index < SAMPLE_COUNT; index += 1) {
      const id = `${category}-${String(index + 1).padStart(3, '0')}`;
      const { answer, fill } = sampleAnswer(random, category, index);
      const fontFamily = pick(random, FONTS);
      const fontSizePx = integer(random, 34, 42);
      const palette = pick(random, PALETTES);
      const interferenceLines = integer(random, 1, 2) as 1 | 2;
      const rotationDegrees = Math.round((random() * 4 - 2) * 10) / 10;
      const canvas = createCanvas(180, 64);
      const context = canvas.getContext('2d');

      context.fillStyle = palette.background;
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.save();
      context.translate(canvas.width / 2, canvas.height / 2);
      context.rotate((rotationDegrees * Math.PI) / 180);
      context.font = `600 ${fontSizePx}px "${fontFamily}"`;
      context.textAlign = 'center';
      context.textBaseline = 'middle';
      context.fillStyle = palette.foreground;
      context.fillText(answer, 0, 1);
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
      await writeFile(path.join(ROOT, relativeImage), canvas.toBuffer('image/png'));
      samples.push({
        id,
        category,
        image: relativeImage,
        answer,
        ...(fill === undefined ? {} : { fill }),
        generation: {
          fontFamily,
          fontSizePx,
          foreground: palette.foreground,
          background: palette.background,
          interferenceLines,
          rotationDegrees,
        },
      });
    }
  }

  await writeFile(
    MANIFEST_PATH,
    `${JSON.stringify({ schemaVersion: 1, seed: SEED, samples }, null, 2)}\n`,
  );
  console.log(`Generated ${samples.length} deterministic samples at ${path.relative(ROOT, OUTPUT_DIRECTORY)}`);
}

await main();
