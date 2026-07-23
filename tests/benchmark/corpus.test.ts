import { describe, expect, it } from 'vitest';

import {
  parseGeneratedManifest,
  parseRealManifest,
} from '../../benchmark/corpus';
import type { BenchmarkCategory } from '../../benchmark/report';

function generatedSample(category: BenchmarkCategory, index: number) {
  const id = `${category}-${String(index + 1).padStart(3, '0')}`;
  const arithmetic = category === 'arithmetic';
  return {
    id,
    category,
    image: `benchmark/fixtures/generated/${id}.png`,
    answer: arithmetic ? '8÷2' : category === 'digits' ? '0101' : category === 'letters' ? 'IlOo' : 'I1o0',
    ...(arithmetic ? { fill: '4' } : {}),
    generation: {
      fontFamily: 'Benchmark Sans',
      fontFile: 'node_modules/dejavu-fonts-ttf/ttf/DejaVuSans.ttf',
      fontSizePx: 36,
      foreground: '#595959',
      background: '#ffffff',
      contrastBand: '7:1',
      interferenceLines: 1,
      rotationDegrees: 1.5,
    },
  };
}

function generatedManifest() {
  return {
    schemaVersion: 2,
    seed: 123,
    samples: (['digits', 'letters', 'alphanumeric', 'arithmetic'] as const).flatMap(
      (category) => Array.from({ length: 50 }, (_, index) => generatedSample(category, index)),
    ),
  };
}

function realManifest() {
  const sha256 = 'a'.repeat(64);
  return {
    schemaVersion: 1,
    samples: [{
      id: `real-${sha256.slice(0, 16)}`,
      category: 'arithmetic',
      image: `benchmark/fixtures/real/${sha256}.png`,
      answer: '8÷2',
      fill: '4',
      sha256,
      provenance: 'authorized fixture',
      license: 'permission granted',
    }],
  };
}

describe('parseGeneratedManifest', () => {
  it('accepts exactly 200 fully validated generated samples', () => {
    const manifest = parseGeneratedManifest(generatedManifest());
    expect(manifest.samples).toHaveLength(200);
  });

  it.each([
    ['legacy schema version', (value: ReturnType<typeof generatedManifest>) => { value.schemaVersion = 1; }],
    ['sample count', (value: ReturnType<typeof generatedManifest>) => { value.samples.pop(); }],
    ['category distribution', (value: ReturnType<typeof generatedManifest>) => { value.samples[0] = generatedSample('letters', 0); }],
    ['image path', (value: ReturnType<typeof generatedManifest>) => { value.samples[0].image = '../escape.png'; }],
    ['ordinary label', (value: ReturnType<typeof generatedManifest>) => { value.samples[0].answer = '12A4'; }],
    ['arithmetic fill', (value: ReturnType<typeof generatedManifest>) => { value.samples[150].fill = '5'; }],
    ['rotation metadata', (value: ReturnType<typeof generatedManifest>) => { value.samples[0].generation.rotationDegrees = 2.1; }],
  ])('rejects invalid %s', (_name, mutate) => {
    const value = generatedManifest();
    mutate(value);
    expect(() => parseGeneratedManifest(value)).toThrow();
  });
});

describe('parseRealManifest', () => {
  it('accepts complete provenance and license metadata', () => {
    expect(parseRealManifest(realManifest()).samples).toHaveLength(1);
  });

  it.each([
    ['schema', (value: ReturnType<typeof realManifest>) => { value.schemaVersion = 2; }],
    ['provenance', (value: ReturnType<typeof realManifest>) => { value.samples[0].provenance = ''; }],
    ['license', (value: ReturnType<typeof realManifest>) => { value.samples[0].license = '  '; }],
    ['hash path', (value: ReturnType<typeof realManifest>) => { value.samples[0].image = 'benchmark/fixtures/real/other.png'; }],
    ['unknown field', (value: ReturnType<typeof realManifest>) => { Object.assign(value.samples[0], { note: 'no' }); }],
  ])('rejects invalid %s', (_name, mutate) => {
    const value = realManifest();
    mutate(value);
    expect(() => parseRealManifest(value)).toThrow();
  });
});
