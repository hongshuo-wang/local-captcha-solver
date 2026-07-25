import type { FieldMatch } from './types';

export const UNIQUE_FIELD_THRESHOLD = 60;
export const UNIQUE_FIELD_MARGIN = 15;

export interface FieldSnapshot {
  id: string;
  type: string;
  value: string;
  visible: boolean;
  disabled: boolean;
  readOnly: boolean;
  distance: number;
  sameForm: boolean;
  labelText: string;
}

type RankedField = { field: FieldSnapshot; score: number; reasons: readonly string[] };

const UNSAFE_TYPES = new Set(['hidden', 'password', 'file', 'checkbox', 'radio', 'button', 'submit', 'reset', 'image']);
const TEXT_LIKE_TYPES = new Set(['', 'text', 'search', 'email', 'tel', 'url', 'number']);
const CAPTCHA_LABEL_TERMS = /\b(?:captcha|verification|verify|security|code|answer|challenge)\b/i;

function scoreField(field: FieldSnapshot): RankedField | undefined {
  const type = field.type.toLowerCase();
  if (!field.visible || field.disabled || field.readOnly || UNSAFE_TYPES.has(type) || !TEXT_LIKE_TYPES.has(type) || field.value !== '') {
    return undefined;
  }

  const reasons = ['empty editable text-like field'];
  let score = 25;
  if (field.sameForm) {
    score += 20;
    reasons.push('same form as captcha');
  }
  if (CAPTCHA_LABEL_TERMS.test(field.labelText)) {
    score += 25;
    reasons.push('captcha-relevant label');
  }
  if (field.distance <= 50) {
    score += 25;
    reasons.push('visually adjacent to captcha');
  } else if (field.distance <= 200) {
    score += 15;
    reasons.push('near captcha');
  } else if (field.distance <= 500) {
    score += 5;
    reasons.push('within captcha area');
  }

  return { field, score: Math.min(100, score), reasons };
}

export function matchCaptchaField(_image: unknown, fields: readonly FieldSnapshot[]): FieldMatch<FieldSnapshot> {
  const rankedFields = fields
    .map(scoreField)
    .filter((candidate): candidate is RankedField => candidate !== undefined)
    .sort((left, right) => right.score - left.score || left.field.distance - right.field.distance || left.field.id.localeCompare(right.field.id));

  const winner = rankedFields[0];
  if (!winner || winner.score <= UNIQUE_FIELD_THRESHOLD) return { state: 'none', candidates: [] };

  const runnerUp = rankedFields[1];
  if (runnerUp && winner.score - runnerUp.score < UNIQUE_FIELD_MARGIN) {
    return { state: 'ambiguous', candidates: rankedFields };
  }

  return {
    state: 'unique',
    winner: winner.field,
    candidates: rankedFields.filter((candidate) => candidate.score > UNIQUE_FIELD_THRESHOLD),
  };
}
