import { describe, expect, it } from 'vitest';

import { decodeArithmeticCtc } from '../../src/ocr/arithmetic-ctc-decoder';
import { decodeCtc } from '../../src/ocr/ctc-decoder';

const CHARSET = ['', '1', '2', '7', '-'] as const;
const FULL_CHARSET = [
  '',
  '0',
  '1',
  '2',
  '3',
  '4',
  '5',
  '6',
  '7',
  '8',
  '9',
  '+',
  '-',
  '*',
  '/',
  'x',
  'X',
  '×',
  '÷',
  '=',
  '?',
] as const;

function logits(rows: readonly (readonly number[])[]): Float32Array {
  return new Float32Array(rows.flat());
}

function pathLogits(
  path: readonly string[],
  charset: readonly string[] = FULL_CHARSET,
  high = 12,
  low = -12,
): Float32Array {
  return logits(
    path.map((character) => {
      const row = Array<number>(charset.length).fill(low);
      const classIndex = charset.indexOf(character);
      if (classIndex < 0) {
        throw new Error(`Missing test character ${character}`);
      }
      row[classIndex] = high;
      return row;
    }),
  );
}

function probability(row: readonly number[], selectedIndex: number): number {
  const maximum = Math.max(...row);
  const exponentials = row.map((value) => Math.exp(value - maximum));
  return exponentials[selectedIndex] / exponentials.reduce((sum, value) => sum + value, 0);
}

describe('decodeArithmeticCtc', () => {
  it('recovers an operator hidden by a locally stronger blank', () => {
    const values = logits([
      [0, 8, -8, -8, -8],
      [0, -8, 8, -8, -8],
      [5, -8, -8, -8, 4],
      [0, -8, -8, 8, -8],
    ]);

    expect(decodeCtc(values, [1, 4, 5], CHARSET, new Set(CHARSET))).toMatchObject({
      text: '127',
    });
    expect(decodeArithmeticCtc(values, [1, 4, 5], CHARSET)).toMatchObject({
      text: '12-7',
    });

    const rows = [
      [0, 8, -8, -8, -8],
      [0, -8, 8, -8, -8],
      [5, -8, -8, -8, 4],
      [0, -8, -8, 8, -8],
    ] as const;
    expect(decodeArithmeticCtc(values, [1, 4, 5], CHARSET)?.confidence).toBeCloseTo(
      (probability(rows[0], 1) +
        probability(rows[1], 2) +
        probability(rows[2], 4) +
        probability(rows[3], 3)) /
        4,
      7,
    );
  });

  it('returns null for incomplete digits-only text', () => {
    const values = pathLogits(['1', '2']);

    expect(decodeArithmeticCtc(values, [1, 2, FULL_CHARSET.length], FULL_CHARSET)).toBeNull();
  });

  it('returns null for a missing right-hand operand', () => {
    const values = pathLogits(['1', '+']);

    expect(decodeArithmeticCtc(values, [1, 2, FULL_CHARSET.length], FULL_CHARSET)).toBeNull();
  });

  it('returns null for a double operator', () => {
    const path = ['1', '+', '', '+', '2'] as const;
    const values = pathLogits(path);

    expect(
      decodeCtc(
        values,
        [1, path.length, FULL_CHARSET.length],
        FULL_CHARSET,
        new Set(FULL_CHARSET),
      ),
    ).toMatchObject({ text: '1++2' });
    expect(
      decodeArithmeticCtc(values, [1, path.length, FULL_CHARSET.length], FULL_CHARSET),
    ).toBeNull();
  });

  it('ignores adjacent operator noise before the left operand', () => {
    const path = ['+', '-', '1', '+', '2'] as const;
    const values = pathLogits(path);
    values[0] = 6;
    values[FULL_CHARSET.length] = 6;

    expect(
      decodeCtc(
        values,
        [1, path.length, FULL_CHARSET.length],
        FULL_CHARSET,
        new Set(FULL_CHARSET),
      ),
    ).toMatchObject({ text: '+-1+2' });
    expect(
      decodeArithmeticCtc(values, [1, path.length, FULL_CHARSET.length], FULL_CHARSET),
    ).toMatchObject({ text: '1+2' });
  });

  it('rejects division by zero after selecting the strongest complete expression', () => {
    const values = pathLogits(['1', '÷', '0']);

    expect(decodeArithmeticCtc(values, [1, 3, FULL_CHARSET.length], FULL_CHARSET)).toBeNull();
  });

  it('keeps non-integer division text for the interpreter to classify later', () => {
    const values = pathLogits(['7', '÷', '2']);

    expect(decodeArithmeticCtc(values, [1, 3, FULL_CHARSET.length], FULL_CHARSET)).toMatchObject({
      text: '7÷2',
    });
  });

  it('requires a blank separation to emit a repeated digit', () => {
    const separated = pathLogits(['1', '', '1', '+', '2']);
    const collapsed = pathLogits(['1', '1', '+', '2']);

    expect(
      decodeArithmeticCtc(separated, [1, 5, FULL_CHARSET.length], FULL_CHARSET),
    ).toMatchObject({ text: '11+2' });
    expect(
      decodeArithmeticCtc(collapsed, [1, 4, FULL_CHARSET.length], FULL_CHARSET),
    ).toMatchObject({ text: '1+2' });
  });

  it('preserves an optional arithmetic suffix', () => {
    const values = pathLogits(['3', '+', '4', '=']);

    expect(decodeArithmeticCtc(values, [1, 4, FULL_CHARSET.length], FULL_CHARSET)).toMatchObject({
      text: '3+4=',
    });
  });

  it.each([
    ['batch-first', [1, 3, FULL_CHARSET.length]],
    ['time-first', [3, 1, FULL_CHARSET.length]],
  ] as const)('supports the %s tensor layout', (_name, dims) => {
    expect(decodeArithmeticCtc(pathLogits(['6', '×', '4']), dims, FULL_CHARSET)).toMatchObject({
      text: '6×4',
    });
  });

  it('uses lexical prefix order to break equal beam scores', () => {
    const charset = ['', '1', '2', '+', '-'] as const;
    const values = logits([
      [0, 8, -8, -8, -8],
      [0, -8, -8, 7, 7],
      [0, -8, 8, -8, -8],
    ]);

    expect(decodeArithmeticCtc(values, [1, 3, 5], charset)).toMatchObject({ text: '1+2' });
  });

  it('uses full-class softmax probabilities for forced-alignment confidence', () => {
    const charset = ['', '1', '2', '+', 'A'] as const;
    const rows = [
      [0, 6, -5, -5, 20],
      [0, -5, -5, 6, -5],
      [0, -5, 6, -5, -5],
    ] as const;

    const result = decodeArithmeticCtc(logits(rows), [1, 3, 5], charset);

    expect(result).toMatchObject({ text: '1+2' });
    expect(result?.confidence).toBeCloseTo(
      (probability(rows[0], 1) + probability(rows[1], 3) + probability(rows[2], 2)) / 3,
      10,
    );
    expect(result?.confidence).toBeLessThan(0.67);
  });

  it('uses the first charset index for a duplicate relevant glyph', () => {
    const charset = ['', '1', '2', '+', '+', '-'] as const;
    const values = logits([
      [0, 10, -10, -10, -10, -10],
      [0, -10, -10, -10, 10, 5],
      [0, -10, 10, -10, -10, -10],
    ]);

    expect(decodeArithmeticCtc(values, [1, 3, 6], charset)).toMatchObject({ text: '1-2' });
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    'rejects non-finite logit %s',
    (value) => {
      const values = pathLogits(['1', '+', '2']);
      values[2] = value;

      expect(() =>
        decodeArithmeticCtc(values, [1, 3, FULL_CHARSET.length], FULL_CHARSET),
      ).toThrow(/finite/i);
    },
  );

  it.each([
    ['dimensions with the wrong rank', [1, FULL_CHARSET.length]],
    ['dimensions without a singleton batch axis', [2, 3, FULL_CHARSET.length]],
    ['zero time', [1, 0, FULL_CHARSET.length]],
    ['fractional time', [1, 1.5, FULL_CHARSET.length]],
    ['zero classes', [1, 3, 0]],
    ['fractional classes', [1, 3, 1.5]],
  ] as const)('rejects %s', (_name, dims) => {
    expect(() => decodeArithmeticCtc(new Float32Array(), dims, FULL_CHARSET)).toThrow(RangeError);
  });

  it('rejects invalid runtime argument types', () => {
    expect(() =>
      decodeArithmeticCtc(
        [0, 1] as unknown as Float32Array,
        [1, 1, 2],
        ['', '1'],
      ),
    ).toThrow(TypeError);
    expect(() =>
      decodeArithmeticCtc(
        new Float32Array(2),
        null as unknown as readonly number[],
        ['', '1'],
      ),
    ).toThrow(TypeError);
    expect(() =>
      decodeArithmeticCtc(
        new Float32Array(2),
        [1, 1, 2],
        null as unknown as readonly string[],
      ),
    ).toThrow(TypeError);
  });

  it('rejects logits whose length does not match time times classes', () => {
    expect(() =>
      decodeArithmeticCtc(new Float32Array(5), [1, 3, 2], ['', '1']),
    ).toThrow(/logits length/i);
  });

  it('rejects a charset whose length does not match classes', () => {
    expect(() =>
      decodeArithmeticCtc(new Float32Array(6), [1, 3, 2], ['', '1', '2']),
    ).toThrow(/charset length/i);
  });

  it('requires the first charset entry to represent blank', () => {
    expect(() =>
      decodeArithmeticCtc(new Float32Array(6), [1, 3, 2], ['_', '1']),
    ).toThrow(/blank/i);
  });

  it('rejects non-string charset entries', () => {
    expect(() =>
      decodeArithmeticCtc(
        new Float32Array(6),
        [1, 3, 2],
        ['', 1] as unknown as readonly string[],
      ),
    ).toThrow(TypeError);
  });

  it('does not mutate logits, dimensions, or charset', () => {
    const values = pathLogits(['1', '+', '2']);
    const dims = [1, 3, FULL_CHARSET.length] as const;
    const charset = [...FULL_CHARSET];
    const valuesBefore = new Float32Array(values);
    const dimsBefore = [...dims];
    const charsetBefore = [...charset];

    decodeArithmeticCtc(values, dims, charset);

    expect(values).toEqual(valuesBefore);
    expect(dims).toEqual(dimsBefore);
    expect(charset).toEqual(charsetBefore);
  });
});
