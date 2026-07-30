# Model Training and Scenario Contributions

当前生产模型的实际数据、训练谱系、精确导出命令和浏览器验收步骤见
[`production-model-reproduction.md`](production-model-reproduction.md)。本文继续负责场景贡献规则和发布门槛。

> Status: maintained skeleton. TODO after the first production-quality model: add issue templates,
> scenario-package automation, end-to-end importer examples, and contributor CI. Current model
> accuracy and reproducible training data remain the priority.

This document is the reproducible path for improving the offline CAPTCHA model. It applies both to maintainers and to contributors proposing support for a CAPTCHA style reported in an issue.

## Supported task

The production model recognizes one static image containing:

- digits, English letters, or alphanumeric text;
- one operation between two nonnegative integers using `+ - * / x X × ÷`;
- common arithmetic suffixes: `=?`, `=`, `?`, or no suffix.

Subtraction samples use nonnegative answers and division samples divide exactly. Negative answers, decimals, remainders, multi-step expressions, parentheses, text questions, non-Latin scripts, animated CAPTCHA, image selection, sliders, and behavioral challenges are outside the core model.

## Contributing a scenario

An issue screenshot is evidence of a failure, but it is not a training set. A scenario contribution needs:

1. Multiple authorized images with exact OCR labels and arithmetic fill values where applicable.
2. Provenance and license/permission that allows local model training. State separately whether the original images may be redistributed.
3. A stable scenario group such as a generator version or website/template family. Do not reuse a group from another split.
4. A short description of the missing visual mechanism: for example hollow glyphs, touching characters, perspective warp, foreground arcs, low contrast, or operator occlusion.
5. Held-out examples added to the real benchmark before tuning. Their hashes must never appear in training or validation.

Do not solve an issue by hard-coding its expected text, image hash, colors, dimensions, or hostname into OCR logic.

## Coverage matrix

Training batches should combine independent values across these dimensions rather than define a finite list of CAPTCHA types:

| Dimension | Common coverage |
| --- | --- |
| Content | digits, lower/upper letters, alphanumeric, arithmetic |
| Glyph | multiple licensed fonts, handwriting-like, hollow/outline, dot-like, shadow/static 3D |
| Geometry | spacing, rotation, scale, shear, wave, perspective, curved baseline, touching/overlap |
| Interference | dots, lines, arcs, grids, shapes, background text, masking, partial occlusion |
| Imaging | color, low contrast, inversion, texture, alpha, blur, resampling, JPEG/WebP artifacts |
| Sequence | variable length, ambiguous glyph pairs, common arithmetic operator and suffix variants |

Rare scripts and puzzle formats are not added merely to increase nominal coverage.

## Data layout and isolation

`training/ppocrv6-captcha/data/manifest.json` is the source of truth. Every sample records:

- `id`, `image`, `label`, and lowercase SHA-256;
- `source`: `synthetic`, `public`, or `real`;
- `licenseId` and a license entry with redistribution status;
- `group`, representing a generator/template/site family;
- `split`: `train`, `validation`, or `test`.

One group may appear in only one split. The frozen files under `benchmark/fixtures` are test-only and are rejected from the training manifest by hash. Public datasets are not considered independent validation if train and validation use the same generator.

Downloaded archives and extracted images live under ignored directories. Never commit them by default. Commit the pinned source/version metadata, archive hash, importer, manifest, and license record so another contributor can reproduce the same data locally.

The machine-readable source catalog is `training/ppocrv6-captcha/public-datasets.ts`. A source marked `candidate` is documentation only and the fetch command rejects it. A `verified` source has a reviewed license, fixed upstream version, byte count, and SHA-256.

```bash
npm run training:public:fetch -- mathcaptcha10k-v6
```

The currently verified MathCaptcha10k source supplies one `+/-` generator family for training. It must not be used as independent validation and it does not replace multiplication/division synthesis. Larger alphanumeric and digit sources remain candidates until their complete archives and label structures are audited.

## Reproducible workflow

From the repository root:

```bash
npm install
npm run training:ppocrv6:fetch
npm test -- tests/training
```

Before a real run, populate the validated manifest, regenerate PaddleOCR label files from it, and record manifest/source counts in a model card. The current scaffold requires at least 100k synthetic training images and 10k isolated synthetic validation images, plus any approved public or real groups.

Use the pinned PaddleOCR checkout, PaddlePaddle version, checkpoint, charset, config, random seed, and two-stage commands documented in `training/ppocrv6-captcha/README.md`. Do not silently change a dependency revision when resuming a run.

The release path is:

```text
manifest preflight
  -> head warmup
  -> full fine-tune
  -> isolated validation
  -> Paddle inference export
  -> ONNX conversion and numerical/decode parity
  -> frozen Node/WASM benchmark
  -> Chrome/Edge offline benchmark
  -> model card and production review
```

## Acceptance and release

A candidate model may ship only when it meets all current product gates:

- automatic-fill precision at least 99.5%;
- coverage at least 80%;
- cold start at most 3 seconds and warm P95 at most 500 ms on the recorded reference system;
- results reported by category, source, scenario group, and arithmetic symbol;
- no digits fallback when arithmetic evidence is structurally ambiguous;
- all assets bundled locally with no runtime model or image upload.

Model size is optimized only after the accuracy gates pass. Quantization or graph changes must rerun the complete isolated benchmark.

## Model card requirements

Copy `training/ppocrv6-captcha/model-card-template.md` for every candidate and record:

- source revision, environment, hardware, seed, config, and commands;
- dataset manifest hash, source/license counts, and group split summary;
- checkpoint and exported model hashes;
- exact, character, arithmetic-fill, selective precision/coverage, latency, and size metrics;
- known failed scenario groups and explicit non-goals.

A binary model without these records is not a reproducible contribution and must not replace the production asset.
