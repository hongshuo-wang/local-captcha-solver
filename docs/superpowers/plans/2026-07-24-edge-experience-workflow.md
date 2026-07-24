# Edge Experience Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an unpacked Edge extension that automatically recognizes `<img>` CAPTCHAs on explicitly enabled hostnames and supports image right-click recognition, then safely fills the matched empty input without submitting the form.

**Architecture:** Pure core modules score images and fields. A runtime content script owns DOM discovery, revision tracking, safe filling, and status UI; the service worker owns permissions, registration, context-menu routing, and an offscreen ONNX inference host. The popup only toggles current-site automation and reports status.

**Tech Stack:** TypeScript 5.9, WXT 0.20, Manifest V3, `onnxruntime-web`, Vitest with Happy DOM, Playwright Chromium extension tests.

---

## File Map

- `src/core/candidate-scorer.ts`: pure CAPTCHA image evidence scoring.
- `src/core/field-matcher.ts`: pure field eligibility, ranking, and ambiguity policy.
- `src/core/confidence-policy.ts`: centralized experience-build OCR fill thresholds.
- `src/platform/settings-store.ts`: versioned exact-hostname allowlist persistence.
- `src/platform/permissions.ts`: URL-to-origin permission decisions and enable/disable transaction.
- `src/ocr/protocol.ts`: runtime-validated inference message contracts.
- `src/background/inference-host.ts`: single-flight offscreen-document lifecycle and request routing.
- `entrypoints/offscreen.html`, `entrypoints/offscreen.ts`: extension-owned reusable ONNX session.
- `src/content/dom-snapshot.ts`: converts DOM elements into scorer/matcher inputs.
- `src/content/image-source.ts`: bounded, permission-aware image byte acquisition.
- `src/content/field-fill.ts`: native-setter filling with no overwrite and no submit behavior.
- `src/content/workflow.ts`: recognition orchestration and stale-result protection.
- `src/content/observer.ts`: debounced initial scan and image refresh detection.
- `src/content/status-ui.ts`: temporary accessible page status.
- `entrypoints/content.ts`: runtime content-script composition and message handling.
- `src/background/content-registration.ts`: exact-host dynamic content-script registration.
- `src/background/context-menu.ts`: image-only menu creation and click routing.
- `entrypoints/background.ts`: composes background services.
- `src/popup/controller.ts`, `entrypoints/popup/*`: current-site toggle and status UI.
- `tests/core/*`, `tests/platform/*`, `tests/ocr/protocol.test.ts`, `tests/content/*`: focused unit and integration tests.
- `tests/e2e/*`: built-extension fixtures and end-to-end safety checks.
- `README.md`: unpacked Edge installation, scope, privacy, and measured limitations.

## Task 1: Score CAPTCHA Images and Match Empty Fields

**Files:**
- Create: `src/core/candidate-scorer.ts`
- Create: `src/core/field-matcher.ts`
- Test: `tests/core/candidate-scorer.test.ts`
- Test: `tests/core/field-matcher.test.ts`

- [ ] **Step 1: Write failing candidate-scoring tests**

Cover positive attribute/nearby text, compact dimensions, same-form proximity, and negative logo/avatar/large-image evidence.

```ts
import { describe, expect, it } from 'vitest';
import { AUTOMATIC_CANDIDATE_THRESHOLD, scoreCaptchaCandidate } from '../../src/core/candidate-scorer';

describe('scoreCaptchaCandidate', () => {
  it('accepts compact verification images near a short input', () => {
    const result = scoreCaptchaCandidate({
      attrText: 'login captcha verification code',
      nearbyText: 'Enter the code',
      width: 120,
      height: 40,
      inForm: true,
      nearShortInput: true,
    });
    expect(result.score).toBeGreaterThanOrEqual(AUTOMATIC_CANDIDATE_THRESHOLD);
  });

  it('rejects large branding images', () => {
    const result = scoreCaptchaCandidate({
      attrText: 'brand logo', nearbyText: '', width: 600, height: 240,
      inForm: false, nearShortInput: false,
    });
    expect(result.score).toBeLessThan(AUTOMATIC_CANDIDATE_THRESHOLD);
  });
});
```

- [ ] **Step 2: Write failing field-match tests**

```ts
import { matchCaptchaField } from '../../src/core/field-matcher';

it('chooses one nearby empty text field', () => {
  const result = matchCaptchaField(image, [nearEmptyText, farEmptyText]);
  expect(result.state).toBe('unique');
  if (result.state === 'unique') expect(result.winner.id).toBe('captcha-answer');
});

it.each([passwordField, readonlyField, disabledField, nonEmptyField])(
  'excludes an unsafe automatic target',
  (field) => expect(matchCaptchaField(image, [field]).state).toBe('none'),
);

it('returns ambiguous instead of guessing a tie', () => {
  expect(matchCaptchaField(image, [leftTie, rightTie]).state).toBe('ambiguous');
});
```

- [ ] **Step 3: Run the focused tests and verify they fail**

Run: `npm test -- tests/core/candidate-scorer.test.ts tests/core/field-matcher.test.ts`

Expected: FAIL because the two modules do not exist.

- [ ] **Step 4: Implement pure scoring and matching**

Export `AUTOMATIC_CANDIDATE_THRESHOLD = 70`, `UNIQUE_FIELD_THRESHOLD = 60`, and `UNIQUE_FIELD_MARGIN = 15`. Return numeric scores and reason arrays. Field matching must exclude invisible, non-editable, non-text-like, and non-empty inputs before ranking.

```ts
export interface CandidateSnapshot {
  attrText: string;
  nearbyText: string;
  width: number;
  height: number;
  inForm: boolean;
  nearShortInput: boolean;
}

export interface FieldSnapshot {
  id: string;
  type: string;
  value: string;
  visible: boolean;
  disabled: boolean;
  readOnly: boolean;
  distance: number;
  sameForm: boolean;
  labelText: string;
}
```

- [ ] **Step 5: Run tests and commit**

Run: `npm test -- tests/core/candidate-scorer.test.ts tests/core/field-matcher.test.ts && npm run typecheck`

Expected: PASS.

```bash
git add src/core/candidate-scorer.ts src/core/field-matcher.ts tests/core/candidate-scorer.test.ts tests/core/field-matcher.test.ts
git commit -m "feat: score captcha images and fields"
```

## Task 2: Add Exact-Hostname Settings and Permissions

**Files:**
- Create: `src/platform/browser-adapter.ts`
- Create: `src/platform/settings-store.ts`
- Create: `src/platform/permissions.ts`
- Test: `tests/platform/settings-store.test.ts`
- Test: `tests/platform/permissions.test.ts`
- Test: `tests/platform/import-boundary.test.ts`

- [ ] **Step 1: Write failing settings tests**

```ts
it('normalizes case while keeping subdomains separate', async () => {
  const store = createSettingsStore(memoryStorage());
  await store.enable('Portal.Example.com');
  expect(await store.isEnabled('portal.example.com')).toBe(true);
  expect(await store.isEnabled('www.portal.example.com')).toBe(false);
});

it('recovers corrupt storage to an empty versioned state', async () => {
  const store = createSettingsStore(memoryStorage({ captchaSettings: { broken: true } }));
  expect(await store.read()).toEqual({ version: 1, allowlistedHosts: [] });
});
```

- [ ] **Step 2: Write failing permission transaction tests**

Verify enabling requests exactly `http://host/*` and `https://host/*`, persists only after permission succeeds, and leaves storage unchanged on denial. Verify disabling removes storage first, then attempts permission removal without restoring a disabled hostname if removal fails.

```ts
expect(originsForPage('https://portal.example.com/login')).toEqual([
  'http://portal.example.com/*',
  'https://portal.example.com/*',
]);
```

- [ ] **Step 3: Verify the tests fail**

Run: `npm test -- tests/platform/settings-store.test.ts tests/platform/permissions.test.ts tests/platform/import-boundary.test.ts`

Expected: FAIL with unresolved imports.

- [ ] **Step 4: Implement adapters, versioned storage, and permission transactions**

```ts
export interface BrowserAdapter {
  getLocal<T>(key: string): Promise<T | undefined>;
  setLocal<T>(key: string, value: T): Promise<void>;
  requestOrigins(origins: readonly string[]): Promise<boolean>;
  removeOrigins(origins: readonly string[]): Promise<boolean>;
}

export interface CaptchaSettings {
  version: 1;
  allowlistedHosts: string[];
}
```

Reject non-HTTP(S) page URLs and hostnames containing credentials, paths, wildcards, or invalid URL syntax. Keep `wxt/browser` imports in entrypoints/background adapters; `src/core` and browser-independent OCR modules must remain browser-API free.

- [ ] **Step 5: Run tests and commit**

Run: `npm test -- tests/platform && npm run typecheck`

Expected: PASS.

```bash
git add src/platform tests/platform
git commit -m "feat: store site automation permissions"
```

## Task 3: Host OCR in an Offscreen Extension Document

**Files:**
- Create: `src/ocr/protocol.ts`
- Create: `src/background/inference-host.ts`
- Create: `entrypoints/offscreen.html`
- Create: `entrypoints/offscreen.ts`
- Test: `tests/ocr/protocol.test.ts`
- Test: `tests/background/inference-host.test.ts`
- Modify: `entrypoints/background.ts`

- [ ] **Step 1: Write failing protocol tests**

Test valid requests and reject missing IDs, non-image payloads, unknown modes, duplicate modes, empty mode arrays, oversized data URLs, and response/request ID mismatches.

```ts
export type InferenceRequest = {
  type: 'ocr:recognize';
  requestId: string;
  imageRevision: string;
  imageDataUrl: string;
  modes: RecognitionMode[];
};

export type InferenceResponse =
  | { type: 'ocr:result'; requestId: string; imageRevision: string; results: OcrResult[] }
  | { type: 'ocr:error'; requestId: string; imageRevision: string; code: OcrRuntimeErrorCode };
```

- [ ] **Step 2: Write failing single-flight host tests**

Verify two concurrent requests cause one offscreen creation, an existing document is reused, a creation failure clears the shared promise, and only a matching validated response resolves the request.

- [ ] **Step 3: Verify the tests fail**

Run: `npm test -- tests/ocr/protocol.test.ts tests/background/inference-host.test.ts`

Expected: FAIL with unresolved imports.

- [ ] **Step 4: Implement runtime guards and offscreen lifecycle**

The host must create `offscreen.html` lazily with the `WORKERS` reason and a local OCR justification. The offscreen entrypoint sets `ort.env.wasm.wasmPaths` to `browser.runtime.getURL('/ort/')`, sets `ort.env.wasm.numThreads = 1`, loads `/models/common_old.json` and `/models/common_old.onnx`, and constructs one reusable `DdddOcrEngine`.

```ts
const enginePromise = createEngine();
browser.runtime.onMessage.addListener(async (message) => {
  if (!isInferenceRequest(message)) return undefined;
  try {
    return successResponse(message, await (await enginePromise).recognize(payload(message), message.modes));
  } catch (error) {
    return errorResponse(message, mapOcrError(error));
  }
});
```

- [ ] **Step 5: Run tests, build, and inspect required artifacts**

Run:

```bash
npm test -- tests/ocr/protocol.test.ts tests/background/inference-host.test.ts tests/ocr/ddddocr-engine.test.ts
npm run typecheck
npm run build:edge
test -f .output/edge-mv3/offscreen.html
test -f .output/edge-mv3/models/common_old.onnx
test -f .output/edge-mv3/ort/ort-wasm-simd-threaded.wasm
```

Expected: all commands exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/ocr/protocol.ts src/background/inference-host.ts entrypoints/offscreen.html entrypoints/offscreen.ts entrypoints/background.ts tests/ocr/protocol.test.ts tests/background/inference-host.test.ts
git commit -m "feat: run local OCR offscreen"
```

## Task 4: Acquire Images and Fill Fields Safely

**Files:**
- Create: `src/content/image-source.ts`
- Create: `src/content/field-fill.ts`
- Create: `src/background/image-fetch.ts`
- Test: `tests/content/image-source.test.ts`
- Test: `tests/content/field-fill.test.ts`
- Test: `tests/background/image-fetch.test.ts`

- [ ] **Step 1: Write failing field-fill tests**

```ts
it('sets an empty controlled input through its native setter', () => {
  const events: string[] = [];
  input.addEventListener('input', () => events.push('input'));
  input.addEventListener('change', () => events.push('change'));
  expect(fillEmptyField(input, '4821')).toEqual({ state: 'filled' });
  expect(input.value).toBe('4821');
  expect(events).toEqual(['input', 'change']);
});

it('never overwrites or submits', () => {
  input.value = 'user value';
  expect(fillEmptyField(input, '4821')).toEqual({ state: 'not_empty' });
  expect(input.value).toBe('user value');
  expect(submitCount).toBe(0);
});
```

- [ ] **Step 2: Write failing image acquisition and fetch-policy tests**

Cover data URLs, blob URLs, same-origin canvas output, tainted canvas fallback, non-image responses, redirects, bodies over 2 MiB, non-HTTP(S) URLs, and ungranted remote origins.

- [ ] **Step 3: Verify the tests fail**

Run: `npm test -- tests/content/image-source.test.ts tests/content/field-fill.test.ts tests/background/image-fetch.test.ts`

Expected: FAIL with unresolved imports.

- [ ] **Step 4: Implement bounded image acquisition**

Try canvas conversion first. On security failure, request a background fetch only when the URL is HTTP(S) and its origin is already granted. Require `image/*`, reject redirects, stream no more than 2 MiB, and return a data URL plus SHA-256 revision. Do not request new permissions from a background or content-script flow.

```ts
export type ImageAcquisitionResult =
  | { state: 'ready'; dataUrl: string; mimeType: string; revision: string }
  | { state: 'image_unavailable'; reason: 'cors' | 'permission' | 'type' | 'size' | 'network' };
```

- [ ] **Step 5: Implement no-overwrite filling**

Use the setter from `HTMLInputElement.prototype.value`, then dispatch bubbling `input` and `change`. Recheck `isConnected`, eligibility, and `value === ''` immediately before setting. Never create click, key, or submit events.

- [ ] **Step 6: Run tests and commit**

Run: `npm test -- tests/content/image-source.test.ts tests/content/field-fill.test.ts tests/background/image-fetch.test.ts && npm run typecheck`

Expected: PASS.

```bash
git add src/content/image-source.ts src/content/field-fill.ts src/background/image-fetch.ts tests/content tests/background/image-fetch.test.ts
git commit -m "feat: acquire captcha images and fill safely"
```

## Task 5: Orchestrate Automatic Recognition and Refreshes

**Files:**
- Create: `src/core/confidence-policy.ts`
- Create: `src/content/dom-snapshot.ts`
- Create: `src/content/workflow.ts`
- Create: `src/content/observer.ts`
- Create: `src/content/status-ui.ts`
- Create: `entrypoints/content.ts`
- Test: `tests/core/confidence-policy.test.ts`
- Test: `tests/content/dom-snapshot.test.ts`
- Test: `tests/content/workflow.test.ts`
- Test: `tests/content/observer.test.ts`

- [ ] **Step 1: Write failing confidence-policy tests**

Centralize category thresholds without changing the fixed benchmark gate. Digits may auto-fill at `0.90`; letters, alphanumeric, and arithmetic require `0.95` in the experience build. Structurally invalid results never fill.

```ts
expect(canAutoFill({ mode: 'digits', confidence: 0.91, valid: true })).toBe(true);
expect(canAutoFill({ mode: 'letters', confidence: 0.94, valid: true })).toBe(false);
expect(canAutoFill({ mode: 'arithmetic', confidence: 0.99, valid: false })).toBe(false);
```

- [ ] **Step 2: Write failing workflow tests**

Cover one successful image-to-field fill, candidate rejection, ambiguous field, low OCR confidence, differing profile values, no field, acquisition failure, inference failure, source revision change, and a field becoming non-empty during inference.

```ts
it('discards a stale result without touching the field', async () => {
  const pending = workflow.recognize(image, 'automatic');
  image.src = '/captcha-next.png';
  inference.resolve(validDigits('4821', 0.99));
  expect(await pending).toEqual(expect.objectContaining({ state: 'stale' }));
  expect(field.value).toBe('');
});
```

- [ ] **Step 3: Write failing observer tests**

Test initial scan, added images, `src` and `srcset` changes, capture-phase image `load`, a 150 ms per-image debounce, same-revision deduplication, and disconnect on disable.

- [ ] **Step 4: Verify the tests fail**

Run: `npm test -- tests/core/confidence-policy.test.ts tests/content`

Expected: FAIL with unresolved imports.

- [ ] **Step 5: Implement DOM snapshots and workflow state machine**

For each candidate: snapshot image and fields, acquire bytes, send one request with all four recognition modes, interpret results, collapse identical fill values, select the valid highest-confidence result, revalidate image revision and empty field, then fill or return a typed state. Distinct valid values within a `0.10` confidence margin return `needs_confirmation` instead of being guessed.

Extend `WorkflowResult` with `permission_denied` only where needed and keep all results serializable.

- [ ] **Step 6: Implement observer, status UI, and runtime content entrypoint**

`entrypoints/content.ts` uses `defineContentScript({ registration: 'runtime', matches: [], main })`. It accepts `captcha:auto-enable`, `captcha:auto-disable`, `captcha:scan`, `captcha:context-image`, and `captcha:get-status` messages. Status UI uses one fixed-size live region and removes itself after a timeout; it never intercepts page pointer events.

- [ ] **Step 7: Run tests and commit**

Run: `npm test -- tests/core/confidence-policy.test.ts tests/content && npm run typecheck && npm run build:edge`

Expected: PASS; the production manifest has no required blanket `host_permissions` and no static all-sites content script.

```bash
git add src/core/confidence-policy.ts src/content entrypoints/content.ts tests/core/confidence-policy.test.ts tests/content
git commit -m "feat: automate page captcha recognition"
```

## Task 6: Register Enabled Sites and Route the Image Context Menu

**Files:**
- Create: `src/background/content-registration.ts`
- Create: `src/background/context-menu.ts`
- Test: `tests/background/content-registration.test.ts`
- Test: `tests/background/context-menu.test.ts`
- Modify: `entrypoints/background.ts`

- [ ] **Step 1: Write failing registration tests**

Test deterministic registration IDs, one exact hostname with both schemes, duplicate avoidance, startup reconciliation, removal, stale registration cleanup, and disable messages to already-open tabs.

```ts
expect(registrationForHost('portal.example.com')).toEqual({
  id: expect.stringMatching(/^captcha-auto-[a-f0-9]{16}$/),
  matches: ['http://portal.example.com/*', 'https://portal.example.com/*'],
  js: ['content-scripts/content.js'],
  persistAcrossSessions: true,
});
```

- [ ] **Step 2: Write failing context-menu tests**

Verify exactly one image-only item is created. A click must ensure the runtime content script is present under `activeTab`, then route `srcUrl` and frame/tab identity. Unsupported pages and duplicate URL matches return a typed status. The handler must never request new host permission or submit a form.

- [ ] **Step 3: Verify the tests fail**

Run: `npm test -- tests/background/content-registration.test.ts tests/background/context-menu.test.ts`

Expected: FAIL with unresolved imports.

- [ ] **Step 4: Implement registration and context routing**

Use a stable SHA-256-derived registration ID. Reconcile registrations on startup, installation, and settings changes. Context clicks inject `content-scripts/content.js` only if ping fails, then send `captcha:context-image`. The content script resolves the clicked image, chooses a unique nearest empty field, and falls back to `document.activeElement` only when it is an eligible empty input.

- [ ] **Step 5: Compose background services**

`entrypoints/background.ts` must initialize the menu once, reconcile registrations, expose permission/settings messages, route image fetch and inference messages, and isolate each listener behind runtime guards.

- [ ] **Step 6: Run tests and commit**

Run: `npm test -- tests/background tests/platform && npm run typecheck && npm run build:edge`

Expected: PASS.

```bash
git add src/background entrypoints/background.ts tests/background
git commit -m "feat: route automatic and context workflows"
```

## Task 7: Build the Current-Site Popup

**Files:**
- Create: `src/popup/controller.ts`
- Modify: `entrypoints/popup/index.html`
- Modify: `entrypoints/popup/main.ts`
- Create: `entrypoints/popup/style.css`
- Test: `tests/popup/controller.test.ts`

- [ ] **Step 1: Write failing popup-controller tests**

Test current HTTP(S) hostname lookup, enabled/disabled state, permission-first enable, denied permission, disable, latest tab status, loading state, and unsupported browser pages.

```ts
it('persists only after the origin permission is granted', async () => {
  permissions.request.mockResolvedValue(false);
  await controller.setEnabled(true);
  expect(store.enable).not.toHaveBeenCalled();
  expect(view.state).toBe('permission_denied');
});
```

- [ ] **Step 2: Verify the tests fail**

Run: `npm test -- tests/popup/controller.test.ts`

Expected: FAIL with unresolved import.

- [ ] **Step 3: Implement the controller and compact popup**

The popup contains the product name, current hostname, one native checkbox toggle labeled `Automatically recognize on this site`, and one stable status line. It has no upload, paste, drop, manual page scan, result history, or replacement controls.

Use a quiet neutral palette, visible keyboard focus, a minimum 44 px toggle hit area, fixed 340 px width, and no nested cards, gradients, or decorative graphics. Status changes must not resize the control row.

- [ ] **Step 4: Run tests, build, and inspect popup layout**

Run: `npm test -- tests/popup/controller.test.ts && npm run typecheck && npm run build:edge`

Expected: PASS. Open `.output/edge-mv3/popup.html` through a loaded extension and verify no clipping at 340 x 220 CSS pixels and 200% zoom.

- [ ] **Step 5: Commit**

```bash
git add src/popup entrypoints/popup tests/popup
git commit -m "feat: control site automation from popup"
```

## Task 8: Verify the Built Edge Experience End to End

**Files:**
- Create: `tests/e2e/fixtures/server.ts`
- Create: `tests/e2e/fixtures/automatic.html`
- Create: `tests/e2e/fixtures/dynamic.html`
- Create: `tests/e2e/fixtures/ambiguous.html`
- Create: `tests/e2e/extension.spec.ts`
- Modify: `playwright.config.ts`
- Create: `README.md`
- Modify: `docs/progress/2026-07-23-mvp-handoff.md`

- [ ] **Step 1: Add local fixtures with submission traps**

Each fixture records `window.__submitCount` from both `submit` and submit-button click listeners. Use tracked generated digit CAPTCHA assets whose current model prediction is asserted by the OCR unit/benchmark layer. Include a single field, dynamic image refresh, ambiguous fields with a focus fallback, and a pre-filled field.

- [ ] **Step 2: Write failing built-extension tests**

Launch persistent Chromium with `.output/chrome-mv3`. Test current-site enablement, automatic fill, dynamic refresh without overwrite, pre-filled protection, popup disabled state, offline inference, and zero submit count. Exercise context-menu routing at the shared handler boundary because Playwright cannot reliably invoke native browser context menus without a production test hook.

```ts
await expect(page.locator('#captcha-answer')).toHaveValue('4821');
expect(await page.evaluate(() => window.__submitCount)).toBe(0);
```

- [ ] **Step 3: Verify the browser tests fail before the final wiring**

Run: `npm run build && npm run test:e2e`

Expected: FAIL on an unimplemented or incorrectly wired experience behavior, not on fixture startup.

- [ ] **Step 4: Complete only the wiring exposed by the tests**

Fix manifest entrypoints, runtime message routing, permission flow, fixture timing, and status propagation without weakening candidate, field, confidence, stale-result, or no-overwrite safeguards.

- [ ] **Step 5: Document installation and limitations**

README must include Edge `edge://extensions` unpacked installation, the output directory, current-site enablement, image right-click fallback, exact supported CAPTCHA classes, local-only processing, no-submit behavior, cross-origin image limitation, and the latest measured benchmark values. State that 90% remains a release target and the build is for workflow evaluation.

Update the progress handoff to mark the experience workflow complete without marking OCR release gates passed.

- [ ] **Step 6: Run complete verification**

Run:

```bash
npm run typecheck
npm test
npm run build
npm run build:edge
npm run test:e2e
node -e "const fs=require('fs'); for (const p of ['.output/chrome-mv3/manifest.json','.output/edge-mv3/manifest.json']) { const m=JSON.parse(fs.readFileSync(p)); if (m.host_permissions?.length || m.content_scripts?.some(x => x.matches?.includes('<all_urls>'))) process.exit(1) }"
git diff --check
```

Expected: every command exits 0; all unit and browser tests pass; both builds exist; neither manifest requests blanket required host access; `git diff --check` prints nothing.

- [ ] **Step 7: Manually smoke-test Edge**

Load `.output/edge-mv3` in stable Edge. Verify the site toggle, automatic fill on the local fixture, refreshed-image handling, pre-filled protection, image context-menu fill with nearest field, focused-field fallback under ambiguity, popup/status presentation, and zero form submissions. Record browser version and results in the progress handoff without storing CAPTCHA text or form values from real sites.

- [ ] **Step 8: Commit**

```bash
git add tests/e2e playwright.config.ts README.md docs/progress/2026-07-23-mvp-handoff.md
git commit -m "test: verify Edge captcha workflow"
```

## Task 9: Review and Produce the Installable Handoff

**Files:**
- Modify only files required by validated review findings.

- [ ] **Step 1: Request code review**

Invoke `superpowers:requesting-code-review` against the implementation range beginning after commit `80c260b`. Address Critical and Important findings with focused regression tests.

- [ ] **Step 2: Run fresh final verification**

Invoke `superpowers:verification-before-completion`, then rerun:

```bash
npm run typecheck
npm test
npm run build
npm run build:edge
npm run test:e2e
git status --short
```

Expected: all commands exit 0 and the worktree is clean after final commits.

- [ ] **Step 3: Hand off the Edge directory**

Provide the absolute `.output/edge-mv3` path and exact `edge://extensions` loading steps. Report current tested behavior and current measured OCR accuracy separately so the experience build is not presented as release-qualified.
