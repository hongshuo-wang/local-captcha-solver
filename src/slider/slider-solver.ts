import type { SliderChallengeSnapshot } from './challenge-discovery';
import { locateSliderGap, type PixelImage } from './gap-locator';
import type { SliderRunResult, SliderSolver } from './types';

type ContentDiscovery =
  | { state: 'ready'; challenge: SliderChallengeSnapshot; recentUserInput: boolean; pageVisible: boolean; pageFocused: boolean }
  | { state: 'activatable'; activator: { provider: 'geetest' | 'geetest-v4'; rect: { x: number; y: number; width: number; height: number } }; recentUserInput: boolean; pageVisible: boolean; pageFocused: boolean }
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
  const candidate = value as Record<string, unknown>;
  if (candidate.state !== 'ready' && candidate.state !== 'activatable') return true;
  if (typeof candidate.recentUserInput !== 'boolean' || typeof candidate.pageVisible !== 'boolean' || typeof candidate.pageFocused !== 'boolean') return false;
  return candidate.state === 'ready' ? typeof candidate.challenge === 'object' && candidate.challenge !== null : typeof candidate.activator === 'object' && candidate.activator !== null;
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

function scaledPieceMask(challenge: SliderChallengeSnapshot, scaleX: number, scaleY: number) {
  const mask = challenge.pieceMask;
  if (mask === undefined || mask.alpha.length !== mask.alphaWidth * mask.alphaHeight) return undefined;
  const width = Math.max(1, Math.round(mask.width * scaleX));
  const height = Math.max(1, Math.round(mask.height * scaleY));
  const alpha = new Array<number>(width * height);
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    const sourceX = Math.min(mask.alphaWidth - 1, Math.floor(x / width * mask.alphaWidth));
    const sourceY = Math.min(mask.alphaHeight - 1, Math.floor(y / height * mask.alphaHeight));
    alpha[y * width + x] = mask.alpha[sourceY * mask.alphaWidth + sourceX]!;
  }
  return { offsetY: mask.offsetY * scaleY, width, height, alpha };
}

async function activateChallenge(adapter: SliderSolverAdapter, tabId: number, discovery: Extract<ContentDiscovery, { state: 'activatable' }>, delay: (durationMs: number) => Promise<void>): Promise<ContentDiscovery> {
  const target = { tabId };
  const x = discovery.activator.rect.x + discovery.activator.rect.width / 2;
  const y = discovery.activator.rect.y + discovery.activator.rect.height / 2;
  let attached = false;
  try {
    await adapter.debugger.attach(target, '1.3');
    attached = true;
    await adapter.debugger.sendCommand(target, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
    await adapter.debugger.sendCommand(target, 'Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
    await adapter.debugger.sendCommand(target, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 });
  } catch {
    return { state: 'unsupported' };
  } finally {
    if (attached) await adapter.debugger.detach(target).catch(() => undefined);
  }
  let latest: ContentDiscovery | undefined;
  for (const wait of [250, 350, 500, 700, 1_000, 1_500]) {
    await delay(wait);
    const current = await adapter.tabs.sendMessage(tabId, { type: 'captcha:slider-discover' }).catch(() => undefined);
    if (!isDiscovery(current)) continue;
    latest = current;
    if (current.state === 'ready' && !current.recentUserInput) return current;
  }
  return latest?.state === 'ready' ? latest : { state: 'not-found' };
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
      const initialDiscovery = await adapter.tabs.sendMessage(tab.id, { type: 'captcha:slider-discover' }).catch(() => undefined);
      if (!isDiscovery(initialDiscovery)) return { state: 'failed', reason: 'content-unavailable' };
      let discoveryValue: ContentDiscovery = initialDiscovery;
      if (discoveryValue.state === 'activatable') {
        if (trigger === 'automatic') return { state: 'not-found', reason: 'challenge-not-open' };
        if (!discoveryValue.pageVisible || discoveryValue.recentUserInput) return { state: discoveryValue.pageVisible ? 'user-active' : 'page-inactive' };
        discoveryValue = await activateChallenge(adapter, tab.id, discoveryValue, delay);
      }
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
        const cleanBackground = before.backgroundDataUrl === undefined ? undefined : await adapter.decodeImage(before.backgroundDataUrl).catch(() => undefined);
        const cropped = cleanBackground === undefined
          ? crop(pixels, before.image, before.viewport)
          : { image: cleanBackground, scaleX: cleanBackground.width / before.image.width, scaleY: cleanBackground.height / before.image.height };
        if (cropped === undefined) return { state: 'unsupported', reason: 'image-outside-viewport' };
        const expectedSize = before.piece === undefined ? Math.max(before.handle.width, before.handle.height) : Math.max(before.piece.width, before.piece.height);
        const pieceMask = scaledPieceMask(before, cropped.scaleX, cropped.scaleY);
        const location = locateSliderGap({ image: cropped.image, expectedSize: expectedSize * (cropped.scaleX + cropped.scaleY) / 2, minimumX: cropped.image.width * .2, ...(pieceMask === undefined ? {} : { pieceMask }) });
        if (location === undefined || location.confidence < MINIMUM_CONFIDENCE) return { state: 'low-confidence', confidence: location?.confidence ?? 0 };
        confidence = location.confidence;
        const verifyValue = await adapter.tabs.sendMessage(tab.id, { type: 'captcha:slider-discover' }).catch(() => undefined);
        if (!isDiscovery(verifyValue) || verifyValue.state !== 'ready' || verifyValue.challenge.revision !== before.revision || !verifyValue.pageVisible || (trigger === 'automatic' && !verifyValue.pageFocused) || verifyValue.recentUserInput) {
          return { state: 'uncertain', reason: 'challenge-changed' };
        }
        const start = { x: before.handle.x + before.handle.width / 2, y: before.handle.y + before.handle.height / 2 };
        const requestedEndX = pieceMask === undefined
          ? start.x + (location.x + location.width / 2) / cropped.scaleX - expectedSize / 2
          : start.x + location.x / cropped.scaleX - before.pieceMask!.offsetX;
        const endX = Math.max(before.track.x + before.handle.width / 2, Math.min(before.track.x + before.track.width - before.handle.width / 2, requestedEndX));
        const points = dragPoints(start, endX, random);
        await adapter.debugger.sendCommand(target(tab.id), 'Input.dispatchMouseEvent', { type: 'mouseMoved', x: start.x, y: start.y });
        await delay(45 + Math.round(random() * 45));
        await adapter.debugger.sendCommand(target(tab.id), 'Input.dispatchMouseEvent', { type: 'mousePressed', x: start.x, y: start.y, button: 'left', buttons: 1, clickCount: 1 });
        await delay(70 + Math.round(random() * 70));
        for (const [index, point] of points.entries()) {
          await adapter.debugger.sendCommand(target(tab.id), 'Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.x, y: point.y, button: 'left', buttons: 1 });
          await delay(16 + Math.round(random() * 16));
          if (index === Math.floor(points.length * .72)) await delay(35 + Math.round(random() * 45));
        }
        const end = points.at(-1) ?? { x: endX, y: start.y };
        await delay(55 + Math.round(random() * 45));
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
