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
  referenceBackgroundDataUrl?: string;
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
  luminance: number[];
}

export interface SliderActivatorSnapshot {
  provider: 'geetest' | 'geetest-v4' | 'generic';
  rect: SliderRect;
}

export type SliderChallengeDiscovery =
  | { state: 'ready'; challenge: SliderChallengeSnapshot }
  | { state: 'activatable'; activator: SliderActivatorSnapshot }
  | { state: 'not-found' | 'ambiguous' | 'unsupported' };

export function sliderDiscoveryKey(discovery: SliderChallengeDiscovery): string | undefined {
  if (discovery.state === 'ready') return `ready|${discovery.challenge.revision}`;
  if (discovery.state !== 'activatable') return undefined;
  return `activatable|${discovery.activator.provider}|${rounded(discovery.activator.rect)}`;
}

const HANDLE_HINT_SELECTORS = [
  '[data-slider-handle]',
  '[role="slider"]',
  '[draggable="true"]',
  '[class*="slider"]',
  '[class*="slide"]',
  '[class*="drag"]',
  '[class*="handle"]',
  '[class*="thumb"]',
];

const TRACK_HINT_SELECTORS = [
  '[data-slider-track]',
  '[class*="track"]',
  '[class*="rail"]',
  '[class*="control"]',
  '[class*="bar"]',
  '[class*="slider"]',
  '[class*="slide"]',
  '[class*="drag"]',
];

const IMAGE_HINT_SELECTORS = [
  '[data-slider-image]',
  'canvas',
  'img',
  '[class*="background"]',
  '[class*="bg"]',
  '[class*="image"]',
  '[class*="picture"]',
];

const PIECE_HINT_SELECTORS = [
  '[data-slider-piece]',
  '[class*="piece"]',
  '[class*="jigsaw"]',
  '[class*="slice"]',
  '[class*="puzzle"]',
];

const ACTIVATOR_CANDIDATE_SELECTORS = [
  '[data-slider-activator]',
  'button',
  '[role="button"]',
  '[class*="button"]',
  '[class*="btn"]',
  '[class*="trigger"]',
  '[class*="radar"]',
];

const TRACK_CONTROL_SELECTOR = 'button, [role="button"], [draggable="true"], [class*="button"], [class*="btn"], [class*="handle"], [class*="thumb"]';
const HANDLE_SEMANTIC_PATTERN = /(^|[-_\s])(slider|slide|drag|handle|thumb)([-_\s]|$)/i;
const HANDLE_CONTROL_PATTERN = /(^|[-_\s])(handle|thumb|button|btn)([-_\s]|$)/i;
const NON_HANDLE_LAYER_PATTERN = /(^|[-_\s])(indicator|progress|fill|track|rail)([-_\s]|$)/i;
const TRACK_SEMANTIC_PATTERN = /(^|[-_\s])(track|rail|control|bar|slider|slide|drag)([-_\s]|$)/i;
const PIECE_SEMANTIC_PATTERN = /(^|[-_\s])(piece|jigsaw|slice)([-_\s]|$)/i;
const ACTIVATION_ACTION_PATTERN = /(verify|verification|slide|drag|swipe|radar|验证|校验|滑动|拖动)/i;
const INACTIVE_CONTROL_PATTERN = /(success|passed|complete|error|fail|disabled|成功|完成|失败|禁用)/i;

function rectFor(element: Element): SliderRect | undefined {
  const rect = element.getBoundingClientRect();
  const style = getComputedStyle(element);
  if (rect.width < 1 || rect.height < 1 || style.display === 'none' || style.visibility === 'hidden' || (style.opacity !== '' && Number(style.opacity) === 0)) return undefined;
  if (rect.right <= 0 || rect.bottom <= 0 || rect.left >= innerWidth || rect.top >= innerHeight) return undefined;
  return { x: rect.left, y: rect.top, width: rect.width, height: rect.height };
}

function containsRect(outer: SliderRect, inner: SliderRect, tolerance = 2): boolean {
  return inner.x >= outer.x - tolerance && inner.y >= outer.y - tolerance &&
    inner.x + inner.width <= outer.x + outer.width + tolerance &&
    inner.y + inner.height <= outer.y + outer.height + tolerance;
}

function handleSized(rect: SliderRect | undefined): rect is SliderRect {
  return rect !== undefined && rect.width >= 18 && rect.width <= 100 && rect.height >= 18 && rect.height <= 100 && rect.width / rect.height >= .45 && rect.width / rect.height <= 2.2;
}

function hintedElements(root: ParentNode, selectors: readonly string[]): Set<Element> {
  return new Set(selectors.flatMap((selector) => [...root.querySelectorAll(selector)]));
}

function semanticValue(element: Element): string {
  return `${element.id} ${element.getAttribute('class') ?? ''} ${element.getAttribute('aria-label') ?? ''}`;
}

function handleHinted(element: Element): boolean {
  if (element.hasAttribute('data-slider-handle') || element.getAttribute('role') === 'slider' || element.getAttribute('draggable') === 'true') return true;
  const value = semanticValue(element);
  return HANDLE_SEMANTIC_PATTERN.test(value) && (!NON_HANDLE_LAYER_PATTERN.test(value) || HANDLE_CONTROL_PATTERN.test(value));
}

function trackHinted(element: Element): boolean {
  return element.hasAttribute('data-slider-track') || TRACK_SEMANTIC_PATTERN.test(semanticValue(element));
}

function handleCandidates(root: ParentNode): Element[] {
  const candidates = new Set([...hintedElements(root, HANDLE_HINT_SELECTORS)].filter(handleHinted));
  for (const track of [...hintedElements(root, TRACK_HINT_SELECTORS)].filter(trackHinted)) {
    for (const control of track.querySelectorAll(TRACK_CONTROL_SELECTOR)) candidates.add(control);
  }
  const sized = [...candidates].filter((element) => handleSized(rectFor(element)));
  return sized.filter((element) => !sized.some((ancestor) => ancestor !== element && ancestor.contains(element)));
}

function challengeRoot(handle: Element): Element | undefined {
  const explicit = handle.closest('[data-slider-captcha]');
  if (explicit !== null) return explicit;
  const handleRect = rectFor(handle);
  if (handleRect === undefined) return undefined;
  let current: Element | null = handle;
  for (let depth = 0; depth < 10 && current !== null; depth += 1, current = current.parentElement) {
    const hasRelatedImage = [...hintedElements(current, IMAGE_HINT_SELECTORS)].some((element) => {
      const imageRect = rectFor(element);
      if (imageRect === undefined || imageRect.width < 160 || imageRect.height < 80) return false;
      const horizontalOverlap = Math.min(imageRect.x + imageRect.width, handleRect.x + handleRect.width) - Math.max(imageRect.x, handleRect.x);
      return horizontalOverlap > 0 && imageRect.y + imageRect.height <= handleRect.y + handleRect.height + 16;
    });
    if (hasRelatedImage) return current;
  }
  return undefined;
}

function boundingRect(rects: readonly SliderRect[]): SliderRect {
  const left = Math.min(...rects.map((rect) => rect.x));
  const top = Math.min(...rects.map((rect) => rect.y));
  const right = Math.max(...rects.map((rect) => rect.x + rect.width));
  const bottom = Math.max(...rects.map((rect) => rect.y + rect.height));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

function challengeRectFor(root: Element, image: SliderRect, track: SliderRect, handle: SliderRect): SliderRect {
  const rootRect = rectFor(root);
  return rootRect !== undefined && containsRect(rootRect, image, 8) && containsRect(rootRect, track, 8)
    ? rootRect
    : boundingRect([image, track, handle]);
}

function trackFor(root: Element, handle: Element, handleRect: SliderRect): { element: Element; rect: SliderRect } | undefined {
  const handleCenter = { x: handleRect.x + handleRect.width / 2, y: handleRect.y + handleRect.height / 2 };
  const elements = new Set([...hintedElements(root, TRACK_HINT_SELECTORS)].filter(trackHinted));
  for (let ancestor = handle.parentElement; ancestor !== null && ancestor !== root; ancestor = ancestor.parentElement) {
    if (trackHinted(ancestor)) elements.add(ancestor);
  }
  return [...elements]
    .filter((element) => element !== handle)
    .map((element) => ({ element, rect: rectFor(element) }))
    .filter((entry): entry is { element: Element; rect: SliderRect } => entry.rect !== undefined &&
      entry.rect.width >= Math.max(120, handleRect.width * 3) && entry.rect.height <= Math.max(80, handleRect.height * 2.5) &&
      handleCenter.x >= entry.rect.x - 8 && handleCenter.x <= entry.rect.x + entry.rect.width + 8 &&
      handleCenter.y >= entry.rect.y - 8 && handleCenter.y <= entry.rect.y + entry.rect.height + 8)
    .sort((left, right) => {
      const leftContainment = left.element.contains(handle) ? 0 : 1;
      const rightContainment = right.element.contains(handle) ? 0 : 1;
      if (leftContainment !== rightContainment) return leftContainment - rightContainment;
      const leftCenter = Math.abs(left.rect.y + left.rect.height / 2 - handleCenter.y);
      const rightCenter = Math.abs(right.rect.y + right.rect.height / 2 - handleCenter.y);
      return leftCenter - rightCenter || right.rect.width - left.rect.width;
    })[0];
}

function imageFor(root: Element, trackRect: SliderRect): { element: Element; rect: SliderRect } | undefined {
  return [...hintedElements(root, IMAGE_HINT_SELECTORS)]
    .map((element) => ({ element, rect: rectFor(element) }))
    .filter((entry): entry is { element: Element; rect: SliderRect } => entry.rect !== undefined &&
      entry.rect.width >= 160 && entry.rect.height >= 80 && entry.rect.y + entry.rect.height <= trackRect.y + 8 && entry.rect.width >= trackRect.width * .65)
    .sort((left, right) => {
      const sourcePriority = (element: Element) => {
        if (element.hasAttribute('data-slider-image')) return 4;
        if (element.classList.contains('geetest_canvas_bg')) return 3;
        if (element.classList.contains('geetest_canvas_fullbg') || PIECE_SEMANTIC_PATTERN.test(semanticValue(element))) return 1;
        return element instanceof HTMLCanvasElement || element instanceof HTMLImageElement ? 2 : 1;
      };
      return sourcePriority(right.element) - sourcePriority(left.element) || right.rect.width * right.rect.height - left.rect.width * left.rect.height;
    })[0];
}

interface PieceLayerCandidate {
  element: Element;
  rect: SliderRect;
  rectIsPiece: boolean;
}

function pieceCandidates(root: Element, imageRect: SliderRect): PieceLayerCandidate[] {
  return [...hintedElements(root, PIECE_HINT_SELECTORS)]
    .map((element) => ({ element, rect: rectFor(element) }))
    .filter((entry): entry is { element: Element; rect: SliderRect } => entry.rect !== undefined && entry.rect.width >= 20 && entry.rect.height >= 20 && containsRect(imageRect, entry.rect, 8))
    .map(({ element, rect }) => {
      const explicit = element.hasAttribute('data-slider-piece');
      const rectIsPiece = explicit || (rect.width <= imageRect.width * .45 && rect.height <= imageRect.height * .7);
      const maskLayer = PIECE_SEMANTIC_PATTERN.test(semanticValue(element)) && (element instanceof HTMLCanvasElement || element instanceof HTMLImageElement || rasterSource(element) !== undefined);
      return { element, rect, rectIsPiece, usable: rectIsPiece || maskLayer };
    })
    .filter((entry) => entry.usable)
    .sort((left, right) => Number(right.rectIsPiece) - Number(left.rectIsPiece) || left.rect.width * left.rect.height - right.rect.width * right.rect.height)
    .map(({ element, rect, rectIsPiece }) => ({ element, rect, rectIsPiece }));
}

async function pixelsForPiece(element: Element): Promise<ImageData | undefined> {
  try {
    if (element instanceof HTMLCanvasElement) return element.getContext('2d', { willReadFrequently: true })?.getImageData(0, 0, element.width, element.height);
    const source = rasterSource(element);
    if (source === undefined) return undefined;
    const bitmap = await createImageBitmap(await (await fetch(source)).blob());
    try {
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (context === null) return undefined;
      context.drawImage(bitmap, 0, 0);
      return context.getImageData(0, 0, bitmap.width, bitmap.height);
    } finally { bitmap.close(); }
  } catch { return undefined; }
}

function rasterSource(element: Element): string | undefined {
  if (element instanceof HTMLImageElement) return element.currentSrc || element.getAttribute('src') || undefined;
  return getComputedStyle(element).backgroundImage.match(/url\(["']?(.*?)["']?\)/)?.[1];
}

async function backgroundDataUrlFor(element: Element): Promise<string | undefined> {
  try {
    if (element instanceof HTMLCanvasElement) return element.toDataURL('image/png');
    const source = rasterSource(element);
    if (source === undefined || source.startsWith('data:')) return source;
    const blob = await (await fetch(source)).blob();
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('Invalid image data'));
      reader.onerror = () => reject(reader.error ?? new Error('Image read failed'));
      reader.readAsDataURL(blob);
    });
  } catch { return undefined; }
}

function matchingReferenceBackground(root: Element, image: { element: Element; rect: SliderRect }): Element | undefined {
  const candidate = root.querySelector('.geetest_canvas_fullbg');
  if (candidate === null || candidate === image.element) return undefined;
  const rect = candidate.getBoundingClientRect();
  const style = getComputedStyle(candidate);
  if (rect.width < 1 || rect.height < 1 || style.display === 'none') return undefined;
  const sameGeometry = Math.abs(rect.left - image.rect.x) <= 2 && Math.abs(rect.top - image.rect.y) <= 2 &&
    Math.abs(rect.width - image.rect.width) <= 2 && Math.abs(rect.height - image.rect.height) <= 2;
  return sameGeometry ? candidate : undefined;
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
  const luminance = new Array<number>(width * height);
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    const source = ((minimumY + y) * pixels.width + minimumX + x) * 4;
    alpha[y * width + x] = pixels.data[source + 3]!;
    luminance[y * width + x] = pixels.data[source]! * .2126 + pixels.data[source + 1]! * .7152 + pixels.data[source + 2]! * .0722;
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
    luminance,
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

function fingerprintText(value: string): string {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function fingerprintNumbers(values: readonly number[]): string {
  let hash = 2_166_136_261;
  for (const value of values) {
    hash ^= Math.round(value) & 255;
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

async function snapshotForHandle(handle: Element): Promise<SliderChallengeSnapshot | undefined> {
  const handleRect = rectFor(handle);
  if (!handleSized(handleRect)) return undefined;
  const root = challengeRoot(handle);
  if (root === undefined) return undefined;
  const track = trackFor(root, handle, handleRect);
  if (track === undefined) return undefined;
  const image = imageFor(root, track.rect);
  if (image === undefined) return undefined;
  const challenge = challengeRectFor(root, image.rect, track.rect, handleRect);
  if (track.rect.width <= handleRect.width || Math.abs(track.rect.y + track.rect.height / 2 - (handleRect.y + handleRect.height / 2)) > Math.max(track.rect.height, handleRect.height)) return undefined;
  const provider = providerFor(root);
  const backgroundDataUrl = await backgroundDataUrlFor(image.element);
  const referenceElement = matchingReferenceBackground(root, image);
  const referenceBackgroundDataUrl = referenceElement === undefined ? undefined : await backgroundDataUrlFor(referenceElement);
  let pieceLayer: PieceLayerCandidate | undefined;
  let pieceMask: SliderPieceMask | undefined;
  for (const candidate of pieceCandidates(root, image.rect)) {
    const candidateMask = await maskForPiece(candidate, image.rect);
    if (candidateMask !== undefined) {
      pieceLayer = candidate;
      pieceMask = candidateMask;
      break;
    }
    if (pieceLayer === undefined && candidate.rectIsPiece) pieceLayer = candidate;
  }
  const piece = pieceMask === undefined ? pieceLayer?.rect : {
    x: image.rect.x + pieceMask.offsetX,
    y: image.rect.y + pieceMask.offsetY,
    width: pieceMask.width,
    height: pieceMask.height,
  };
  const backgroundFingerprint = fingerprintText(`${backgroundDataUrl ?? imageRevision(image.element)}|${referenceBackgroundDataUrl ?? ''}`);
  const pieceFingerprint = pieceMask === undefined
    ? piece === undefined ? '' : `${Math.round(piece.width)}:${Math.round(piece.height)}`
    : `${pieceMask.alphaWidth}:${pieceMask.alphaHeight}:${fingerprintNumbers(pieceMask.alpha)}:${fingerprintNumbers(pieceMask.luminance)}`;
  const revision = [provider, backgroundFingerprint, pieceFingerprint].join('|');
  return {
    revision,
    provider,
    challenge,
    image: image.rect,
    ...(backgroundDataUrl === undefined ? {} : { backgroundDataUrl }),
    ...(referenceBackgroundDataUrl === undefined ? {} : { referenceBackgroundDataUrl }),
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
  const semanticSignal = `${element.id} ${element.className}`;
  const contentSignal = `${element.getAttribute('aria-label') ?? ''} ${element.getAttribute('title') ?? ''} ${element.textContent ?? ''}`;
  if (!element.hasAttribute('data-slider-activator') && !ACTIVATION_ACTION_PATTERN.test(contentSignal) &&
    (!ACTIVATION_ACTION_PATTERN.test(semanticSignal) || INACTIVE_CONTROL_PATTERN.test(semanticSignal))) return undefined;
  return { provider: providerFor(element), rect };
}

function activatorForHandle(handle: Element): SliderActivatorSnapshot | undefined {
  const handleRect = rectFor(handle);
  if (!handleSized(handleRect)) return undefined;
  let current = handle.parentElement;
  for (let depth = 0; depth < 5 && current !== null; depth += 1, current = current.parentElement) {
    const rect = rectFor(current);
    const signal = `${semanticValue(current)} ${current.textContent ?? ''}`;
    if (rect !== undefined && trackHinted(current) && rect.width >= Math.max(120, handleRect.width * 3) && rect.height <= Math.max(100, handleRect.height * 2.5) &&
      containsRect(rect, handleRect, 8) && ACTIVATION_ACTION_PATTERN.test(signal)) {
      return { provider: providerFor(current), rect: handleRect };
    }
  }
  return undefined;
}

function handleActivatorCandidates(root: ParentNode): SliderActivatorSnapshot[] {
  const activators = new Map<string, SliderActivatorSnapshot>();
  for (const handle of handleCandidates(root)) {
    const activator = activatorForHandle(handle);
    if (activator !== undefined) activators.set(`${activator.provider}|${rounded(activator.rect)}`, activator);
  }
  return [...activators.values()];
}

function activatorElements(root: ParentNode): { element: Element; activator: SliderActivatorSnapshot }[] {
  const candidates: { element: Element; activator: SliderActivatorSnapshot }[] = [];
  for (const element of hintedElements(root, ACTIVATOR_CANDIDATE_SELECTORS)) {
    const activator = activatorFor(element);
    if (activator !== undefined) candidates.push({ element, activator });
  }
  return candidates.filter((candidate) => !candidates.some((outer) => outer.element !== candidate.element && outer.element.contains(candidate.element)));
}

function activatorCandidates(root: ParentNode): SliderActivatorSnapshot[] {
  const activators = new Map<string, SliderActivatorSnapshot>();
  for (const { activator } of activatorElements(root)) activators.set(`${activator.provider}|${rounded(activator.rect)}`, activator);
  return [...activators.values()];
}

export function visibleSliderInteractionTarget(root: ParentNode = document): Element | undefined {
  const handles = handleCandidates(root);
  for (const handle of handles) {
    const handleRect = rectFor(handle);
    const challenge = challengeRoot(handle);
    if (!handleSized(handleRect) || challenge === undefined) continue;
    const track = trackFor(challenge, handle, handleRect);
    if (track !== undefined && imageFor(challenge, track.rect) !== undefined) return handle;
  }
  for (const handle of handles) if (activatorForHandle(handle) !== undefined) return handle;
  const activator = activatorElements(root)[0];
  if (activator !== undefined) return activator.element;
  return undefined;
}

export async function discoverSliderChallenge(root: ParentNode = document): Promise<SliderChallengeDiscovery> {
  const snapshots = (await Promise.all(handleCandidates(root).map(snapshotForHandle))).filter((value): value is SliderChallengeSnapshot => value !== undefined);
  const uniqueCandidates = new Map<string, SliderChallengeSnapshot>();
  for (const snapshot of snapshots) {
    const key = [rounded(snapshot.challenge), rounded(snapshot.image), rounded(snapshot.track)].join('|');
    const existing = uniqueCandidates.get(key);
    if (existing === undefined || snapshot.handle.width * snapshot.handle.height > existing.handle.width * existing.handle.height) uniqueCandidates.set(key, snapshot);
  }
  const candidates = [...uniqueCandidates.values()];
  if (candidates.length === 1) return { state: 'ready', challenge: candidates[0]! };
  if (candidates.length > 1) return { state: 'ambiguous' };
  const handleActivators = handleActivatorCandidates(root);
  if (handleActivators.length === 1) return { state: 'activatable', activator: handleActivators[0]! };
  if (handleActivators.length > 1) return { state: 'ambiguous' };
  const activators = activatorCandidates(root);
  if (activators.length === 1) return { state: 'activatable', activator: activators[0]! };
  return { state: activators.length > 1 ? 'ambiguous' : 'not-found' };
}

export type SliderOutcome = 'success' | 'failure' | 'pending' | 'absent' | 'uncertain';

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
  if (current.state === 'not-found') return 'absent';
  if (current.state !== 'ready') return 'uncertain';
  return current.challenge.revision === previousRevision ? 'pending' : 'failure';
}
