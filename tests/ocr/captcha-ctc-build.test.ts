import { describe, expect, it } from 'vitest';

import {
  CAPTCHA_CTC_CANDIDATE,
  captchaCtcOutputDirectory,
} from '../../scripts/build-captcha-ctc';

describe('CAPTCHA CTC candidate build', () => {
  it('uses isolated Chrome and Edge output directories', () => {
    expect(captchaCtcOutputDirectory('/project', 'chrome')).toBe('/project/.output/chrome-mv3-captcha-ctc');
    expect(captchaCtcOutputDirectory('/project', 'edge')).toBe('/project/.output/edge-mv3-captcha-ctc');
  });

  it('pins the selected model bytes and SHA-256', () => {
    expect(CAPTCHA_CTC_CANDIDATE).toMatchObject({
      id: 'paddle-ctc-v4-decoupled-320k',
      modelBytes: 2_242_324,
      modelSha256: 'bce3e791636f369dd8bbac9b4eee2a0d9515f001b89b422f6d250c33ee6bbc28',
    });
  });
});
