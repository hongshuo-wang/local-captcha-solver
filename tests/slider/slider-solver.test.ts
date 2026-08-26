import { describe, expect, it, vi } from 'vitest';

import { createSliderSolver } from '../../src/slider/slider-solver';
import type { PixelImage } from '../../src/slider/gap-locator';

function weakMaskedScreenshot(): { image: PixelImage; pieceMask: { offsetX: number; offsetY: number; width: number; height: number; alphaWidth: number; alphaHeight: number; alpha: number[]; luminance: number[] } } {
  const image = screenshot();
  const width = 48;
  const height = 48;
  const targetX = 154;
  const targetY = 30;
  const alpha = new Array<number>(width * height).fill(0);
  const luminance = new Array<number>(width * height).fill(110);
  const opaque = (x: number, y: number) => x >= 2 && x < width - 2 && y >= 2 && y < height - 2 && !(x >= 17 && x < 31 && y < 11);
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) alpha[y * width + x] = opaque(x, y) ? 255 : 0;
  for (let y = 1; y < height - 1; y += 1) for (let x = 1; x < width - 1; x += 1) {
    if (!opaque(x, y) || (opaque(x - 1, y) && opaque(x + 1, y) && opaque(x, y - 1) && opaque(x, y + 1))) continue;
    const target = ((targetY + y) * image.width + targetX + x) * 4;
    image.data[target] = 8;
    image.data[target + 1] = 8;
    image.data[target + 2] = 8;
  }
  return { image, pieceMask: { offsetX: 0, offsetY: targetY, width, height, alphaWidth: width, alphaHeight: height, alpha, luminance } };
}

function screenshot(): PixelImage {
  const width = 260;
  const height = 170;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    const index = (y * width + x) * 4;
    const shade = 140 + Math.round(12 * Math.sin(x / 17));
    data[index] = shade;
    data[index + 1] = shade + 10;
    data[index + 2] = shade - 8;
    data[index + 3] = 255;
  }
  for (let offset = 0; offset < 38; offset += 1) for (const [x, y] of [[166 + offset, 34], [166 + offset, 71], [166, 34 + offset], [203, 34 + offset]]) {
    const index = (y * width + x) * 4;
    data[index] = 20; data[index + 1] = 20; data[index + 2] = 20;
  }
  return { width, height, data };
}

function blankScreenshot(): PixelImage {
  return { width: 260, height: 170, data: new Uint8ClampedArray(260 * 170 * 4) };
}

const challenge = {
  revision: 'challenge-1', provider: 'geetest-v4' as const,
  challenge: { x: 0, y: 0, width: 260, height: 160 },
  image: { x: 0, y: 0, width: 260, height: 110 },
  track: { x: 0, y: 120, width: 260, height: 40 },
  handle: { x: 0, y: 120, width: 38, height: 38 },
  viewport: { width: 260, height: 170, devicePixelRatio: 1 },
};

function harness(options: { granted?: boolean; enabled?: boolean; recentUserInput?: boolean; changed?: boolean; activatable?: boolean; activationWidths?: readonly number[]; image?: PixelImage; cleanImage?: PixelImage; referenceImage?: PixelImage; visibleImage?: PixelImage; pieceMask?: ReturnType<typeof weakMaskedScreenshot>['pieceMask']; feedbackPieceOffsets?: readonly number[]; userActiveAfterInputEvents?: number; outcomes?: readonly ('success' | 'failure' | 'pending' | 'absent' | 'uncertain')[] } = {}) {
  let discoveries = 0;
  let inputEvents = 0;
  let outcomeChecks = 0;
  const sendMessage = vi.fn(async (_tabId: number, message: unknown) => {
    const type = (message as { type?: string }).type;
    if (type === 'captcha:slider-user-active') return { active: options.userActiveAfterInputEvents !== undefined && inputEvents >= options.userActiveAfterInputEvents };
    if (type === 'captcha:slider-discover') {
      discoveries += 1;
      if (options.activatable && discoveries === 1) return { state: 'activatable', activator: { provider: 'geetest-v4', rect: { x: 80, y: 40, width: 260, height: 50 } }, recentUserInput: false, pageVisible: true, pageFocused: true };
      const activationWidthIndex = options.activatable ? discoveries - 2 : -1;
      const activationWidth = activationWidthIndex < 0 ? undefined : options.activationWidths?.[Math.min(activationWidthIndex, options.activationWidths.length - 1)];
      const feedbackIndex = discoveries - 3;
      const feedbackPieceOffset = feedbackIndex < 0 ? undefined : options.feedbackPieceOffsets?.[Math.min(feedbackIndex, options.feedbackPieceOffsets.length - 1)];
      return {
        state: 'ready',
        challenge: {
          ...challenge,
          ...(options.cleanImage === undefined ? {} : { backgroundDataUrl: 'data:image/png;base64,CLEAN' }),
          ...(options.referenceImage === undefined ? {} : { referenceBackgroundDataUrl: 'data:image/png;base64,REFERENCE' }),
          ...(options.pieceMask === undefined ? {} : { pieceMask: options.pieceMask }),
          revision: options.changed && discoveries > 1 ? 'challenge-2' : challenge.revision,
          ...(activationWidth === undefined ? {} : { image: { ...challenge.image, width: activationWidth }, track: { ...challenge.track, width: activationWidth } }),
          ...(options.feedbackPieceOffsets === undefined ? {} : { piece: { x: feedbackPieceOffset ?? 0, y: 34, width: 38, height: 38 } }),
        },
        recentUserInput: options.recentUserInput ?? false,
        pageVisible: true,
        pageFocused: true,
      };
    }
    if (type === 'captcha:slider-outcome') return { outcome: options.outcomes?.[Math.min(outcomeChecks++, options.outcomes.length - 1)] ?? 'success' };
    return undefined;
  });
  const attach = vi.fn(async () => undefined);
  const detach = vi.fn(async () => undefined);
  const sendCommand = vi.fn(async (_target: { tabId: number }, method: string, _params?: Record<string, unknown>) => {
    if (method === 'Input.dispatchMouseEvent') inputEvents += 1;
    return method === 'Page.captureScreenshot' ? { data: 'AA==' } : undefined;
  });
  const delay = vi.fn(async (_durationMs: number) => undefined);
  const solver = createSliderSolver({
    settings: { isSliderEnabled: vi.fn(async () => options.enabled ?? true) },
    permissions: { contains: vi.fn(async () => options.granted ?? true) },
    tabs: { sendMessage },
    debugger: { attach, detach, sendCommand },
    decodeImage: vi.fn(async (dataUrl) => dataUrl === 'data:image/png;base64,AA=='
      ? options.image ?? options.visibleImage ?? screenshot()
      : dataUrl === 'data:image/png;base64,REFERENCE'
        ? options.referenceImage ?? screenshot()
        : options.cleanImage ?? options.image ?? screenshot()),
    delay,
    random: () => .5,
  });
  return { solver, attach, detach, sendCommand, delay };
}

describe('slider solver', () => {
  it('executes a guarded drag and always detaches after success', async () => {
    const app = harness();
    const result = await app.solver.solve({ id: 7, url: 'https://demo.example.test/' }, 'automatic');
    expect(result).toMatchObject({
      state: 'success',
      confidence: expect.any(Number),
      challengeRevision: 'challenge-1',
      diagnostic: {
        provider: 'geetest-v4',
        gapX: expect.any(Number),
        gapY: expect.any(Number),
        imageWidth: 260,
        imageHeight: 110,
        trackWidth: 260,
        handleWidth: 38,
        scaleX: 1,
        scaleY: 1,
        startX: 19,
        requestedEndX: expect.any(Number),
        endX: expect.any(Number),
        releaseX: expect.any(Number),
      },
    });
    expect(result.diagnostic?.releaseX).toBe(result.diagnostic?.endX);
    expect(app.attach).toHaveBeenCalledOnce();
    expect(app.detach).toHaveBeenCalledOnce();
    expect(app.sendCommand.mock.calls.at(0)?.[1]).toBe('Page.captureScreenshot');
    expect(app.sendCommand.mock.calls.some((call) => call[1] === 'Input.dispatchMouseEvent')).toBe(true);
    expect(app.sendCommand.mock.calls.at(-1)?.[2]).toMatchObject({ type: 'mouseReleased', button: 'left', buttons: 0 });
  });

  it('treats a stably removed challenge as successful without provider-specific markup', async () => {
    const app = harness({ outcomes: ['absent', 'absent'] });
    await expect(app.solver.solve({ id: 7, url: 'https://demo.example.test/' }, 'automatic')).resolves.toMatchObject({ state: 'success', challengeRevision: 'challenge-1' });
    const checks = app.delay.mock.calls.filter(([duration]) => duration === 250 || duration === 500 || duration === 750);
    expect(checks).toEqual([[250], [500]]);
  });

  it('returns the rejected challenge identity and outcome observations', async () => {
    const app = harness({ outcomes: ['pending', 'failure'] });
    await expect(app.solver.solve({ id: 7, url: 'https://demo.example.test/' }, 'automatic')).resolves.toMatchObject({
      state: 'failed',
      reason: 'challenge-rejected',
      challengeRevision: 'challenge-1',
      diagnostic: { outcomeSequence: 'pending>failure' },
    });
  });

  it('does not inspect or drag an automatic challenge on a site that is not enabled', async () => {
    const app = harness({ enabled: false });
    await expect(app.solver.solve({ id: 7, url: 'https://demo.example.test/' }, 'automatic')).resolves.toEqual({ state: 'permission-denied', reason: 'site-not-enabled' });
    expect(app.attach).not.toHaveBeenCalled();
  });

  it('stops before screenshot and debugger input when the user is active', async () => {
    const app = harness({ recentUserInput: true });
    await expect(app.solver.solve({ id: 7, url: 'https://demo.example.test/' }, 'manual')).resolves.toMatchObject({ state: 'user-active', diagnostic: { attemptId: 'slider-1' } });
    expect(app.attach).not.toHaveBeenCalled();
  });

  it('stops when the challenge changes between localization and execution', async () => {
    const app = harness({ changed: true });
    await expect(app.solver.solve({ id: 7, url: 'https://demo.example.test/' }, 'manual')).resolves.toMatchObject({
      state: 'uncertain',
      reason: 'challenge-changed',
      diagnostic: { provider: 'geetest-v4', gapX: expect.any(Number), imageWidth: 260, trackWidth: 260 },
    });
    expect(app.attach).toHaveBeenCalledOnce();
    expect(app.detach).toHaveBeenCalledOnce();
    expect(app.sendCommand.mock.calls.some((call) => call[1] === 'Input.dispatchMouseEvent')).toBe(false);
  });

  it('rejects a stale automatic request before attaching the debugger', async () => {
    const app = harness();
    await expect(app.solver.solve({ id: 7, url: 'https://demo.example.test/' }, 'automatic', 'older-challenge')).resolves.toMatchObject({
      state: 'uncertain',
      reason: 'challenge-changed',
      diagnostic: { attemptId: 'slider-1' },
    });
    expect(app.attach).not.toHaveBeenCalled();
  });

  it('releases the pointer and stops when the user interrupts an automatic drag', async () => {
    const app = harness({ userActiveAfterInputEvents: 2 });
    await expect(app.solver.solve({ id: 7, url: 'https://demo.example.test/' }, 'automatic')).resolves.toMatchObject({ state: 'uncertain', reason: 'user-interrupted' });
    const releases = app.sendCommand.mock.calls.filter((call) => call[1] === 'Input.dispatchMouseEvent' && (call[2] as { type?: string })?.type === 'mouseReleased');
    expect(releases).toHaveLength(1);
    expect(app.detach).toHaveBeenCalledOnce();
  });

  it('releases the pointer when an automatic run is cancelled while dragging', async () => {
    const app = harness();
    let inputEvents = 0;
    app.sendCommand.mockImplementation(async (_target, method) => {
      if (method === 'Page.captureScreenshot') return { data: 'AA==' };
      if (method === 'Input.dispatchMouseEvent' && ++inputEvents === 3) app.solver.cancel?.(7);
      return undefined;
    });

    await expect(app.solver.solve({ id: 7, url: 'https://demo.example.test/' }, 'automatic')).resolves.toMatchObject({
      state: 'permission-denied',
      reason: 'run-cancelled',
    });
    const releases = app.sendCommand.mock.calls.filter((call) => call[1] === 'Input.dispatchMouseEvent' && (call[2] as { type?: string })?.type === 'mouseReleased');
    expect(releases).toHaveLength(1);
    expect(app.detach).toHaveBeenCalledOnce();
  });

  it('returns a permission result without attaching when debugger access is absent', async () => {
    const app = harness({ granted: false });
    await expect(app.solver.solve({ id: 7, url: 'https://demo.example.test/' }, 'manual')).resolves.toEqual({ state: 'permission-denied', reason: 'debugger-not-granted' });
    expect(app.attach).not.toHaveBeenCalled();
  });

  it('keeps provider and image geometry when localization confidence is too low', async () => {
    const app = harness({ image: blankScreenshot() });
    await expect(app.solver.solve({ id: 7, url: 'https://demo.example.test/' }, 'manual')).resolves.toMatchObject({
      state: 'low-confidence',
      confidence: 0,
      diagnostic: {
        provider: 'geetest-v4',
        imageWidth: 260,
        imageHeight: 110,
        trackWidth: 260,
        handleWidth: 38,
        scaleX: 1,
        scaleY: 1,
      },
    });
    expect(app.detach).toHaveBeenCalledOnce();
  });

  it('abstains from dragging when masked localization only has weak evidence', async () => {
    const fixture = weakMaskedScreenshot();
    const app = harness(fixture);

    const result = await app.solver.solve({ id: 7, url: 'https://demo.example.test/' }, 'automatic');
    expect(result).toMatchObject({
      state: 'low-confidence',
      confidence: expect.any(Number),
      diagnostic: {
        imageSource: 'viewport',
        localizationMethod: 'shape',
        confidenceThreshold: .69,
      },
    });
    expect(result.confidence).toBeGreaterThan(.58);
    expect(result.confidence).toBeLessThan(.69);
    expect(app.sendCommand.mock.calls.some((call) => call[1] === 'Input.dispatchMouseEvent')).toBe(false);
  });

  it('uses the visible gap when clean-background texture is inconclusive', async () => {
    const app = harness({ image: screenshot(), cleanImage: blankScreenshot() });

    await expect(app.solver.solve({ id: 7, url: 'https://demo.example.test/' }, 'manual')).resolves.toMatchObject({
      state: 'success',
      confidence: expect.any(Number),
      diagnostic: { gapX: expect.any(Number), gapY: expect.any(Number) },
    });
  });

  it('selects the stronger view when both image sources are usable', async () => {
    const app = harness({ image: screenshot(), cleanImage: blankScreenshot(), visibleImage: screenshot() });

    await expect(app.solver.solve({ id: 7, url: 'https://demo.example.test/' }, 'manual')).resolves.toMatchObject({
      state: 'success',
      confidence: expect.any(Number),
    });
  });

  it('measures and corrects the remaining piece error before releasing', async () => {
    const app = harness({ feedbackPieceOffsets: [165, 166] });
    const result = await app.solver.solve({ id: 7, url: 'https://demo.example.test/' }, 'automatic');

    expect(result).toMatchObject({
      state: 'success',
      diagnostic: {
        desiredPieceOffsetX: 166,
        actualPieceOffsetX: 166,
        pieceErrorX: 0,
        correctionX: 1,
        endX: 185,
        releaseX: 186,
        plannedDragX: 166,
        finalDragX: 167,
        outcomeSequence: 'success',
      },
    });
    const heldMoves = app.sendCommand.mock.calls.filter((call) => call[1] === 'Input.dispatchMouseEvent' && (call[2] as { type?: string; buttons?: number })?.type === 'mouseMoved' && (call[2] as { buttons?: number })?.buttons === 1);
    expect(heldMoves.at(-1)?.[2]).toMatchObject({ x: 186, buttons: 1 });
  });

  it('opens one collapsed challenge before locating and dragging it manually', async () => {
    const app = harness({ activatable: true });
    await expect(app.solver.solve({ id: 7, url: 'https://demo.example.test/' }, 'manual')).resolves.toMatchObject({ state: 'success' });
    expect(app.attach).toHaveBeenCalledTimes(2);
    expect(app.detach).toHaveBeenCalledTimes(2);
    const clickRelease = app.sendCommand.mock.calls.find((call) => call[1] === 'Input.dispatchMouseEvent' && (call[2] as { type?: string })?.type === 'mouseReleased');
    expect(clickRelease?.[2]).toMatchObject({ x: 210, y: 65, clickCount: 1 });
  });

  it('opens one collapsed challenge automatically after the site is explicitly enabled', async () => {
    const app = harness({ activatable: true });
    await expect(app.solver.solve({ id: 7, url: 'https://demo.example.test/' }, 'automatic')).resolves.toMatchObject({ state: 'success' });
    expect(app.attach).toHaveBeenCalledTimes(2);
    expect(app.detach).toHaveBeenCalledTimes(2);
  });

  it('waits for an opened challenge to stop resizing before taking a screenshot', async () => {
    const app = harness({ activatable: true, activationWidths: [238, 252, 260, 260] });
    await expect(app.solver.solve({ id: 7, url: 'https://demo.example.test/' }, 'automatic')).resolves.toMatchObject({ state: 'success' });
    expect(app.delay.mock.calls.slice(0, 4)).toEqual([[250], [350], [500], [700]]);
  });

  it('does not inspect or open a collapsed challenge automatically on a disabled site', async () => {
    const app = harness({ activatable: true, enabled: false });
    await expect(app.solver.solve({ id: 7, url: 'https://demo.example.test/' }, 'automatic')).resolves.toEqual({ state: 'permission-denied', reason: 'site-not-enabled' });
    expect(app.attach).not.toHaveBeenCalled();
  });
});
