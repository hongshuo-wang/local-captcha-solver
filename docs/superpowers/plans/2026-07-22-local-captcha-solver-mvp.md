# Local CAPTCHA Solver MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an unpacked Chrome/Edge Manifest V3 extension that recognizes common alphanumeric and single-operation arithmetic image CAPTCHAs entirely locally, then fills a confidently matched field without ever submitting the form.

**Architecture:** A browser-independent TypeScript core owns OCR contracts, decoding, interpretation, candidate scoring, and field matching. A lightweight ddddocr adapter runs the pinned `common_old.onnx` model through `onnxruntime-web` in an extension-owned offscreen inference context, while WXT supplies Chromium entrypoints for the service worker, runtime content script, and popup. Browser APIs stay behind adapters so a future Firefox layer can replace Chromium registration/inference lifecycle without changing the core. An OCR benchmark is a hard gate before browser workflow implementation continues.

**Tech Stack:** TypeScript, WXT, Manifest V3, `onnxruntime-web` 1.23.2, Vitest, Happy DOM, Playwright, `@napi-rs/canvas`, and locally provisioned `tesseract.js` as a benchmark-only comparator.

---

## Prerequisites

- Node.js 22 LTS and npm 10 or later.
- Current stable Chrome and Microsoft Edge.
- Network access during dependency and pinned-model download only.
- Design reference: `docs/superpowers/specs/2026-07-22-local-captcha-solver-design.md`.
- Execute implementation in an isolated worktree created with `superpowers:using-git-worktrees`.

## Locked File Structure

```text
.
├── .gitignore
├── LICENSE
├── README.md
├── THIRD_PARTY_NOTICES.md
├── package.json
├── package-lock.json
├── playwright.config.ts
├── tsconfig.json
├── vitest.config.ts
├── wxt.config.ts
├── benchmark/
│   ├── corpus.generated.json
│   ├── generate-corpus.ts
│   ├── import-real-sample.ts
│   ├── run.ts
│   ├── report.ts
│   └── fixtures/{generated,real}/
├── entrypoints/
│   ├── background.ts
│   ├── content.ts
│   ├── offscreen.html
│   ├── offscreen.ts
│   └── popup/{index.html,main.ts,style.css}
├── public/
│   ├── models/{common_old.onnx,common_old.json}
│   └── ort/
├── scripts/
│   ├── sync-third-party-assets.mjs
│   └── verify-build.mjs
├── src/
│   ├── core/
│   │   ├── arithmetic.ts
│   │   ├── candidate-scorer.ts
│   │   ├── field-matcher.ts
│   │   ├── request-coordinator.ts
│   │   ├── result-interpreter.ts
│   │   └── types.ts
│   ├── ocr/
│   │   ├── ctc-decoder.ts
│   │   ├── ddddocr-engine.ts
│   │   ├── image-preprocessor.ts
│   │   └── protocol.ts
│   ├── platform/
│   │   ├── browser-adapter.ts
│   │   ├── chromium-adapter.ts
│   │   ├── permissions.ts
│   │   └── settings-store.ts
│   ├── background/
│   │   ├── content-registration.ts
│   │   ├── context-menu.ts
│   │   ├── image-fetch.ts
│   │   └── inference-host.ts
│   ├── content/
│   │   ├── detector.ts
│   │   ├── field-fill.ts
│   │   ├── image-source.ts
│   │   ├── orchestrator.ts
│   │   └── status-ui.ts
│   └── popup/
│       └── controller.ts
└── tests/
    ├── benchmark/
    ├── core/
    ├── ocr/
    ├── platform/
    ├── content/
    └── e2e/{extension.spec.ts,fixtures/}
```

## Task 1: Scaffold the TypeScript Extension and Test Harness

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `wxt.config.ts`
- Create: `vitest.config.ts`
- Create: `playwright.config.ts`
- Create: `.gitignore`
- Create: `entrypoints/background.ts`
- Create: `entrypoints/popup/index.html`
- Create: `entrypoints/popup/main.ts`

- [ ] **Step 1: Create the package manifest with pinned runtime dependencies**

```json
{
  "name": "local-captcha-solver",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "wxt",
    "build": "wxt build -b chrome",
    "build:edge": "wxt build -b edge",
    "build:verify": "node scripts/verify-build.mjs",
    "zip": "wxt zip -b chrome",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:coverage": "vitest run --coverage",
    "test:e2e": "playwright test",
    "assets:sync": "node scripts/sync-third-party-assets.mjs",
    "benchmark:generate": "tsx benchmark/generate-corpus.ts",
    "benchmark": "tsx benchmark/run.ts"
  },
  "dependencies": {
    "onnxruntime-web": "1.23.2"
  },
  "devDependencies": {
    "@napi-rs/canvas": "0.1.80",
    "@playwright/test": "1.55.0",
    "@tesseract.js-data/eng": "1.0.0",
    "@vitest/coverage-v8": "3.2.4",
    "happy-dom": "18.0.1",
    "tesseract.js": "6.0.1",
    "tsx": "4.20.5",
    "typescript": "5.9.2",
    "vitest": "3.2.4",
    "wxt": "0.20.7"
  }
}
```

- [ ] **Step 2: Install dependencies and commit the lockfile**

Run: `npm install`

Expected: exit code 0 and a new `package-lock.json`.

- [ ] **Step 3: Add strict compiler, WXT, Vitest, and Playwright configuration**

Use `ES2022`, `moduleResolution: "Bundler"`, `strict: true`, and the WXT-generated type directory. Configure Vitest with `environment: "happy-dom"` and include `tests/**/*.test.ts`. Configure Playwright with one Chromium project and a 30-second timeout.

```ts
// wxt.config.ts
import { defineConfig } from 'wxt';

export default defineConfig({
  manifest: {
    name: 'Local CAPTCHA Solver',
    description: 'Recognize simple CAPTCHAs locally and fill the matching field.',
    permissions: ['activeTab', 'contextMenus', 'storage', 'scripting', 'offscreen'],
    optional_host_permissions: ['http://*/*', 'https://*/*'],
    content_security_policy: {
      extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'",
    },
  },
});
```

- [ ] **Step 4: Add minimal entrypoints and verify the scaffold**

```ts
// entrypoints/background.ts
export default defineBackground(() => {
  console.info('Local CAPTCHA Solver background ready');
});
```

```html
<!-- entrypoints/popup/index.html -->
<!doctype html>
<html lang="zh-CN">
  <head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
  <body><main id="app"></main><script type="module" src="./main.ts"></script></body>
</html>
```

Run: `npm run typecheck && npm test && npm run build`

Expected: all three commands pass and `.output/chrome-mv3/manifest.json` exists.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json tsconfig.json wxt.config.ts vitest.config.ts playwright.config.ts .gitignore entrypoints
git commit -m "chore: scaffold chromium extension"
```

## Task 2: Pin Model Assets and Third-Party Notices

**Files:**
- Create: `scripts/sync-third-party-assets.mjs`
- Create: `THIRD_PARTY_NOTICES.md`
- Create: `LICENSE`
- Modify: `.gitignore`
- Modify: `package.json`

- [ ] **Step 1: Write an asset-sync script that validates Git blob identities**

The script downloads these exact blobs through the GitHub blob API:

```js
const assets = [
  {
    repo: 'sml2h3/ddddocr',
    commit: 'c40f56f95412e10bcb9bd0bd24411e92f896d238',
    path: 'ddddocr/common_old.onnx',
    blob: '8ce4807e1e68c3fa5c1344d281cc7d1623a020cc',
    size: 13606051,
    output: 'public/models/common_old.onnx',
  },
  {
    repo: 'renhaoyeh/ddddocr-node',
    commit: 'f7be779568b08cbb3b12c895ce7f22fd6ccc554d',
    path: 'onnx/common_old.json',
    blob: 'bc50c087ee50455d364eaebd48a3a75fb58fee20',
    size: 90091,
    output: 'public/models/common_old.json',
  },
];
```

For each asset, first fetch `https://api.github.com/repos/{repo}/contents/{path}?ref={commit}` and require its `sha`, `size`, and `path` to match the pinned entry. Then fetch its `git_url`, decode the Base64 blob, verify its byte length, and verify `sha1("blob " + size + "\0" + bytes)` equals the recorded blob ID before writing it. Copy only `ort-wasm-simd-threaded.wasm` and `ort-wasm-simd-threaded.mjs` from `node_modules/onnxruntime-web/dist` into `public/ort`; the asyncify and JSEP variants are not used and must not inflate the extension.

- [ ] **Step 2: Add the failing asset verification test**

```ts
// tests/ocr/assets.test.ts
import { existsSync, statSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('bundled OCR assets', () => {
  it.each([
    ['public/models/common_old.onnx', 13_606_051],
    ['public/models/common_old.json', 90_091],
    ['public/ort/ort-wasm-simd-threaded.wasm', 11_905_541],
    ['public/ort/ort-wasm-simd-threaded.mjs', 20_321],
  ])('contains pinned asset %s', (path, size) => {
    expect(existsSync(path)).toBe(true);
    expect(statSync(path).size).toBe(size);
  });
});
```

- [ ] **Step 3: Run the test and observe the missing asset failure**

Run: `npm test -- tests/ocr/assets.test.ts`

Expected: FAIL because `public/models/common_old.onnx` does not exist.

- [ ] **Step 4: Sync assets and rerun the test**

Run: `npm run assets:sync && npm test -- tests/ocr/assets.test.ts`

Expected: PASS and local copies of the model, character map, and ORT WebAssembly files.

- [ ] **Step 5: Add licensing and repository ignore rules**

Use the MIT license for the project. `THIRD_PARTY_NOTICES.md` must name ddddocr, ddddocr-node, ONNX Runtime, Tesseract.js, and the Tesseract English data package; link their source repositories, identify pinned revisions or package versions, and reproduce their applicable license notices. Ignore benchmark reports, `.output`, `.wxt`, coverage, and Playwright output. Keep pinned production model assets and the generated benchmark corpus tracked so the accuracy gate is auditable.

- [ ] **Step 6: Commit**

```bash
git add scripts public package.json package-lock.json LICENSE THIRD_PARTY_NOTICES.md .gitignore tests/ocr/assets.test.ts
git commit -m "build: pin local OCR assets"
```

## Task 3: Define Core Contracts and Arithmetic Interpretation

**Files:**
- Create: `src/core/types.ts`
- Create: `src/core/arithmetic.ts`
- Create: `src/core/result-interpreter.ts`
- Create: `tests/core/arithmetic.test.ts`
- Create: `tests/core/result-interpreter.test.ts`

- [ ] **Step 1: Write failing arithmetic and interpretation tests**

```ts
import { describe, expect, it } from 'vitest';
import { parseArithmetic } from '../../src/core/arithmetic';

describe('parseArithmetic', () => {
  it.each([
    ['12+7', '12+7', '19'],
    ['9 - 3 =', '9-3', '6'],
    ['3-9', '3-9', '-6'],
    ['6×4?', '6*4', '24'],
    ['8/2', '8/2', '4'],
    ['8÷2', '8/2', '4'],
    ['8x3', '8*3', '24'],
    ['8X3', '8*3', '24'],
    ['8*3', '8*3', '24'],
  ])('evaluates %s', (source, expression, value) => {
    expect(parseArithmetic(source)).toEqual({ expression, value });
  });

  it.each(['1/0', '7/2', '1+2+3', 'alert(1)', ''])('rejects %s', (source) => {
    expect(parseArithmetic(source)).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tests/core/arithmetic.test.ts tests/core/result-interpreter.test.ts`

Expected: FAIL with unresolved imports.

- [ ] **Step 3: Add explicit result types and safe arithmetic parsing**

```ts
export type RecognitionMode = 'digits' | 'letters' | 'alphanumeric' | 'arithmetic';

export interface OcrResult {
  text: string;
  confidence: number;
  mode: RecognitionMode;
}

export interface ImagePayload {
  bytes: Uint8Array;
  mimeType: string;
  revision: string;
}

export interface ImageSource {
  acquire(candidateId: string): Promise<ImagePayload>;
}

export interface ModelInput {
  data: Float32Array;
  dims: readonly [1, 1, 64, number];
}

export interface ImagePreprocessor {
  prepare(image: ImagePayload): Promise<ModelInput>;
}

export interface OcrEngine {
  recognize(image: ImagePayload, modes: readonly RecognitionMode[]): Promise<OcrResult[]>;
}

export type InterpretedResult =
  | { kind: 'plain'; displayText: string; fillValue: string; confidence: number }
  | { kind: 'arithmetic'; displayText: string; fillValue: string; confidence: number }
  | { kind: 'invalid'; reason: 'empty' | 'unsupported' | 'non_integer_division' };

export interface ResultInterpreter {
  interpret(results: readonly OcrResult[]): InterpretedResult[];
}

export interface ScoreResult {
  score: number;
  reasons: string[];
}

export interface CaptchaCandidateScorer<TCandidate> {
  score(candidate: TCandidate): ScoreResult;
}

export interface FieldMatch<TField> {
  state: 'unique' | 'ambiguous' | 'none';
  winner?: TField;
  candidates: Array<{ field: TField; score: number; reasons: string[] }>;
}

export interface FieldMatcher<TImage, TField> {
  match(image: TImage, fields: readonly TField[], allowReplacement: boolean): FieldMatch<TField>;
}

export type WorkflowResult =
  | { state: 'filled'; candidateId: string; fieldId: string; displayText: string; fillValue: string }
  | { state: 'needs_confirmation'; candidateId: string; displayText: string; fillValue?: string; fieldIds: string[] }
  | { state: 'no_candidate' }
  | { state: 'no_field'; candidateId: string; displayText: string; fillValue: string }
  | { state: 'image_unavailable'; candidateId: string }
  | { state: 'recognition_failed'; candidateId: string }
  | { state: 'stale'; candidateId: string }
  | { state: 'model_unavailable'; candidateId: string };
```

Keep `ImageSource` and `OcrEngine` free of `chrome.*`/`browser.*` types; DOM and Chromium adapters implement them at the platform edge. Implement `parseArithmetic` with one anchored regular expression and an operator switch. Implement `interpretResult` so valid arithmetic returns the computed fill value and all other structurally valid alphanumeric strings preserve case. Add exhaustive tests for every `WorkflowResult.state` so later entry points share one result vocabulary.

- [ ] **Step 4: Run focused tests**

Run: `npm test -- tests/core/arithmetic.test.ts tests/core/result-interpreter.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core tests/core
git commit -m "feat: add safe captcha result interpretation"
```

## Task 4: Implement Logit Masking, CTC Decoding, and Confidence

**Files:**
- Create: `src/ocr/ctc-decoder.ts`
- Create: `tests/ocr/ctc-decoder.test.ts`

- [ ] **Step 1: Write failing decoder tests**

Tests must prove blank removal, repeated-character collapse, repeated characters separated by blank, pre-argmax character masking, and mean confidence over emitted characters. Add a case where a disallowed class has the dominant raw logit and assert the allowed output's confidence remains low rather than being renormalized to a false high-confidence value.

```ts
it('keeps repeated characters separated by a blank', () => {
  const charset = ['', '1', 'A', '中'];
  const logits = tensorFromWinners([1, 0, 1], 4);
  expect(decodeCtc(logits, [1, 3, 4], charset, new Set(['1']))).toMatchObject({ text: '11' });
});

it('masks disallowed winners before argmax', () => {
  const charset = ['', '7', '中'];
  const logits = new Float32Array([0, 8, 10]);
  expect(decodeCtc(logits, [1, 1, 3], charset, new Set(['7']))).toMatchObject({ text: '7' });
});
```

- [ ] **Step 2: Run the decoder tests and verify failure**

Run: `npm test -- tests/ocr/ctc-decoder.test.ts`

Expected: FAIL because `decodeCtc` is missing.

- [ ] **Step 3: Implement dimension normalization and masked argmax**

Support `[1, time, classes]` and `[time, 1, classes]`. At each time step, select argmax from blank plus only allowed character indices, but compute the selected class probability from a numerically stable softmax over all model classes. This preserves evidence that the model preferred a disallowed class and prevents masked profiles from manufacturing high confidence. Collapse consecutive identical indices, omit blank index 0, take the maximum selected probability within each collapsed character run, and average those emitted-character probabilities. An empty decode has confidence `0`.

```ts
export function decodeCtc(
  logits: Float32Array,
  dims: readonly number[],
  charset: readonly string[],
  allowed: ReadonlySet<string>,
): { text: string; confidence: number };
```

- [ ] **Step 4: Run decoder tests and type checking**

Run: `npm test -- tests/ocr/ctc-decoder.test.ts && npm run typecheck`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ocr/ctc-decoder.ts tests/ocr/ctc-decoder.test.ts
git commit -m "feat: decode constrained OCR logits"
```

## Task 5: Implement Image Tensor Preparation and the Ddddocr Engine

**Files:**
- Create: `src/ocr/image-preprocessor.ts`
- Create: `src/ocr/ddddocr-engine.ts`
- Create: `tests/ocr/image-preprocessor.test.ts`
- Create: `tests/ocr/ddddocr-engine.test.ts`

- [ ] **Step 1: Write failing pure preprocessing tests**

```ts
it('converts RGBA pixels to one normalized grayscale channel', () => {
  const rgba = new Uint8ClampedArray([255, 255, 255, 255, 0, 0, 0, 255]);
  expect(rgbaToModelTensor(rgba, 2, 1)).toEqual(new Float32Array([1, -1]));
});
```

Also test alpha compositing onto white, target height 64, aspect-ratio width calculation, and deterministic dimensions `[1, 1, 64, targetWidth]`.

- [ ] **Step 2: Run tests and verify missing implementations**

Run: `npm test -- tests/ocr/image-preprocessor.test.ts tests/ocr/ddddocr-engine.test.ts`

Expected: FAIL with unresolved imports.

- [ ] **Step 3: Implement browser preprocessing**

Use `createImageBitmap` and `OffscreenCanvas` in the extension inference context. Composite transparent pixels onto white, resize with high-quality interpolation, calculate luminance, and normalize each pixel with `(value / 255 - 0.5) / 0.5`.

- [ ] **Step 4: Implement an injectable ONNX session adapter**

```ts
export interface OcrSession {
  run(feeds: Record<string, unknown>): Promise<Record<string, { data: Float32Array; dims: number[] }>>;
}

export interface OcrSessionFactory {
  create(modelUrl: string): Promise<OcrSession>;
}

export class DdddOcrEngine {
  constructor(
    private readonly sessionFactory: OcrSessionFactory,
    private readonly modelUrl: string,
    private readonly charset: readonly string[],
  ) {}
}
```

Expose `recognize(image, modes: readonly RecognitionMode[]): Promise<OcrResult[]>`. Cache the session promise, preprocess once, run the model once with input name `input1`, accept the single output tensor regardless of upstream output name, and decode the same logits once per requested mode with that mode's allowed characters. Deduplicate modes while preserving caller order. Never rerun ONNX merely to apply another character profile.

- [ ] **Step 5: Use a fake session to test session reuse and mode constraints**

Verify two recognition calls create one session, one four-mode call invokes `session.run` exactly once, arithmetic excludes letters, alphanumeric preserves case, duplicate modes are removed, and a model exception becomes a typed `model_unavailable` error.

- [ ] **Step 6: Run focused tests**

Run: `npm test -- tests/ocr/image-preprocessor.test.ts tests/ocr/ddddocr-engine.test.ts && npm run typecheck`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/ocr tests/ocr
git commit -m "feat: add browser ddddocr engine"
```

## Task 6: Build the OCR Benchmark and Enforce the Feasibility Gate

**Files:**
- Create: `benchmark/generate-corpus.ts`
- Create: `benchmark/run.ts`
- Create: `benchmark/report.ts`
- Create: `benchmark/import-real-sample.ts`
- Create: `tests/benchmark/report.test.ts`
- Modify: `.gitignore`

- [ ] **Step 1: Write failing report-metric tests**

```ts
it('computes whole-string and arithmetic answer accuracy by category', () => {
  const report = buildReport([
    { category: 'digits', expected: '1234', actual: '1234', confidence: 0.98, latencyMs: 20 },
    { category: 'digits', expected: '5678', actual: '567B', confidence: 0.95, latencyMs: 30 },
    { category: 'arithmetic', expected: '8x3', expectedFill: '24', actual: '8x3', actualFill: '24', confidence: 0.97, latencyMs: 25 },
  ]);
  expect(report.categories.digits.wholeStringAccuracy).toBe(0.5);
  expect(report.categories.arithmetic.fillAccuracy).toBe(1);
  expect(report.falseHighConfidenceRate).toBeCloseTo(1 / 3);
});
```

Also test Levenshtein-based character accuracy, median and p95 warm latency, cold initialization time, package-size contribution, and the false-high-confidence definition: an incorrect whole-string result with confidence at least `0.90`, divided by all predictions.

- [ ] **Step 2: Implement deterministic corpus generation**

Use a seeded PRNG and `@napi-rs/canvas` to create 50 images in each category. Vary font family, font size, foreground/background contrast, one or two thin interference lines, and up to two degrees of rotation. Generate only integer division. Write labels to `benchmark/corpus.generated.json` and PNG files to `benchmark/fixtures/generated`; both labels and images are tracked so every later run uses the same agreed corpus.

- [ ] **Step 3: Implement ddddocr/Tesseract comparison**

Run the production `DdddOcrEngine` with `onnxruntime-web` and decode each image through `@napi-rs/canvas`, so the benchmark exercises the same tensor preparation, model, character map, masking, and CTC decoder that will ship. Initialize one Tesseract worker with its worker/core files from `node_modules/tesseract.js` and `langPath` pointing at the installed `@tesseract.js-data/eng` package; disable every CDN/default download path. Apply the matching character whitelist for each category. For each sample, record source recognition, interpreted fill value, confidence, cold initialization time, warm latency, and engine name. Emit machine-readable JSON and a Markdown table under `benchmark/results/`, which remains ignored.

- [ ] **Step 4: Add a real-sample importer**

`npm exec tsx benchmark/import-real-sample.ts -- --image /absolute/path.png --answer aB72 --category alphanumeric --provenance "authorized test sample" --license "permission granted"` copies the image into `benchmark/fixtures/real`, calculates SHA-256, and adds a deduplicated label entry. Arithmetic imports require `--fill`. The importer rejects missing provenance/license metadata so real samples cannot silently enter the corpus without a usage basis.

- [ ] **Step 5: Run the generated benchmark**

Run: `npm run benchmark:generate && npm run benchmark`

Expected: at least 200 tracked samples processed, comparison report emitted, both engines use only local files, and no remote OCR calls occur. Generated images are committed with their labels; real samples are included only when their recorded provenance permits repository storage.

- [ ] **Step 6: Apply the hard gate**

Proceed to Task 7 only if ddddocr achieves both:

- at least 90% aggregate whole-string accuracy for digits, letters, and alphanumeric categories;
- at least 90% arithmetic final-answer accuracy.

If either threshold fails, commit only the benchmark and report schema, stop implementation, and revise the approved model/preprocessing design before continuing.

- [ ] **Step 7: Commit**

```bash
git add benchmark tests/benchmark .gitignore package.json package-lock.json
git commit -m "test: add local OCR feasibility benchmark"
```

## Task 7: Implement Candidate Scoring and Field Matching

**Files:**
- Create: `src/core/candidate-scorer.ts`
- Create: `src/core/field-matcher.ts`
- Create: `tests/core/candidate-scorer.test.ts`
- Create: `tests/core/field-matcher.test.ts`

- [ ] **Step 1: Write failing scoring tests with explicit snapshots**

```ts
const captchaImage = {
  attrText: 'login captcha verification-code',
  nearbyText: '请输入验证码',
  width: 120,
  height: 40,
  inForm: true,
  nearShortInput: true,
};

expect(scoreCaptchaCandidate(captchaImage)).toBeGreaterThanOrEqual(70);
expect(scoreCaptchaCandidate({ ...captchaImage, attrText: 'brand logo', width: 600, height: 240 })).toBeLessThan(40);
```

- [ ] **Step 2: Write field ambiguity and exclusion tests**

Test same-form preference, visual distance, CAPTCHA-related labels, disabled/readonly/password exclusion, non-empty automatic exclusion, and an ambiguous tie returning `needs_confirmation` rather than a guessed element.

- [ ] **Step 3: Run tests and verify failure**

Run: `npm test -- tests/core/candidate-scorer.test.ts tests/core/field-matcher.test.ts`

Expected: FAIL with unresolved imports.

- [ ] **Step 4: Implement pure scorers**

Return numeric scores plus reason arrays for diagnostics. Define automatic candidate threshold `70`, manual scan threshold `45`, unique field threshold `60`, and a minimum winning margin of `15` over the runner-up. Keep thresholds exported and covered by tests.

- [ ] **Step 5: Run tests and commit**

Run: `npm test -- tests/core/candidate-scorer.test.ts tests/core/field-matcher.test.ts`

Expected: PASS.

```bash
git add src/core tests/core
git commit -m "feat: score captcha images and target fields"
```

## Task 8: Implement Local Settings and Chromium Permission Boundaries

**Files:**
- Create: `src/platform/browser-adapter.ts`
- Create: `src/platform/chromium-adapter.ts`
- Create: `src/platform/settings-store.ts`
- Create: `src/platform/permissions.ts`
- Create: `tests/platform/settings-store.test.ts`
- Create: `tests/platform/permissions.test.ts`
- Create: `tests/platform/import-boundary.test.ts`

- [ ] **Step 1: Write failing storage and hostname tests**

Test schema `{ version: 1, allowlistedHosts: string[] }`, exact-host matching, lowercase normalization, subdomain separation, path independence, add/remove idempotence, and corrupt-storage recovery to an empty allowlist.

- [ ] **Step 2: Write failing permission-adapter tests**

Use a fake adapter to verify enabling `portal.example.com` requests exactly `http://portal.example.com/*` and `https://portal.example.com/*`, disabling removes both permissions, and denial leaves storage unchanged. Reject IP/hostname values that cannot be obtained from a normal `http:` or `https:` page URL.

- [ ] **Step 3: Run tests and verify failure**

Run: `npm test -- tests/platform`

Expected: FAIL with unresolved imports.

- [ ] **Step 4: Implement the interfaces and Chromium adapter**

```ts
export interface BrowserAdapter {
  getLocal<T>(key: string): Promise<T | undefined>;
  setLocal<T>(key: string, value: T): Promise<void>;
  requestOrigins(origins: string[]): Promise<boolean>;
  removeOrigins(origins: string[]): Promise<boolean>;
  hasOrigins(origins: string[]): Promise<boolean>;
}
```

Use `wxt/browser` only inside `chromium-adapter.ts`. Core and OCR modules must not import browser APIs.

Add an import-boundary test that scans `src/core` and the browser-independent OCR modules and fails on `chrome.*`, `browser.*`, or `wxt/browser` imports. Chromium-specific offscreen lifecycle and registration remain outside those directories so future Firefox support can supply different adapters without forking recognition or matching logic.

- [ ] **Step 5: Run tests and commit**

Run: `npm test -- tests/platform && npm run typecheck`

Expected: PASS.

```bash
git add src/platform tests/platform
git commit -m "feat: add local allowlist permissions"
```

## Task 9: Add Typed Inference Messaging and the Offscreen Host

**Files:**
- Create: `src/ocr/protocol.ts`
- Create: `src/background/inference-host.ts`
- Create: `entrypoints/offscreen.html`
- Create: `entrypoints/offscreen.ts`
- Create: `scripts/verify-build.mjs`
- Create: `tests/ocr/protocol.test.ts`
- Modify: `entrypoints/background.ts`

- [ ] **Step 1: Write failing protocol validation tests**

Define request IDs, image data URL, image revision, requested recognition modes, and a discriminated success/error response. Test rejection of missing IDs, non-image data URLs, empty/duplicate/unsupported mode arrays, and mismatched response IDs.

- [ ] **Step 2: Run tests and verify failure**

Run: `npm test -- tests/ocr/protocol.test.ts`

Expected: FAIL with unresolved protocol imports.

- [ ] **Step 3: Implement protocol types and runtime guards**

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
  | { type: 'ocr:error'; requestId: string; imageRevision: string; code: 'image_unavailable' | 'recognition_failed' | 'model_unavailable' };
```

- [ ] **Step 4: Implement one reusable offscreen inference session**

Configure `ort.env.wasm.wasmPaths` to `browser.runtime.getURL('/ort/')` and `ort.env.wasm.numThreads = 1`. Load the model and character map from extension URLs, create one `DdddOcrEngine`, and answer only validated OCR messages. The background creates `offscreen.html` once with offscreen reasons `BLOBS` and `WORKERS` plus a specific local-OCR justification, handles concurrent create calls with one shared promise, and routes request/response messages. Detect an existing offscreen client before creation and clear the promise after a creation failure so retry remains possible.

- [ ] **Step 5: Add and run build-content verification**

Implement `scripts/verify-build.mjs` to accept an optional output directory argument defaulting to `.output/chrome-mv3`. It must parse `manifest.json`, require `offscreen.html`, the two model assets, and the selected ORT WASM/MJS pair; recursively scan file names and contents for forbidden benchmark payloads; reject asyncify/JSEP assets; and assert there is no static `content_scripts` or required `host_permissions` entry.

Run: `npm test -- tests/ocr/protocol.test.ts tests/ocr/ddddocr-engine.test.ts && npm run build && npm run build:verify`

Expected: PASS and the build contains `offscreen.html`, the two pinned model assets, and only the selected local ORT WASM/MJS pair. Assert that it contains no `tesseract`, Tesseract language-data, `@napi-rs/canvas`, ddddocr-node, asyncify, or JSEP payload.

- [ ] **Step 6: Commit**

```bash
git add src/ocr/protocol.ts src/background/inference-host.ts entrypoints/offscreen* entrypoints/background.ts scripts/verify-build.mjs tests/ocr/protocol.test.ts
git commit -m "feat: host local OCR inference offscreen"
```

## Task 10: Implement Image Acquisition, Safe Filling, and Page Orchestration

**Files:**
- Create: `src/content/image-source.ts`
- Create: `src/content/detector.ts`
- Create: `src/content/field-fill.ts`
- Create: `src/content/orchestrator.ts`
- Create: `src/content/status-ui.ts`
- Create: `src/core/request-coordinator.ts`
- Create: `entrypoints/content.ts`
- Create: `tests/content/image-source.test.ts`
- Create: `tests/content/field-fill.test.ts`
- Create: `tests/content/orchestrator.test.ts`

- [ ] **Step 1: Write failing field-fill safety tests**

Test empty-field filling, native setter use, bubbling `input` and `change`, refusal to overwrite automatically, explicit replacement, and absence of `submit`, click, or keyboard events.

- [ ] **Step 2: Write failing stale-result and deduplication tests**

Test that identical image revisions deduplicate, a changed `src` invalidates pending output, explicit requests supersede automatic requests, stale results do not modify fields, identical fill values from multiple OCR profiles collapse into one choice, and close high-confidence profiles with different fill values return `needs_confirmation`.

- [ ] **Step 3: Run tests and verify failure**

Run: `npm test -- tests/content`

Expected: FAIL with unresolved imports.

- [ ] **Step 4: Implement `<img>` acquisition and DOM snapshots**

Try Canvas conversion for same-origin, `data:`, and `blob:` images. If Canvas is tainted, send a typed `image:fetch` request to the background; the background may fetch only `http:`/`https:` image URLs covered by current permissions, uses `credentials: 'include'`, `cache: 'no-store'`, and `redirect: 'manual'`, requires an `image/*` response, and rejects redirects or payloads over 2 MiB. Return `image_unavailable` without requesting broader permission outside a user gesture. Hash the acquired bytes with SHA-256 and include that hash in diagnostics/deduplication without persisting it.

- [ ] **Step 5: Implement the orchestrator state machine**

For each selected image: snapshot revision, acquire bytes, request all applicable OCR profiles in one inference message, interpret and rank the returned profile results, match fields, verify revision again, then either fill, request confirmation, or surface a typed error. Collapse profile outputs by identical `fillValue`; if distinct structurally valid values both have confidence at least `0.80` and the winning confidence margin is below `0.10`, return `needs_confirmation`. Automatic mode additionally requires candidate score 70, field score 60 with margin 15, winning OCR confidence 0.90, and an empty field. Export and test these thresholds. A non-integer division is surfaced as `needs_confirmation` without a fill value; it is never rounded or automatically written.

- [ ] **Step 6: Add the runtime content entrypoint**

Export `defineContentScript({ registration: 'runtime', matches: [], main() { ... } })` so WXT builds `content-scripts/content.js` without adding `<all_urls>` or any fixed host permission. Accept messages for automatic scan, manual scan, context-image recognition, confirmed fill, and explicit replacement. Background flows inject that exact bundle with `browser.scripting.executeScript` before messaging when it is not already present; manual popup/context-menu injection relies on the temporary `activeTab` grant, while automatic registration relies only on the exact optional origins already granted for the allowlist entry.

- [ ] **Step 7: Run focused tests and build**

Run: `npm test -- tests/content tests/core/request-coordinator.test.ts && npm run typecheck && npm run build`

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/content src/core/request-coordinator.ts entrypoints/content.ts tests/content tests/core/request-coordinator.test.ts
git commit -m "feat: recognize and safely fill page captchas"
```

## Task 11: Add Allowlisted Automatic Registration and Refresh Observation

**Files:**
- Create: `src/background/content-registration.ts`
- Create: `src/background/image-fetch.ts`
- Create: `tests/platform/content-registration.test.ts`
- Create: `tests/platform/image-fetch.test.ts`
- Modify: `entrypoints/background.ts`
- Modify: `entrypoints/content.ts`

- [ ] **Step 1: Write failing dynamic registration tests**

Test registering one exact hostname, startup reconciliation with storage, removal, duplicate avoidance, replacement after bundle revisions, and failure cleanup when either required scheme permission is absent. Inspect the production manifest and assert it has no static `content_scripts` entry and no required `host_permissions` entry. Test image fetch rejection for ungranted origins, non-HTTP(S) URLs, non-image content types, oversized bodies, and redirects to an ungranted origin; verify an allowed image request includes credentials and is never stored.

- [ ] **Step 2: Run the tests and verify failure**

Run: `npm test -- tests/platform/content-registration.test.ts tests/platform/image-fetch.test.ts`

Expected: FAIL with unresolved imports.

- [ ] **Step 3: Implement deterministic registration IDs**

Use `captcha-auto-${sha256(hostname).slice(0, 16)}` as the registration ID. Register `content-scripts/content.js` only for `http://hostname/*` and `https://hostname/*`, with `persistAcrossSessions: true` and the same run-at/world settings as the WXT definition. Reconcile registrations on extension install/startup and allowlist changes; remove registrations that no longer correspond to both stored allowlist state and granted origins.

- [ ] **Step 4: Add debounced refresh observation**

Observe added `<img>` elements, changes to `src`/`srcset`, and capture-phase `load` events. Maintain an element-local revision counter in a `WeakMap`; combine it with current source and dimensions so a same-URL CAPTCHA reload is still a new revision. Debounce each candidate for 150 ms and process each revision once. When an allowlist entry is removed, unregister future injection and send a disable message to matching open tabs so already-running observers disconnect immediately.

- [ ] **Step 5: Run tests and commit**

Run: `npm test -- tests/platform/content-registration.test.ts tests/platform/image-fetch.test.ts tests/content/orchestrator.test.ts && npm run build`

Expected: PASS.

```bash
git add src/background entrypoints/background.ts entrypoints/content.ts tests/platform tests/content
git commit -m "feat: automate allowlisted captcha recognition"
```

## Task 12: Implement Context Menu and Popup Workflows

**Files:**
- Create: `src/background/context-menu.ts`
- Create: `src/popup/controller.ts`
- Modify: `entrypoints/background.ts`
- Modify: `entrypoints/popup/index.html`
- Modify: `entrypoints/popup/main.ts`
- Create: `entrypoints/popup/style.css`
- Create: `tests/platform/context-menu.test.ts`
- Create: `tests/platform/popup-controller.test.ts`

- [ ] **Step 1: Write failing context-menu routing tests**

Verify one image-only menu item is created, a click first ensures `content-scripts/content.js` is present under the click's `activeTab` grant and then routes `srcUrl` and tab ID to it, duplicate `srcUrl` matches return an ambiguity result, unsupported pages show a typed error, and the handler never requests form submission.

- [ ] **Step 2: Write failing popup controller tests**

Test current-host lookup, permission-first allowlist enablement, permission removal, manual scan, candidate/result rendering, retry, copy, confirm fill, and explicit replacement.

- [ ] **Step 3: Run tests and verify failure**

Run: `npm test -- tests/platform/context-menu.test.ts tests/platform/popup-controller.test.ts`

Expected: FAIL with unresolved imports.

- [ ] **Step 4: Implement the menu and compact popup**

The popup is a 340 px work surface with one site toggle, one primary scan command, a stable status region, and a flat result list. Use native controls, clear focus states, no decorative cards, no gradients, and no explanatory marketing copy. Buttons must not resize when status changes.

- [ ] **Step 5: Wire confirmation-only low-confidence behavior**

High-confidence results fill only empty fields. Low-confidence, no-field, and ambiguous-field results remain in the popup with copy or explicit confirmation actions. Only an explicit replacement action can change a non-empty field.

- [ ] **Step 6: Run tests, build, and inspect the popup at 340 x 520**

Run: `npm test -- tests/platform && npm run typecheck && npm run build`

Expected: PASS with no clipped or overlapping popup controls.

- [ ] **Step 7: Commit**

```bash
git add src/background/context-menu.ts src/popup entrypoints/background.ts entrypoints/popup tests/platform
git commit -m "feat: add manual captcha workflows"
```

## Task 13: Add End-to-End, Offline, and No-Submit Verification

**Files:**
- Create: `tests/e2e/extension.spec.ts`
- Create: `tests/e2e/fixtures/server.ts`
- Create: `tests/e2e/fixtures/single.html`
- Create: `tests/e2e/fixtures/multiple.html`
- Create: `tests/e2e/fixtures/dynamic.html`
- Create: `tests/e2e/fixtures/controlled.html`
- Modify: `playwright.config.ts`

- [ ] **Step 1: Add fixture pages with submission traps**

Every fixture increments `window.__submitCount` from both `submit` and submit-button click listeners. Include one simple form, multiple independent forms, dynamic image refresh, ambiguous fields, pre-filled fields, and a controlled-input simulation that rejects direct property assignment without native setter events.

- [ ] **Step 2: Write failing extension tests**

Launch Chromium with `--disable-extensions-except` and `--load-extension` pointing to `.output/chrome-mv3`. Cover popup scan, allowlist permission, automatic refresh recognition, low-confidence confirmation, and explicit replacement. Context-menu routing is covered at the shared handler boundary in Task 12 and by the final manual Chrome/Edge smoke test; do not add a production-only test hook for browser UI that Playwright cannot invoke.

- [ ] **Step 3: Assert the safety invariants in every workflow**

```ts
await expect(page.locator('#captcha-answer')).toHaveValue(expectedValue);
expect(await page.evaluate(() => window.__submitCount)).toBe(0);
```

Also assert non-empty fields remain unchanged in automatic mode.

After every workflow, inspect `storage.local` from the extension context and assert it contains only the versioned settings object. It must contain no image bytes/data URLs, page URLs, OCR text, field values, results, history, or telemetry keys.

- [ ] **Step 4: Add a no-external-network assertion**

Start a local trap proxy for the test browser, bypass only the local fixture host, and disable Chromium background networking features. Clear startup noise before each recognition action; fail if the proxy receives any new external HTTP request or HTTPS `CONNECT` while OCR runs. Independently wrap the background/offscreen fetch adapters in tests and assert they receive only the selected image URL or extension-local asset URLs. Repeat one recognition after setting the page context offline. This pair of checks covers extension runtime paths without relying on page-only Playwright request events.

- [ ] **Step 5: Run the full browser suite**

Run: `npm run build && npm run test:e2e`

Expected: all tests pass; every fixture reports `__submitCount === 0`; no external extension request is recorded.

- [ ] **Step 6: Commit**

```bash
git add tests/e2e playwright.config.ts
git commit -m "test: verify offline browser workflows"
```

## Task 14: Complete MVP Documentation and Release-Candidate Verification

**Files:**
- Create: `README.md`
- Create: `docs/testing/real-site-validation.md`
- Create: `docs/testing/ocr-benchmark.md`
- Modify: `THIRD_PARTY_NOTICES.md`

- [ ] **Step 1: Document unpacked installation and scope**

README must cover Chrome and Edge unpacked installation, three entry points, local-only processing, exact supported CAPTCHA types, the no-submit guarantee, allowlist permission behavior, unsupported scenarios, development commands, and license attribution.

- [ ] **Step 2: Record the benchmark decision**

Copy the committed benchmark summary into `docs/testing/ocr-benchmark.md`, including corpus composition, ddddocr/Tesseract results, selected preprocessing, cold/warm latency, package-size impact, and the reason the chosen engine passed the gate.

- [ ] **Step 3: Perform real-site validation without collecting private data**

For each authorized test site, record only hostname, browser/version, CAPTCHA category, attempted count, correct count, median warm latency, entry point used, and compatibility notes. Do not store screenshots, CAPTCHA text, credentials, form values, or page URLs beyond the hostname.

- [ ] **Step 4: Run complete verification**

Run:

```bash
npm run assets:sync
npm run typecheck
npm run test:coverage
npm run benchmark
npm run build
npm run build:verify -- .output/chrome-mv3
npm run build:edge
npm run build:verify -- .output/edge-mv3
npm run test:e2e
git diff --check
```

Expected:

- every command exits 0;
- OCR accuracy gates are at least 90%;
- warm inference target is met on the test machine or explicitly reported with measured evidence;
- Chrome and Edge unpacked output directories exist;
- both build-content checks confirm benchmark-only dependencies and unused ORT variants are absent;
- no submission or external-network test fails;
- `git diff --check` prints nothing.

- [ ] **Step 5: Manually smoke-test stable Chrome and Edge**

Load each unpacked build and verify allowlist, popup scan, image context menu, dynamic refresh, low-confidence confirmation, non-empty-field protection, and zero form submissions. Record results in `docs/testing/real-site-validation.md`.

- [ ] **Step 6: Request code review before calling the MVP complete**

Invoke `superpowers:requesting-code-review`, address validated findings, then invoke `superpowers:verification-before-completion` and rerun the complete verification command set.

- [ ] **Step 7: Commit**

```bash
git add README.md docs/testing THIRD_PARTY_NOTICES.md
git commit -m "docs: complete MVP validation guide"
```

## Completion Boundary

This plan ends with validated unpacked Chrome and Edge builds. Store listing copy, screenshots, branding, privacy-policy hosting, signing, and marketplace submission belong to a separate store-readiness plan created only after the user approves the MVP on real sites.
