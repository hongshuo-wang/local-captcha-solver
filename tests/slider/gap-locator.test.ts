import { describe, expect, it } from 'vitest';

import { locateSliderGap, type PixelImage } from '../../src/slider/gap-locator';

function imageWithGap(shape: 'square' | 'notched', gapX: number, gapY: number, size: number): PixelImage {
  const width = 260;
  const height = 120;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4;
      const shade = 142 + Math.round(18 * Math.sin(x / 19) + 12 * Math.cos(y / 13));
      data[index] = shade;
      data[index + 1] = shade + 8;
      data[index + 2] = shade - 6;
      data[index + 3] = 255;
    }
  }
  const border = (x: number, y: number): void => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const index = (y * width + x) * 4;
    data[index] = 25;
    data[index + 1] = 25;
    data[index + 2] = 25;
  };
  for (let offset = 0; offset < size; offset += 1) {
    border(gapX + offset, gapY);
    border(gapX + offset, gapY + size - 1);
    border(gapX, gapY + offset);
    border(gapX + size - 1, gapY + offset);
  }
  if (shape === 'notched') {
    const center = gapX + Math.floor(size / 2);
    for (let x = center - 5; x <= center + 5; x += 1) border(x, gapY - 5 + Math.abs(x - center));
  }
  return { width, height, data };
}

describe('slider gap locator', () => {
  it.each(['square', 'notched'] as const)('finds a %s gap without depending on a fixed puzzle silhouette', (shape) => {
    const result = locateSliderGap({ image: imageWithGap(shape, 166, 34, 38), expectedSize: 38 });
    expect(result).toBeDefined();
    expect(result!.x).toBeGreaterThanOrEqual(160);
    expect(result!.x).toBeLessThanOrEqual(171);
    expect(result!.y).toBeGreaterThanOrEqual(28);
    expect(result!.y).toBeLessThanOrEqual(40);
    expect(result!.confidence).toBeGreaterThan(.58);
  });

  it('abstains when the image has no strong edge candidate', () => {
    const data = new Uint8ClampedArray(220 * 100 * 4).fill(160);
    for (let index = 3; index < data.length; index += 4) data[index] = 255;
    expect(locateSliderGap({ image: { width: 220, height: 100, data }, expectedSize: 36 })).toBeUndefined();
  });

  it('uses an arbitrary transparent puzzle silhouette to reject unrelated background edges', () => {
    const image = imageWithGap('square', 166, 34, 38);
    const width = 38;
    const height = 38;
    const alpha = new Array<number>(width * height).fill(0);
    const opaque = (x: number, y: number) => x >= 4 && x < 34 && y >= 4 && y < 34 && !(x >= 14 && x < 24 && y < 10);
    for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) alpha[y * width + x] = opaque(x, y) ? 255 : 0;
    const border = (x: number, y: number): void => {
      const index = (y * image.width + x) * 4;
      image.data[index] = 12; image.data[index + 1] = 12; image.data[index + 2] = 12;
    };
    for (let y = 1; y < height - 1; y += 1) for (let x = 1; x < width - 1; x += 1) {
      if (!opaque(x, y) || (opaque(x - 1, y) && opaque(x + 1, y) && opaque(x, y - 1) && opaque(x, y + 1))) continue;
      border(162 + x, 30 + y);
    }

    const result = locateSliderGap({ image, expectedSize: 38, pieceMask: { offsetY: 30, width, height, alpha } });
    expect(result).toMatchObject({ x: expect.any(Number), y: expect.any(Number), confidence: expect.any(Number) });
    expect(result!.x).toBeGreaterThanOrEqual(160);
    expect(result!.x).toBeLessThanOrEqual(166);
    expect(result!.confidence).toBeGreaterThan(.58);
  });

  it('uses piece texture to distinguish a real gap from a competing silhouette edge', () => {
    const width = 38;
    const height = 38;
    const targetX = 164;
    const targetY = 30;
    const distractorX = 92;
    const image = imageWithGap('square', targetX, targetY, width);
    const alpha = new Array<number>(width * height).fill(0);
    const luminance = new Array<number>(width * height);
    for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
      const shade = 55 + ((x * 37 + y * 61 + x * y * 7) % 170);
      luminance[y * width + x] = shade;
      if (x >= 3 && x < width - 3 && y >= 3 && y < height - 3) alpha[y * width + x] = 255;
      const target = ((targetY + y) * image.width + targetX + x) * 4;
      image.data[target] = shade;
      image.data[target + 1] = shade;
      image.data[target + 2] = shade;
    }
    const border = (originX: number, originY: number): void => {
      for (let offset = 3; offset < width - 3; offset += 1) for (const [x, y] of [[originX + offset, originY + 3], [originX + offset, originY + height - 4], [originX + 3, originY + offset], [originX + width - 4, originY + offset]]) {
        const index = (y * image.width + x) * 4;
        image.data[index] = 10; image.data[index + 1] = 10; image.data[index + 2] = 10;
      }
    };
    border(targetX, targetY);
    border(distractorX, targetY);

    const result = locateSliderGap({ image, expectedSize: width, pieceMask: { offsetY: targetY, width, height, alpha, luminance } });
    expect(result).toMatchObject({ confidence: expect.any(Number) });
    expect(result!.x).toBeGreaterThanOrEqual(targetX - 2);
    expect(result!.x).toBeLessThanOrEqual(targetX + 2);
    expect(result!.confidence).toBeGreaterThan(.58);
  });

  it('matches piece texture after the target region is uniformly darkened', () => {
    const width = 56;
    const height = 52;
    const targetX = 158;
    const targetY = 32;
    const distractorX = 76;
    const image = imageWithGap('square', targetX, targetY, width);
    const alpha = new Array<number>(width * height).fill(0);
    const luminance = new Array<number>(width * height).fill(0);
    const opaque = (x: number, y: number) => x >= 4 && x < width - 4 && y >= 4 && y < height - 4 && !(x >= 19 && x < 35 && y < 12);
    for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
      if (!opaque(x, y)) continue;
      const target = ((targetY + y) * image.width + targetX + x) * 4;
      const original = 45 + ((x * 37 + y * 61 + x * y * 7) % 175);
      image.data[target] = original;
      image.data[target + 1] = Math.min(255, original + 7);
      image.data[target + 2] = Math.max(0, original - 5);
      alpha[y * width + x] = 255;
      luminance[y * width + x] = original * .2126 + Math.min(255, original + 7) * .7152 + Math.max(0, original - 5) * .0722;
      image.data[target] = Math.round(original * .52 + 18);
      image.data[target + 1] = Math.round(Math.min(255, original + 7) * .52 + 18);
      image.data[target + 2] = Math.round(Math.max(0, original - 5) * .52 + 18);
    }
    for (let y = 1; y < height - 1; y += 1) for (let x = 1; x < width - 1; x += 1) {
      if (!opaque(x, y) || (opaque(x - 1, y) && opaque(x + 1, y) && opaque(x, y - 1) && opaque(x, y + 1))) continue;
      const distractor = ((targetY + y) * image.width + distractorX + x) * 4;
      image.data[distractor] = 5;
      image.data[distractor + 1] = 5;
      image.data[distractor + 2] = 5;
    }

    const result = locateSliderGap({ image, expectedSize: width, pieceMask: { offsetY: targetY, width, height, alpha, luminance } });
    expect(result).toMatchObject({ confidence: expect.any(Number) });
    expect(result!.x).toBeGreaterThanOrEqual(targetX - 2);
    expect(result!.x).toBeLessThanOrEqual(targetX + 2);
    expect(result!.confidence).toBeGreaterThan(.58);
  });

  it('uses guarded geometry when piece texture is not preserved by the renderer', () => {
    const width = 48;
    const height = 48;
    const targetX = 154;
    const targetY = 30;
    const image = imageWithGap('notched', targetX, targetY, width);
    const alpha = new Array<number>(width * height).fill(0);
    const luminance = new Array<number>(width * height).fill(0);
    const opaque = (x: number, y: number) => x >= 3 && x < width - 3 && y >= 3 && y < height - 3;
    for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
      const value = 25 + ((x * 17 + y * 31 + x * y * 5) % 220);
      luminance[y * width + x] = value;
      if (!opaque(x, y)) continue;
      alpha[y * width + x] = 255;
      const target = ((targetY + y) * image.width + targetX + x) * 4;
      image.data[target] = 45;
      image.data[target + 1] = 45;
      image.data[target + 2] = 45;
    }

    const result = locateSliderGap({ image, expectedSize: width, pieceMask: { offsetY: targetY, width, height, alpha, luminance } });
    expect(result).toMatchObject({ confidence: expect.any(Number) });
    expect(result!.x).toBeGreaterThanOrEqual(targetX - 2);
    expect(result!.x).toBeLessThanOrEqual(targetX + 2);
    expect(result!.confidence).toBeGreaterThan(.58);
    expect(result!.confidence).toBeLessThanOrEqual(.72);
  });

  it('uses a distinctive non-rectangular silhouette when flat texture provides no match', () => {
    const width = 48;
    const height = 48;
    const targetX = 154;
    const targetY = 30;
    const image = imageWithGap('square', targetX, targetY, width);
    const alpha = new Array<number>(width * height).fill(0);
    const luminance = new Array<number>(width * height).fill(110);
    const opaque = (x: number, y: number) => x >= 2 && x < width - 2 && y >= 2 && y < height - 2 && !(x >= 17 && x < 31 && y < 11);
    for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) alpha[y * width + x] = opaque(x, y) ? 255 : 0;
    for (let y = 1; y < height - 1; y += 1) for (let x = 1; x < width - 1; x += 1) {
      if (!opaque(x, y) || (opaque(x - 1, y) && opaque(x + 1, y) && opaque(x, y - 1) && opaque(x, y + 1))) continue;
      const target = ((targetY + y) * image.width + targetX + x) * 4;
      image.data[target] = 8;
      image.data[target + 1] = 8;
      image.data[target + 2] = 8;
    }

    const result = locateSliderGap({ image, expectedSize: width, pieceMask: { offsetY: targetY, width, height, alpha, luminance } });

    expect(result).toMatchObject({ confidence: expect.any(Number) });
    expect(result!.x).toBeGreaterThanOrEqual(targetX - 2);
    expect(result!.x).toBeLessThanOrEqual(targetX + 2);
    expect(result!.confidence).toBeGreaterThan(.58);
    expect(result!.confidence).toBeLessThanOrEqual(.68);
  });

  it('abstains when a strong silhouette does not share the piece texture', () => {
    const width = 48;
    const height = 48;
    const image = imageWithGap('notched', 154, 30, width);
    const alpha = new Array<number>(width * height).fill(0);
    const luminance = new Array<number>(width * height).fill(0);
    for (let y = 3; y < height - 3; y += 1) for (let x = 3; x < width - 3; x += 1) {
      alpha[y * width + x] = 255;
      luminance[y * width + x] = 35 + ((x * 43 + y * 71 + x * y * 11) % 190);
    }

    expect(locateSliderGap({ image, expectedSize: width, pieceMask: { offsetY: 30, width, height, alpha, luminance } })).toBeUndefined();
  });

  it('uses a complete reference image when the altered gap has weak edges and flat texture', () => {
    const width = 52;
    const height = 50;
    const targetX = 48;
    const targetY = 36;
    const reference = imageWithGap('square', 180, 20, 24);
    const image = { ...reference, data: new Uint8ClampedArray(reference.data) };
    const alpha = new Array<number>(width * height).fill(0);
    const luminance = new Array<number>(width * height).fill(110);
    for (let y = 3; y < height - 3; y += 1) for (let x = 3; x < width - 3; x += 1) {
      alpha[y * width + x] = 255;
      const index = ((targetY + y) * image.width + targetX + x) * 4;
      image.data[index] = 55;
      image.data[index + 1] = 55;
      image.data[index + 2] = 55;
    }

    const result = locateSliderGap({ image, referenceImage: reference, expectedSize: width, pieceMask: { offsetY: targetY, width, height, alpha, luminance } });

    expect(result).toMatchObject({ x: targetX, y: targetY, confidence: expect.any(Number) });
    expect(result!.confidence).toBeGreaterThan(.58);
  });

  it('abstains when two supplied backgrounds differ across the whole puzzle', () => {
    const image = imageWithGap('square', 154, 30, 48);
    const reference = imageWithGap('square', 88, 30, 48);
    for (let index = 0; index < reference.data.length; index += 4) {
      reference.data[index] = Math.min(255, reference.data[index]! + 70);
      reference.data[index + 1] = Math.min(255, reference.data[index + 1]! + 70);
      reference.data[index + 2] = Math.min(255, reference.data[index + 2]! + 70);
    }
    const alpha = new Array<number>(48 * 48).fill(255);

    expect(locateSliderGap({ image, referenceImage: reference, expectedSize: 48, pieceMask: { offsetY: 30, width: 48, height: 48, alpha } })).toBeUndefined();
  });
});
