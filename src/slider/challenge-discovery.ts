export interface SliderRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SliderChallengeSnapshot {
  revision: string;
  provider: 'geetest' | 'geetest-v4' | 'generic';
  challenge: SliderRect;
  image: SliderRect;
  backgroundDataUrl?: string;
  piece?: SliderRect;
  pieceMask?: SliderPieceMask;
  track: SliderRect;
  handle: SliderRect;
  viewport: { width: number; height: number; devicePixelRatio: number };
}

export interface SliderPieceMask {
  offsetX: number;
  offsetY: number;
  width: number;
  height: number;
  alphaWidth: number;
  alphaHeight: number;
  alpha: number[];
}

export interface SliderActivatorSnapshot {
  provider: 'geetest' | 'geetest-v4';
  rect: SliderRect;
}

export type SliderChallengeDiscovery =
  | { state: 'ready'; challenge: SliderChallengeSnapshot }
  | { state: 'activatable'; activator: SliderActivatorSnapshot }
  | { state: 'not-found' | 'ambiguous' | 'unsupported' };

const HANDLE_SELECTORS = [
  '[data-slider-handle]',
  '.geetest_slider_button',
  '.geetest_slider .geetest_btn',
  '[class*="slider"][class*="button"]',
  '[class*="slider"][class*="handle"]',
  '[class*="slide"][class*="button"]',
  '[role="slider"]',
];

const TRACK_SELECTORS = [
  '[data-slider-track]',
  '.geetest_track',
  '.geetest_slider_track',
  '.geetest_slider',
  '[class*="slider"][class*="track"]',
  '[class*="slide"][class*="track"]',
  '[class*="slider"]',
];

const IMAGE_SELECTORS = [
  '[data-slider-image]',
  '.geetest_canvas_bg',
  '.geetest_bg',
  '[class*="geetest"][class*="bg"]',
  'canvas',
  'img',
];

const PIECE_SELECTORS = [
  '[data-slider-piece]',
  '.geetest_canvas_slice',
  '.geetest_slice_bg',
  '.geetest_slice',
];

const ACTIVATOR_SELECTORS = [
  '.geetest_btn_click',
  '.geetest_radar_btn',
];

function rectFor(element: Element): SliderRect | undefined {
  const rect = element.getBoundingClientRect();
  const style = getComputedStyle(element);
  if (rect.width < 1 || rect.height < 1 || style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return undefined;
  if (rect.right <= 0 || rect.bottom <= 0 || rect.left >= innerWidth || rect.top >= innerHeight) return undefined;
  return { x: rect.left, y: rect.top, width: rect.width, height: rect.height };
}

function containsRect(outer: SliderRect, inner: SliderRect, tolerance = 2): boolean {
  return inner.x >= outer.x - tolerance && inner.y >= outer.y - tolerance &&
    inner.x + inner.width <= outer.x + outer.width + tolerance &&
    inner.y + inner.height <= outer.y + outer.height + tolerance;
}

function challengeRoot(handle: Element): Element | undefined {
  const explicit = handle.closest('[data-slider-captcha]');
  if (explicit !== null) return explicit;
  let current: Element | null = handle;
  for (let depth = 0; depth < 9 && current !== null; depth += 1, current = current.parentElement) {
    const rect = rectFor(current);
    if (rect !== undefined && rect.width >= 180 && rect.height >= 120 && current.querySelector('canvas, img, [class*="bg"]') !== null) return current;
  }
  return undefined;
}

function largestVisible(root: Element, selectors: readonly string[], predicate: (rect: SliderRect) => boolean): { element: Element; rect: SliderRect } | undefined {
  const elements = new Set(selectors.flatMap((selector) => [...root.querySelectorAll(selector)]));
  return [...elements]
    .map((element) => ({ element, rect: rectFor(element) }))
    .filter((entry): entry is { element: Element; rect: SliderRect } => entry.rect !== undefined && predicate(entry.rect))
    .sort((left, right) => right.rect.width * right.rect.height - left.rect.width * left.rect.height)[0];
}

function trackFor(root: Element, handleRect: SliderRect): { element: Element; rect: SliderRect } | undefined {
  const handleCenter = { x: handleRect.x + handleRect.width / 2, y: handleRect.y + handleRect.height / 2 };
  const matched = largestVisible(root, TRACK_SELECTORS, (rect) =>
    rect.width >= handleRect.width * 3 && rect.height <= Math.max(80, handleRect.height * 2.5) &&
    handleCenter.x >= rect.x - 8 && handleCenter.x <= rect.x + rect.width + 8 &&
    handleCenter.y >= rect.y - 8 && handleCenter.y <= rect.y + rect.height + 8,
  );
  if (matched !== undefined) return matched;
  const parent = root.querySelector('[data-slider-track]') ?? root;
  const rect = rectFor(parent);
  return rect !== undefined && rect.width >= handleRect.width * 3 ? { element: parent, rect } : undefined;
}

function imageFor(root: Element, trackRect: SliderRect): { element: Element; rect: SliderRect } | undefined {
  return largestVisible(root, IMAGE_SELECTORS, (rect) =>
    rect.width >= 160 && rect.height >= 80 && rect.y + rect.height <= trackRect.y + 8 && rect.width >= trackRect.width * .65,
  );
}

function pieceFor(root: Element, imageRect: SliderRect): { element: Element; rect: SliderRect } | undefined {
  const elements = new Set(PIECE_SELECTORS.flatMap((selector) => [...root.querySelectorAll(selector)]));
  return [...elements]
    .map((element) => ({ element, rect: rectFor(element) }))
    .filter((entry): entry is { element: Element; rect: SliderRect } => entry.rect !== undefined && entry.rect.width >= 20 && entry.rect.height >= 20 && containsRect(imageRect, entry.rect, 8) && (
      entry.element.matches('.geetest_canvas_slice') || (entry.rect.width <= imageRect.width * .45 && entry.rect.height <= imageRect.height * .7)
    ))
    .sort((left, right) => left.rect.width * left.rect.height - right.rect.width * right.rect.height)[0];
}

async function pixelsForPiece(element: Element): Promise<ImageData | undefined> {
  try {
    if (element instanceof HTMLCanvasElement) return element.getContext('2d', { willReadFrequently: true })?.getImageData(0, 0, element.width, element.height);
    const match = getComputedStyle(element).backgroundImage.match(/url\(["']?(.*?)["']?\)/);
    if (match?.[1] === undefined) return undefined;
    const bitmap = await createImageBitmap(await (await fetch(match[1])).blob());
    try {
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (context === null) return undefined;
      context.drawImage(bitmap, 0, 0);
      return context.getImageData(0, 0, bitmap.width, bitmap.height);
    } finally { bitmap.close(); }
  } catch { return undefined; }
}

async function backgroundDataUrlFor(element: Element): Promise<string | undefined> {
  try {
    if (element instanceof HTMLCanvasElement) return element.toDataURL('image/png');
    const match = getComputedStyle(element).backgroundImage.match(/url\(["']?(.*?)["']?\)/);
    if (match?.[1] === undefined || match[1].startsWith('data:')) return match?.[1];
    const blob = await (await fetch(match[1])).blob();
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('Invalid image data'));
      reader.onerror = () => reject(reader.error ?? new Error('Image read failed'));
      reader.readAsDataURL(blob);
    });
  } catch { return undefined; }
}

async function maskForPiece(piece: { element: Element; rect: SliderRect }, imageRect: SliderRect): Promise<SliderPieceMask | undefined> {
  const pixels = await pixelsForPiece(piece.element);
  if (pixels === undefined) return undefined;
  let minimumX = pixels.width;
  let minimumY = pixels.height;
  let maximumX = -1;
  let maximumY = -1;
  for (let y = 0; y < pixels.height; y += 1) for (let x = 0; x < pixels.width; x += 1) {
    if (pixels.data[(y * pixels.width + x) * 4 + 3]! <= 20) continue;
    minimumX = Math.min(minimumX, x);
    minimumY = Math.min(minimumY, y);
    maximumX = Math.max(maximumX, x);
    maximumY = Math.max(maximumY, y);
  }
  if (maximumX < minimumX || maximumY < minimumY) return undefined;
  const width = maximumX - minimumX + 1;
  const height = maximumY - minimumY + 1;
  if (width < 20 || height < 20 || width > 120 || height > 120) return undefined;
  const alpha = new Array<number>(width * height);
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    alpha[y * width + x] = pixels.data[((minimumY + y) * pixels.width + minimumX + x) * 4 + 3]!;
  }
  const scaleX = piece.rect.width / pixels.width;
  const scaleY = piece.rect.height / pixels.height;
  return {
    offsetX: piece.rect.x - imageRect.x + minimumX * scaleX,
    offsetY: piece.rect.y - imageRect.y + minimumY * scaleY,
    width: width * scaleX,
    height: height * scaleY,
    alphaWidth: width,
    alphaHeight: height,
    alpha,
  };
}

function providerFor(root: Element): 'geetest' | 'geetest-v4' | 'generic' {
  const value = `${root.id} ${root.className} ${root.getAttribute('data-provider') ?? ''}`.toLowerCase();
  if (!value.includes('geetest')) return 'generic';
  return root.querySelector('.geetest_canvas_bg') === null ? 'geetest-v4' : 'geetest';
}

function rounded(rect: SliderRect): string {
  return [rect.x, rect.y, rect.width, rect.height].map((value) => Math.round(value * 10) / 10).join(':');
}

function imageRevision(element: Element): string {
  if (element instanceof HTMLImageElement) return element.currentSrc || element.src;
  return element.getAttribute('src') ?? getComputedStyle(element).backgroundImage;
}

async function snapshotForHandle(handle: Element): Promise<SliderChallengeSnapshot | undefined> {
  const handleRect = rectFor(handle);
  if (handleRect === undefined || handleRect.width < 18 || handleRect.width > 100 || handleRect.height < 18 || handleRect.height > 100) return undefined;
  const root = challengeRoot(handle);
  if (root === undefined) return undefined;
  const challenge = rectFor(root);
  const track = trackFor(root, handleRect);
  if (challenge === undefined || track === undefined) return undefined;
  const image = imageFor(root, track.rect);
  if (image === undefined || !containsRect(challenge, image.rect, 8) || !containsRect(challenge, track.rect, 8)) return undefined;
  if (track.rect.width <= handleRect.width || Math.abs(track.rect.y + track.rect.height / 2 - (handleRect.y + handleRect.height / 2)) > Math.max(track.rect.height, handleRect.height)) return undefined;
  const provider = providerFor(root);
  const backgroundDataUrl = await backgroundDataUrlFor(image.element);
  const pieceLayer = pieceFor(root, image.rect);
  const pieceMask = pieceLayer === undefined ? undefined : await maskForPiece(pieceLayer, image.rect);
  const piece = pieceMask === undefined ? pieceLayer?.rect : {
    x: image.rect.x + pieceMask.offsetX,
    y: image.rect.y + pieceMask.offsetY,
    width: pieceMask.width,
    height: pieceMask.height,
  };
  const revision = [provider, rounded(challenge), rounded(image.rect), piece === undefined ? '' : rounded(piece), rounded(track.rect), rounded(handleRect), imageRevision(image.element), root.textContent?.trim().slice(0, 80) ?? ''].join('|');
  return {
    revision,
    provider,
    challenge,
    image: image.rect,
    ...(backgroundDataUrl === undefined ? {} : { backgroundDataUrl }),
    ...(piece === undefined ? {} : { piece }),
    ...(pieceMask === undefined ? {} : { pieceMask }),
    track: track.rect,
    handle: handleRect,
    viewport: { width: innerWidth, height: innerHeight, devicePixelRatio },
  };
}

function activatorFor(element: Element): SliderActivatorSnapshot | undefined {
  const rect = rectFor(element);
  if (rect === undefined || rect.width < 120 || rect.height < 30 || rect.height > 100) return undefined;
  return { provider: element.matches('.geetest_btn_click') ? 'geetest-v4' : 'geetest', rect };
}

export async function discoverSliderChallenge(root: ParentNode = document): Promise<SliderChallengeDiscovery> {
  const handles = new Set(HANDLE_SELECTORS.flatMap((selector) => [...root.querySelectorAll(selector)]));
  const candidates = (await Promise.all([...handles].map(snapshotForHandle))).filter((value): value is SliderChallengeSnapshot => value !== undefined);
  const unique = new Map(candidates.map((candidate) => [candidate.revision, candidate]));
  if (unique.size === 1) return { state: 'ready', challenge: [...unique.values()][0]! };
  if (unique.size > 1) return { state: 'ambiguous' };
  const activators = new Map<string, SliderActivatorSnapshot>();
  for (const selector of ACTIVATOR_SELECTORS) for (const element of root.querySelectorAll(selector)) {
    const activator = activatorFor(element);
    if (activator !== undefined) activators.set(`${activator.provider}|${rounded(activator.rect)}`, activator);
  }
  if (activators.size === 1) return { state: 'activatable', activator: [...activators.values()][0]! };
  return { state: activators.size > 1 ? 'ambiguous' : 'not-found' };
}

export type SliderOutcome = 'success' | 'failure' | 'pending' | 'uncertain';

function visibleOutcomeText(root: ParentNode): string {
  const selectors = '[role="status"], [class*="success"], [class*="error"], [class*="fail"], [class*="result"]';
  return [...root.querySelectorAll(selectors)]
    .filter((element) => rectFor(element) !== undefined)
    .map((element) => `${element.className} ${element.textContent ?? ''}`)
    .join('\n');
}

export async function observeSliderOutcome(previousRevision: string, root: ParentNode = document): Promise<SliderOutcome> {
  const text = visibleOutcomeText(root);
  if (/(验证成功|校验成功|\bsuccess\b|\bverified\b|\bpassed\b|\byou beat\s+\d+%|超过了?\s*\d+%)/i.test(text)) return 'success';
  if (/(验证失败|请重试|再试一次|\bfailed\b|\btry again\b|\bretry\b)/i.test(text)) return 'failure';
  const current = await discoverSliderChallenge(root);
  if (current.state === 'activatable') return 'failure';
  if (current.state === 'not-found') return 'uncertain';
  if (current.state !== 'ready') return 'uncertain';
  return current.challenge.revision === previousRevision ? 'pending' : 'failure';
}
