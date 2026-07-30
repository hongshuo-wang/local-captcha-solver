import { describe, expect, it } from 'vitest';

import { validateDatasetManifest } from '../../training/ppocrv6-captcha/dataset';

const alphabet = Array.from(new Set(
  '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ+-*/xX×÷=?',
));
const hash = (character: string) => character.repeat(64);

function manifest() {
  return {
    schemaVersion: 1,
    licenses: [{ id: 'generated-project', name: 'Project-generated fixtures', url: null, redistribution: true }],
    samples: [
      { id: 'train-a', split: 'train', source: 'synthetic', group: 'template-a', image: 'data/images/train-a.png', label: 'A1b2', sha256: hash('a'), licenseId: 'generated-project' },
      { id: 'validation-b', split: 'validation', source: 'synthetic', group: 'template-b', image: 'data/images/validation-b.png', label: '7*3=?', sha256: hash('b'), licenseId: 'generated-project' },
      { id: 'test-c', split: 'test', source: 'real', group: 'site-example', image: 'data/private/test-c.png', label: '9÷3', sha256: hash('c'), licenseId: 'generated-project' },
    ],
  };
}

describe('PP-OCRv6 training dataset manifest', () => {
  it('accepts licensed, hashed, source-isolated samples in the 70-character alphabet', () => {
    const result = validateDatasetManifest(manifest(), {
      alphabet,
      maximumLabelLength: 12,
      frozenBenchmarkHashes: new Set([hash('f')]),
    });
    expect(result.counts).toEqual({ train: 1, validation: 1, test: 1 });
  });

  it('rejects template or website groups shared across splits', () => {
    const value = manifest();
    value.samples[1].group = 'template-a';
    expect(() => validateDatasetManifest(value, {
      alphabet,
      maximumLabelLength: 12,
      frozenBenchmarkHashes: new Set(),
    })).toThrow(/group.*split/i);
  });

  it('rejects frozen benchmark leakage by image hash', () => {
    const value = manifest();
    expect(() => validateDatasetManifest(value, {
      alphabet,
      maximumLabelLength: 12,
      frozenBenchmarkHashes: new Set([value.samples[0].sha256]),
    })).toThrow(/frozen benchmark/i);
  });

  it('rejects unknown characters, missing licenses, and duplicate image hashes', () => {
    const unknown = manifest();
    unknown.samples[0].label = 'A_1';
    expect(() => validateDatasetManifest(unknown, { alphabet, maximumLabelLength: 12, frozenBenchmarkHashes: new Set() })).toThrow(/character/i);
    const unlicensed = manifest();
    unlicensed.samples[0].licenseId = 'missing';
    expect(() => validateDatasetManifest(unlicensed, { alphabet, maximumLabelLength: 12, frozenBenchmarkHashes: new Set() })).toThrow(/license/i);
    const duplicate = manifest();
    duplicate.samples[1].sha256 = duplicate.samples[0].sha256;
    expect(() => validateDatasetManifest(duplicate, { alphabet, maximumLabelLength: 12, frozenBenchmarkHashes: new Set() })).toThrow(/duplicate.*sha/i);
  });
});
