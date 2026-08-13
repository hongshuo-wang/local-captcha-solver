import type { SliderChallengeSnapshot } from './challenge-discovery';
import { locateSliderGap, type PixelImage } from './gap-locator';
import type { SliderRunResult, SliderSolver } from './types';

type ContentDiscovery =
  | { state: 'ready'; challenge: SliderChallengeSnapshot; recentUserInput: boolean; pageVisible: boolean; pageFocused: boolean }
  | { state: 'not-found' | 'ambiguous' | 'unsupported' };

export interface SliderSolverAdapter {
  settings: {
    isSliderEnabled(pageUrl: string): Promise<boolean>;
  };
  permissions: {
    contains(details: { permissions: readonly string[] }): Promise<boolean>;
  };
  tabs: {
    sendMessage(tabId: number, message: unknown): Promise<unknown>;
  };
  debugger: {
    attach(target: { tabId: number }, version: string): Promise<void>;
    detach(target: { tabId: number }): Promise<void>;
    sendCommand(target: { tabId: number }, method: string, params?: Record<string, unknown>): Promise<unknown>;
  };
  decodeImage(dataUrl: string): Promise<PixelImage>;
  delay?(durationMs: number): Promise<void>;
  random?(): number;
}

const MINIMUM_CONFIDENCE = .58;

function isDiscovery(value: unknown): value is ContentDiscovery {
  if (typeof value !== 'object' || value === null || typeof (value as { state?: unknown }).state !== 'string') return false;
  const candidate = value as Partial<ContentDiscovery>;
  return candidate.state !== 'ready' || (typeof candidate.recentUserInput === 'boolean' && typeof candidate.pageVisible === 'boolean' && typeof candidate.pageFocused === 'boolean' && typeof candidate.challenge === 'object' && candidate.challenge !== null);
}

function crop(image: PixelImage, rect: { x: number; y: number; width: number; height: number }, viewport: { width: number; height: number }): { image: PixelImage; scaleX: number; scaleY: number } | undefined {
  const scaleX = image.width / viewport.width;
  const scaleY = image.height / viewport.height;
  const x = Math.max(0, Math.round(rect.x * scaleX));
  const y = Math.max(0, Math.round(rect.y * scaleY));
  const width = Math.min(image.width - x, Math.round(rect.width * scaleX));
  const height = Math.min(image.height - y, Math.round(rect.height * scaleY));
  if (width < 1 || height < 1) return undefined;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let row = 0; row < height; row += 1) {
    const sourceStart = ((y + row) * image.width + x) * 4;
    data.set(image.data.subarray(sourceStart, sourceStart + width * 4), row * width * 4);
  }
  return { image: { width, height, data }, scaleX, scaleY };
}

function dragPoints(start: { x: number; y: number }, endX: number, random: () => number): Array<{ x: number; y: number }> {
  const distance = endX - start.x;
  const count = Math.max(12, Math.min(28, Math.round(Math.abs(distance) / 10)));
  const overshoot = Math.min(4, Math.max(0, distance * .015));
  const points: Array<{ x: number; y: number }> = [];
  for (let index = 0; index <= count; index += 1) {
    const progress = index / count;
    const eased = progress < .5 ? 2 * progress * progress : 1 - Math.pow(-2 * progress + 2, 2) / 2;
    const x = start.x + distance * eased + (progress > .72 && progress < .96 ? overshoot * Math.sin((progress - .72) / .24 * Math.PI) : 0);
    const y = start.y + Math.sin(progress * Math.PI * 2) * 1.2 + (random() - .5) * .8;
    points.push({ x, y });
  }
  return points;
}

function outcome(value: unknown): 'success' | 'failure' | 'pending' | 'uncertain' {
  if (typeof value !== 'object' || value === null) return 'uncertain';
  const state = (value as { outcome?: unknown }).outcome;
  return state === 'success' || state === 'failure' || state === 'pending' || state === 'uncertain' ? state : 'uncertain';
}

export async function decodeScreenshot(dataUrl: string): Promise<PixelImage> {
  const blob = await (await fetch(dataUrl)).blob();
  const bitmap = await createImageBitmap(blob);
  try {
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext('2d');
    if (context === null) throw new Error('Canvas is unavailable');
    context.drawImage(bitmap, 0, 0);
    const pixels = context.getImageData(0, 0, bitmap.width, bitmap.height);
    return { width: pixels.width, height: pixels.height, data: pixels.data };
  } finally {
    bitmap.close();
  }
}

export function createSliderSolver(adapter: SliderSolverAdapter): SliderSolver {
  const delay = adapter.delay ?? ((durationMs: number) => new Promise<void>((resolve) => setTimeout(resolve, durationMs)));
  const random = adapter.random ?? Math.random;
  const target = (tabId: number) => ({ tabId });

  return {
    async solve(tab, trigger): Promise<SliderRunResult> {
      if (trigger === 'automatic' && !await adapter.settings.isSliderEnabled(tab.url)) return { state: 'permission-denied', reason: 'site-not-enabled' };
      if (!await adapter.permissions.contains({ permissions: ['debugger'] })) return { state: 'permission-denied', reason: 'debugger-not-granted' };
      const discoveryValue = await adapter.tabs.sendMessage(tab.id, { type: 'captcha:slider-discover' }).catch(() => undefined);
      if (!isDiscovery(discoveryValue)) return { state: 'failed', reason: 'content-unavailable' };
      if (discoveryValue.state !== 'ready') return { state: discoveryValue.state === 'not-found' ? 'not-found' : 'unsupported', reason: discoveryValue.state };
      if (!discoveryValue.pageVisible) return { state: 'page-inactive' };
      if (trigger === 'automatic' && !discoveryValue.pageFocused) return { state: 'page-inactive' };
      if (discoveryValue.recentUserInput) return { state: 'user-active' };
      const before = discoveryValue.challenge;
      let confidence: number | undefined;
      let attached = false;
      try {
        await adapter.debugger.attach(target(tab.id), '1.3');
        attached = true;
        const screenshotResult = await adapter.debugger.sendCommand(target(tab.id), 'Page.captureScreenshot', { format: 'png', captureBeyondViewport: false, fromSurface: true }).catch(() => undefined);
        const screenshotData = typeof screenshotResult === 'object' && screenshotResult !== null && typeof (screenshotResult as { data?: unknown }).data === 'string'
          ? (screenshotResult as { data: string }).data
          : undefined;
        if (screenshotData === undefined) return { state: 'failed', reason: 'screenshot-failed' };
        const pixels = await adapter.decodeImage(`data:image/png;base64,${screenshotData}`).catch(() => undefined);
        if (pixels === undefined) return { state: 'failed', reason: 'screenshot-invalid' };
        const cropped = crop(pixels, before.image, before.viewport);
        if (cropped === undefined) return { state: 'unsupported', reason: 'image-outside-viewport' };
        const expectedSize = Math.max(before.handle.width, before.handle.height) * (cropped.scaleX + cropped.scaleY) / 2;
        const location = locateSliderGap({ image: cropped.image, expectedSize, minimumX: cropped.image.width * .2 });
        if (location === undefined || location.confidence < MINIMUM_CONFIDENCE) return { state: 'low-confidence', confidence: location?.confidence ?? 0 };
        confidence = location.confidence;
        const verifyValue = await adapter.tabs.sendMessage(tab.id, { type: 'captcha:slider-discover' }).catch(() => undefined);
        if (!isDiscovery(verifyValue) || verifyValue.state !== 'ready' || verifyValue.challenge.revision !== before.revision || !verifyValue.pageVisible || (trigger === 'automatic' && !verifyValue.pageFocused) || verifyValue.recentUserInput) {
          return { state: 'uncertain', reason: 'challenge-changed' };
        }
        const start = { x: before.handle.x + before.handle.width / 2, y: before.handle.y + before.handle.height / 2 };
        const gapCenterCss = before.image.x + (location.x + location.width / 2) / cropped.scaleX;
        const pieceCenterCss = before.image.x + expectedSize / cropped.scaleX / 2;
        const requestedEndX = start.x + gapCenterCss - pieceCenterCss;
        const endX = Math.max(before.track.x + before.handle.width / 2, Math.min(before.track.x + before.track.width - before.handle.width / 2, requestedEndX));
        const points = dragPoints(start, endX, random);
        await adapter.debugger.sendCommand(target(tab.id), 'Input.dispatchMouseEvent', { type: 'mouseMoved', x: start.x, y: start.y });
        await adapter.debugger.sendCommand(target(tab.id), 'Input.dispatchMouseEvent', { type: 'mousePressed', x: start.x, y: start.y, button: 'left', buttons: 1, clickCount: 1 });
        for (const [index, point] of points.entries()) {
          await adapter.debugger.sendCommand(target(tab.id), 'Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.x, y: point.y, button: 'left', buttons: 1 });
          if (index % 3 === 0) await delay(12 + Math.round(random() * 12));
        }
        const end = points.at(-1) ?? { x: endX, y: start.y };
        await adapter.debugger.sendCommand(target(tab.id), 'Input.dispatchMouseEvent', { type: 'mouseReleased', x: end.x, y: end.y, button: 'left', buttons: 0, clickCount: 1 });
      } catch {
        return { state: 'failed', reason: attached ? 'input-failed' : 'debugger-unavailable' };
      } finally {
        if (attached) await adapter.debugger.detach(target(tab.id)).catch(() => undefined);
      }
      for (const wait of [250, 500, 750]) {
        await delay(wait);
        const current = outcome(await adapter.tabs.sendMessage(tab.id, { type: 'captcha:slider-outcome', revision: before.revision }).catch(() => undefined));
        if (current === 'success') return { state: 'success', confidence };
        if (current === 'failure') return { state: 'failed', confidence, reason: 'challenge-rejected' };
        if (current === 'uncertain') return { state: 'uncertain', confidence };
      }
      return { state: 'uncertain', confidence, reason: 'outcome-timeout' };
    },
  };
}
