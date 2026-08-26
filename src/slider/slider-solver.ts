import { sliderDiscoveryKey, type SliderChallengeSnapshot } from './challenge-discovery';
import { locateSliderGap, type PixelImage } from './gap-locator';
import type { SliderImageSource, SliderProvider, SliderResultState, SliderRunDiagnostic, SliderRunResult, SliderSolver } from './types';

type ContentDiscovery =
  | { state: 'ready'; challenge: SliderChallengeSnapshot; recentUserInput: boolean; pageVisible: boolean; pageFocused: boolean }
  | { state: 'activatable'; activator: { provider: SliderProvider; rect: { x: number; y: number; width: number; height: number } }; recentUserInput: boolean; pageVisible: boolean; pageFocused: boolean }
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
const DEFAULT_MASKED_CONFIDENCE = .68;

function confidenceThreshold(method: NonNullable<ReturnType<typeof locateSliderGap>>['method']): number {
  if (method === 'edge-perimeter') return MINIMUM_CONFIDENCE;
  if (method === 'reference-difference') return .62;
  if (method === 'geometry') return .7;
  if (method === 'shape') return .69;
  return DEFAULT_MASKED_CONFIDENCE;
}

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
  if (mask === undefined || mask.alpha.length !== mask.alphaWidth * mask.alphaHeight || mask.luminance.length !== mask.alpha.length) return undefined;
  const width = Math.max(1, Math.round(mask.width * scaleX));
  const height = Math.max(1, Math.round(mask.height * scaleY));
  const alpha = new Array<number>(width * height);
  const luminance = new Array<number>(width * height);
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    const sourceX = Math.min(mask.alphaWidth - 1, Math.floor(x / width * mask.alphaWidth));
    const sourceY = Math.min(mask.alphaHeight - 1, Math.floor(y / height * mask.alphaHeight));
    alpha[y * width + x] = mask.alpha[sourceY * mask.alphaWidth + sourceX]!;
    luminance[y * width + x] = mask.luminance[sourceY * mask.alphaWidth + sourceX]!;
  }
  return { offsetY: mask.offsetY * scaleY, width, height, alpha, luminance };
}

interface SliderImageView {
  source: SliderImageSource;
  image: PixelImage;
  referenceImage?: PixelImage;
  scaleX: number;
  scaleY: number;
}

function locateInView(challenge: SliderChallengeSnapshot, view: SliderImageView) {
  const expectedSize = challenge.piece === undefined ? Math.max(challenge.handle.width, challenge.handle.height) : Math.max(challenge.piece.width, challenge.piece.height);
  const pieceMask = scaledPieceMask(challenge, view.scaleX, view.scaleY);
  const location = locateSliderGap({
    image: view.image,
    ...(view.referenceImage === undefined ? {} : { referenceImage: view.referenceImage }),
    expectedSize: expectedSize * (view.scaleX + view.scaleY) / 2,
    minimumX: view.image.width * (view.referenceImage === undefined ? .2 : .18),
    ...(pieceMask === undefined ? {} : { pieceMask }),
  });
  return { view, expectedSize, pieceMask, location };
}

function pieceOffsetX(challenge: SliderChallengeSnapshot): number | undefined {
  return challenge.pieceMask?.offsetX ?? (challenge.piece === undefined ? undefined : challenge.piece.x - challenge.image.x);
}

function stableChallengeGeometry(previous: SliderChallengeSnapshot, current: SliderChallengeSnapshot): boolean {
  if (previous.revision !== current.revision) return false;
  const rects = [
    [previous.challenge, current.challenge],
    [previous.image, current.image],
    [previous.track, current.track],
    [previous.handle, current.handle],
  ] as const;
  return rects.every(([left, right]) =>
    Math.abs(left.x - right.x) <= .25 && Math.abs(left.y - right.y) <= .25 &&
    Math.abs(left.width - right.width) <= .25 && Math.abs(left.height - right.height) <= .25,
  );
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
    await adapter.tabs.sendMessage(tabId, { type: 'captcha:slider-automation-press' }).catch(() => undefined);
    try {
      await adapter.debugger.sendCommand(target, 'Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
    } finally {
      await adapter.tabs.sendMessage(tabId, { type: 'captcha:slider-automation-disarm' }).catch(() => undefined);
    }
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
    if (current.state === 'ready' && !current.recentUserInput && latest?.state === 'ready' && stableChallengeGeometry(latest.challenge, current.challenge)) return current;
    latest = current;
  }
  return { state: 'not-found' };
}

function outcome(value: unknown): 'success' | 'failure' | 'pending' | 'absent' | 'uncertain' {
  if (typeof value !== 'object' || value === null) return 'uncertain';
  const state = (value as { outcome?: unknown }).outcome;
  return state === 'success' || state === 'failure' || state === 'pending' || state === 'absent' || state === 'uncertain' ? state : 'uncertain';
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
  const runGenerations = new Map<number, number>();
  let attemptSequence = 0;

  const diagnosticId = (value: string): string => {
    let hash = 2_166_136_261;
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 16_777_619);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
  };

  return {
    cancel(tabId): void {
      runGenerations.set(tabId, (runGenerations.get(tabId) ?? 0) + 1);
    },
    async solve(tab, trigger, expectedRevision): Promise<SliderRunResult> {
      const runGeneration = (runGenerations.get(tab.id) ?? 0) + 1;
      runGenerations.set(tab.id, runGeneration);
      const cancelled = (): boolean => runGenerations.get(tab.id) !== runGeneration;
      const siteDisabled = async (): Promise<boolean> => trigger === 'automatic' && !await adapter.settings.isSliderEnabled(tab.url);
      let diagnostic: SliderRunDiagnostic = {};
      const result = (state: SliderResultState, details: Omit<SliderRunResult, 'state' | 'diagnostic'> = {}): SliderRunResult => ({
        state,
        ...details,
        ...(Object.keys(diagnostic).length === 0 ? {} : { diagnostic: { ...diagnostic } }),
      });
      if (trigger === 'automatic' && !await adapter.settings.isSliderEnabled(tab.url)) return result('permission-denied', { reason: 'site-not-enabled' });
      if (cancelled()) return result('permission-denied', { reason: 'run-cancelled' });
      if (!await adapter.permissions.contains({ permissions: ['debugger'] })) return result('permission-denied', { reason: 'debugger-not-granted' });
      if (cancelled()) return result('permission-denied', { reason: 'run-cancelled' });
      diagnostic = { attemptId: `slider-${(++attemptSequence).toString(36)}`, phase: 'discovery' };
      const initialDiscovery = await adapter.tabs.sendMessage(tab.id, { type: 'captcha:slider-discover' }).catch(() => undefined);
      if (cancelled()) return result('permission-denied', { reason: 'run-cancelled' });
      if (!isDiscovery(initialDiscovery)) return result('failed', { reason: 'content-unavailable' });
      if (expectedRevision !== undefined && sliderDiscoveryKey(initialDiscovery) !== expectedRevision) return result('uncertain', { reason: 'challenge-changed' });
      let discoveryValue: ContentDiscovery = initialDiscovery;
      if (discoveryValue.state === 'activatable') {
        diagnostic = { ...diagnostic, provider: discoveryValue.activator.provider, phase: 'activation' };
        if (!discoveryValue.pageVisible || (trigger === 'automatic' && !discoveryValue.pageFocused)) return result('page-inactive');
        if (discoveryValue.recentUserInput) return result('user-active');
        discoveryValue = await activateChallenge(adapter, tab.id, discoveryValue, delay);
        if (cancelled()) return result('permission-denied', { reason: 'run-cancelled' });
      }
      if (discoveryValue.state !== 'ready') return result(discoveryValue.state === 'not-found' ? 'not-found' : 'unsupported', { reason: discoveryValue.state });
      if (!discoveryValue.pageVisible) return result('page-inactive');
      if (trigger === 'automatic' && !discoveryValue.pageFocused) return result('page-inactive');
      if (discoveryValue.recentUserInput) return result('user-active');
      const before = discoveryValue.challenge;
      const challengeId = diagnosticId(before.revision);
      const initialPieceOffsetX = pieceOffsetX(before);
      const pieceOffsetY = before.pieceMask?.offsetY ?? (before.piece === undefined ? undefined : before.piece.y - before.image.y);
      diagnostic = {
        provider: before.provider,
        attemptId: diagnostic.attemptId,
        challengeId,
        phase: 'localization',
        trackWidth: before.track.width,
        handleWidth: before.handle.width,
        ...(initialPieceOffsetX === undefined ? {} : { pieceOffsetX: initialPieceOffsetX }),
        ...(pieceOffsetY === undefined ? {} : { pieceOffsetY }),
      };
      let confidence: number | undefined;
      let attached = false;
      let pointerPressed = false;
      let lastPointer = { x: 0, y: 0 };
      let releasePointer = async (): Promise<void> => undefined;
      const userIsActive = async (): Promise<boolean> => {
        const value = await adapter.tabs.sendMessage(tab.id, { type: 'captcha:slider-user-active' }).catch(() => undefined);
        return typeof value === 'object' && value !== null && (value as { active?: unknown }).active === true;
      };
      try {
        await adapter.debugger.attach(target(tab.id), '1.3');
        attached = true;
        if (cancelled()) return result('permission-denied', { reason: 'run-cancelled' });
        const screenshotResult = await adapter.debugger.sendCommand(target(tab.id), 'Page.captureScreenshot', { format: 'png', captureBeyondViewport: false, fromSurface: true }).catch(() => undefined);
        const screenshotData = typeof screenshotResult === 'object' && screenshotResult !== null && typeof (screenshotResult as { data?: unknown }).data === 'string'
          ? (screenshotResult as { data: string }).data
          : undefined;
        if (screenshotData === undefined) return result('failed', { reason: 'screenshot-failed' });
        const pixels = await adapter.decodeImage(`data:image/png;base64,${screenshotData}`).catch(() => undefined);
        if (cancelled()) return result('permission-denied', { reason: 'run-cancelled' });
        if (pixels === undefined) return result('failed', { reason: 'screenshot-invalid' });
        const visibleCrop = crop(pixels, before.image, before.viewport);
        if (visibleCrop === undefined) return result('unsupported', { reason: 'image-outside-viewport' });
        const visibleView: SliderImageView = { source: 'viewport', ...visibleCrop };
        const cleanBackground = before.backgroundDataUrl === undefined ? undefined : await adapter.decodeImage(before.backgroundDataUrl).catch(() => undefined);
        const referenceBackground = before.referenceBackgroundDataUrl === undefined ? undefined : await adapter.decodeImage(before.referenceBackgroundDataUrl).catch(() => undefined);
        const cleanView = cleanBackground === undefined ? undefined : {
          source: referenceBackground === undefined ? 'background' as const : 'paired-background' as const,
          image: cleanBackground,
          ...(referenceBackground === undefined ? {} : { referenceImage: referenceBackground }),
          scaleX: cleanBackground.width / before.image.width,
          scaleY: cleanBackground.height / before.image.height,
        };
        const attempts = (cleanView === undefined ? [visibleView] : [cleanView, visibleView]).map((view) => locateInView(before, view));
        const rankedAttempts = [...attempts].sort((left, right) => (right.location?.confidence ?? 0) - (left.location?.confidence ?? 0));
        const acceptedAttempts = rankedAttempts.filter((attempt) => attempt.location !== undefined && attempt.location.confidence >= confidenceThreshold(attempt.location.method));
        const selected = acceptedAttempts[0] ?? rankedAttempts[0]!;
        const alternative = rankedAttempts.find((attempt) => attempt !== selected);
        const selectedThreshold = selected.location === undefined ? DEFAULT_MASKED_CONFIDENCE : confidenceThreshold(selected.location.method);
        const accepted = acceptedAttempts.length === 0 ? undefined : selected;
        const { view: cropped, expectedSize, pieceMask, location } = selected;
        diagnostic = {
          ...diagnostic,
          imageWidth: cropped.image.width,
          imageHeight: cropped.image.height,
          scaleX: cropped.scaleX,
          scaleY: cropped.scaleY,
          imageSource: cropped.source,
          confidenceThreshold: selectedThreshold,
          ...(alternative === undefined ? {} : {
            alternativeImageSource: alternative.view.source,
            alternativeConfidence: alternative.location?.confidence ?? 0,
          }),
        };
        if (location !== undefined) diagnostic = {
          ...diagnostic,
          gapX: location.x,
          gapY: location.y,
          localizationMethod: location.method,
          localizationScore: location.score,
        };
        if (accepted === undefined || location === undefined) return result('low-confidence', { confidence: location?.confidence ?? 0 });
        confidence = location.confidence;
        const verifyValue = await adapter.tabs.sendMessage(tab.id, { type: 'captcha:slider-discover' }).catch(() => undefined);
        if (cancelled()) return result('permission-denied', { reason: 'run-cancelled' });
        if (!isDiscovery(verifyValue) || verifyValue.state !== 'ready' || verifyValue.challenge.revision !== before.revision || !verifyValue.pageVisible || (trigger === 'automatic' && !verifyValue.pageFocused) || verifyValue.recentUserInput) {
          return result('uncertain', { confidence, reason: 'challenge-changed' });
        }
        const start = { x: before.handle.x + before.handle.width / 2, y: before.handle.y + before.handle.height / 2 };
        const desiredPieceOffsetX = pieceMask === undefined
          ? (location.x + location.width / 2) / cropped.scaleX - expectedSize / 2
          : location.x / cropped.scaleX;
        const requestedEndX = start.x + desiredPieceOffsetX - (initialPieceOffsetX ?? 0);
        const minimumEndX = before.track.x + before.handle.width / 2;
        const maximumEndX = before.track.x + before.track.width - before.handle.width / 2;
        const endX = Math.max(minimumEndX, Math.min(maximumEndX, requestedEndX));
        diagnostic = { ...diagnostic, phase: 'execution', desiredPieceOffsetX, startX: start.x, requestedEndX, endX, plannedDragX: endX - start.x };
        const points = dragPoints(start, endX, random);
        lastPointer = start;
        releasePointer = async () => {
          if (!attached || !pointerPressed) return;
          await adapter.debugger.sendCommand(target(tab.id), 'Input.dispatchMouseEvent', { type: 'mouseReleased', x: lastPointer.x, y: lastPointer.y, button: 'left', buttons: 0, clickCount: 1 }).catch(() => undefined);
          pointerPressed = false;
        };
        await adapter.debugger.sendCommand(target(tab.id), 'Input.dispatchMouseEvent', { type: 'mouseMoved', x: start.x, y: start.y });
        await delay(45 + Math.round(random() * 45));
        if (await siteDisabled()) return result('permission-denied', { confidence, reason: 'site-not-enabled' });
        await adapter.tabs.sendMessage(tab.id, { type: 'captcha:slider-automation-press' }).catch(() => undefined);
        if (cancelled()) {
          await adapter.tabs.sendMessage(tab.id, { type: 'captcha:slider-automation-disarm' }).catch(() => undefined);
          return result('permission-denied', { reason: 'run-cancelled' });
        }
        try {
          await adapter.debugger.sendCommand(target(tab.id), 'Input.dispatchMouseEvent', { type: 'mousePressed', x: start.x, y: start.y, button: 'left', buttons: 1, clickCount: 1 });
        } finally {
          await adapter.tabs.sendMessage(tab.id, { type: 'captcha:slider-automation-disarm' }).catch(() => undefined);
        }
        pointerPressed = true;
        await delay(70 + Math.round(random() * 70));
        for (const [index, point] of points.entries()) {
          if (index % 4 === 0) {
            if (cancelled()) {
              await releasePointer();
              return result('permission-denied', { confidence, reason: 'run-cancelled' });
            }
            if (index % 8 === 0 && await siteDisabled()) {
              await releasePointer();
              return result('permission-denied', { confidence, reason: 'site-not-enabled' });
            }
            if (await userIsActive()) {
              await releasePointer();
              return result('uncertain', { confidence, reason: 'user-interrupted' });
            }
          }
          lastPointer = point;
          await adapter.debugger.sendCommand(target(tab.id), 'Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.x, y: point.y, button: 'left', buttons: 1 });
          await delay(16 + Math.round(random() * 16));
          if (index === Math.floor(points.length * .72)) await delay(35 + Math.round(random() * 45));
        }
        let end = points.at(-1) ?? { x: endX, y: start.y };
        for (let measurement = 0; measurement < 2; measurement += 1) {
          await delay(45);
          const feedbackValue = await adapter.tabs.sendMessage(tab.id, { type: 'captcha:slider-discover' }).catch(() => undefined);
          if (!isDiscovery(feedbackValue) || feedbackValue.state !== 'ready' || feedbackValue.challenge.revision !== before.revision) break;
          const actualPieceOffsetX = pieceOffsetX(feedbackValue.challenge);
          if (actualPieceOffsetX === undefined) break;
          const pieceErrorX = desiredPieceOffsetX - actualPieceOffsetX;
          diagnostic = { ...diagnostic, actualPieceOffsetX, pieceErrorX, correctionX: end.x - endX };
          if (Math.abs(pieceErrorX) < .5 || measurement === 1) break;
          const correctedX = Math.max(minimumEndX, Math.min(maximumEndX, end.x + pieceErrorX));
          if (Math.abs(correctedX - end.x) < .05) break;
          end = { x: correctedX, y: end.y };
          diagnostic = { ...diagnostic, correctionX: end.x - endX };
          await adapter.debugger.sendCommand(target(tab.id), 'Input.dispatchMouseEvent', { type: 'mouseMoved', x: end.x, y: end.y, button: 'left', buttons: 1 });
          lastPointer = end;
        }
        if (await userIsActive()) {
          await releasePointer();
          return result('uncertain', { confidence, reason: 'user-interrupted' });
        }
        if (cancelled()) {
          await releasePointer();
          return result('permission-denied', { confidence, reason: 'run-cancelled' });
        }
        await delay(55 + Math.round(random() * 45));
        await adapter.debugger.sendCommand(target(tab.id), 'Input.dispatchMouseEvent', { type: 'mouseReleased', x: end.x, y: end.y, button: 'left', buttons: 0, clickCount: 1 });
        pointerPressed = false;
        diagnostic = { ...diagnostic, releaseX: end.x, finalDragX: end.x - start.x };
      } catch {
        await releasePointer();
        return result('failed', { confidence, reason: attached ? 'input-failed' : 'debugger-unavailable' });
      } finally {
        await releasePointer();
        if (attached) await adapter.debugger.detach(target(tab.id)).catch(() => undefined);
      }
      let absentObservations = 0;
      const outcomeObservations: string[] = [];
      diagnostic = { ...diagnostic, phase: 'outcome' };
      for (const wait of [250, 500, 750]) {
        await delay(wait);
        if (cancelled()) return result('permission-denied', { confidence, reason: 'run-cancelled' });
        if (await siteDisabled()) return result('permission-denied', { confidence, reason: 'site-not-enabled' });
        const current = outcome(await adapter.tabs.sendMessage(tab.id, { type: 'captcha:slider-outcome', revision: before.revision }).catch(() => undefined));
        outcomeObservations.push(current);
        diagnostic = { ...diagnostic, outcomeSequence: outcomeObservations.join('>') };
        if (current === 'success') return result('success', { confidence, challengeRevision: before.revision });
        if (current === 'failure') return result('failed', { confidence, reason: 'challenge-rejected', challengeRevision: before.revision });
        if (current === 'absent') {
          if (++absentObservations >= 2) return result('success', { confidence, challengeRevision: before.revision });
        } else {
          absentObservations = 0;
        }
      }
      return result('uncertain', { confidence, reason: 'outcome-timeout' });
    },
  };
}
