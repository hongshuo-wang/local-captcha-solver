import { describe, expect, it } from 'vitest';

import { discoverSliderChallenge, observeSliderOutcome } from '../../src/slider/challenge-discovery';

describe('slider challenge outcome', () => {
  it('recognizes the visible GeeTest score as a successful verification', async () => {
    document.body.innerHTML = '<div role="status" class="geetest_result" style="display:block;visibility:visible;opacity:1">0.8 s. You beat 99% of users</div>';
    const result = document.querySelector<HTMLElement>('[role="status"]')!;
    result.getBoundingClientRect = () => ({ x: 10, y: 10, left: 10, top: 10, right: 210, bottom: 40, width: 200, height: 30, toJSON: () => ({}) });

    await expect(observeSliderOutcome('before')).resolves.toBe('success');
  });

  it('keeps challenge identity stable while the handle and piece move', async () => {
    document.body.innerHTML = '<div data-slider-captcha style="display:block;visibility:visible;opacity:1"><img data-slider-image style="display:block;visibility:visible;opacity:1" src="https://captcha.example.test/image-a.png"><div data-slider-piece style="display:block;visibility:visible;opacity:1"></div><div data-slider-track style="display:block;visibility:visible;opacity:1"><button data-slider-handle style="display:block;visibility:visible;opacity:1"></button></div></div>';
    const root = document.querySelector('[data-slider-captcha]')!;
    const image = root.querySelector('[data-slider-image]')!;
    const piece = root.querySelector('[data-slider-piece]')!;
    const track = root.querySelector('[data-slider-track]')!;
    const handle = root.querySelector('[data-slider-handle]')!;
    const rects = new Map<Element, { x: number; y: number; width: number; height: number }>([
      [root, { x: 0, y: 0, width: 260, height: 160 }],
      [image, { x: 0, y: 0, width: 260, height: 110 }],
      [piece, { x: 8, y: 42, width: 38, height: 38 }],
      [track, { x: 0, y: 120, width: 260, height: 40 }],
      [handle, { x: 0, y: 120, width: 38, height: 38 }],
    ]);
    for (const element of rects.keys()) element.getBoundingClientRect = () => {
      const rect = rects.get(element)!;
      return { ...rect, left: rect.x, top: rect.y, right: rect.x + rect.width, bottom: rect.y + rect.height, toJSON: () => ({}) };
    };

    const before = await discoverSliderChallenge();
    if (before.state !== 'ready') throw new Error(`Expected ready discovery, received ${before.state}`);
    rects.set(handle, { x: 182, y: 120, width: 38, height: 38 });
    rects.set(piece, { x: 190, y: 42, width: 38, height: 38 });
    const after = await discoverSliderChallenge();

    if (after.state !== 'ready') throw new Error(`Expected ready discovery, received ${after.state}`);
    expect(after.challenge.revision).toBe(before.challenge.revision);
    await expect(observeSliderOutcome(before.challenge.revision, document)).resolves.toBe('pending');

    (image as HTMLImageElement).src = 'https://captcha.example.test/image-b.png';
    const refreshed = await discoverSliderChallenge();
    if (refreshed.state !== 'ready') throw new Error(`Expected ready discovery, received ${refreshed.state}`);
    expect(refreshed.challenge.revision).not.toBe(before.challenge.revision);
  });
});
