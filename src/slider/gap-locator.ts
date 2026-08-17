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

const MINIMUM_TEXTURE_CORRELATION = .52;
const MINIMUM_GEOMETRY_EVIDENCE = .42;
const MINIMUM_GEOMETRY_SEPARATION = .18;
const GEOMETRY_CONFIDENCE_CAP = .72;

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

function shapeEdgeScore(gradient: Float32Array, imageWidth: number, x: number, y: number, edges: readonly { x: number; y: number }[]): number {
  let sum = 0;
  let covered = 0;
  let strong = 0;
  for (const edge of edges) {
    let nearbyMaximum = 0;
    for (let offsetY = -2; offsetY <= 2; offsetY += 1) for (let offsetX = -2; offsetX <= 2; offsetX += 1) {
      nearbyMaximum = Math.max(nearbyMaximum, gradient[(y + edge.y + offsetY) * imageWidth + x + edge.x + offsetX]!);
    }
    sum += Math.min(nearbyMaximum, 140);
    if (nearbyMaximum >= 28) covered += 1;
    if (nearbyMaximum >= 55) strong += 1;
  }
  return sum / edges.length * .45 + covered / edges.length * 45 + strong / edges.length * 20;
}

function maskRegions(mask: NonNullable<GapLocatorInput['pieceMask']>): { inside: Array<{ x: number; y: number }>; ring: Array<{ x: number; y: number }> } | undefined {
  const opaque = (x: number, y: number) => mask.alpha[y * mask.width + x]! > 220;
  const inside: Array<{ x: number; y: number }> = [];
  const ring: Array<{ x: number; y: number }> = [];
  for (let y = 1; y < mask.height - 1; y += 1) for (let x = 1; x < mask.width - 1; x += 1) {
    if (opaque(x, y)) {
      if (x % 2 === 0 && y % 2 === 0 && opaque(x - 1, y) && opaque(x + 1, y) && opaque(x, y - 1) && opaque(x, y + 1)) inside.push({ x, y });
      continue;
    }
    let nearPiece = false;
    for (let offsetY = -3; offsetY <= 3 && !nearPiece; offsetY += 1) for (let offsetX = -3; offsetX <= 3; offsetX += 1) {
      const sampleX = x + offsetX;
      const sampleY = y + offsetY;
      if (sampleX >= 0 && sampleY >= 0 && sampleX < mask.width && sampleY < mask.height && opaque(sampleX, sampleY)) nearPiece = true;
    }
    if (nearPiece) ring.push({ x, y });
  }
  return inside.length >= 24 && ring.length >= 16 ? { inside, ring } : undefined;
}

function regionContrast(luminanceMap: Float32Array, imageWidth: number, x: number, y: number, regions: NonNullable<ReturnType<typeof maskRegions>>): number {
  let insideSum = 0;
  let ringSum = 0;
  for (const sample of regions.inside) insideSum += luminanceMap[(y + sample.y) * imageWidth + x + sample.x]!;
  for (const sample of regions.ring) ringSum += luminanceMap[(y + sample.y) * imageWidth + x + sample.x]!;
  return Math.abs(insideSum / regions.inside.length - ringSum / regions.ring.length);
}

function textureCorrelation(backgroundLuminance: Float32Array, imageWidth: number, x: number, y: number, mask: NonNullable<GapLocatorInput['pieceMask']>): number | undefined {
  if (mask.luminance?.length !== mask.alpha.length) return undefined;
  let pieceSum = 0;
  let backgroundSum = 0;
  let count = 0;
  const margin = Math.max(3, Math.round(Math.min(mask.width, mask.height) * .1));
  for (let sampleY = margin; sampleY < mask.height - margin; sampleY += 2) for (let sampleX = margin; sampleX < mask.width - margin; sampleX += 2) {
    const index = sampleY * mask.width + sampleX;
    if (mask.alpha[index]! < 220 || mask.alpha[index - 1]! < 220 || mask.alpha[index + 1]! < 220 || mask.alpha[index - mask.width]! < 220 || mask.alpha[index + mask.width]! < 220) continue;
    pieceSum += mask.luminance[index]!;
    backgroundSum += backgroundLuminance[(y + sampleY) * imageWidth + x + sampleX]!;
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
    const pieceDelta = mask.luminance[index]! - pieceMean;
    const backgroundDelta = backgroundLuminance[(y + sampleY) * imageWidth + x + sampleX]! - backgroundMean;
    covariance += pieceDelta * backgroundDelta;
    pieceVariance += pieceDelta * pieceDelta;
    backgroundVariance += backgroundDelta * backgroundDelta;
  }
  const denominator = Math.sqrt(pieceVariance * backgroundVariance);
  return denominator < 1 ? undefined : covariance / denominator;
}

function locateMaskedGap(image: PixelImage, luminanceMap: Float32Array, gradient: Float32Array, mask: NonNullable<GapLocatorInput['pieceMask']>, minimumX: number): GapLocation | undefined {
  if (mask.width < 20 || mask.height < 20 || mask.alpha.length !== mask.width * mask.height) return undefined;
  const edges = maskEdges(mask);
  if (edges.length < 16) return undefined;
  const hasPieceTexture = mask.luminance?.length === mask.alpha.length;
  const regions = maskRegions(mask);
  const yRadius = Math.max(4, Math.round(mask.height * .12));
  const minimumY = Math.max(1, Math.round(mask.offsetY) - yRadius);
  const maximumY = Math.min(image.height - mask.height - 2, Math.round(mask.offsetY) + yRadius);
  const candidates: Array<{ x: number; y: number; score: number; edgeScore: number; edgeEvidence: number; regionEvidence: number; regionScore?: number; textureScore?: number }> = [];
  for (let y = minimumY; y <= maximumY; y += 1) for (let x = minimumX; x + mask.width < image.width - 1; x += 1) {
    const edgeScore = shapeEdgeScore(gradient, image.width, x, y, edges);
    let interiorScore = 0;
    let interiorCount = 0;
    for (let sampleY = 4; sampleY < mask.height - 4; sampleY += 3) for (let sampleX = 4; sampleX < mask.width - 4; sampleX += 3) {
      if (mask.alpha[sampleY * mask.width + sampleX]! <= 20) continue;
      interiorScore += gradient[(y + sampleY) * image.width + x + sampleX]!;
      interiorCount += 1;
    }
    const averageEdgeScore = edgeScore - (interiorCount === 0 ? 0 : interiorScore / interiorCount * .12);
    const textureScore = hasPieceTexture ? textureCorrelation(luminanceMap, image.width, x, y, mask) : undefined;
    const regionScore = regions === undefined ? undefined : regionContrast(luminanceMap, image.width, x, y, regions);
    candidates.push({ x, y, score: averageEdgeScore, edgeScore: averageEdgeScore, edgeEvidence: 0, regionEvidence: 0, ...(regionScore === undefined ? {} : { regionScore }), ...(textureScore === undefined ? {} : { textureScore }) });
  }
  if (hasPieceTexture) {
    const indexed = new Map(candidates.map((candidate) => [`${candidate.x}:${candidate.y}`, candidate.textureScore ?? -1]));
    const radiusX = Math.max(1, Math.round(mask.width * .04));
    const radiusY = Math.max(1, Math.round(mask.height * .04));
    for (const candidate of candidates) {
      let nearbyTexture = candidate.textureScore ?? -1;
      for (let offsetY = -radiusY; offsetY <= radiusY; offsetY += 1) for (let offsetX = -radiusX; offsetX <= radiusX; offsetX += 1) {
        nearbyTexture = Math.max(nearbyTexture, indexed.get(`${candidate.x + offsetX}:${candidate.y + offsetY}`) ?? -1);
      }
      candidate.textureScore = nearbyTexture;
    }
  }
  const orderedEdges = candidates.map((candidate) => candidate.edgeScore).sort((left, right) => left - right);
  const edgeBaseline = orderedEdges[Math.floor(orderedEdges.length * .5)] ?? 0;
  const edgeMaximum = orderedEdges.at(-1) ?? edgeBaseline;
  const edgeRange = Math.max(1, edgeMaximum - edgeBaseline);
  const orderedRegions = candidates.map((candidate) => candidate.regionScore ?? 0).sort((left, right) => left - right);
  const regionBaseline = orderedRegions[Math.floor(orderedRegions.length * .5)] ?? 0;
  const regionMaximum = orderedRegions.at(-1) ?? regionBaseline;
  const regionRange = Math.max(1, regionMaximum - regionBaseline);
  for (const candidate of candidates) {
    const normalizedEdge = Math.min(1, Math.max(0, (candidate.edgeScore - edgeBaseline) / edgeRange));
    const edgeAbsolute = Math.min(1, Math.max(0, (candidate.edgeScore - 18) / 60));
    const normalizedRegion = Math.min(1, Math.max(0, ((candidate.regionScore ?? 0) - regionBaseline) / regionRange));
    const regionAbsolute = Math.min(1, Math.max(0, ((candidate.regionScore ?? 0) - 10) / 70));
    candidate.edgeEvidence = Math.sqrt(normalizedEdge * edgeAbsolute);
    candidate.regionEvidence = Math.sqrt(normalizedRegion * regionAbsolute);
    candidate.score = candidate.edgeEvidence * 30 + Math.max(0, candidate.textureScore ?? 0) * 60 + candidate.regionEvidence * 40;
  }
  candidates.sort((left, right) => right.score - left.score);
  const best = candidates[0];
  if (best === undefined) return undefined;
  const competing = candidates.find((candidate) => Math.hypot(candidate.x - best.x, candidate.y - best.y) >= Math.max(mask.width, mask.height) * .75);
  const competitorScore = Math.max(0, competing?.score ?? 0);
  const separation = (best.score - competitorScore) / Math.max(best.score, 1);
  const alignmentRadius = Math.max(3, Math.round(Math.max(mask.width, mask.height) * .1));
  const localEdgeCandidate = candidates
    .filter((candidate) => Math.hypot(candidate.x - best.x, candidate.y - best.y) <= alignmentRadius)
    .reduce((strongest, candidate) => candidate.edgeScore > strongest.edgeScore ? candidate : strongest, best);
  const localEdgeScore = localEdgeCandidate.edgeScore;
  const edgeEvidence = localEdgeCandidate.edgeEvidence;
  const edgeCompetitor = candidates
    .filter((candidate) => Math.hypot(candidate.x - best.x, candidate.y - best.y) >= Math.max(mask.width, mask.height) * .75)
    .reduce((maximum, candidate) => Math.max(maximum, candidate.edgeScore), 0);
  const edgeSeparation = (localEdgeScore - edgeCompetitor) / Math.max(localEdgeScore, 1);
  const textureEvidence = Math.min(1, Math.max(0, ((best.textureScore ?? 0) - .35) / .5));
  const textureCompetitor = candidates
    .filter((candidate) => Math.hypot(candidate.x - best.x, candidate.y - best.y) >= Math.max(mask.width, mask.height) * .75)
    .reduce((maximum, candidate) => Math.max(maximum, candidate.textureScore ?? 0), 0);
  const textureSeparation = best.textureScore === undefined ? 0 : (best.textureScore - textureCompetitor) / Math.max(best.textureScore, .01);
  const regionCompetitor = candidates
    .filter((candidate) => Math.hypot(candidate.x - best.x, candidate.y - best.y) >= Math.max(mask.width, mask.height) * .75)
    .reduce((maximum, candidate) => Math.max(maximum, candidate.regionScore ?? 0), 0);
  const regionSeparation = best.regionScore === undefined ? 0 : ((best.regionScore ?? 0) - regionCompetitor) / Math.max(best.regionScore ?? 0, 1);
  const edgeConfidence = localEdgeScore < 20 ? 0 : Math.max(0, edgeSeparation) * .6 + edgeEvidence * .4;
  const textureConfidence = (best.textureScore ?? 0) < .55 || textureSeparation < .25 ? 0 : textureSeparation * .55 + textureEvidence * .45;
  const regionConfidence = (best.regionScore ?? 0) < 25 || regionSeparation < .25 ? 0 : regionSeparation * .55 + best.regionEvidence * .45;
  const evidence = [edgeEvidence, textureEvidence, best.regionEvidence].sort((left, right) => right - left);
  const combinedConfidence = separation * .6 + evidence[0]! * .4;
  const corroboratedConfidence = evidence[1]! < .35 || separation < .12 ? 0 : evidence[0]! * .55 + evidence[1]! * .45;
  const confidence = Math.min(1, Math.max(edgeConfidence, textureConfidence, regionConfidence, combinedConfidence, corroboratedConfidence));
  if (hasPieceTexture && (best.textureScore ?? -1) < MINIMUM_TEXTURE_CORRELATION) {
    const geometryCandidates = [...candidates].sort((left, right) => {
      const leftScore = left.edgeEvidence * .55 + left.regionEvidence * .45;
      const rightScore = right.edgeEvidence * .55 + right.regionEvidence * .45;
      return rightScore - leftScore;
    });
    const geometryBest = geometryCandidates[0];
    if (geometryBest === undefined || geometryBest.regionScore === undefined) return undefined;
    const geometryScore = geometryBest.edgeEvidence * .55 + geometryBest.regionEvidence * .45;
    const geometryCompetitor = geometryCandidates.find((candidate) => Math.hypot(candidate.x - geometryBest.x, candidate.y - geometryBest.y) >= Math.max(mask.width, mask.height) * .75);
    const geometryCompetitorScore = geometryCompetitor === undefined ? 0 : geometryCompetitor.edgeEvidence * .55 + geometryCompetitor.regionEvidence * .45;
    const geometrySeparation = (geometryScore - geometryCompetitorScore) / Math.max(geometryScore, 1);
    const geometryConfidence = geometrySeparation * .6 + geometryScore * .4;
    if (geometryBest.edgeEvidence < MINIMUM_GEOMETRY_EVIDENCE || geometryBest.regionEvidence < MINIMUM_GEOMETRY_EVIDENCE || geometrySeparation < MINIMUM_GEOMETRY_SEPARATION || geometryConfidence < MINIMUM_TEXTURE_CORRELATION) return undefined;
    return { x: geometryBest.x, y: geometryBest.y, width: mask.width, height: mask.height, confidence: Math.min(GEOMETRY_CONFIDENCE_CAP, geometryConfidence), score: geometryBest.score };
  }
  if (confidence === 0) return undefined;
  return { x: best.x, y: best.y, width: mask.width, height: mask.height, confidence, score: best.score };
}

export function locateSliderGap(input: GapLocatorInput): GapLocation | undefined {
  const { image } = input;
  if (image.width < 120 || image.height < 60 || image.data.length !== image.width * image.height * 4) return undefined;
  const minimumX = Math.max(Math.round(image.width * .18), Math.round(input.minimumX ?? 0));
  const gray = luminance(image);
  const gradient = gradientMap(gray, image.width, image.height);
  if (input.pieceMask !== undefined) return locateMaskedGap(image, gray, gradient, input.pieceMask, minimumX);
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
