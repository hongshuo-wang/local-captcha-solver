import { describe, expect, it } from 'vitest';

import { observeSliderOutcome } from '../../src/slider/challenge-discovery';

describe('slider challenge outcome', () => {
  it('recognizes the visible GeeTest score as a successful verification', async () => {
    document.body.innerHTML = '<div role="status" class="geetest_result" style="display:block;visibility:visible;opacity:1">0.8 s. You beat 99% of users</div>';
    const result = document.querySelector<HTMLElement>('[role="status"]')!;
    result.getBoundingClientRect = () => ({ x: 10, y: 10, left: 10, top: 10, right: 210, bottom: 40, width: 200, height: 30, toJSON: () => ({}) });

    await expect(observeSliderOutcome('before')).resolves.toBe('success');
  });
});
