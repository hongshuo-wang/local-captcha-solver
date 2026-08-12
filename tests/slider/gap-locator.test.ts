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
});
