import { describe, expect, it } from 'vitest';

import { decodeCtc } from '../../src/ocr/ctc-decoder';

const CHARSET = ['', 'A', 'B', 'C'] as const;

function logits(rows: readonly (readonly number[])[]): Float32Array {
  return new Float32Array(rows.flat());
}

function probability(row: readonly number[], selectedIndex: number): number {
  const maximum = Math.max(...row);
  const exponentials = row.map((value) => Math.exp(value - maximum));
  return exponentials[selectedIndex] / exponentials.reduce((sum, value) => sum + value, 0);
}

describe('decodeCtc', () => {
  it('returns an empty result with zero confidence for blank-only output', () => {
    expect(
      decodeCtc(logits([[4, 1, 0, -1], [3, 2, 1, 0]]), [1, 2, 4], CHARSET, new Set(['A'])),
    ).toEqual({ text: '', confidence: 0 });
  });

  it('collapses consecutive repetitions of the same selected class', () => {
    const rows = [
      [0, 3, 1, -1],
      [0, 4, 1, -1],
      [0, 2, 1, -1],
    ] as const;

    const result = decodeCtc(logits(rows), [1, 3, 4], CHARSET, new Set(['A']));

    expect(result.text).toBe('A');
    expect(result.confidence).toBeCloseTo(probability(rows[1], 1), 7);
  });

  it('allows a blank to separate identical emitted characters', () => {
    const rows = [
      [0, 4, 1, -1],
      [5, 1, 0, -1],
      [0, 3, 1, -1],
    ] as const;

    const result = decodeCtc(logits(rows), [1, 3, 4], CHARSET, new Set(['A']));

    expect(result.text).toBe('AA');
    expect(result.confidence).toBeCloseTo(
      (probability(rows[0], 1) + probability(rows[2], 1)) / 2,
      7,
    );
  });

  it('masks disallowed classes before selecting the timestep argmax', () => {
    const rows = [[1, 4, 9, 0]] as const;

    const result = decodeCtc(logits(rows), [1, 1, 4], CHARSET, new Set(['A']));

    expect(result.text).toBe('A');
    expect(result.confidence).toBeCloseTo(probability(rows[0], 1), 7);
  });

  it('uses full-softmax probability when a disallowed class dominates', () => {
    const rows = [[0, 5, 20, -3]] as const;

    const result = decodeCtc(logits(rows), [1, 1, 4], CHARSET, new Set(['A']));

    expect(result.text).toBe('A');
    expect(result.confidence).toBeCloseTo(probability(rows[0], 1), 10);
    expect(result.confidence).toBeLessThan(0.000001);
  });

  it('ignores allowed symbols that do not occur in the charset', () => {
    expect(
      decodeCtc(logits([[0, 1, 8, -1]]), [1, 1, 4], CHARSET, new Set(['A', 'Z'])),
    ).toMatchObject({ text: 'A' });
  });

  it('decodes only blank when the allowed set is empty', () => {
    expect(decodeCtc(logits([[0, 10, 9, 8]]), [1, 1, 4], CHARSET, new Set())).toEqual({
      text: '',
      confidence: 0,
    });
  });

  it.each([
    ['batch-first', [1, 2, 4]],
    ['time-first', [2, 1, 4]],
  ] as const)('supports the %s tensor layout', (_name, dims) => {
    const result = decodeCtc(
      logits([
        [0, 5, 1, -1],
        [0, 1, 5, -1],
      ]),
      dims,
      CHARSET,
      new Set(['A', 'B']),
    );

    expect(result.text).toBe('AB');
  });

  it('accepts the ambiguous [1, 1, classes] layout', () => {
    expect(
      decodeCtc(logits([[0, 1, 2, 5]]), [1, 1, 4], CHARSET, new Set(['C'])),
    ).toMatchObject({ text: 'C' });
  });

  it('takes the run maximum and then averages across emitted characters', () => {
    const rows = [
      [0, 2, -1, -2],
      [0, 5, -1, -2],
      [0, -1, 3, -2],
      [0, -1, 1, -2],
    ] as const;

    const result = decodeCtc(logits(rows), [1, 4, 4], CHARSET, new Set(['A', 'B']));
    const expected = (probability(rows[1], 1) + probability(rows[2], 2)) / 2;

    expect(result).toMatchObject({ text: 'AB' });
    expect(result.confidence).toBeCloseTo(expected, 7);
  });

  it('computes stable softmax probabilities for huge finite logits', () => {
    const rows = [[1e30, 1e30, -1e30, -1e30]] as const;

    const result = decodeCtc(logits(rows), [1, 1, 4], CHARSET, new Set(['A']));

    expect(result.text).toBe('');
    expect(result.confidence).toBe(0);

    const selectedRows = [[1e30, 1e30 + 1e24, -1e30, -1e30]] as const;
    const selected = decodeCtc(
      logits(selectedRows),
      [1, 1, 4],
      CHARSET,
      new Set(['A']),
    );

    expect(selected.text).toBe('A');
    expect(Number.isFinite(selected.confidence)).toBe(true);
    expect(selected.confidence).toBeGreaterThan(0.99);
  });

  it('uses the lowest class index to break selected-logit ties', () => {
    expect(
      decodeCtc(logits([[0, 7, 7, -1]]), [1, 1, 4], CHARSET, new Set(['A', 'B'])),
    ).toMatchObject({ text: 'A' });
  });

  it.each([
    ['dimensions with the wrong rank', [1, 4]],
    ['dimensions with too many axes', [1, 1, 1, 4]],
    ['dimensions without a singleton batch axis', [2, 3, 4]],
    ['dimensions with two non-batch leading axes', [2, 2, 4]],
    ['zero time', [1, 0, 4]],
    ['negative time', [-1, 1, 4]],
    ['fractional time', [1, 1.5, 4]],
    ['zero classes', [1, 2, 0]],
    ['negative classes', [1, 2, -4]],
    ['fractional classes', [1, 2, 4.5]],
  ] as const)('rejects %s', (_name, dims) => {
    expect(() => decodeCtc(new Float32Array(), dims, CHARSET, new Set())).toThrow(RangeError);
  });

  it('rejects non-array dimensions', () => {
    expect(() =>
      decodeCtc(new Float32Array(), null as unknown as readonly number[], CHARSET, new Set()),
    ).toThrow(TypeError);
  });

  it('rejects logits whose length does not match time times classes', () => {
    expect(() => decodeCtc(new Float32Array(7), [1, 2, 4], CHARSET, new Set())).toThrow(
      /logits length/i,
    );
  });

  it('rejects a charset whose length does not match classes', () => {
    expect(() =>
      decodeCtc(new Float32Array(8), [1, 2, 4], ['', 'A'], new Set(['A'])),
    ).toThrow(/charset length/i);
  });

  it('requires the first charset entry to represent blank', () => {
    expect(() =>
      decodeCtc(new Float32Array(8), [1, 2, 4], ['_', 'A', 'B', 'C'], new Set(['A'])),
    ).toThrow(/blank/i);
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    'rejects non-finite logit %s',
    (value) => {
      const values = logits([[0, 1, 2, 3]]);
      values[2] = value;

      expect(() => decodeCtc(values, [1, 1, 4], CHARSET, new Set(['A']))).toThrow(
        /finite/i,
      );
    },
  );

  it('rejects invalid runtime argument types', () => {
    expect(() =>
      decodeCtc([0, 1] as unknown as Float32Array, [1, 1, 2], ['', 'A'], new Set(['A'])),
    ).toThrow(TypeError);
    expect(() =>
      decodeCtc(new Float32Array(2), [1, 1, 2], null as unknown as readonly string[], new Set()),
    ).toThrow(TypeError);
    expect(() =>
      decodeCtc(new Float32Array(2), [1, 1, 2], ['', 'A'], null as unknown as ReadonlySet<string>),
    ).toThrow(TypeError);
  });

  it('does not mutate any input collection', () => {
    const values = logits([
      [0, 5, 1, -1],
      [4, 0, 1, -1],
    ]);
    const dims = [1, 2, 4] as const;
    const charset = ['', 'A', 'B', 'C'] as const;
    const allowed = new Set(['A', 'B']);
    const valuesBefore = new Float32Array(values);
    const dimsBefore = [...dims];
    const charsetBefore = [...charset];
    const allowedBefore = [...allowed];

    decodeCtc(values, dims, charset, allowed);

    expect(values).toEqual(valuesBefore);
    expect(dims).toEqual(dimsBefore);
    expect(charset).toEqual(charsetBefore);
    expect([...allowed]).toEqual(allowedBefore);
  });
});
