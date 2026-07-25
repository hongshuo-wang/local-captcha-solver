import { describe, expect, it } from 'vitest';

import {
  UNIQUE_FIELD_MARGIN,
  UNIQUE_FIELD_THRESHOLD,
  matchCaptchaField,
  type FieldSnapshot,
} from '../../src/core/field-matcher';

const image = { id: 'captcha-image' };

function field(overrides: Partial<FieldSnapshot> = {}): FieldSnapshot {
  return {
    id: 'captcha-answer',
    type: 'text',
    value: '',
    visible: true,
    disabled: false,
    readOnly: false,
    distance: 20,
    sameForm: true,
    labelText: 'Verification code',
    ...overrides,
  };
}

describe('matchCaptchaField', () => {
  it('selects a nearby unique empty text field and explains why', () => {
    const answer = field();
    const match = matchCaptchaField(image, [answer, field({ id: 'search', distance: 700, sameForm: false, labelText: 'Search' })]);

    expect(match.state).toBe('unique');
    if (match.state === 'unique') {
      expect(match.winner).toBe(answer);
      expect(match.candidates[0]?.reasons).toEqual(
        expect.arrayContaining(['empty editable text-like field', 'same form as captcha', 'captcha-relevant label']),
      );
    }
  });

  it('excludes unsafe and non-empty fields from automatic matching', () => {
    const match = matchCaptchaField(image, [
      field({ id: 'hidden', visible: false }),
      field({ id: 'disabled', disabled: true }),
      field({ id: 'readonly', readOnly: true }),
      field({ id: 'password', type: 'password' }),
      field({ id: 'file', type: 'file' }),
      field({ id: 'checkbox', type: 'checkbox' }),
      field({ id: 'radio', type: 'radio' }),
      field({ id: 'button', type: 'button' }),
      field({ id: 'submit', type: 'submit' }),
      field({ id: 'filled', value: 'already filled' }),
      field({ id: 'whitespace', value: '   ' }),
    ]);

    expect(match).toEqual({ state: 'none', candidates: [] });
  });

  it('does not guess between tied eligible fields', () => {
    const match = matchCaptchaField(image, [field({ id: 'first' }), field({ id: 'second' })]);

    expect(match.state).toBe('ambiguous');
    expect(match.candidates).toHaveLength(2);
  });

  it('does not guess when a lower-scoring eligible runner-up is within the margin', () => {
    const match = matchCaptchaField(image, [
      field({ id: 'winner', distance: 100, sameForm: false }),
      field({ id: 'runner-up', distance: 400, sameForm: false, labelText: 'Security answer' }),
    ]);

    expect(match.state).toBe('ambiguous');
    expect(match.candidates.map((candidate) => candidate.score)).toEqual([65, 55]);
  });

  it('selects a winner when its lead meets the margin', () => {
    const winner = field({ id: 'winner', distance: 20, labelText: 'Response' });
    const match = matchCaptchaField(image, [
      winner,
      field({ id: 'runner-up', distance: 400, sameForm: false, labelText: 'Security answer' }),
    ]);

    expect(match.state).toBe('unique');
    if (match.state === 'unique') expect(match.winner).toBe(winner);
  });

  it('requires a winner score strictly above the threshold', () => {
    const exactThreshold = matchCaptchaField(image, [
      field({ distance: 100, labelText: 'General response' }),
    ]);

    expect(exactThreshold).toEqual({ state: 'none', candidates: [] });
  });

  it('exports the automatic matching threshold and margin', () => {
    const belowThreshold = matchCaptchaField(image, [
      field({ distance: 600, sameForm: false, labelText: 'General response' }),
    ]);

    expect(UNIQUE_FIELD_THRESHOLD).toBe(60);
    expect(UNIQUE_FIELD_MARGIN).toBe(15);
    expect(belowThreshold).toEqual({ state: 'none', candidates: [] });
  });
});
