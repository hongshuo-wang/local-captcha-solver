import { describe, expect, it } from 'vitest';

import {
  AUTOMATIC_CANDIDATE_THRESHOLD,
  scoreCaptchaCandidate,
} from '../../src/core/candidate-scorer';

describe('scoreCaptchaCandidate', () => {
  it('adds independent reasons and score for each positive evidence category', () => {
    const baseline = {
      attrText: '',
      nearbyText: '',
      width: 140,
      height: 48,
      inForm: false,
      nearShortInput: false,
    };
    const baseResult = scoreCaptchaCandidate(baseline);
    const cases = [
      [{ ...baseline, attrText: 'captcha' }, 'captcha or verification attribute'],
      [{ ...baseline, nearbyText: 'Verification required' }, 'captcha or verification nearby text'],
      [{ ...baseline, inForm: true }, 'inside form'],
      [{ ...baseline, nearShortInput: true }, 'near short input'],
    ] as const;

    for (const [candidate, reason] of cases) {
      const result = scoreCaptchaCandidate(candidate);
      expect(result.score).toBeGreaterThan(baseResult.score);
      expect(result.reasons).toContain(reason);
    }
  });

  it('accepts a compact verification image supported by form context', () => {
    const result = scoreCaptchaCandidate({
      attrText: 'captcha verification challenge',
      nearbyText: 'Enter the verification code',
      width: 140,
      height: 48,
      inForm: true,
      nearShortInput: true,
    });

    expect(result.score).toBeGreaterThanOrEqual(AUTOMATIC_CANDIDATE_THRESHOLD);
    expect(result.score).toBeLessThanOrEqual(100);
    expect(result.reasons).toEqual(
      expect.arrayContaining(['captcha or verification attribute', 'compact captcha-like dimensions']),
    );
  });

  it('rejects large branding imagery despite descriptive text', () => {
    const result = scoreCaptchaCandidate({
      attrText: 'company logo',
      nearbyText: 'Welcome to the company',
      width: 1200,
      height: 600,
      inForm: false,
      nearShortInput: false,
    });

    expect(result.score).toBeLessThan(AUTOMATIC_CANDIDATE_THRESHOLD);
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.reasons).toEqual(
      expect.arrayContaining(['logo, avatar, or icon signal', 'large content-image dimensions']),
    );
  });
});
