import { describe, expect, it } from 'vitest';

import {
  AUTOMATIC_CANDIDATE_THRESHOLD,
  scoreCaptchaCandidate,
} from '../../src/core/candidate-scorer';

describe('scoreCaptchaCandidate', () => {
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
