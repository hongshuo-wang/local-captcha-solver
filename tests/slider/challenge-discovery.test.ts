import { describe, expect, it } from 'vitest';

import { discoverSliderChallenge, observeSliderOutcome } from '../../src/slider/challenge-discovery';

describe('slider challenge outcome', () => {
  it('reports a removed challenge as absent so the solver can confirm it across observations', async () => {
    document.body.innerHTML = '';
    await expect(observeSliderOutcome('before')).resolves.toBe('absent');
  });

  it('recognizes the visible GeeTest score as a successful verification', async () => {
    document.body.innerHTML = '<div role="status" class="geetest_result" style="display:block;visibility:visible;opacity:1">0.8 s. You beat 99% of users</div>';
    const result = document.querySelector<HTMLElement>('[role="status"]')!;
    result.getBoundingClientRect = () => ({ x: 10, y: 10, left: 10, top: 10, right: 210, bottom: 40, width: 200, height: 30, toJSON: () => ({}) });

    await expect(observeSliderOutcome('before')).resolves.toBe('success');
  });

  it('keeps challenge identity stable while the handle and piece move', async () => {
    document.body.innerHTML = '<div data-slider-captcha style="display:block;visibility:visible;opacity:1"><img data-slider-image style="display:block;visibility:visible;opacity:1" src="data:image/png;base64,AQ=="><div data-slider-piece style="display:block;visibility:visible;opacity:1"></div><div data-slider-track style="display:block;visibility:visible;opacity:1"><button data-slider-handle style="display:block;visibility:visible;opacity:1"></button></div></div>';
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

    (image as HTMLImageElement).src = 'data:image/png;base64,Ag==';
    const refreshed = await discoverSliderChallenge();
    if (refreshed.state !== 'ready') throw new Error(`Expected ready discovery, received ${refreshed.state}`);
    expect(refreshed.challenge.revision).not.toBe(before.challenge.revision);
  });

  it('discovers a provider-neutral puzzle from semantics and geometry', async () => {
    document.body.innerHTML = '<div class="verification-widget"><div class="puzzle-background"></div><div class="puzzle-piece"></div><div class="drag-bar"><button class="drag-thumb"></button></div></div>';
    const root = document.querySelector('.verification-widget')!;
    const image = document.querySelector('.puzzle-background')!;
    const piece = document.querySelector('.puzzle-piece')!;
    const track = document.querySelector('.drag-bar')!;
    const handle = document.querySelector('.drag-thumb')!;
    const rects = new Map<Element, { x: number; y: number; width: number; height: number }>([
      [root, { x: 30, y: 20, width: 320, height: 220 }],
      [image, { x: 30, y: 20, width: 320, height: 160 }],
      [piece, { x: 42, y: 76, width: 44, height: 44 }],
      [track, { x: 30, y: 194, width: 320, height: 40 }],
      [handle, { x: 30, y: 192, width: 44, height: 44 }],
    ]);
    for (const element of rects.keys()) element.getBoundingClientRect = () => {
      const rect = rects.get(element)!;
      return { ...rect, left: rect.x, top: rect.y, right: rect.x + rect.width, bottom: rect.y + rect.height, toJSON: () => ({}) };
    };

    const discovery = await discoverSliderChallenge();

    expect(discovery).toMatchObject({
      state: 'ready',
      challenge: {
        provider: 'generic',
        image: { x: 30, y: 20, width: 320, height: 160 },
        piece: { x: 42, y: 76, width: 44, height: 44 },
        track: { x: 30, y: 194, width: 320, height: 40 },
        handle: { x: 30, y: 192, width: 44, height: 44 },
      },
    });
  });

  it('extracts the piece mask from a full-size transparent raster layer', async () => {
    document.body.innerHTML = '<div class="verification-widget"><canvas class="puzzle-background"></canvas><canvas class="puzzle-slice"></canvas><div class="drag-bar"><button class="drag-thumb"></button></div></div>';
    const root = document.querySelector('.verification-widget')!;
    const image = document.querySelector<HTMLCanvasElement>('.puzzle-background')!;
    const slice = document.querySelector<HTMLCanvasElement>('.puzzle-slice')!;
    const track = document.querySelector('.drag-bar')!;
    const handle = document.querySelector('.drag-thumb')!;
    image.width = 260;
    image.height = 110;
    slice.width = 260;
    slice.height = 110;
    const pixels = new Uint8ClampedArray(slice.width * slice.height * 4);
    for (let y = 30; y < 70; y += 1) for (let x = 10; x < 50; x += 1) {
      const index = (y * slice.width + x) * 4;
      pixels[index] = 120;
      pixels[index + 1] = 150;
      pixels[index + 2] = 180;
      pixels[index + 3] = 255;
    }
    Object.defineProperty(slice, 'getContext', { value: () => ({ getImageData: () => ({ width: slice.width, height: slice.height, data: pixels }) }) });
    const rects = new Map<Element, { x: number; y: number; width: number; height: number }>([
      [root, { x: 30, y: 20, width: 260, height: 160 }],
      [image, { x: 30, y: 20, width: 260, height: 110 }],
      [slice, { x: 30, y: 20, width: 260, height: 110 }],
      [track, { x: 30, y: 140, width: 260, height: 40 }],
      [handle, { x: 30, y: 138, width: 44, height: 44 }],
    ]);
    for (const element of rects.keys()) element.getBoundingClientRect = () => {
      const rect = rects.get(element)!;
      return { ...rect, left: rect.x, top: rect.y, right: rect.x + rect.width, bottom: rect.y + rect.height, toJSON: () => ({}) };
    };

    const discovery = await discoverSliderChallenge();

    expect(discovery).toMatchObject({
      state: 'ready',
      challenge: {
        piece: { x: 40, y: 50, width: 40, height: 40 },
        pieceMask: { offsetX: 10, offsetY: 30, width: 40, height: 40, alphaWidth: 40, alphaHeight: 40 },
      },
    });
  });

  it('discovers an SDK structure whose handle and track use different vocabulary', async () => {
    document.body.innerHTML = '<div class="yidun_panel"><div class="yidun_bgimg"><img class="yidun_bg-img"></div><div class="yidun_jigsaw"></div><div class="yidun_control"><div class="yidun_slide_indicator"></div><div class="yidun_slider"><span class="yidun_slider__icon"></span></div></div></div>';
    const root = document.querySelector('.yidun_panel')!;
    const imageContainer = document.querySelector('.yidun_bgimg')!;
    const image = document.querySelector('.yidun_bg-img')!;
    const piece = document.querySelector('.yidun_jigsaw')!;
    const track = document.querySelector('.yidun_control')!;
    const handle = document.querySelector('.yidun_slider')!;
    const icon = document.querySelector('.yidun_slider__icon')!;
    const rects = new Map<Element, { x: number; y: number; width: number; height: number }>([
      [root, { x: 50, y: 202, width: 320, height: 44 }],
      [imageContainer, { x: 50, y: 30, width: 320, height: 160 }],
      [image, { x: 50, y: 30, width: 320, height: 160 }],
      [piece, { x: 58, y: 82, width: 46, height: 46 }],
      [track, { x: 50, y: 202, width: 320, height: 44 }],
      [handle, { x: 50, y: 202, width: 44, height: 44 }],
      [icon, { x: 62, y: 214, width: 20, height: 20 }],
    ]);
    for (const element of rects.keys()) element.getBoundingClientRect = () => {
      const rect = rects.get(element)!;
      return { ...rect, left: rect.x, top: rect.y, right: rect.x + rect.width, bottom: rect.y + rect.height, toJSON: () => ({}) };
    };

    const discovery = await discoverSliderChallenge();

    expect(discovery).toMatchObject({
      state: 'ready',
      challenge: {
        provider: 'generic',
        challenge: { x: 50, y: 30, width: 320, height: 216 },
        image: { x: 50, y: 30, width: 320, height: 160 },
        piece: { x: 58, y: 82, width: 46, height: 46 },
        track: { x: 50, y: 202, width: 320, height: 44 },
        handle: { x: 50, y: 202, width: 44, height: 44 },
      },
    });
  });

  it('uses the handle to activate a collapsed puzzle before its image is visible', async () => {
    document.body.innerHTML = '<div class="verification-widget"><div class="drag-control">Drag to verify<div class="drag-thumb"></div></div></div>';
    const root = document.querySelector('.verification-widget')!;
    const track = document.querySelector('.drag-control')!;
    const handle = document.querySelector('.drag-thumb')!;
    const rects = new Map<Element, { x: number; y: number; width: number; height: number }>([
      [root, { x: 40, y: 180, width: 320, height: 44 }],
      [track, { x: 40, y: 180, width: 320, height: 44 }],
      [handle, { x: 40, y: 180, width: 44, height: 44 }],
    ]);
    for (const element of rects.keys()) element.getBoundingClientRect = () => {
      const rect = rects.get(element)!;
      return { ...rect, left: rect.x, top: rect.y, right: rect.x + rect.width, bottom: rect.y + rect.height, toJSON: () => ({}) };
    };

    await expect(discoverSliderChallenge()).resolves.toEqual({
      state: 'activatable',
      activator: { provider: 'generic', rect: { x: 40, y: 180, width: 44, height: 44 } },
    });
  });

  it('does not confuse a slider progress indicator with the overlapping handle', async () => {
    document.body.innerHTML = '<div class="verification-widget"><div class="slide-control">Slide to verify<div class="slide-indicator"></div><div class="slider"></div></div></div>';
    const root = document.querySelector('.verification-widget')!;
    const track = document.querySelector('.slide-control')!;
    const indicator = document.querySelector('.slide-indicator')!;
    const handle = document.querySelector('.slider')!;
    const rects = new Map<Element, { x: number; y: number; width: number; height: number }>([
      [root, { x: 40, y: 180, width: 320, height: 44 }],
      [track, { x: 40, y: 180, width: 320, height: 44 }],
      [indicator, { x: 40, y: 180, width: 40, height: 40 }],
      [handle, { x: 41, y: 181, width: 40, height: 38 }],
    ]);
    for (const element of rects.keys()) element.getBoundingClientRect = () => {
      const rect = rects.get(element)!;
      return { ...rect, left: rect.x, top: rect.y, right: rect.x + rect.width, bottom: rect.y + rect.height, toJSON: () => ({}) };
    };

    await expect(discoverSliderChallenge()).resolves.toEqual({
      state: 'activatable',
      activator: { provider: 'generic', rect: { x: 41, y: 181, width: 40, height: 38 } },
    });
  });

  it('does not treat a navigation button containing only the CAPTCHA noun as an activator', async () => {
    document.body.innerHTML = '<nav><button class="captcha-menu-button">Captcha</button></nav>';
    const button = document.querySelector('button')!;
    button.getBoundingClientRect = () => ({ x: 20, y: 10, left: 20, top: 10, right: 170, bottom: 50, width: 150, height: 40, toJSON: () => ({}) });

    await expect(discoverSliderChallenge()).resolves.toEqual({ state: 'not-found' });
  });

  it('does not borrow page-level slider text for an unrelated dropdown handle', async () => {
    document.body.innerHTML = '<main>Slider verification demo<nav><a class="drop-handle">Products</a></nav></main>';
    const main = document.querySelector('main')!;
    const nav = document.querySelector('nav')!;
    const handle = document.querySelector('.drop-handle')!;
    const rects = new Map<Element, { x: number; y: number; width: number; height: number }>([
      [main, { x: 0, y: 0, width: 1200, height: 600 }],
      [nav, { x: 0, y: 0, width: 1200, height: 64 }],
      [handle, { x: 100, y: 0, width: 76, height: 64 }],
    ]);
    for (const element of rects.keys()) element.getBoundingClientRect = () => {
      const rect = rects.get(element)!;
      return { ...rect, left: rect.x, top: rect.y, right: rect.x + rect.width, bottom: rect.y + rect.height, toJSON: () => ({}) };
    };

    await expect(discoverSliderChallenge()).resolves.toEqual({ state: 'not-found' });
  });

  it('treats nested activator layers as one interaction target', async () => {
    document.body.innerHTML = '<div class="verification-button">Click to verify<div class="verification-radar"><div class="verification-radar-tip">Click to verify</div></div><div class="verification-success-radar-tip"></div></div>';
    const outer = document.querySelector('.verification-button')!;
    const radar = document.querySelector('.verification-radar')!;
    const tip = document.querySelector('.verification-radar-tip')!;
    const success = document.querySelector('.verification-success-radar-tip')!;
    const rects = new Map<Element, { x: number; y: number; width: number; height: number }>([
      [outer, { x: 40, y: 60, width: 300, height: 44 }],
      [radar, { x: 40, y: 60, width: 300, height: 44 }],
      [tip, { x: 41, y: 61, width: 298, height: 42 }],
      [success, { x: 180, y: 61, width: 159, height: 42 }],
    ]);
    for (const element of rects.keys()) element.getBoundingClientRect = () => {
      const rect = rects.get(element)!;
      return { ...rect, left: rect.x, top: rect.y, right: rect.x + rect.width, bottom: rect.y + rect.height, toJSON: () => ({}) };
    };

    await expect(discoverSliderChallenge()).resolves.toEqual({
      state: 'activatable',
      activator: { provider: 'generic', rect: { x: 40, y: 60, width: 300, height: 44 } },
    });
  });

  it('does not confuse an ordinary toolbar thumbnail with a slider handle', async () => {
    document.body.innerHTML = '<div class="gallery"><img><div class="toolbar"><button class="thumbnail"></button></div></div>';
    const root = document.querySelector('.gallery')!;
    const image = document.querySelector('img')!;
    const toolbar = document.querySelector('.toolbar')!;
    const thumbnail = document.querySelector('.thumbnail')!;
    const rects = new Map<Element, { x: number; y: number; width: number; height: number }>([
      [root, { x: 20, y: 20, width: 320, height: 220 }],
      [image, { x: 20, y: 20, width: 320, height: 160 }],
      [toolbar, { x: 20, y: 190, width: 320, height: 44 }],
      [thumbnail, { x: 20, y: 190, width: 44, height: 44 }],
    ]);
    for (const element of rects.keys()) element.getBoundingClientRect = () => {
      const rect = rects.get(element)!;
      return { ...rect, left: rect.x, top: rect.y, right: rect.x + rect.width, bottom: rect.y + rect.height, toJSON: () => ({}) };
    };

    await expect(discoverSliderChallenge()).resolves.toEqual({ state: 'not-found' });
  });
});
