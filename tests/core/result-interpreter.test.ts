import { describe, expect, it } from 'vitest';

import {
  interpretResult,
  resultInterpreter,
} from '../../src/core/result-interpreter';
import type { OcrResult, WorkflowResult } from '../../src/core/types';

describe('interpretResult', () => {
  it.each([
    ['digits', '00721'],
    ['letters', 'AbCdZ'],
    ['alphanumeric', 'aB09Z'],
  ] as const)('preserves valid %s text and confidence', (mode, text) => {
    expect(interpretResult({ text, confidence: 0.87, mode })).toEqual({
      kind: 'plain',
      displayText: text,
      fillValue: text,
      confidence: 0.87,
    });
  });

  it.each([
    [{ mode: 'digits', text: '12a' }, 'unsupported'],
    [{ mode: 'letters', text: 'Ab2' }, 'unsupported'],
    [{ mode: 'alphanumeric', text: '3+4' }, 'unsupported'],
    [{ mode: 'digits', text: ' 123 ' }, 'unsupported'],
    [{ mode: 'letters', text: 'A b' }, 'unsupported'],
    [{ mode: 'arithmetic', text: 'abc' }, 'unsupported'],
    [{ mode: 'arithmetic', text: '1/0' }, 'unsupported'],
    [{ mode: 'arithmetic', text: '1+2+3' }, 'unsupported'],
    [{ mode: 'arithmetic', text: '1.5+2' }, 'unsupported'],
  ] as const)('rejects $mode OCR text %j as $reason', ({ mode, text }, reason) => {
    expect(interpretResult({ text, confidence: 0.4, mode })).toEqual({
      kind: 'invalid',
      reason,
    });
  });

  it.each([
    { mode: 'digits', text: '' },
    { mode: 'letters', text: ' \t\n ' },
    { mode: 'arithmetic', text: '   ' },
  ] as const)('classifies empty $mode OCR text', ({ mode, text }) => {
    expect(interpretResult({ text, confidence: 0.1, mode })).toEqual({
      kind: 'invalid',
      reason: 'empty',
    });
  });

  it('computes an arithmetic fill value and formats a stable display value', () => {
    expect(
      interpretResult({ text: ' 6 × 4 ? ', confidence: 0.93, mode: 'arithmetic' }),
    ).toEqual({
      kind: 'arithmetic',
      displayText: '6*4 = 24',
      fillValue: '24',
      confidence: 0.93,
    });
  });

  it.each(['7/2', ' 7 ÷ 2 = '])(
    'distinguishes non-integer division in %j',
    (text) => {
      expect(interpretResult({ text, confidence: 0.8, mode: 'arithmetic' })).toEqual({
        kind: 'invalid',
        reason: 'non_integer_division',
      });
    },
  );
});

describe('resultInterpreter', () => {
  it('maps OCR results in their original order', () => {
    const results: readonly OcrResult[] = [
      { text: 'AbC', confidence: 0.91, mode: 'letters' },
      { text: '12-5=', confidence: 0.88, mode: 'arithmetic' },
      { text: '4/3', confidence: 0.77, mode: 'arithmetic' },
      { text: 'A-1', confidence: 0.66, mode: 'alphanumeric' },
    ];

    expect(resultInterpreter.interpret(results)).toEqual([
      { kind: 'plain', displayText: 'AbC', fillValue: 'AbC', confidence: 0.91 },
      { kind: 'arithmetic', displayText: '12-5 = 7', fillValue: '7', confidence: 0.88 },
      { kind: 'invalid', reason: 'non_integer_division' },
      { kind: 'invalid', reason: 'unsupported' },
    ]);
  });
});

describe('WorkflowResult', () => {
  const fixtures = [
    {
      state: 'filled',
      candidateId: 'captcha-1',
      fieldId: 'answer-1',
      displayText: '12+7 = 19',
      fillValue: '19',
    },
    {
      state: 'needs_confirmation',
      candidateId: 'captcha-2',
      displayText: '7/2',
      fieldIds: ['answer-2', 'answer-3'],
    },
    { state: 'no_candidate' },
    {
      state: 'no_field',
      candidateId: 'captcha-3',
      displayText: 'AbC',
      fillValue: 'AbC',
    },
    { state: 'image_unavailable', candidateId: 'captcha-4' },
    { state: 'recognition_failed', candidateId: 'captcha-5' },
    { state: 'stale', candidateId: 'captcha-6' },
    { state: 'model_unavailable', candidateId: 'captcha-7' },
  ] satisfies readonly WorkflowResult[];

  function assertNever(value: never): never {
    throw new Error(`Unexpected workflow result: ${JSON.stringify(value)}`);
  }

  function describeState(result: WorkflowResult): string {
    switch (result.state) {
      case 'filled':
        return `${result.candidateId}:${result.fieldId}:${result.displayText}:${result.fillValue}`;
      case 'needs_confirmation':
        return `${result.candidateId}:${result.displayText}:${result.fillValue ?? ''}:${result.fieldIds.join(',')}`;
      case 'no_candidate':
        return result.state;
      case 'no_field':
        return `${result.candidateId}:${result.displayText}:${result.fillValue}`;
      case 'image_unavailable':
      case 'recognition_failed':
      case 'stale':
      case 'model_unavailable':
        return `${result.state}:${result.candidateId}`;
      default:
        return assertNever(result);
    }
  }

  it('keeps all eight workflow states in one exhaustive vocabulary', () => {
    expect(fixtures.map(describeState)).toHaveLength(8);
    expect(fixtures.map((fixture) => fixture.state)).toEqual([
      'filled',
      'needs_confirmation',
      'no_candidate',
      'no_field',
      'image_unavailable',
      'recognition_failed',
      'stale',
      'model_unavailable',
    ]);
  });
});
