import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { createCanvas, GlobalFonts } from '@napi-rs/canvas';
import type { Canvas, SKRSContext2D } from '@napi-rs/canvas';

import { mergeTrainingManifest } from './materialize-dataset';
import type { TrainingDatasetSample } from './materialize-dataset';

const SEED = 0x71c4a6e2;
const DEFAULT_TRAINING_COUNT = 100_000;
const DEFAULT_VALIDATION_COUNT = 10_000;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DIGITS = '0123456789';
const LETTERS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
const ALPHANUMERIC = `${DIGITS}${LETTERS}`;
const OPERATORS = ['+', '-', '*', '/', 'x', 'X', '×', '÷'] as const;
const SUFFIXES = ['=?', '=', '?', ''] as const;
const CATEGORIES = ['digits', 'letters', 'alphanumeric', 'arithmetic'] as const;
const FONTS = [
  ['Captcha Sans', 'node_modules/dejavu-fonts-ttf/ttf/DejaVuSans-Bold.ttf'],
  ['Captcha Serif', 'node_modules/dejavu-fonts-ttf/ttf/DejaVuSerif-Bold.ttf'],
  ['Captcha Mono', 'node_modules/dejavu-fonts-ttf/ttf/DejaVuSansMono-Bold.ttf'],
  ['Captcha Condensed', 'node_modules/dejavu-fonts-ttf/ttf/DejaVuSansCondensed-BoldOblique.ttf'],
  ['Captcha Oblique', 'node_modules/dejavu-fonts-ttf/ttf/DejaVuSans-Oblique.ttf'],
  ['Kalam', 'node_modules/@fontsource/kalam/files/kalam-latin-400-normal.woff2'],
  ['Kalam', 'node_modules/@fontsource/kalam/files/kalam-latin-700-normal.woff2'],
  ['Patrick Hand', 'node_modules/@fontsource/patrick-hand/files/patrick-hand-latin-400-normal.woff2'],
  ['Special Elite', 'node_modules/@fontsource/special-elite/files/special-elite-latin-400-normal.woff2'],
] as const;
const TRAIN_TEMPLATES = ['synthetic-train-lines', 'synthetic-train-dots', 'synthetic-train-outline', 'synthetic-train-shadow', 'synthetic-train-multicolor-crossline'] as const;
const VALIDATION_TEMPLATES = ['synthetic-validation-curves', 'synthetic-validation-speckle', 'synthetic-validation-crossline', 'synthetic-validation-wave', 'synthetic-validation-multicolor-crossline'] as const;
const CONTRAST_PAIRS = ['0O', 'O0'] as const;
const MULTICOLOR_FOREGROUNDS = ['#176b5b', '#8b3e24', '#2d3e91', '#5d2c72', '#6b5b1b'] as const;

type Split = 'train' | 'validation';
type Category = typeof CATEGORIES[number];

export interface SyntheticPlan {
  readonly id: string;
  readonly split: Split;
  readonly category: Category;
  readonly group: string;
  readonly label: string;
  readonly templateIndex: number;
  readonly fontIndex: number;
  readonly foreground: string;
  readonly background: string;
  readonly seed: number;
}

export interface FittedCanvasSize {
  readonly width: number;
  readonly height: number;
  readonly horizontalPadding: number;
  readonly verticalPadding: number;
}

export function fittedCanvasSize(
  baseWidth: number,
  baseHeight: number,
  textWidth: number,
  fontSize: number,
): FittedCanvasSize {
  if (![baseWidth, baseHeight, textWidth, fontSize].every((value) => Number.isFinite(value) && value > 0)) {
    throw new RangeError('Synthetic canvas measurements must be positive finite numbers');
  }
  const horizontalPadding = Math.ceil(fontSize * 0.3) + 4;
  const verticalPadding = Math.ceil(fontSize * 0.12) + 3;
  return {
    width: Math.max(Math.ceil(baseWidth), Math.ceil(textWidth) + horizontalPadding * 2),
    height: Math.max(Math.ceil(baseHeight), Math.ceil(fontSize) + verticalPadding * 2),
    horizontalPadding,
    verticalPadding,
  };
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

function text(random: () => number, alphabet: string, length: number): string {
  return Array.from({ length }, () => alphabet[integer(random, 0, alphabet.length - 1)]).join('');
}

function arithmetic(random: () => number, index: number): string {
  const operator = OPERATORS[index % OPERATORS.length];
  const suffix = SUFFIXES[Math.floor(index / OPERATORS.length) % SUFFIXES.length];
  let left: number;
  let right: number;
  if (operator === '/' || operator === '÷') {
    right = integer(random, 1, 12);
    left = right * integer(random, 0, 12);
  } else {
    left = integer(random, 0, 99);
    right = integer(random, 0, 99);
    if (operator === '-' && right > left) [left, right] = [right, left];
  }
  return `${left}${operator}${right}${suffix}`;
}

function derivedSeed(split: Split, index: number): number {
  return Math.imul(SEED ^ (split === 'train' ? 0x54524149 : 0x56414c49), index + 1) >>> 0;
}

export function syntheticPlan(split: Split, index: number): SyntheticPlan {
  if (!Number.isSafeInteger(index) || index < 0) throw new RangeError('Synthetic index must be nonnegative');
  const category = CATEGORIES[index % CATEGORIES.length];
  const seed = derivedSeed(split, index);
  const random = mulberry32(seed);
  const categoryIndex = Math.floor(index / CATEGORIES.length);
  const templates = split === 'train' ? TRAIN_TEMPLATES : VALIDATION_TEMPLATES;
  // Cycle every arithmetic operator/suffix pair through every visual template.
  // A plain modulo ties operators to styles because 8 operators is divisible by 4 templates.
  const templateIndex = category === 'arithmetic'
    ? (categoryIndex % OPERATORS.length + Math.floor(categoryIndex / (OPERATORS.length * SUFFIXES.length)))
      % templates.length
    : categoryIndex % templates.length;
  const label = category === 'arithmetic'
    ? arithmetic(random, categoryIndex)
    : category === 'alphanumeric' && templateIndex === 4
      ? (() => {
          const length = integer(random, 4, 6);
          const pair = CONTRAST_PAIRS[categoryIndex % CONTRAST_PAIRS.length];
          const tail = text(random, ALPHANUMERIC, length - pair.length);
          const characters = Array.from(`${pair}${tail}`);
          const rotation = integer(random, 0, characters.length - 1);
          return [...characters.slice(rotation), ...characters.slice(0, rotation)].join('');
        })()
    : text(
        random,
        category === 'digits' ? DIGITS : category === 'letters' ? LETTERS : ALPHANUMERIC,
        integer(random, 4, 6),
      );
  const dark = ['#101010', '#123b65', '#681b2b', '#28502d', '#4b245f'];
  const light = ['#ffffff', '#eef5fb', '#fff4f1', '#f2f7ed', '#f7f1fb'];
  const paletteIndex = integer(random, 0, dark.length - 1);
  return {
    id: `synthetic-${split}-${String(index + 1).padStart(6, '0')}`,
    split,
    category,
    group: templates[templateIndex],
    label,
    templateIndex,
    fontIndex: integer(random, 0, FONTS.length - 1),
    foreground: dark[paletteIndex],
    background: light[(paletteIndex + (split === 'train' ? 0 : 2)) % light.length],
    seed,
  };
}

function registerFonts(): void {
  for (const [family, file] of FONTS) {
    const registered = GlobalFonts.registerFromPath(path.join(ROOT, file), family);
    if (!registered && !GlobalFonts.families.some((entry) => entry.family === family)) {
      throw new Error(`Could not register training font: ${file}`);
    }
  }
}

function strokeAsterisk(context: SKRSContext2D, radius: number): void {
  context.save();
  context.lineCap = 'round';
  for (const angle of [0, Math.PI / 3, (Math.PI * 2) / 3]) {
    context.beginPath();
    context.moveTo(-Math.cos(angle) * radius, -Math.sin(angle) * radius);
    context.lineTo(Math.cos(angle) * radius, Math.sin(angle) * radius);
    context.stroke();
  }
  context.restore();
}

function degradedPng(
  source: Canvas,
  plan: SyntheticPlan,
  random: () => number,
): Buffer {
  const style = plan.templateIndex + (plan.split === 'train' ? 0 : TRAIN_TEMPLATES.length);
  const scaleRanges = [
    [100, 100], [58, 82], [88, 100], [52, 74], [50, 76],
    [82, 96], [55, 78], [72, 90], [60, 82], [48, 74],
  ] as const;
  const [minimumScale, maximumScale] = scaleRanges[style];
  const scale = integer(random, minimumScale, maximumScale) / 100;
  const reduced = createCanvas(
    Math.max(1, Math.round(source.width * scale)),
    Math.max(1, Math.round(source.height * scale)),
  );
  const reducedContext = reduced.getContext('2d');
  reducedContext.imageSmoothingEnabled = true;
  reducedContext.imageSmoothingQuality = 'medium';
  reducedContext.drawImage(source, 0, 0, reduced.width, reduced.height);

  const output = createCanvas(source.width, source.height);
  const outputContext = output.getContext('2d');
  outputContext.fillStyle = plan.background;
  outputContext.fillRect(0, 0, output.width, output.height);
  outputContext.imageSmoothingEnabled = true;
  outputContext.imageSmoothingQuality = 'medium';
  if (style === 3) outputContext.filter = `blur(${integer(random, 5, 10) / 10}px)`;
  if (style === 8) outputContext.filter = `blur(${integer(random, 2, 6) / 10}px)`;
  outputContext.drawImage(reduced, 0, 0, output.width, output.height);
  return output.toBuffer('image/png');
}

function render(plan: SyntheticPlan): Buffer {
  const random = mulberry32(plan.seed ^ 0xa11ce55);
  const style = plan.templateIndex + (plan.split === 'train' ? 0 : TRAIN_TEMPLATES.length);
  const baseWidth = integer(random, 130, 230);
  const baseHeight = integer(random, 48, 76);
  const [family] = FONTS[plan.fontIndex];
  const fontSize = integer(random, 30, 43);
  const font = `${fontSize}px "${family}"`;
  const spacing = integer(random, -2, 3);
  const measurementContext = createCanvas(1, 1).getContext('2d');
  measurementContext.font = font;
  const widths = Array.from(plan.label, (character) => measurementContext.measureText(character).width);
  const totalWidth = widths.reduce((sum, value) => sum + value, 0) + spacing * (widths.length - 1);
  const { width, height } = fittedCanvasSize(baseWidth, baseHeight, totalWidth, fontSize);
  const canvas = createCanvas(width, height);
  const context = canvas.getContext('2d');
  context.fillStyle = plan.background;
  context.fillRect(0, 0, width, height);

  context.globalAlpha = 0.28;
  context.strokeStyle = plan.foreground;
  context.fillStyle = plan.foreground;
  if (style === 1 || style === 4 || style === 6 || style === 9) {
    const dots = style === 4 || style === 9 ? 110 : style === 6 ? 75 : 45;
    for (let dot = 0; dot < dots; dot += 1) {
      context.beginPath();
      context.arc(integer(random, 0, width), integer(random, 0, height), integer(random, 1, 2), 0, Math.PI * 2);
      context.fill();
    }
  }

  context.font = font;
  let x = (width - totalWidth) / 2;
  const centerY = height / 2 + integer(random, -2, 3);
  context.globalAlpha = 1;
  for (const [characterIndex, character] of Array.from(plan.label).entries()) {
    const characterWidth = widths[characterIndex];
    context.save();
    const wave = style === 8 ? integer(random, 3, 7) : integer(random, 0, 4);
    context.translate(x + characterWidth / 2, centerY + Math.sin(characterIndex * 1.7) * wave);
    context.rotate((integer(random, -13, 13) * Math.PI) / 180);
    context.transform(1, 0, integer(random, -10, 10) / 100, 1, 0, 0);
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillStyle = style === 4 || style === 9
      ? MULTICOLOR_FOREGROUNDS[(plan.seed + characterIndex) % MULTICOLOR_FOREGROUNDS.length]
      : plan.foreground;
    if (style === 2) {
      context.strokeStyle = plan.foreground;
      context.lineWidth = integer(random, 1, 2);
      context.strokeText(character, 0, 0);
      context.globalAlpha = 0.35;
    } else if (style === 3) {
      context.shadowColor = plan.foreground;
      context.shadowBlur = integer(random, 2, 5);
      context.shadowOffsetX = integer(random, 2, 4);
      context.shadowOffsetY = integer(random, 1, 4);
    }
    const manualAsterisk = character === '*' && ((plan.seed + characterIndex) % 3 !== 0);
    if (manualAsterisk) {
      context.strokeStyle = plan.foreground;
      context.lineWidth = integer(random, 2, 4);
      strokeAsterisk(context, fontSize * integer(random, 15, 23) / 100);
    } else {
      context.fillText(character, 0, 0);
    }
    context.restore();
    x += characterWidth + spacing;
  }

  context.globalAlpha = style === 4 || style === 9 ? 0.7 : 0.55;
  context.strokeStyle = plan.foreground;
  context.lineWidth = integer(random, 1, 2);
  const lineCount = style === 4 || style === 9 ? integer(random, 3, 5) : integer(random, 1, 3);
  for (let line = 0; line < lineCount; line += 1) {
    context.beginPath();
    if (style === 4 || style === 9) {
      context.strokeStyle = MULTICOLOR_FOREGROUNDS[(plan.seed + line * 2) % MULTICOLOR_FOREGROUNDS.length];
      if (line % 2 === 0) {
        context.moveTo(integer(random, 0, Math.floor(width * 0.2)), integer(random, 0, height));
        context.lineTo(integer(random, Math.ceil(width * 0.8), width), integer(random, 0, height));
      } else {
        context.moveTo(0, integer(random, 5, height - 5));
        context.bezierCurveTo(
          width * 0.3, integer(random, 0, height),
          width * 0.7, integer(random, 0, height),
          width, integer(random, 5, height - 5),
        );
      }
    } else if (plan.split === 'validation' && style !== 7 && style !== 9) {
      context.moveTo(0, integer(random, 5, height - 5));
      context.bezierCurveTo(
        width * 0.3, integer(random, 0, height),
        width * 0.7, integer(random, 0, height),
        width, integer(random, 5, height - 5),
      );
    } else if (style === 7) {
      context.moveTo(integer(random, 0, Math.floor(width * 0.2)), 0);
      context.lineTo(integer(random, Math.ceil(width * 0.8), width), height);
    } else {
      context.moveTo(0, integer(random, 4, height - 4));
      context.lineTo(width, integer(random, 4, height - 4));
    }
    context.stroke();
  }
  return degradedPng(canvas, plan, random);
}

export async function generateSyntheticDataset(
  root: string,
  options: { readonly trainingCount?: number; readonly validationCount?: number } = {},
): Promise<{ readonly training: number; readonly validation: number }> {
  const trainingCount = options.trainingCount ?? DEFAULT_TRAINING_COUNT;
  const validationCount = options.validationCount ?? DEFAULT_VALIDATION_COUNT;
  if (
    !Number.isSafeInteger(trainingCount) || trainingCount <= 0 || trainingCount % CATEGORIES.length !== 0
    || !Number.isSafeInteger(validationCount) || validationCount <= 0 || validationCount % CATEGORIES.length !== 0
  ) throw new RangeError('Synthetic split counts must be positive multiples of four');
  registerFonts();
  const manifests: TrainingDatasetSample[] = [];
  const pending: Promise<void>[] = [];
  for (const [split, count] of [['train', trainingCount], ['validation', validationCount]] as const) {
    for (let index = 0; index < count; index += 1) {
      const plan = syntheticPlan(split, index);
      const bytes = render(plan);
      const image = `data/images/synthetic/${split}/${plan.id}.png`;
      const target = path.join(root, 'training', 'ppocrv6-captcha', image);
      await mkdir(path.dirname(target), { recursive: true });
      pending.push(writeFile(target, bytes));
      manifests.push({
        id: plan.id,
        split,
        source: 'synthetic',
        group: plan.group,
        image,
        label: plan.label,
        sha256: createHash('sha256').update(bytes).digest('hex'),
        licenseId: 'generated-project',
      });
      if (pending.length >= 64) await Promise.all(pending.splice(0));
    }
  }
  await Promise.all(pending);
  await mergeTrainingManifest(
    root,
    {
      groups: new Set([...TRAIN_TEMPLATES, ...VALIDATION_TEMPLATES]),
      license: {
        id: 'generated-project',
        name: 'Project-generated CAPTCHA training data',
        url: null,
        redistribution: true,
      },
    },
    manifests,
  );
  return { training: trainingCount, validation: validationCount };
}

export async function main(): Promise<void> {
  const result = await generateSyntheticDataset(process.cwd());
  console.log(`Generated ${result.training} training and ${result.validation} validation samples`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  await main();
}
