import { describe, expect, it, vi } from 'vitest';

import { createSliderSolver } from '../../src/slider/slider-solver';
import type { PixelImage } from '../../src/slider/gap-locator';

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

function harness(options: { granted?: boolean; enabled?: boolean; recentUserInput?: boolean; changed?: boolean; activatable?: boolean; image?: PixelImage } = {}) {
  let discoveries = 0;
  const sendMessage = vi.fn(async (_tabId: number, message: unknown) => {
    const type = (message as { type?: string }).type;
    if (type === 'captcha:slider-discover') {
      discoveries += 1;
      if (options.activatable && discoveries === 1) return { state: 'activatable', activator: { provider: 'geetest-v4', rect: { x: 80, y: 40, width: 260, height: 50 } }, recentUserInput: false, pageVisible: true, pageFocused: true };
      return { state: 'ready', challenge: { ...challenge, revision: options.changed && discoveries > 1 ? 'challenge-2' : challenge.revision }, recentUserInput: options.recentUserInput ?? false, pageVisible: true, pageFocused: true };
    }
    if (type === 'captcha:slider-outcome') return { outcome: 'success' };
    return undefined;
  });
  const attach = vi.fn(async () => undefined);
  const detach = vi.fn(async () => undefined);
  const sendCommand = vi.fn(async (_target: { tabId: number }, method: string, _params?: Record<string, unknown>) => method === 'Page.captureScreenshot' ? { data: 'AA==' } : undefined);
  const solver = createSliderSolver({
    settings: { isSliderEnabled: vi.fn(async () => options.enabled ?? true) },
    permissions: { contains: vi.fn(async () => options.granted ?? true) },
    tabs: { sendMessage },
    debugger: { attach, detach, sendCommand },
    decodeImage: vi.fn(async () => options.image ?? screenshot()),
    delay: vi.fn(async () => undefined),
    random: () => .5,
  });
  return { solver, attach, detach, sendCommand };
}

describe('slider solver', () => {
  it('executes a guarded drag and always detaches after success', async () => {
    const app = harness();
    const result = await app.solver.solve({ id: 7, url: 'https://demo.example.test/' }, 'automatic');
    expect(result).toMatchObject({
      state: 'success',
      confidence: expect.any(Number),
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

  it('does not inspect or drag an automatic challenge on a site that is not enabled', async () => {
    const app = harness({ enabled: false });
    await expect(app.solver.solve({ id: 7, url: 'https://demo.example.test/' }, 'automatic')).resolves.toEqual({ state: 'permission-denied', reason: 'site-not-enabled' });
    expect(app.attach).not.toHaveBeenCalled();
  });

  it('stops before screenshot and debugger input when the user is active', async () => {
    const app = harness({ recentUserInput: true });
    await expect(app.solver.solve({ id: 7, url: 'https://demo.example.test/' }, 'manual')).resolves.toEqual({ state: 'user-active' });
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

  it('does not inspect or open a collapsed challenge automatically on a disabled site', async () => {
    const app = harness({ activatable: true, enabled: false });
    await expect(app.solver.solve({ id: 7, url: 'https://demo.example.test/' }, 'automatic')).resolves.toEqual({ state: 'permission-denied', reason: 'site-not-enabled' });
    expect(app.attach).not.toHaveBeenCalled();
  });
});
