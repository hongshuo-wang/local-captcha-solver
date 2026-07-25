# 验证码快捷触发、输入框搜索与结果复制 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 扩大验证码输入框匹配范围，增加 `Ctrl/Command + 左键`快捷识别，并在没有输入框时按配置展示和复制识别结果，同时统一相关中文文案。

**Architecture:** 保留现有 OCR 工作流和右键消息链路，在 DOM 快照层扩展当前文档内文本控件候选，在内容脚本层加入快捷点击与复制协调，在设置/运行时路由层增加全局复制偏好，在弹窗和状态条呈现中文配置及结果。自动填充仍由唯一性和置信度策略保护。

**Tech Stack:** TypeScript、Vitest、WXT 浏览器扩展 API、原生 DOM/Clipboard API。

---

### Task 1: 扩展字段类型、DOM 快照和匹配评分

**Files:**
- Modify: `src/core/field-matcher.ts`
- Modify: `src/content/dom-snapshot.ts`
- Modify: `src/content/field-fill.ts`
- Modify: `src/content/workflow.ts`
- Test: `tests/content/dom-snapshot.test.ts`
- Test: `tests/content/field-fill.test.ts`
- Test: `tests/core/field-matcher.test.ts`
- Test: `tests/content/workflow.test.ts`

- [ ] **Step 1: Write failing DOM snapshot tests** for a visible `textarea`, a field identified only by Chinese `placeholder`/`aria-label`, a field outside the image's form but within the expanded distance, and filtering hidden/disabled/read-only/password controls.
- [ ] **Step 2: Run the focused snapshot tests and verify they fail** with the current `input`-only collection and missing context text.

  Run: `npm test -- tests/content/dom-snapshot.test.ts`
  Expected: FAIL because the textarea and expanded semantic context are absent.

- [ ] **Step 3: Write failing field matcher/workflow tests** asserting the Chinese semantic candidate is unique and fills the supported control, while two near-equal candidates return confirmation instead of filling.
- [ ] **Step 4: Run the focused matcher/workflow tests and verify they fail** before implementation.

  Run: `npm test -- tests/core/field-matcher.test.ts tests/content/workflow.test.ts`
  Expected: FAIL because the current semantic regex/threshold and element type only support the old cases.

- [ ] **Step 5: Implement the minimal field model extension.** Introduce a shared `TextFieldElement = HTMLInputElement | HTMLTextAreaElement`; collect eligible `input, textarea` controls; compose label context from label text, `id`, `name`, `placeholder`, ARIA attributes, and nearby ancestor text; include Chinese and English CAPTCHA terms; widen distance scoring without removing the unique-field margin.
- [ ] **Step 6: Update filling to support both input and textarea** with the native prototype setter and existing `input`/`change` events; preserve stale, ineligible, and non-empty guards.
- [ ] **Step 7: Run the focused tests and then the existing content/core suites.**

  Run: `npm test -- tests/content/dom-snapshot.test.ts tests/content/field-fill.test.ts tests/core/field-matcher.test.ts tests/content/workflow.test.ts`
  Expected: PASS with no regressions in existing automatic, explicit, ambiguous, and stale workflows.

### Task 2: Add shortcut click handling and Chinese content/menu text

**Files:**
- Modify: `src/content/workflow.ts`
- Modify: `entrypoints/content.ts`
- Modify: `src/content/status-ui.ts`
- Modify: `src/background/context-menu.ts`
- Modify: `wxt.config.ts`
- Test: `tests/entrypoints/content.test.ts`
- Test: `tests/content/status-ui.test.ts`
- Test: `tests/background/context-menu.test.ts`

- [ ] **Step 1: Write failing shortcut tests** dispatching ordinary clicks, `Ctrl` clicks, and `Meta` clicks against an image and a non-image target; assert only modified image clicks invoke the workflow and prevent the default action.
- [ ] **Step 2: Run the content tests and verify the shortcut assertions fail** because no click listener exists.

  Run: `npm test -- tests/entrypoints/content.test.ts`
  Expected: FAIL in the new shortcut cases.

- [ ] **Step 3: Implement a capture-phase document click listener** in `createRuntimeContent`: resolve the nearest `img`, require visibility and `ctrlKey || metaKey`, call the displayed workflow with the shortcut/explicit trigger, and prevent default image navigation/drag behavior. Keep ordinary clicks untouched and clean up the listener on `disable`.
- [ ] **Step 4: Translate user-facing content and context-menu strings** including status messages, confirmation action, menu title, popup-facing site/model status constants, extension name, and description; leave protocol identifiers and internal logs unchanged.
- [ ] **Step 5: Run shortcut, status, and context-menu tests** and update assertions to the Chinese labels and messages.

  Run: `npm test -- tests/entrypoints/content.test.ts tests/content/status-ui.test.ts tests/background/context-menu.test.ts`
  Expected: PASS; ordinary click and right-click message behavior remains unchanged.

### Task 3: Add copy-on-no-field setting and runtime messages

**Files:**
- Modify: `src/platform/settings-store.ts`
- Modify: `src/background/runtime-router.ts`
- Modify: `src/background/background-runtime.ts`
- Modify: `entrypoints/background.ts`
- Modify: `entrypoints/content.ts`
- Create: `src/content/clipboard.ts`
- Test: `tests/platform/settings-store.test.ts`
- Test: `tests/background/runtime-router.test.ts`
- Test: `tests/content/clipboard.test.ts`

- [ ] **Step 1: Write failing settings tests** for the default `copyOnNoField: true`, legacy version-1 data without the property, explicit false persistence, and corrupt values falling back to true.
- [ ] **Step 2: Run the settings tests and verify they fail** because the schema has no copy preference.

  Run: `npm test -- tests/platform/settings-store.test.ts`
  Expected: FAIL on the new preference expectations.

- [ ] **Step 3: Extend the version-1 settings schema compatibly** with `copyOnNoField`, defaulting and normalizing it without changing allowlist behavior; add serialized mutation methods for the preference.
- [ ] **Step 4: Write failing runtime-router tests** for `captcha:get-preferences` and `captcha:set-preferences`, including malformed requests and persistence calls.
- [ ] **Step 5: Run the router tests and verify they fail** because the messages are not recognized.

  Run: `npm test -- tests/background/runtime-router.test.ts`
  Expected: FAIL with undefined responses for the new message types.

- [ ] **Step 6: Add guarded preference routes and background allowlisting.** Return `{ copyOnNoField }`, reject non-boolean updates, and pass the existing settings store into the background router without weakening sender/page validation for unrelated messages.
- [ ] **Step 7: Implement and test `copyText(value)`** with `navigator.clipboard.writeText` first and a temporary textarea plus `execCommand('copy')` fallback; return a boolean or throw a typed failure so callers can display failure without losing the OCR result.
- [ ] **Step 8: Run settings, router, clipboard, and background suites.**

  Run: `npm test -- tests/platform/settings-store.test.ts tests/background/runtime-router.test.ts tests/content/clipboard.test.ts tests/background/background-runtime.test.ts`
  Expected: PASS and existing background message filtering remains intact.

### Task 4: Wire no-field result display, copy behavior, and popup configuration

**Files:**
- Modify: `entrypoints/content.ts`
- Modify: `src/content/status-ui.ts`
- Modify: `src/popup/controller.ts`
- Modify: `entrypoints/popup/main.ts`
- Modify: `entrypoints/popup/index.html`
- Modify: `entrypoints/popup/style.css`
- Test: `tests/content/status-ui.test.ts`
- Test: `tests/entrypoints/content.test.ts`
- Test: `tests/popup/view.test.ts`
- Test: `tests/popup/controller.test.ts`

- [ ] **Step 1: Write failing status/content tests** asserting `no_field` renders the OCR display text, calls preference lookup, copies only when enabled, and shows a Chinese copied/disabled/failed suffix; assert recognition/model/permission failures do not attempt copying.
- [ ] **Step 2: Run those tests and verify they fail** because `no_field` currently only renders the generic message and content has no clipboard branch.

  Run: `npm test -- tests/content/status-ui.test.ts tests/entrypoints/content.test.ts`
  Expected: FAIL in the new no-field/copy assertions.

- [ ] **Step 3: Extend status rendering with a copy outcome option** and make the no-field message always include `displayText` or `fillValue`; keep confirmation actions and fixed live-region behavior unchanged.
- [ ] **Step 4: Wire content no-field handling** to request the current preference, call `copyText` when enabled, map failures to a visible status, and then render the final result. Treat malformed/unsupported preference responses as the backward-compatible default enabled behavior.
- [ ] **Step 5: Add a Chinese copy-preference checkbox to the popup** and a small preference controller that reads `captcha:get-preferences` on startup and sends `captcha:set-preferences` on changes; preserve site enable/disable and model polling controllers.
- [ ] **Step 6: Translate popup HTML labels, controller status constants, document title, and accessible labels; add compact styling for the new setting without nesting cards or changing popup dimensions unexpectedly.
- [ ] **Step 7: Run content/status/popup tests and update exact user-facing assertions.**

  Run: `npm test -- tests/content/status-ui.test.ts tests/entrypoints/content.test.ts tests/popup/view.test.ts tests/popup/controller.test.ts`
  Expected: PASS with result and setting states rendered in Chinese.

### Task 5: Full verification and delivery review

**Files:**
- Modify only any test fixtures or type declarations required by the preceding tasks.

- [ ] **Step 1: Run the complete unit test suite.**

  Run: `npm test`
  Expected: PASS with zero failed tests.

- [ ] **Step 2: Run the production build/type checks.**

  Run: `npm run build`
  Expected: exit code 0 and generated extension assets compile successfully.

- [ ] **Step 3: Inspect the final diff and verify scope.** Confirm the design doc commit and pre-existing dirty files are preserved, protocol identifiers remain stable, and all requested acceptance criteria have corresponding tests.

- [ ] **Step 4: Prepare implementation changes for handoff.** Keep implementation uncommitted because several target files already contain user-owned edits. Report the exact changed files and verification evidence so the user can review before deciding whether to commit.

  Run: `git status --short && git diff --stat`
  Expected: only planned implementation/test changes plus the pre-existing user-owned paths are present; no unrelated file is staged.
