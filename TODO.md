# Next Model Candidate TODO

## Goal

Train and evaluate a reproducible CAPTCHA model candidate that improves multicolor, crossing-line,
English-letter, and `0/O` recognition without reducing selective precision or weakening arithmetic
abstention. Do not replace the production model until every release gate passes. Puzzle-slider handling is a separate browser-interaction Beta and is intentionally excluded from this model candidate.

## Handoff state

- The current worktree contains uncommitted product, benchmark, data-recipe, documentation, and test
  changes. Preserve and review them; do not discard or overwrite them when starting the next session.
- Exact-host recognition modes are implemented for `auto`, `digits`, `letters`, `alphanumeric`, and
  `arithmetic`. Recognition uses the selected character constraint without silently falling back to
  another mode.
- The authorized frozen regression labeled `UDJN` is stored at
  `benchmark/fixtures/real/36ffa6f15c1962fc484e8e2d0e31791e85b5a7b1f4a551af6b76e3a6eb66136a.png`.
  Its SHA-256 is the filename, and it must never enter training or validation data.
- The next-candidate recipe includes split-isolated multicolor-crossline templates, deterministic
  labels containing both `0` and uppercase `O`, and a 10% balanced alphanumeric reservation for
  those contrast samples.
- The production files under `public/models` have not been changed. On the frozen `UDJN` sample,
  the current production model returns `UDJ` in letters mode and `UDJ9` in alphanumeric mode; both
  remain below the automatic-fill threshold and correctly abstain.
- Last completed verification: typecheck passed, 612 unit tests passed, Chrome and Edge production
  builds passed, extension E2E passed 4/4, and `git diff --check` passed.

## Required work

- [ ] Read `AGENTS.md`, `docs/model-training.md`, `docs/production-model-reproduction.md`, and
  `training/ppocrv6-captcha/README.md` before running data or training commands.
- [ ] Review the existing dirty worktree and rerun the focused training tests. Commit only when the
  user explicitly requests it.
- [ ] Create a new candidate model card from
  `training/ppocrv6-captcha/model-card-template.md`; record the Git revision, environment, hardware,
  dependencies, random seed, and all input hashes before training.
- [ ] Rebuild the approved public and synthetic data using the pinned sources and current generator.
  Keep downloads, extracted data, generated images, checkpoints, and training output out of Git.
  Commit only reviewed manifests, pinned source metadata, licenses, generation code, documentation,
  and intentionally redistributable fixtures.
- [ ] Generate the 320k balanced label list and verify that the alphanumeric bucket reserves 10% for
  samples containing both `0` and `O` when eligible samples exist.
- [ ] Run the manifest preflight. Confirm stable labels and SHA-256 values, known licenses, no duplicate
  or frozen-benchmark hashes, and no scenario group crossing train, validation, or test splits.
- [ ] Record dataset counts and hashes in the candidate model card. Do not reuse historical production
  hashes after regenerating the new recipe.
- [ ] Train the pinned two-stage candidate described in `training/ppocrv6-captcha/README.md`: head
  warmup followed by full fine-tuning. Preserve logs, resolved configuration, checkpoint hashes, and
  any resume events in ignored experiment storage.
- [ ] Select the candidate using isolated validation only. Use the frozen benchmark after candidate
  selection, not for tuning thresholds, augmentations, or epochs.
- [ ] Report results by category, source, scenario group, arithmetic symbol, and confidence bucket.
  Include whole-string accuracy, character accuracy, arithmetic answer accuracy, `0/O` confusion,
  high-confidence errors, selective precision, and coverage.
- [ ] Export Paddle inference artifacts and an unoptimized ONNX candidate. Verify 71 CTC output
  classes, numeric logit tolerance, identical decoded strings on the parity set, and artifact hashes.
- [ ] Run the Node/WASM frozen benchmark, then Chrome and Edge offline recognition benchmarks on the
  documented reference machine. Record cold start, warm P50/P95, model size, and memory.
- [ ] Reject the candidate unless automatic-fill precision is at least 99.5%, coverage is at least
  80%, cold start is at most 3 seconds, warm single-image P95 is at most 500 ms, all frozen real
  samples are exact, and arithmetic ambiguity still abstains.
- [ ] Request a separate integration review before copying any candidate into `public/models`.
  Production replacement also requires an approved completed model card, Paddle/ONNX parity,
  Chrome/Edge offline verification, full tests, production builds, and updated release documentation.

## Explicit non-goals

- Do not hard-code the `UDJN` label, image hash, colors, dimensions, or source website into OCR logic.
- Do not implement a global `0 -> O` or `O -> 0` replacement; mode constraints and calibrated model
  evidence determine the allowed output.
- Do not expand the core model to non-Latin scripts, sliders, image selection, animation, behavioral
  challenges, or multi-step mathematics.
- Do not add a second production model unless the primary candidate fails the documented selective
  precision and coverage gates on isolated groups and a separate product decision approves it.

## Suggested next-conversation prompt

> Read `AGENTS.md` and `TODO.md`, preserve the existing dirty worktree, and start the next model
> candidate from the data preflight. Follow the pinned training documentation, keep the `UDJN` frozen
> fixture out of training and validation, update the candidate model card as evidence is produced,
> and do not replace `public/models` unless every release gate passes.
