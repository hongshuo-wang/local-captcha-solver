import { describe, expect, it } from 'vitest';

import {
  balancedTrainingSamples,
  trainingBucket,
} from '../../training/ppocrv6-captcha/materialize-balanced-labels';
import type { TrainingDatasetSample } from '../../training/ppocrv6-captcha/materialize-dataset';

const labels = ['1234', 'AbCd', 'A1b2', '1+2', '3-1', '2*4', '8/2', '3x3', '4X2', '2×5', '8÷4'];

function samples(): TrainingDatasetSample[] {
  return labels.map((label, index) => ({
    id: `sample-${index}`,
    split: 'train',
    source: 'synthetic',
    group: 'fixture',
    image: `data/images/${index}.png`,
    label,
    sha256: String(index).padStart(64, '0'),
    licenseId: 'fixture',
  }));
}

describe('balanced PaddleOCR label materialization', () => {
  it('is deterministic and balances categories plus arithmetic symbols', () => {
    const first = balancedTrainingSamples(samples(), 16, 1234);
    expect(first).toEqual(balancedTrainingSamples(samples(), 16, 1234));
    const counts = new Map<string, number>();
    for (const sample of first) {
      const bucket = trainingBucket(sample.label);
      counts.set(bucket, (counts.get(bucket) ?? 0) + 1);
    }
    expect(first).toHaveLength(64);
    expect(counts.get('digits')).toBe(16);
    expect(counts.get('letters')).toBe(16);
    expect(counts.get('alphanumeric')).toBe(16);
    for (const operator of ['+', '-', '*', '/', 'x', 'X', '×', '÷']) {
      expect(counts.get(`arithmetic:${operator}`)).toBe(2);
    }
  });

  it('rejects invalid targets and unsupported labels', () => {
    expect(() => balancedTrainingSamples(samples(), 7)).toThrow(/multiple of eight/i);
    expect(() => trainingBucket('1_2')).toThrow(/unsupported/i);
  });
});
