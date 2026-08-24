# Contributing to Captcha Helper

Thanks for helping improve Captcha Helper. Contributions should preserve the project's local-first privacy model, conservative automatic-fill policy, and intentionally narrow CAPTCHA scope.

## Before you start

- Search existing issues and pull requests.
- Open an issue before a large behavior, permission, model, or data change.
- Do not include credentials, private URLs, cookies, account data, or CAPTCHA samples you are not authorized to share.
- Keep changes focused. Unrelated refactors make privacy and model reviews harder.

## Development setup

Requirements: Node.js 22 or later and npm.

```sh
git clone https://github.com/hongshuo-wang/local-captcha-solver.git
cd local-captcha-solver
npm ci
npm run typecheck
npm test
npm run build
```

Run the built-extension tests with:

```sh
npx playwright install chromium
npm run test:e2e:extension
```

## Product scope

Core recognition is limited to static, single-image CAPTCHAs containing digits, English letters, alphanumeric strings, or one-step integer arithmetic. Arithmetic supports `+`, `-`, `*`, `/`, `x`, `X`, `×`, and `÷`.

Do not expand the core OCR model to image selection, sliders, puzzles, animation, behavioral challenges, niche scripts, or multi-step mathematics without an explicit product decision. The separately implemented puzzle-slider Beta may evolve as an independently authorized browser-interaction path, but it must remain outside OCR training data and preserve explicit user-controlled site scope.

Automatic filling must remain conservative. Ambiguous arithmetic and weak operator evidence must abstain rather than fall back to a digit result. The extension must never submit a form.

## CAPTCHA scenario contributions

A request for a new visual style should be reproducible rather than site-specific. Include:

1. Samples you are authorized to share.
2. Exact labels for every sample.
3. Source and license or permission information.
4. A unique scenario or template group that does not cross data splits.
5. A held-out benchmark that demonstrates the current failure.
6. A description of the visual mechanism missing from current coverage.

Do not add benchmark fixtures to training or validation data. Prefer extending deterministic generators or augmentation families over adding site-specific image hacks.

Read [docs/model-training.md](docs/model-training.md) and [docs/production-model-reproduction.md](docs/production-model-reproduction.md) before changing model or dataset behavior.

## Production model changes

A production model replacement requires all of the following:

- reproducible and pinned training inputs;
- stable labels, SHA-256 hashes, source, license, and group metadata;
- a completed model card;
- Paddle-to-ONNX numerical and decode consistency checks;
- the frozen benchmark with category, source, group, and operator reporting;
- Chrome and Edge offline verification; and
- the documented precision, coverage, cold-start, and warm-latency release gates.

Do not replace `public/models` to fix a single issue sample.

## Pull requests

- Add focused tests for behavior changes.
- Run `npm run typecheck` and `npm test` before opening the pull request.
- Run browser E2E tests when changing permissions, content scripts, inference, onboarding, settings, or popup behavior.
- Update both READMEs and the privacy policy when changing user-visible behavior or data handling.
- Update the changelog under `Unreleased` for changes users should know about.
- Keep generated downloads, checkpoints, training output, and extracted third-party data out of git.

By contributing, you agree that your source-code contribution is licensed under the repository's MIT License and that third-party assets retain their original licenses.
