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
    expect(result!.x).toBeGreaterThanOrEqual(targetX - 1);
    expect(result!.x).toBeLessThanOrEqual(targetX + 1);
    expect(result!.confidence).toBeGreaterThan(.58);
  });
});
