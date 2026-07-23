# Local OCR Accuracy V1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Improve the fully local OCR pipeline's arithmetic recognition with grammar-constrained CTC decoding while producing a deconfounded, reproducible benchmark that preserves the existing 90% hard gate.

**Architecture:** Keep the pinned `common_old.onnx` and one inference per image. Add a bounded arithmetic prefix beam decoder beside the existing greedy decoder, select it only for arithmetic mode, and retain greedy fallback. Upgrade generated corpus metadata to schema version 2 with independently shuffled style assignments, then extend reports with per-operator and confidence-selective metrics.

**Tech Stack:** TypeScript 5.9, Vitest 3.2, ONNX Runtime Web 1.23, WXT 0.20, `@napi-rs/canvas`, deterministic local benchmark assets.

---

## File Map

- Create `src/ocr/arithmetic-ctc-decoder.ts`: bounded arithmetic grammar, prefix beam search, forced alignment confidence.
- Create `tests/ocr/arithmetic-ctc-decoder.test.ts`: decoder behavior, validation, immutability, determinism.
- Modify `src/ocr/ddddocr-engine.ts`: route arithmetic mode through the structured decoder with greedy fallback.
- Modify `tests/ocr/ddddocr-engine.test.ts`: integration and one-inference guarantees.
- Modify `benchmark/generate-corpus.ts`: schema version 2 and independent deterministic assignments.
- Modify `benchmark/corpus.ts`: parse generated schema version 2.
- Modify `benchmark/corpus.generated.json`: regenerated labels.
- Modify `benchmark/fixtures/generated/*.png`: regenerated deterministic images.
- Modify `tests/benchmark/generate-corpus.test.ts`: deconfounding and coverage assertions.
- Modify `tests/benchmark/corpus.test.ts`: schema version 2 parsing assertions.
- Modify `benchmark/report.ts`: operator and confidence-selective metrics.
- Modify `benchmark/run.ts`: render the new metrics in JSON and Markdown.
- Modify `tests/benchmark/report.test.ts`: metric boundary and grouping tests.
- Modify `docs/progress/2026-07-23-mvp-handoff.md`: v2 baseline, optimized result, remaining gap, next iteration.

## Task 1: Generate a Deconfounded Version 2 Corpus

**Files:**
- Modify: `benchmark/generate-corpus.ts`
- Modify: `benchmark/corpus.ts`
- Modify: `tests/benchmark/generate-corpus.test.ts`
- Modify: `tests/benchmark/corpus.test.ts`
- Regenerate: `benchmark/corpus.generated.json`
- Regenerate: `benchmark/fixtures/generated/*.png`

- [ ] **Step 1: Write the failing schema and coverage tests**

Change the generated manifest assertion to version 2 and add an arithmetic coverage test that proves each operator is not bound to one style:

```ts
expect(manifest.schemaVersion).toBe(2);

for (const operator of ['+', '-', 'x', '÷'] as const) {
  const matches = manifest.samples.filter(
    (sample) => sample.category === 'arithmetic' && sample.answer.includes(operator),
  );
  expect(matches.length).toBeGreaterThanOrEqual(12);
  expect(new Set(matches.map((sample) => sample.generation.fontFamily)).size)
    .toBeGreaterThanOrEqual(3);
  expect(new Set(matches.map((sample) => sample.generation.contrastBand))).toEqual(
    new Set(['4.5:1', '7:1', '12:1', '18:1']),
  );
  expect(new Set(matches.map((sample) => sample.generation.interferenceLines))).toEqual(
    new Set([1, 2]),
  );
}
```

In `tests/benchmark/corpus.test.ts`, update valid generated fixtures to `schemaVersion: 2` and add:

```ts
it('rejects legacy generated manifests so benchmark identity is explicit', () => {
  expect(() => parseGeneratedManifest({
    schemaVersion: 1,
    seed: 1,
    samples: [],
  })).toThrow(/schemaVersion/i);
});
```

- [ ] **Step 2: Run the focused tests and verify RED**

Run:

```bash
npm test -- tests/benchmark/generate-corpus.test.ts tests/benchmark/corpus.test.ts
```

Expected: FAIL because the generator and parser still emit/accept schema version 1 and arithmetic styles remain coupled.

- [ ] **Step 3: Implement independent deterministic assignments**

Change only the generated manifest type to version 2. Keep the real manifest at version 1.

Add deterministic balanced assignment helpers in `benchmark/generate-corpus.ts`:

```ts
function seededRandom(seed: number): () => number {
  return mulberry32(seed >>> 0);
}

function balancedAssignments<T>(
  seed: number,
  values: readonly T[],
  count: number,
): T[] {
  const random = seededRandom(seed);
  const balanced = Array.from({ length: count }, (_, index) => values[index % values.length]);
  return shuffle(random, balanced);
}

function hasArithmeticCoverage(
  operators: readonly string[],
  fonts: readonly (typeof FONTS)[number][],
  palettes: readonly (typeof PALETTES)[number][],
  lineCounts: readonly (1 | 2)[],
): boolean {
  return ['+', '-', 'x', '÷'].every((operator) => {
    const indexes = operators.flatMap((value, index) => value === operator ? [index] : []);
    return new Set(indexes.map((index) => fonts[index].family)).size >= 3
      && new Set(indexes.map((index) => palettes[index].band)).size === 4
      && new Set(indexes.map((index) => lineCounts[index])).size === 2;
  });
}
```

Build separate assignments from distinct seed salts. If the arithmetic coverage predicate fails, increment only the style seed salts and retry, bounded to 1,000 attempts; throw after the bound. Do not use one `index % N` expression for all variables.

Change arithmetic generation to accept its assigned operator:

```ts
function arithmetic(
  random: () => number,
  operator: '+' | '-' | 'x' | '÷',
): { answer: string; fill: string } {
  if (operator === '÷') {
    const divisor = integer(random, 2, 9);
    const quotient = integer(random, 2, 12);
    return { answer: `${divisor * quotient}÷${divisor}`, fill: String(quotient) };
  }
  let left = integer(random, 2, 49);
  let right = integer(random, 2, 29);
  if (operator === '-' && right > left) [left, right] = [right, left];
  const fill = operator === '+' ? left + right : operator === '-' ? left - right : left * right;
  return { answer: `${left}${operator}${right}`, fill: String(fill) };
}
```

Update `GeneratedCorpusManifest` and `parseGeneratedManifest` to require `schemaVersion: 2`.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run:

```bash
npm test -- tests/benchmark/generate-corpus.test.ts tests/benchmark/corpus.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 5: Regenerate and verify deterministic assets**

Run twice:

```bash
npm run benchmark:generate
git status --short
npm run benchmark:generate
git status --short
```

Expected: the second generation does not change the first generation's file set or bytes. Exactly 200 generated PNG files remain.

- [ ] **Step 6: Commit the version 2 corpus**

```bash
git add benchmark/generate-corpus.ts benchmark/corpus.ts benchmark/corpus.generated.json benchmark/fixtures/generated tests/benchmark/generate-corpus.test.ts tests/benchmark/corpus.test.ts
git commit -m "test: deconfound generated OCR corpus"
```

## Task 2: Add Operator and Confidence-Selective Metrics

**Files:**
- Modify: `benchmark/report.ts`
- Modify: `benchmark/run.ts`
- Modify: `tests/benchmark/report.test.ts`

- [ ] **Step 1: Write failing metric tests**

Add predictions covering all normalized operator groups and threshold boundaries:

```ts
it('groups arithmetic source and fill accuracy by normalized operator', () => {
  const metrics = buildReport([
    prediction({ category: 'arithmetic', expected: '1+2', actual: '1+2', expectedFill: '3', actualFill: '3', confidence: 0.8 }),
    prediction({ category: 'arithmetic', expected: '8÷2', actual: '8-2', expectedFill: '4', actualFill: '6', confidence: 0.8 }),
    prediction({ category: 'arithmetic', expected: '7x3', actual: '7X3', expectedFill: '21', actualFill: '21', confidence: 0.8 }),
    prediction({ category: 'arithmetic', expected: '9-4', actual: '94', expectedFill: '5', confidence: 0.8 }),
  ], PACKAGE_OPTIONS);

  expect(metrics.arithmeticByOperator).toMatchObject({
    addition: { sampleCount: 1, wholeStringAccuracy: 1, fillAccuracy: 1 },
    subtraction: { sampleCount: 1, wholeStringAccuracy: 0, fillAccuracy: 0 },
    multiplication: { sampleCount: 1, wholeStringAccuracy: 0, fillAccuracy: 1 },
    division: { sampleCount: 1, wholeStringAccuracy: 0, fillAccuracy: 0 },
  });
});

it('reports selective precision and coverage at the fixed threshold', () => {
  const metrics = buildReport([
    prediction({ category: 'digits', expected: '1234', actual: '1234', confidence: 0.90 }),
    prediction({ category: 'digits', expected: '5678', actual: 'wrong', confidence: 0.95 }),
    prediction({ category: 'digits', expected: '9012', actual: '9012', confidence: 0.89 }),
  ], PACKAGE_OPTIONS);

  expect(metrics.selectiveAt90.ordinary).toEqual({
    threshold: 0.9,
    acceptedCount: 2,
    coverage: 2 / 3,
    precision: 0.5,
  });
});
```

Add arithmetic predictions and assert `metrics.selectiveAt90.arithmetic` independently. Add a zero-coverage case expecting `precision: null`, so JSON never serializes `NaN`.

- [ ] **Step 2: Run report tests and verify RED**

```bash
npm test -- tests/benchmark/report.test.ts
```

Expected: FAIL because `arithmeticByOperator` and `selectiveAt90` do not exist.

- [ ] **Step 3: Implement report metrics**

Add these public types:

```ts
export type ArithmeticOperatorGroup =
  | 'addition'
  | 'subtraction'
  | 'multiplication'
  | 'division';

export interface SelectiveMetrics {
  readonly threshold: 0.9;
  readonly acceptedCount: number;
  readonly coverage: number;
  readonly precision: number | null;
}

export interface SelectiveMetricsByScope {
  readonly ordinary: SelectiveMetrics;
  readonly arithmetic: SelectiveMetrics;
}

export interface ArithmeticOperatorMetrics {
  readonly sampleCount: number;
  readonly wholeStringAccuracy: number;
  readonly fillAccuracy: number;
}
```

Extend `BenchmarkMetrics` with:

```ts
readonly arithmeticByOperator: Record<ArithmeticOperatorGroup, ArithmeticOperatorMetrics>;
readonly selectiveAt90: SelectiveMetricsByScope;
```

Normalize expected operators, never predicted operators:

```ts
function operatorGroup(expected: string): ArithmeticOperatorGroup {
  if (expected.includes('+')) return 'addition';
  if (expected.includes('-')) return 'subtraction';
  if (/[xX×*]/.test(expected)) return 'multiplication';
  if (/[÷/]/.test(expected)) return 'division';
  throw new TypeError(`Arithmetic benchmark label has no supported operator: ${expected}`);
}
```

Calculate each group from arithmetic predictions. For an empty group, return count 0 and both accuracies 0. Calculate selective metrics separately for ordinary and arithmetic predictions, including confidence exactly equal to 0.90. Ordinary precision compares `expected === actual`; arithmetic precision compares `expectedFill === actualFill`, because the product fills the evaluated result rather than the source expression. Coverage always uses the full corresponding scope as its denominator.

- [ ] **Step 4: Render the new metrics in Markdown**

In `benchmark/run.ts`, add an operator table for each engine and a selective summary. Use `n/a` when precision is null. Keep the hard-gate section unchanged.

- [ ] **Step 5: Run tests, typecheck, and commit**

```bash
npm test -- tests/benchmark/report.test.ts tests/benchmark/runner-support.test.ts
npm run typecheck
git add benchmark/report.ts benchmark/run.ts tests/benchmark/report.test.ts
git commit -m "feat: report local OCR diagnostic metrics"
```

Expected: PASS.

- [ ] **Step 6: Record the greedy version 2 baseline locally**

Before modifying production decoding, run:

```bash
npm run benchmark
local_ocr_benchmark_exit=$?
test "$local_ocr_benchmark_exit" -eq 0 || test "$local_ocr_benchmark_exit" -eq 2
cp benchmark/results/latest.json benchmark/results/baseline-v2-greedy.json
cp benchmark/results/latest.md benchmark/results/baseline-v2-greedy.md
```

Expected: benchmark processes both local engines, writes the report with operator and scoped selective metrics, and normally exits 2 because the unchanged hard gate remains blocked. The two baseline files stay ignored by Git.

## Task 3: Implement the Arithmetic Prefix Beam Decoder

**Files:**
- Create: `src/ocr/arithmetic-ctc-decoder.ts`
- Create: `tests/ocr/arithmetic-ctc-decoder.test.ts`

- [ ] **Step 1: Write the failing recovery test**

Use a small charset where blank beats minus at the operator timestep:

```ts
const CHARSET = ['', '1', '2', '7', '+', '-', '÷', '='] as const;

it('recovers a complete subtraction when greedy CTC drops the minus as blank', () => {
  const rows = [
    row('1'), row(''), row('2'), row(''),
    scores({ '': 5, '-': 4, '+': 1 }),
    row(''), row('7'),
  ];

  expect(decodeCtc(flatten(rows), [1, rows.length, CHARSET.length], CHARSET, ALLOWED))
    .toMatchObject({ text: '127' });
  expect(decodeArithmeticCtc(flatten(rows), [1, rows.length, CHARSET.length], CHARSET))
    .toMatchObject({ text: '12-7' });
});
```

The test helper `scores` must initialize unspecified logits to `-10`, and `row(character)` must make the requested class the unique winner.

- [ ] **Step 2: Add failing grammar, semantics, and CTC tests**

Cover these exact behaviors:

```ts
expect(decodeArithmeticCtc(logitsFor('1', '2'), dims, CHARSET)).toBeNull();
expect(decodeArithmeticCtc(logitsFor('1', '+'), dims, CHARSET)).toBeNull();
expect(decodeArithmeticCtc(logitsFor('1', '+', '+', '2'), dims, CHARSET)).toBeNull();
expect(decodeArithmeticCtc(logitsFor('1', '÷', '0'), dims, CHARSET)).toBeNull();
expect(decodeArithmeticCtc(logitsFor('7', '÷', '2'), dims, CHARSET))
  .toMatchObject({ text: '7÷2' });
```

Also test `11+2` with blank separating the two `1` classes, optional `=`, both tensor layouts, deterministic tie-breaking, non-finite logits, charset mismatch, invalid blank entry, and input immutability.

- [ ] **Step 3: Run decoder tests and verify RED**

```bash
npm test -- tests/ocr/arithmetic-ctc-decoder.test.ts
```

Expected: FAIL with unresolved `arithmetic-ctc-decoder` import.

- [ ] **Step 4: Implement bounded log-space prefix beam search**

Create `src/ocr/arithmetic-ctc-decoder.ts` with these constants and state:

```ts
const BEAM_WIDTH = 24;
const OPERATORS = new Set(['+', '-', '*', '/', 'x', 'X', '×', '÷']);
const SUFFIXES = new Set(['=', '?']);
const NEGATIVE_INFINITY = Number.NEGATIVE_INFINITY;

interface Beam {
  readonly prefix: string;
  readonly blank: number;
  readonly nonBlank: number;
}
```

Use `logAdd(left, right)` for stable probability merging. For every timestep:

1. Add the blank transition to the same prefix from `logAdd(blank, nonBlank)`.
2. Iterate only the first charset index for each relevant digit/operator/suffix character.
3. For a repeated last character, keep a collapsed transition from `nonBlank` and allow extension only from `blank`.
4. For a different character, extend from the total beam probability.
5. Reject prefixes longer than `MAX_OCR_TEXT_LENGTH` or not matching either `^[0-9]*$` or `^[0-9]+[+\-*/xX×÷][0-9]*[=?]?$`.
6. Merge identical prefixes with log-sum-exp.
7. Sort by total log probability descending, then prefix ascending, and retain 24.

After the final timestep, retain only `^[0-9]+[+\-*/xX×÷][0-9]+[=?]?$`. Call `analyzeArithmetic`; reject `unsupported`, allow `valid` and `non_integer_division`. Return null when no candidate survives.

- [ ] **Step 5: Implement forced-alignment confidence**

For the selected text, build the expanded CTC state sequence `blank, char, blank, ...`. Run Viterbi dynamic programming over timesteps with stay, advance-one, and legal advance-two transitions. Store backpointers. Reconstruct the best state path, calculate full-class softmax at every timestep, take the maximum aligned probability for each emitted character, and return their arithmetic mean.

If no finite alignment reaches the terminal character or trailing blank state, return null. Do not renormalize over the arithmetic charset.

- [ ] **Step 6: Run focused tests and verify GREEN**

```bash
npm test -- tests/ocr/arithmetic-ctc-decoder.test.ts tests/ocr/ctc-decoder.test.ts
npm run typecheck
```

Expected: PASS with the existing greedy decoder tests unchanged.

- [ ] **Step 7: Commit the decoder**

```bash
git add src/ocr/arithmetic-ctc-decoder.ts tests/ocr/arithmetic-ctc-decoder.test.ts
git commit -m "feat: decode arithmetic OCR with grammar constraints"
```

## Task 4: Integrate Structured Arithmetic Decoding

**Files:**
- Modify: `src/ocr/ddddocr-engine.ts`
- Modify: `tests/ocr/ddddocr-engine.test.ts`

- [ ] **Step 1: Write the failing engine integration test**

Extend the test charset with `2`, `7`, and `-`. Add a harness output where greedy arithmetic becomes `127` while the structured decoder can produce `12-7`.

```ts
it('uses structured arithmetic decoding without a second inference', async () => {
  const output = subtractionWithBlankDominatingMinus();
  const { engine, session, preprocessor } = createHarness(output);

  await expect(engine.recognize(IMAGE, ['arithmetic'])).resolves.toMatchObject([
    { mode: 'arithmetic', text: '12-7' },
  ]);
  expect(preprocessor.prepare).toHaveBeenCalledOnce();
  expect(session.run).toHaveBeenCalledOnce();
});
```

Add a test where no complete grammar candidate exists and assert the existing greedy result is returned.

- [ ] **Step 2: Run the engine test and verify RED**

```bash
npm test -- tests/ocr/ddddocr-engine.test.ts
```

Expected: FAIL because arithmetic still always uses `decodeCtc`.

- [ ] **Step 3: Implement minimal routing and fallback**

In `DdddOcrEngine.recognize`, keep one output extraction and route only arithmetic:

```ts
return uniqueModes.map((mode) => {
  const greedy = decodeCtc(output.data, output.dims, this.charset, ALLOWED_BY_MODE[mode]);
  const decoded = mode === 'arithmetic'
    ? decodeArithmeticCtc(output.data, output.dims, this.charset) ?? greedy
    : greedy;
  return { ...decoded, mode };
});
```

Do not catch decoder validation failures as normal fallback; the existing outer model error wrapper must preserve them as `model_unavailable` causes.

- [ ] **Step 4: Run focused and full tests**

```bash
npm test -- tests/ocr/ddddocr-engine.test.ts tests/ocr/arithmetic-ctc-decoder.test.ts tests/core/result-interpreter.test.ts
npm test
npm run typecheck
```

Expected: all tests PASS.

- [ ] **Step 5: Commit engine integration**

```bash
git add src/ocr/ddddocr-engine.ts tests/ocr/ddddocr-engine.test.ts
git commit -m "feat: use structured decoding for arithmetic OCR"
```

## Task 5: Benchmark the Optimized Decoder and Update Handoff

**Files:**
- Modify: `docs/progress/2026-07-23-mvp-handoff.md`

- [ ] **Step 1: Run the optimized local benchmark**

```bash
npm run benchmark
local_ocr_benchmark_exit=$?
test "$local_ocr_benchmark_exit" -eq 0 || test "$local_ocr_benchmark_exit" -eq 2
```

Expected: both engines use local files only, `benchmark/results/latest.json` and `.md` are written, and exit code is 0 only if both fixed 90% gates pass; otherwise exit code 2 is expected.

- [ ] **Step 2: Produce an exact before/after comparison**

Run:

```bash
node --input-type=module -e '
import fs from "node:fs";
const before = JSON.parse(fs.readFileSync("benchmark/results/baseline-v2-greedy.json", "utf8"));
const after = JSON.parse(fs.readFileSync("benchmark/results/latest.json", "utf8"));
for (const name of ["before", "after"]) {
  const report = name === "before" ? before : after;
  const metrics = report.engines.ddddocr.metrics;
  console.log(JSON.stringify({
    name,
    ordinary: report.gates.ordinaryWholeStringAccuracy,
    arithmeticFill: report.gates.arithmeticFillAccuracy,
    categories: metrics.categories,
    arithmeticByOperator: metrics.arithmeticByOperator,
    selectiveAt90: metrics.selectiveAt90,
  }, null, 2));
}
'
```

Expected: exact JSON for both runs on the same version 2 corpus.

- [ ] **Step 3: Update the handoff with observed evidence**

Add a dated “OCR accuracy v1” section containing:

- version 2 corpus identity and deconfounding rules;
- greedy baseline ordinary and arithmetic-fill accuracy;
- optimized ordinary and arithmetic-fill accuracy;
- per-operator source and fill accuracy before and after;
- confidence-0.90 coverage and precision;
- cold, median warm, and P95 latency;
- whether the hard gate remains blocked;
- the highest-impact remaining error class and the next recommended iteration.

Do not claim the hard gate passed unless `report.gates.passed` is true.

- [ ] **Step 4: Verify the documentation diff and commit**

```bash
git diff --check
git add -f docs/progress/2026-07-23-mvp-handoff.md
git commit -m "docs: record local OCR accuracy v1 results"
```

## Task 6: Full Local-Only Verification

**Files:**
- No planned source edits. Fix only failures caused by Tasks 1-5, using a new TDD cycle for behavioral changes.

- [ ] **Step 1: Verify tests and type safety**

```bash
npm test
npm run typecheck
```

Expected: all tests pass and TypeScript reports no errors.

- [ ] **Step 2: Verify production builds**

```bash
npm run build
npm run build:edge
```

Expected: Chrome and Edge MV3 builds succeed using packaged local assets.

- [ ] **Step 3: Verify local resource and dependency integrity**

```bash
npm ls --depth=0
npm test -- tests/ocr/assets.test.ts tests/ocr/asset-file-set.test.ts tests/ocr/asset-sync.test.ts
```

Expected: pinned model, charset, WASM, notices, and direct dependencies pass integrity checks.

- [ ] **Step 4: Verify benchmark termination semantics**

```bash
npm run benchmark
local_ocr_benchmark_exit=$?
test "$local_ocr_benchmark_exit" -eq 0 || test "$local_ocr_benchmark_exit" -eq 2
```

Expected: exit 0 when the unchanged hard gate passes, otherwise exit 2 after a complete paired report. Any other nonzero exit is a failure.

- [ ] **Step 5: Verify repository state**

```bash
git diff --check
git status --short
git log -6 --oneline
```

Expected: no unstaged implementation changes, no ignored benchmark reports accidentally committed, and the task commits appear in order.
