import { describe, expect, it } from 'vitest';

import { parseArithmetic } from '../../src/core/arithmetic';

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
});
