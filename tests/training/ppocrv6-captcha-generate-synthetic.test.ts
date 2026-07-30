import { describe, expect, it } from 'vitest';

import {
  fittedCanvasSize,
  syntheticPlan,
} from '../../training/ppocrv6-captcha/generate-synthetic';
import { parseArithmetic } from '../../src/core/arithmetic';

describe('synthetic CAPTCHA plans', () => {
  it('are deterministic and isolate template groups by split', () => {
    expect(syntheticPlan('train', 17)).toEqual(syntheticPlan('train', 17));
    const trainGroups = new Set(Array.from({ length: 128 }, (_, index) => syntheticPlan('train', index).group));
    const validationGroups = new Set(Array.from({ length: 128 }, (_, index) => syntheticPlan('validation', index).group));
    expect([...trainGroups].some((group) => validationGroups.has(group))).toBe(false);
  });

  it('balances supported arithmetic operators and suffixes with valid integer results', () => {
    const plans = Array.from({ length: 512 }, (_, index) => syntheticPlan('train', index * 4 + 3));
    const labels = plans.map((plan) => plan.label);
    for (const operator of ['+', '-', '*', '/', 'x', 'X', '×', '÷']) {
      expect(labels.some((label) => label.includes(operator))).toBe(true);
      expect(new Set(plans.filter((plan) => plan.label.includes(operator)).map((plan) => plan.group)).size).toBe(4);
    }
    for (const suffix of ['=?', '=', '?']) {
      expect(labels.some((label) => label.endsWith(suffix))).toBe(true);
    }
    expect(labels.some((label) => !/[=?]$/.test(label))).toBe(true);
    expect(labels.every((label) => parseArithmetic(label) !== null)).toBe(true);
  });

  it('expands the canvas when text plus transform padding would be clipped', () => {
    expect(fittedCanvasSize(130, 48, 180.2, 43)).toEqual({
      width: 215,
      height: 61,
      horizontalPadding: 17,
      verticalPadding: 9,
    });
    expect(fittedCanvasSize(230, 76, 100, 30)).toEqual({
      width: 230,
      height: 76,
      horizontalPadding: 13,
      verticalPadding: 7,
    });
    expect(() => fittedCanvasSize(0, 48, 100, 30)).toThrow(/positive finite/i);
  });
});
