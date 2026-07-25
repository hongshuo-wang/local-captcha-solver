# Model Status Observability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose one background-owned OCR readiness state through the action badge and popup, with coarse progress, retry, and recent user-facing execution outcomes.

**Architecture:** Add a small `ModelStatusStore` that owns an immutable snapshot and bounded in-memory log. Inject it into the runtime router/background runtime, update it around warmup and recognition, and map snapshots to optional `browser.action` badge calls. Extend the popup with a separate model-status controller/view so existing site permission behavior remains isolated.

**Tech Stack:** TypeScript, Vitest, WXT MV3, browser runtime/action APIs, existing inference host and popup DOM.

---

### Task 1: Add the model status store and contract

**Files:**
- Create: `src/background/model-status.ts`
- Test: `tests/background/model-status.test.ts`

- [ ] **Step 1: Write the failing tests**

  Cover: initial `loading` snapshot with `progress: 0`; transitions to loading/ready/error; immutable snapshots; a user-facing log entry for each transition; retention capped at 30 records with oldest entries removed first; and `recognition` logs never containing a supplied recognized text.

- [ ] **Step 2: Run the focused test and verify it fails**

  Run `npm test -- tests/background/model-status.test.ts`.
  Expected: FAIL because `src/background/model-status.ts` does not exist.

- [ ] **Step 3: Implement the minimal store**

  Export `ModelStatus`, `ModelLog`, `ModelStatusSnapshot`, `ModelStatusStore`, and `createModelStatusStore(now?)`. Implement `snapshot()`, `subscribe(listener)`, `beginWarmup()`, `warmupReady()`, `warmupFailed(message)`, `recognitionStarted()`, `recognitionSucceeded(durationMs, confidence)`, and `recognitionFailed(message, durationMs, modelUnavailable)`. Clone the logs array on every snapshot and clamp progress to `0 | 50 | 100`.

- [ ] **Step 4: Run the focused test and verify it passes**

  Run `npm test -- tests/background/model-status.test.ts`.
  Expected: PASS.

- [ ] **Step 5: Commit**

  `git add src/background/model-status.ts tests/background/model-status.test.ts && git commit -m "feat: add observable model status store"`

### Task 2: Wire status transitions into the background and action badge

**Files:**
- Modify: `src/background/background-runtime.ts`
- Modify: `src/background/runtime-router.ts`
- Modify: `entrypoints/background.ts`
- Test: `tests/background/background-runtime.test.ts`
- Test: `tests/background/runtime-router.test.ts`

- [ ] **Step 1: Write failing background tests**

  Extend the background adapter with `modelStatus` and an optional `action` adapter. Assert startup calls `beginWarmup`, then marks ready or error from the warmup promise; recognition appends a success/failure result log with duration; `captcha:get-model-status` returns a snapshot; and `captcha:retry-model-warmup` starts a new warmup. Assert badge mapping is `…`/amber, `✓`/green, `!`/red and badge failures do not reject startup.

- [ ] **Step 2: Run focused tests and verify red**

  Run `npm test -- tests/background/background-runtime.test.ts tests/background/runtime-router.test.ts`.
  Expected: FAIL on missing adapter fields and message handlers.

- [ ] **Step 3: Implement wiring**

  Add `modelStatus: ModelStatusStore` to `RuntimeRouterAdapter`. Wrap `inferenceHost.warmup()` in a shared `runWarmup()` that calls `beginWarmup()` before awaiting and calls `warmupReady()` or `warmupFailed()` after. In the recognition branch call `recognitionStarted()` and measure elapsed time with `performance.now()`; on success call `recognitionSucceeded`, on typed failure call `recognitionFailed` and preserve the existing response shape. Add the two status message routes and validate `retry` has no page dependency. Add `action.setBadgeText` and `setBadgeBackgroundColor` to the background adapter and subscribe once to status transitions, swallowing/reporting badge errors. Pass real `browser.action` methods from `entrypoints/background.ts`.

- [ ] **Step 4: Run focused tests and verify green**

  Run `npm test -- tests/background/background-runtime.test.ts tests/background/runtime-router.test.ts`.
  Expected: PASS.

- [ ] **Step 5: Commit**

  `git add src/background/background-runtime.ts src/background/runtime-router.ts entrypoints/background.ts tests/background/background-runtime.test.ts tests/background/runtime-router.test.ts && git commit -m "feat: publish model readiness and action badge"`

### Task 3: Add popup status, progress, retry, and user-facing log view

**Files:**
- Modify: `src/popup/controller.ts`
- Modify: `entrypoints/popup/main.ts`
- Modify: `entrypoints/popup/style.css`
- Test: `tests/popup/controller.test.ts`
- Test: `tests/popup/view.test.ts`

- [ ] **Step 1: Write failing popup tests**

  Add a `ModelStatusSnapshot` fixture and assert controller startup requests `captcha:get-model-status`, renders loading/ready/error states, displays progress and the last 30 user logs, and retry sends `captcha:retry-model-warmup` then refreshes the snapshot. Assert error state exposes a retry button while ready/loading hide it and empty logs show the empty message.

- [ ] **Step 2: Run focused popup tests and verify red**

  Run `npm test -- tests/popup/controller.test.ts tests/popup/view.test.ts`.
  Expected: FAIL because the popup has no model status region or controller.

- [ ] **Step 3: Implement the popup model-status controller/view**

  Add a typed `ModelStatusController` alongside the existing site controller or as a focused helper in `src/popup/controller.ts`. Keep site toggle request generation separate. In `entrypoints/popup/main.ts`, render a status row before the site panel with `[data-model-status]`, `[data-model-progress]`, `[data-model-retry]`, and `[data-model-logs]`; bind retry and initial snapshot loading. Render only user-facing `message` strings and durations, never raw errors. Preserve existing hostname and checkbox hooks.

- [ ] **Step 4: Add stable compact popup styling**

  Add fixed-height progress track, status color variants, a compact log list with overflow clipping, and a retry button that fits the existing 340px popup without shifting the site toggle layout. Use accessible `role="status"`, `aria-live="polite"`, and a labelled progressbar.

- [ ] **Step 5: Run focused popup tests and verify green**

  Run `npm test -- tests/popup/controller.test.ts tests/popup/view.test.ts`.
  Expected: PASS.

- [ ] **Step 6: Commit**

  `git add src/popup/controller.ts entrypoints/popup/main.ts entrypoints/popup/style.css tests/popup/controller.test.ts tests/popup/view.test.ts && git commit -m "feat: show model status and execution logs in popup"`

### Task 4: Full verification and Edge artifact check

**Files:**
- Modify only if verification exposes a regression.

- [ ] **Step 1: Run all automated checks**

  Run `npm test`, `npm run typecheck`, `npm run build:edge`, and `git diff --check`.
  Expected: all tests pass, typecheck exits 0, Edge artifact builds under `.output/edge-mv3`, and diff check is clean.

- [ ] **Step 2: Inspect the generated manifest and popup hooks**

  Run `rg -n 'popup|action|model-status|captcha:retry-model-warmup' .output/edge-mv3/manifest.json .output/edge-mv3 | head -80`.
  Expected: popup entry, action permission/API usage, and both status message strings are present.

- [ ] **Step 3: Commit any verification-only fix**

  If a fix is needed, rerun the affected focused test and then commit it with a message describing the regression; otherwise leave the implementation commits unchanged.
