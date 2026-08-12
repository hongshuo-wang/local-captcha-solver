export interface SliderRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SliderChallengeSnapshot {
  revision: string;
  provider: 'geetest-v4' | 'generic';
  challenge: SliderRect;
  image: SliderRect;
  track: SliderRect;
  handle: SliderRect;
  viewport: { width: number; height: number; devicePixelRatio: number };
}

export type SliderChallengeDiscovery =
  | { state: 'ready'; challenge: SliderChallengeSnapshot }
  | { state: 'not-found' | 'ambiguous' | 'unsupported' };

const HANDLE_SELECTORS = [
  '[data-slider-handle]',
  '.geetest_btn',
  '.geetest_slider_button',
  '[class*="geetest"][class*="button"]',
  '[class*="slider"][class*="button"]',
  '[class*="slider"][class*="handle"]',
  '[class*="slide"][class*="button"]',
  '[role="slider"]',
];

const TRACK_SELECTORS = [
  '[data-slider-track]',
  '.geetest_track',
  '.geetest_slider',
  '[class*="slider"][class*="track"]',
  '[class*="slide"][class*="track"]',
  '[class*="slider"]',
];

const IMAGE_SELECTORS = [
  '[data-slider-image]',
  '.geetest_bg',
  '.geetest_canvas_bg',
  '[class*="geetest"][class*="bg"]',
  'canvas',
  'img',
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
  for (let depth = 0; depth < 7 && current !== null; depth += 1, current = current.parentElement) {
    const rect = rectFor(current);
    if (rect !== undefined && rect.width >= 180 && rect.height >= 120 && current.querySelector('canvas, img, [class*="bg"]') !== null) return current;
  }
  return undefined;
}

function largestVisible(root: Element, selectors: readonly string[], predicate: (rect: SliderRect) => boolean): { element: Element; rect: SliderRect } | undefined {
  return selectors
    .flatMap((selector) => [...root.querySelectorAll(selector)])
    .map((element) => ({ element, rect: rectFor(element) }))
    .filter((entry): entry is { element: Element; rect: SliderRect } => entry.rect !== undefined && predicate(entry.rect))
    .sort((left, right) => right.rect.width * right.rect.height - left.rect.width * left.rect.height)[0];
}

function trackFor(root: Element, handleRect: SliderRect): { element: Element; rect: SliderRect } | undefined {
  const matched = largestVisible(root, TRACK_SELECTORS, (rect) =>
    rect.width >= handleRect.width * 3 && rect.height <= Math.max(80, handleRect.height * 2.5) && containsRect(rect, handleRect),
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

function identity(root: Element): 'geetest-v4' | 'generic' {
  const value = `${root.id} ${root.className} ${root.getAttribute('data-provider') ?? ''}`.toLowerCase();
  return value.includes('geetest') ? 'geetest-v4' : 'generic';
}

function rounded(rect: SliderRect): string {
  return [rect.x, rect.y, rect.width, rect.height].map((value) => Math.round(value * 10) / 10).join(':');
}

function snapshotForHandle(handle: Element): SliderChallengeSnapshot | undefined {
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
  const provider = identity(root);
  const revision = [provider, rounded(challenge), rounded(image.rect), rounded(track.rect), rounded(handleRect), image.element.getAttribute('src') ?? '', root.textContent?.trim().slice(0, 80) ?? ''].join('|');
  return {
    revision,
    provider,
    challenge,
    image: image.rect,
    track: track.rect,
    handle: handleRect,
    viewport: { width: innerWidth, height: innerHeight, devicePixelRatio },
  };
}

export function discoverSliderChallenge(root: ParentNode = document): SliderChallengeDiscovery {
  const handles = new Set<Element>();
  for (const selector of HANDLE_SELECTORS) root.querySelectorAll(selector).forEach((element) => handles.add(element));
  const candidates = [...handles].map(snapshotForHandle).filter((value): value is SliderChallengeSnapshot => value !== undefined);
  const unique = new Map(candidates.map((candidate) => [candidate.revision, candidate]));
  if (unique.size === 0) return { state: 'not-found' };
  if (unique.size > 1) return { state: 'ambiguous' };
  return { state: 'ready', challenge: [...unique.values()][0]! };
}

export type SliderOutcome = 'success' | 'failure' | 'pending' | 'uncertain';

export function observeSliderOutcome(previousRevision: string, root: ParentNode = document): SliderOutcome {
  const text = root instanceof Document ? root.body?.innerText ?? '' : root.textContent ?? '';
  if (/(验证成功|校验成功|success|verified|passed)/i.test(text)) return 'success';
  if (/(验证失败|请重试|再试一次|failed|try again|retry)/i.test(text)) return 'failure';
  const current = discoverSliderChallenge(root);
  if (current.state === 'not-found') return 'success';
  if (current.state !== 'ready') return 'uncertain';
  return current.challenge.revision === previousRevision ? 'pending' : 'failure';
}
