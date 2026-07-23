import { describe, expect, expectTypeOf, it } from 'vitest';

import { MAX_OCR_TEXT_LENGTH } from '../../src/core/arithmetic';
import {
  interpretResult,
  resultInterpreter,
} from '../../src/core/result-interpreter';
import type {
  FieldMatch,
  ImagePayload,
  InterpretedResult,
  OcrEngine,
  OcrResult,
  ScoreResult,
  WorkflowResult,
} from '../../src/core/types';

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
    'preserves non-integer division confirmation data for %j',
    (text) => {
      expect(interpretResult({ text, confidence: 0.8, mode: 'arithmetic' })).toEqual({
        kind: 'invalid',
        reason: 'non_integer_division',
        displayText: '7/2',
        confidence: 0.8,
      });
    },
  );

  it('accepts 64 source characters without truncating and rejects 65', () => {
    const atLimit = 'A'.repeat(MAX_OCR_TEXT_LENGTH);
    const overLimit = 'A'.repeat(MAX_OCR_TEXT_LENGTH + 1);

    expect(interpretResult({ text: atLimit, confidence: 1, mode: 'letters' })).toEqual({
      kind: 'plain',
      displayText: atLimit,
      fillValue: atLimit,
      confidence: 1,
    });
    expect(interpretResult({ text: overLimit, confidence: 1, mode: 'letters' })).toEqual({
      kind: 'invalid',
      reason: 'unsupported',
    });
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, -0.01, 1.01])(
    'rejects hostile confidence %s',
    (confidence) => {
      expect(interpretResult({ text: '1234', confidence, mode: 'digits' })).toEqual({
        kind: 'invalid',
        reason: 'unsupported',
      });
    },
  );

  it('accepts confidence boundaries zero and one', () => {
    expect(interpretResult({ text: '0', confidence: 0, mode: 'digits' })).toMatchObject({
      kind: 'plain',
      confidence: 0,
    });
    expect(interpretResult({ text: '1', confidence: 1, mode: 'digits' })).toMatchObject({
      kind: 'plain',
      confidence: 1,
    });
  });

  it('keeps empty and unsupported invalid variants free of fill values', () => {
    const empty: InterpretedResult = { kind: 'invalid', reason: 'empty' };
    const unsupported: InterpretedResult = { kind: 'invalid', reason: 'unsupported' };

    // @ts-expect-error Invalid empty results must not carry fill values.
    const emptyWithFill: InterpretedResult = { ...empty, fillValue: '' };
    // @ts-expect-error Invalid unsupported results must not carry fill values.
    const unsupportedWithFill: InterpretedResult = { ...unsupported, fillValue: '123' };

    expect(emptyWithFill).toHaveProperty('fillValue', '');
    expect(unsupportedWithFill).toHaveProperty('fillValue', '123');
  });
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
      {
        kind: 'invalid',
        reason: 'non_integer_division',
        displayText: '4/3',
        confidence: 0.77,
      },
      { kind: 'invalid', reason: 'unsupported' },
    ]);

    const interpreted = resultInterpreter.interpret(results);
    if (false) {
      // @ts-expect-error Interpreter outputs are readonly.
      interpreted.push({ kind: 'invalid', reason: 'unsupported' });
    }
  });
});

describe('OcrEngine', () => {
  it('exposes awaited recognition results as readonly', async () => {
    const image: ImagePayload = {
      bytes: new Uint8Array(),
      mimeType: 'image/png',
      revision: 'revision-1',
    };
    const engine: OcrEngine = {
      async recognize() {
        return [{ text: '1234', confidence: 0.9, mode: 'digits' }];
      },
    };

    const results = await engine.recognize(image, ['digits']);
    if (false) {
      // @ts-expect-error OCR engine results are readonly outputs.
      results.push({ text: '5678', confidence: 0.8, mode: 'digits' });
    }

    expect(results).toEqual([{ text: '1234', confidence: 0.9, mode: 'digits' }]);
  });
});

describe('FieldMatch', () => {
  type Field = { id: string };
  const field: Field = { id: 'answer' };
  const candidates = [{ field, score: 90, reasons: ['same form'] }] as const;

  it('requires and narrows a winner only for unique matches', () => {
    const match: FieldMatch<Field> = { state: 'unique', winner: field, candidates };

    if (match.state === 'unique') {
      expectTypeOf(match.winner).toEqualTypeOf<Field>();
      expect(match.winner.id).toBe('answer');
    }
  });

  it('rejects impossible winner states at compile time', () => {
    // @ts-expect-error Unique matches require a winner.
    const missingWinner: FieldMatch<Field> = { state: 'unique', candidates };
    // @ts-expect-error Ambiguous matches prohibit a winner.
    const ambiguousWinner: FieldMatch<Field> = { state: 'ambiguous', winner: field, candidates };
    // @ts-expect-error Empty matches prohibit a winner.
    const noneWinner: FieldMatch<Field> = { state: 'none', winner: field, candidates };

    expect([missingWinner.state, ambiguousWinner.state, noneWinner.state]).toEqual([
      'unique',
      'ambiguous',
      'none',
    ]);
  });

  it('exposes readonly ranked candidates and reason arrays', () => {
    const match: FieldMatch<Field> = { state: 'unique', winner: field, candidates };
    const score: ScoreResult = { score: 90, reasons: ['same form'] };

    if (false) {
      // @ts-expect-error Ranked candidates are readonly outputs.
      match.candidates.push({ field, score: 0, reasons: [] });
      // @ts-expect-error Score reasons are readonly outputs.
      score.reasons.push('mutable');
    }

    expect(match.candidates).toHaveLength(1);
    expect(score.reasons).toEqual(['same form']);
  });
});

describe('WorkflowResult', () => {
  const fixturesByState = {
    filled: {
      state: 'filled',
      candidateId: 'captcha-1',
      fieldId: 'answer-1',
      displayText: '12+7 = 19',
      fillValue: '19',
    },
    needs_confirmation: {
      state: 'needs_confirmation',
      candidateId: 'captcha-2',
      displayText: '7/2',
      fieldIds: ['answer-2', 'answer-3'],
    },
    no_candidate: { state: 'no_candidate' },
    no_field: {
      state: 'no_field',
      candidateId: 'captcha-3',
      displayText: 'AbC',
      fillValue: 'AbC',
    },
    image_unavailable: { state: 'image_unavailable', candidateId: 'captcha-4' },
    recognition_failed: { state: 'recognition_failed', candidateId: 'captcha-5' },
    stale: { state: 'stale', candidateId: 'captcha-6' },
    model_unavailable: { state: 'model_unavailable', candidateId: 'captcha-7' },
  } satisfies {
    [State in WorkflowResult['state']]: Extract<WorkflowResult, { state: State }>;
  };

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
    expect(Object.values(fixturesByState).map(describeState)).toHaveLength(8);
    expect(Object.keys(fixturesByState)).toEqual([
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

  it('exposes readonly confirmation field ids', () => {
    const result: WorkflowResult = fixturesByState.needs_confirmation;

    if (result.state === 'needs_confirmation' && false) {
      // @ts-expect-error Confirmation field IDs are readonly outputs.
      result.fieldIds.push('mutable');
    }

    expect(result.fieldIds).toEqual(['answer-2', 'answer-3']);
  });
});
