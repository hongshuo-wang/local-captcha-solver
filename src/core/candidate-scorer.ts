import type { CaptchaCandidateScorer, ScoreResult } from './types';

export const AUTOMATIC_CANDIDATE_THRESHOLD = 70;

export interface CandidateSnapshot {
  attrText: string;
  nearbyText: string;
  width: number;
  height: number;
  inForm: boolean;
  nearShortInput: boolean;
}

const CAPTCHA_TERMS = /(?:\b(?:captcha|verification|verify|security\s*code|challenge)\b|验证码|校验码|图形码)/i;
const CODE_IMAGE_ATTRIBUTE = /(?:^|[\s_-])code[\s_-]*(?:img|image)(?:$|[\s_-])/i;
const LEGACY_CAPTCHA_ATTRIBUTE = /(?:^|[\s_-])(?:(?:verify|verification|validate|validation|vaildata|check|auth|security|rand)[\s_-]*code|yzm)(?=$|[\s_-]|img|image)/i;
const NEGATIVE_TERMS = /\b(?:logo|avatar|icon|profile|banner|hero)\b/i;

export function scoreCaptchaCandidate(candidate: CandidateSnapshot): ScoreResult {
  const reasons: string[] = [];
  let score = 0;

  if (CAPTCHA_TERMS.test(candidate.attrText) || CODE_IMAGE_ATTRIBUTE.test(candidate.attrText) || LEGACY_CAPTCHA_ATTRIBUTE.test(candidate.attrText)) {
    score += 35;
    reasons.push('captcha or verification attribute');
  }
  if (CAPTCHA_TERMS.test(candidate.nearbyText)) {
    score += 20;
    reasons.push('captcha or verification nearby text');
  }

  const aspectRatio = candidate.height > 0 ? candidate.width / candidate.height : Number.POSITIVE_INFINITY;
  if (candidate.width >= 50 && candidate.width <= 360 && candidate.height >= 20 && candidate.height <= 140 && aspectRatio >= 1.2 && aspectRatio <= 8) {
    score += 20;
    reasons.push('compact captcha-like dimensions');
  }
  if (candidate.inForm) {
    score += 10;
    reasons.push('inside form');
  }
  if (candidate.nearShortInput) {
    score += 10;
    reasons.push('near short input');
  }

  if (NEGATIVE_TERMS.test(`${candidate.attrText} ${candidate.nearbyText}`)) {
    score -= 45;
    reasons.push('logo, avatar, or icon signal');
  }
  if (candidate.width > 600 || candidate.height > 300 || candidate.width * candidate.height > 150_000) {
    score -= 40;
    reasons.push('large content-image dimensions');
  }

  return { score: Math.max(0, Math.min(100, score)), reasons };
}

export const captchaCandidateScorer: CaptchaCandidateScorer<CandidateSnapshot> = {
  score: scoreCaptchaCandidate,
};
