export interface PixelImage {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

export interface GapLocatorInput {
  image: PixelImage;
  expectedSize: number;
  minimumX?: number;
  pieceMask?: {
    offsetY: number;
    width: number;
    height: number;
    alpha: readonly number[];
    luminance?: readonly number[];
  };
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

function gradientMap(gray: Float32Array, width: number, height: number): Float32Array {
  const gradient = new Float32Array(gray.length);
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const index = y * width + x;
      const dx = gray[index + 1]! - gray[index - 1]!;
      const dy = gray[index + width]! - gray[index - width]!;
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

function maskEdges(mask: NonNullable<GapLocatorInput['pieceMask']>): Array<{ x: number; y: number }> {
  const opaque = (x: number, y: number) => mask.alpha[y * mask.width + x]! > 20;
  const edges: Array<{ x: number; y: number }> = [];
  for (let y = 1; y < mask.height - 1; y += 1) for (let x = 1; x < mask.width - 1; x += 1) {
    if (opaque(x, y) && (!opaque(x - 1, y) || !opaque(x + 1, y) || !opaque(x, y - 1) || !opaque(x, y + 1))) edges.push({ x, y });
  }
  return edges;
}

function pieceTextureGradient(mask: NonNullable<GapLocatorInput['pieceMask']>): Float32Array | undefined {
  if (mask.luminance?.length !== mask.alpha.length) return undefined;
  return gradientMap(Float32Array.from(mask.luminance), mask.width, mask.height);
}

function textureCorrelation(backgroundGradient: Float32Array, pieceGradient: Float32Array, imageWidth: number, x: number, y: number, mask: NonNullable<GapLocatorInput['pieceMask']>): number | undefined {
  let pieceSum = 0;
  let backgroundSum = 0;
  let count = 0;
  const margin = Math.max(3, Math.round(Math.min(mask.width, mask.height) * .1));
  for (let sampleY = margin; sampleY < mask.height - margin; sampleY += 2) for (let sampleX = margin; sampleX < mask.width - margin; sampleX += 2) {
    const index = sampleY * mask.width + sampleX;
    if (mask.alpha[index]! < 220 || mask.alpha[index - 1]! < 220 || mask.alpha[index + 1]! < 220 || mask.alpha[index - mask.width]! < 220 || mask.alpha[index + mask.width]! < 220) continue;
    pieceSum += pieceGradient[index]!;
    backgroundSum += backgroundGradient[(y + sampleY) * imageWidth + x + sampleX]!;
    count += 1;
  }
  if (count < 24) return undefined;
  const pieceMean = pieceSum / count;
  const backgroundMean = backgroundSum / count;
  let covariance = 0;
  let pieceVariance = 0;
  let backgroundVariance = 0;
  for (let sampleY = margin; sampleY < mask.height - margin; sampleY += 2) for (let sampleX = margin; sampleX < mask.width - margin; sampleX += 2) {
    const index = sampleY * mask.width + sampleX;
    if (mask.alpha[index]! < 220 || mask.alpha[index - 1]! < 220 || mask.alpha[index + 1]! < 220 || mask.alpha[index - mask.width]! < 220 || mask.alpha[index + mask.width]! < 220) continue;
    const pieceDelta = pieceGradient[index]! - pieceMean;
    const backgroundDelta = backgroundGradient[(y + sampleY) * imageWidth + x + sampleX]! - backgroundMean;
    covariance += pieceDelta * backgroundDelta;
    pieceVariance += pieceDelta * pieceDelta;
    backgroundVariance += backgroundDelta * backgroundDelta;
  }
  const denominator = Math.sqrt(pieceVariance * backgroundVariance);
  return denominator < 1 ? undefined : covariance / denominator;
}

function locateMaskedGap(image: PixelImage, map: Float32Array, mask: NonNullable<GapLocatorInput['pieceMask']>, minimumX: number): GapLocation | undefined {
  if (mask.width < 20 || mask.height < 20 || mask.alpha.length !== mask.width * mask.height) return undefined;
  const edges = maskEdges(mask);
  if (edges.length < 16) return undefined;
  const textureGradient = pieceTextureGradient(mask);
  const yRadius = Math.max(4, Math.round(mask.height * .12));
  const minimumY = Math.max(1, Math.round(mask.offsetY) - yRadius);
  const maximumY = Math.min(image.height - mask.height - 2, Math.round(mask.offsetY) + yRadius);
  const candidates: Array<{ x: number; y: number; score: number; edgeScore: number; textureScore?: number }> = [];
  for (let y = minimumY; y <= maximumY; y += 1) for (let x = minimumX; x + mask.width < image.width - 1; x += 1) {
    let edgeScore = 0;
    for (const edge of edges) edgeScore += map[(y + edge.y) * image.width + x + edge.x]!;
    let interiorScore = 0;
    let interiorCount = 0;
    for (let sampleY = 4; sampleY < mask.height - 4; sampleY += 3) for (let sampleX = 4; sampleX < mask.width - 4; sampleX += 3) {
      if (mask.alpha[sampleY * mask.width + sampleX]! <= 20) continue;
      interiorScore += map[(y + sampleY) * image.width + x + sampleX]!;
      interiorCount += 1;
    }
    const averageEdgeScore = edgeScore / edges.length - (interiorCount === 0 ? 0 : interiorScore / interiorCount * .35);
    const textureScore = textureGradient === undefined ? undefined : textureCorrelation(map, textureGradient, image.width, x, y, mask);
    candidates.push({ x, y, score: averageEdgeScore, edgeScore: averageEdgeScore, ...(textureScore === undefined ? {} : { textureScore }) });
  }
  if (textureGradient !== undefined) {
    const indexed = new Map(candidates.map((candidate) => [`${candidate.x}:${candidate.y}`, candidate.textureScore ?? -1]));
    const radiusX = Math.max(2, Math.round(mask.width * .12));
    const radiusY = Math.max(2, Math.round(mask.height * .12));
    for (const candidate of candidates) {
      let nearbyTexture = candidate.textureScore ?? -1;
      for (let offsetY = -radiusY; offsetY <= radiusY; offsetY += 1) for (let offsetX = -radiusX; offsetX <= radiusX; offsetX += 1) {
        nearbyTexture = Math.max(nearbyTexture, indexed.get(`${candidate.x + offsetX}:${candidate.y + offsetY}`) ?? -1);
      }
      candidate.textureScore = nearbyTexture;
      candidate.score = candidate.edgeScore + Math.max(0, nearbyTexture) * 40;
    }
  }
  candidates.sort((left, right) => right.score - left.score);
  const best = candidates[0];
  if (best === undefined) return undefined;
  const competing = candidates.find((candidate) => Math.hypot(candidate.x - best.x, candidate.y - best.y) >= Math.max(mask.width, mask.height) * .75);
  const competitorScore = Math.max(0, competing?.score ?? 0);
  const separation = (best.score - competitorScore) / Math.max(best.score, 1);
  const edgeEvidence = Math.min(1, Math.max(0, (best.edgeScore - 12) / 35));
  const textureEvidence = Math.min(1, Math.max(0, ((best.textureScore ?? 0) - .25) / .55));
  const textureCompetitor = candidates
    .filter((candidate) => Math.hypot(candidate.x - best.x, candidate.y - best.y) >= Math.max(mask.width, mask.height) * .75)
    .reduce((maximum, candidate) => Math.max(maximum, candidate.textureScore ?? 0), 0);
  const textureSeparation = best.textureScore === undefined ? 0 : (best.textureScore - textureCompetitor) / Math.max(best.textureScore, .01);
  const edgeConfidence = best.edgeScore < 12 ? 0 : separation * .65 + edgeEvidence * .35;
  const textureConfidence = (best.textureScore ?? 0) < .52 || textureSeparation < .35 ? 0 : textureSeparation * .55 + textureEvidence * .45;
  const confidence = Math.min(1, Math.max(edgeConfidence, textureConfidence));
  if (confidence === 0) return undefined;
  return { x: best.x, y: best.y, width: mask.width, height: mask.height, confidence, score: best.score };
}

export function locateSliderGap(input: GapLocatorInput): GapLocation | undefined {
  const { image } = input;
  if (image.width < 120 || image.height < 60 || image.data.length !== image.width * image.height * 4) return undefined;
  const minimumX = Math.max(Math.round(image.width * .18), Math.round(input.minimumX ?? 0));
  const gray = luminance(image);
  const gradient = gradientMap(gray, image.width, image.height);
  if (input.pieceMask !== undefined) return locateMaskedGap(image, gradient, input.pieceMask, minimumX);
  const size = Math.max(20, Math.min(Math.round(input.expectedSize), Math.floor(Math.min(image.width, image.height) * .6)));
  if (minimumX + size >= image.width) return undefined;
  const map = integral(gradient, image.width, image.height);
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
