import { describe, expect, it } from 'vitest';
import { canAutoFill } from '../../src/core/confidence-policy';

describe('confidence policy', () => {
  it.each([
    ['digits', 0.899, false], ['digits', 0.9, true],
    ['letters', 0.949, false], ['letters', 0.95, true],
    ['alphanumeric', 0.95, true], ['arithmetic', 0.95, true],
  ] as const)('uses inclusive %s threshold at %s', (mode, confidence, expected) => {
    expect(canAutoFill({ kind: 'plain', displayText: '123', fillValue: '123', confidence, mode })).toBe(expected);
  });

  it('never permits structurally invalid OCR output', () => {
    expect(canAutoFill({ kind: 'invalid', reason: 'unsupported' })).toBe(false);
  });
});
