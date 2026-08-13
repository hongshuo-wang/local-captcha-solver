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

const challenge = {
  revision: 'challenge-1', provider: 'geetest-v4' as const,
  challenge: { x: 0, y: 0, width: 260, height: 160 },
  image: { x: 0, y: 0, width: 260, height: 110 },
  track: { x: 0, y: 120, width: 260, height: 40 },
  handle: { x: 0, y: 120, width: 38, height: 38 },
  viewport: { width: 260, height: 170, devicePixelRatio: 1 },
};

function harness(options: { granted?: boolean; enabled?: boolean; recentUserInput?: boolean; changed?: boolean } = {}) {
  let discoveries = 0;
  const sendMessage = vi.fn(async (_tabId: number, message: unknown) => {
    const type = (message as { type?: string }).type;
    if (type === 'captcha:slider-discover') {
      discoveries += 1;
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
    decodeImage: vi.fn(async () => screenshot()),
    delay: vi.fn(async () => undefined),
    random: () => .5,
  });
  return { solver, attach, detach, sendCommand };
}

describe('slider solver', () => {
  it('executes a guarded drag and always detaches after success', async () => {
    const app = harness();
    await expect(app.solver.solve({ id: 7, url: 'https://demo.example.test/' }, 'automatic')).resolves.toMatchObject({ state: 'success', confidence: expect.any(Number) });
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
    await expect(app.solver.solve({ id: 7, url: 'https://demo.example.test/' }, 'manual')).resolves.toEqual({ state: 'uncertain', reason: 'challenge-changed' });
    expect(app.attach).toHaveBeenCalledOnce();
    expect(app.detach).toHaveBeenCalledOnce();
    expect(app.sendCommand.mock.calls.some((call) => call[1] === 'Input.dispatchMouseEvent')).toBe(false);
  });

  it('returns a permission result without attaching when debugger access is absent', async () => {
    const app = harness({ granted: false });
    await expect(app.solver.solve({ id: 7, url: 'https://demo.example.test/' }, 'manual')).resolves.toEqual({ state: 'permission-denied', reason: 'debugger-not-granted' });
    expect(app.attach).not.toHaveBeenCalled();
  });
});
