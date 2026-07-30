import { createCanvas } from '@napi-rs/canvas';
import { parse } from 'yaml';

export const CAPTCHA_VISIBLE_CHARACTERS = Array.from(new Set(
  '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ+-*/xX×÷=?',
));

export interface PpOcrV6Config {
  readonly modelName: string;
  readonly imageShape: readonly [3, number, number];
  readonly charset: readonly string[];
}

function object(value: unknown, context: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${context} must be an object`);
  }
  return value as Record<string, unknown>;
}

export function parsePpOcrV6Config(text: string): PpOcrV6Config {
  const root = object(parse(text), 'inference.yml');
  const global = object(root.Global, 'Global');
  if (typeof global.model_name !== 'string' || global.model_name.trim() === '') {
    throw new TypeError('Global.model_name must be a nonempty string');
  }
  const preProcess = object(root.PreProcess, 'PreProcess');
  if (!Array.isArray(preProcess.transform_ops)) {
    throw new TypeError('PreProcess.transform_ops must be an array');
  }
  const resizeEntry = preProcess.transform_ops.find((entry) => (
    entry !== null && typeof entry === 'object' && !Array.isArray(entry)
    && Object.hasOwn(entry, 'RecResizeImg')
  ));
  const resize = object(
    resizeEntry && object(resizeEntry, 'transform op').RecResizeImg,
    'RecResizeImg',
  );
  if (
    !Array.isArray(resize.image_shape)
    || resize.image_shape.length !== 3
    || resize.image_shape[0] !== 3
    || !resize.image_shape.every((dimension) => Number.isInteger(dimension) && dimension > 0)
  ) {
    throw new TypeError('RecResizeImg.image_shape must be [3, height, width]');
  }
  const postProcess = object(root.PostProcess, 'PostProcess');
  if (postProcess.name !== 'CTCLabelDecode' || !Array.isArray(postProcess.character_dict)) {
    throw new TypeError('PostProcess must define a CTCLabelDecode character_dict');
  }
  if (postProcess.character_dict.some((character) => typeof character !== 'string' || character === '')) {
    throw new TypeError('PostProcess.character_dict entries must be nonempty strings');
  }
  return {
    modelName: global.model_name,
    imageShape: resize.image_shape as [3, number, number],
    charset: ['', ...(postProcess.character_dict as string[]), ' '],
  };
}

export function auditCaptchaCharset(charset: readonly string[]): {
  readonly supported: boolean;
  readonly missing: readonly string[];
} {
  const available = new Set(charset);
  const missing = CAPTCHA_VISIBLE_CHARACTERS.filter((character) => !available.has(character));
  return { supported: missing.length === 0, missing };
}

export function preprocessRgbaForPpOcrV6(
  rgba: Uint8ClampedArray,
  sourceWidth: number,
  sourceHeight: number,
  imageShape: readonly [3, number, number],
): { readonly data: Float32Array; readonly dims: readonly [1, 3, number, number]; readonly resizedWidth: number } {
  if (rgba.length !== sourceWidth * sourceHeight * 4 || sourceWidth <= 0 || sourceHeight <= 0) {
    throw new RangeError('RGBA dimensions must describe a nonempty image');
  }
  const [, targetHeight, baseWidth] = imageShape;
  const ratio = sourceWidth / sourceHeight;
  const targetWidth = Math.min(3200, Math.max(baseWidth, Math.trunc(targetHeight * ratio)));
  const resizedWidth = Math.min(targetWidth, Math.ceil(targetHeight * ratio));
  const sourceCanvas = createCanvas(sourceWidth, sourceHeight);
  const sourceContext = sourceCanvas.getContext('2d');
  const sourceImage = sourceContext.createImageData(sourceWidth, sourceHeight);
  sourceImage.data.set(rgba);
  sourceContext.putImageData(sourceImage, 0, 0);
  const resizedCanvas = createCanvas(resizedWidth, targetHeight);
  const resizedContext = resizedCanvas.getContext('2d');
  resizedContext.imageSmoothingEnabled = true;
  resizedContext.imageSmoothingQuality = 'high';
  resizedContext.drawImage(sourceCanvas, 0, 0, resizedWidth, targetHeight);
  const resized = resizedContext.getImageData(0, 0, resizedWidth, targetHeight).data;
  const plane = targetHeight * targetWidth;
  const output = new Float32Array(3 * plane);
  for (let row = 0; row < targetHeight; row += 1) {
    for (let column = 0; column < resizedWidth; column += 1) {
      const sourceIndex = (row * resizedWidth + column) * 4;
      const targetIndex = row * targetWidth + column;
      output[targetIndex] = resized[sourceIndex + 2] / 127.5 - 1;
      output[plane + targetIndex] = resized[sourceIndex + 1] / 127.5 - 1;
      output[2 * plane + targetIndex] = resized[sourceIndex] / 127.5 - 1;
    }
  }
  return { data: output, dims: [1, 3, targetHeight, targetWidth], resizedWidth };
}

export function decodePpOcrV6Ctc(
  probabilities: Float32Array,
  dims: readonly number[],
  charset: readonly string[],
): { readonly text: string; readonly confidence: number } {
  if (dims.length !== 3 || dims[0] !== 1) {
    throw new RangeError('PP-OCRv6 output dimensions must be [1, time, classes]');
  }
  const [, timeSteps, classes] = dims;
  if (classes !== charset.length || probabilities.length !== timeSteps * classes) {
    throw new RangeError('PP-OCRv6 class dimension must match the parsed charset');
  }
  let previousClass = -1;
  let text = '';
  const selectedProbabilities: number[] = [];
  for (let step = 0; step < timeSteps; step += 1) {
    const offset = step * classes;
    let selectedClass = 0;
    let selectedProbability = probabilities[offset];
    for (let classIndex = 1; classIndex < classes; classIndex += 1) {
      const probability = probabilities[offset + classIndex];
      if (!Number.isFinite(probability)) throw new RangeError('CTC probabilities must be finite');
      if (probability > selectedProbability) {
        selectedClass = classIndex;
        selectedProbability = probability;
      }
    }
    if (selectedClass > 0 && selectedClass !== previousClass) {
      text += charset[selectedClass];
      selectedProbabilities.push(selectedProbability);
    }
    previousClass = selectedClass;
  }
  return {
    text,
    confidence: selectedProbabilities.length === 0
      ? 0
      : selectedProbabilities.reduce((sum, value) => sum + value, 0) / selectedProbabilities.length,
  };
}
