export interface PixelImage {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

export interface GapLocatorInput {
  image: PixelImage;
  expectedSize: number;
  minimumX?: number;
}

export interface GapLocation {
  x: number;
  y: number;
  width: number;
  height: number;
  confidence: number;
  score: number;
}

function luminance(image: PixelImage): Float32Array {
  const output = new Float32Array(image.width * image.height);
  for (let index = 0, pixel = 0; index < image.data.length; index += 4, pixel += 1) {
    output[pixel] = image.data[index]! * .2126 + image.data[index + 1]! * .7152 + image.data[index + 2]! * .0722;
  }
  return output;
}

function gradientMap(image: PixelImage): Float32Array {
  const gray = luminance(image);
  const gradient = new Float32Array(gray.length);
  for (let y = 1; y < image.height - 1; y += 1) {
    for (let x = 1; x < image.width - 1; x += 1) {
      const index = y * image.width + x;
      const dx = gray[index + 1]! - gray[index - 1]!;
      const dy = gray[index + image.width]! - gray[index - image.width]!;
      gradient[index] = Math.min(255, Math.abs(dx) + Math.abs(dy));
    }
  }
  return gradient;
}

function integral(values: Float32Array, width: number, height: number): Float64Array {
  const stride = width + 1;
  const output = new Float64Array((width + 1) * (height + 1));
  for (let y = 0; y < height; y += 1) {
    let row = 0;
    for (let x = 0; x < width; x += 1) {
      row += values[y * width + x]!;
      output[(y + 1) * stride + x + 1] = output[y * stride + x + 1]! + row;
    }
  }
  return output;
}

function areaSum(map: Float64Array, width: number, x: number, y: number, w: number, h: number): number {
  const stride = width + 1;
  const right = x + w;
  const bottom = y + h;
  return map[bottom * stride + right]! - map[y * stride + right]! - map[bottom * stride + x]! + map[y * stride + x]!;
}

function perimeterScore(map: Float64Array, width: number, x: number, y: number, size: number): number {
  const band = Math.max(2, Math.round(size * .09));
  const outer = areaSum(map, width, x, y, size, size);
  const innerSize = size - band * 2;
  if (innerSize <= 0) return 0;
  const inner = areaSum(map, width, x + band, y + band, innerSize, innerSize);
  const perimeterArea = size * size - innerSize * innerSize;
  return (outer - inner) / perimeterArea - (inner / (innerSize * innerSize)) * .2;
}

export function locateSliderGap(input: GapLocatorInput): GapLocation | undefined {
  const { image } = input;
  if (image.width < 120 || image.height < 60 || image.data.length !== image.width * image.height * 4) return undefined;
  const size = Math.max(20, Math.min(Math.round(input.expectedSize), Math.floor(Math.min(image.width, image.height) * .6)));
  const minimumX = Math.max(Math.round(image.width * .18), Math.round(input.minimumX ?? 0));
  if (minimumX + size >= image.width) return undefined;
  const map = integral(gradientMap(image), image.width, image.height);
  const step = Math.max(1, Math.round(size / 14));
  const candidates: Array<{ x: number; y: number; score: number }> = [];
  for (let y = 1; y + size < image.height - 1; y += step) {
    for (let x = minimumX; x + size < image.width - 1; x += step) {
      candidates.push({ x, y, score: perimeterScore(map, image.width, x, y, size) });
    }
  }
  candidates.sort((left, right) => right.score - left.score);
  const best = candidates[0];
  if (best === undefined || best.score < 8) return undefined;
  const competing = candidates.find((candidate) => Math.hypot(candidate.x - best.x, candidate.y - best.y) >= size * .75);
  const competitorScore = Math.max(0, competing?.score ?? 0);
  const separation = (best.score - competitorScore) / Math.max(best.score, 1);
  const absolute = Math.min(1, Math.max(0, (best.score - 8) / 30));
  const confidence = Math.min(1, Math.max(0, separation * .7 + absolute * .3));
  return { x: best.x, y: best.y, width: size, height: size, confidence, score: best.score };
}
