import { describe, expect, it } from 'vitest';

import {
  analyzeArithmetic,
  MAX_OCR_TEXT_LENGTH,
  parseArithmetic,
} from '../../src/core/arithmetic';

describe('parseArithmetic', () => {
  it.each([
    ['12+7', '12+7', '19'],
    ['9 - 3 =', '9-3', '6'],
    ['3-9', '3-9', '-6'],
    ['6×4?', '6*4', '24'],
    ['8/2', '8/2', '4'],
    ['8÷2', '8/2', '4'],
    ['8x3', '8*3', '24'],
    ['8X3', '8*3', '24'],
    ['8*3', '8*3', '24'],
  ])('evaluates %s', (source, expression, value) => {
    expect(parseArithmetic(source)).toEqual({ expression, value });
  });

  it('preserves operand digit spellings while calculating with exact integers', () => {
    expect(parseArithmetic('09007199254740993 + 0007 =')).toEqual({
      expression: '09007199254740993+0007',
      value: '9007199254741000',
    });
  });

  it.each([
    '1/0',
    '7/2',
    '1+2+3',
    '1+',
    '+1',
    '',
    '   ',
    'alert(1)',
    'eight+3',
    '-1+2',
    '1+-2',
    '1.5+2',
    '1+2answer',
    '1+2==',
    '1+2??',
    '1+2=?',
  ])('rejects %j', (source) => {
    expect(parseArithmetic(source)).toBeNull();
  });

  it('keeps the compatibility API bounded to the exported OCR text limit', () => {
    const atLimit = `${'1'.repeat(MAX_OCR_TEXT_LENGTH - 2)}+1`;
    const overLimit = `${'1'.repeat(MAX_OCR_TEXT_LENGTH - 1)}+1`;

    expect(atLimit).toHaveLength(64);
    expect(parseArithmetic(atLimit)).toEqual({
      expression: atLimit,
      value: `${'1'.repeat(MAX_OCR_TEXT_LENGTH - 3)}2`,
    });
    expect(overLimit).toHaveLength(65);
    expect(parseArithmetic(overLimit)).toBeNull();
  });
});

describe('analyzeArithmetic', () => {
  it('returns a valid normalized expression and exact value', () => {
    expect(analyzeArithmetic(' 09007199254740993 × 0007 ? ')).toEqual({
      kind: 'valid',
      expression: '09007199254740993*0007',
      value: '63050394783186951',
    });
  });

  it.each([
    ['7/2', '7/2'],
    [' 07 ÷ 02 = ', '07/02'],
  ])('preserves normalized non-integer division details for %j', (source, expression) => {
    expect(analyzeArithmetic(source)).toEqual({
      kind: 'non_integer_division',
      expression,
    });
  });

  it.each(['1/0', '1+2+3', 'abc', `${'1'.repeat(63)}+1`])(
    'classifies %j as unsupported',
    (source) => {
      expect(analyzeArithmetic(source)).toEqual({ kind: 'unsupported' });
    },
  );
});
