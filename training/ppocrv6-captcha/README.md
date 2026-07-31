# PP-OCRv6 tiny CAPTCHA training scaffold

Contributor-facing data, scenario, evaluation, and release requirements are defined in
[`docs/model-training.md`](../../docs/model-training.md). Read that document before adding a
dataset or changing the recipe.

The production model's actual exploratory lineage, reproducible data commands, verified bit-exact
export commands, clean-room retraining path, and browser release checks are documented in
[`docs/production-model-reproduction.md`](../../docs/production-model-reproduction.md). The
two-stage 3+60 epoch commands below are the clean-room retraining scaffold, not the historical
training lineage of the current production checkpoint.

This directory contains the reproducible inputs and tooling used to train the 71-class CAPTCHA CTC model. The approved `paddle-ctc-v4-decoupled-320k` model card is under `model-cards/`, and its exported ONNX/config pair is the production asset in `public/models`. Training images, downloads, checkpoints, and exported working files remain ignored; regenerate them only after the independent preflight checks pass.

The fixed recognition alphabet is the 70 visible characters in `charset.txt`. PaddleOCR adds CTC blank at index 0, producing exactly 71 CTC classes. `use_space_char` must remain false. The NRTR auxiliary training head has its own control tokens and is not part of the exported CTC class count.

## Pinned inputs

- PaddleOCR tag: `v3.7.0`
- PaddleOCR commit: `b03f46425e8ff4442b268ce449e3eef758146cd4`
- Training config base: `configs/rec/PP-OCRv6/PP-OCRv6_tiny_rec.yml`
- PaddlePaddle target: `3.2.0`; the recorded production environment uses Python `3.12.11` on Apple M4 Pro CPU
- Official checkpoint: `PP-OCRv6_tiny_rec_pretrained.pdparams`
- Checkpoint bytes: `71,528,759`
- Checkpoint SHA-256: `960cb4aa5276e3ac235b7f671fb8c9a7c1c1423617da0f96da66a33d0ed53f84`

Use a dedicated environment matching `python-environment.txt` when reproducing the recorded CPU setup. For NVIDIA training, install the CUDA build of PaddlePaddle 3.2.0 selected for the host's CUDA version, then install the remaining pinned dependencies. Do not substitute an unrecorded PaddleOCR revision.

```bash
git clone --branch v3.7.0 --depth 1 https://github.com/PaddlePaddle/PaddleOCR.git /opt/PaddleOCR-v3.7.0
git -C /opt/PaddleOCR-v3.7.0 rev-parse HEAD
python3 -m pip install -r /opt/PaddleOCR-v3.7.0/requirements.txt
python3 -c "import paddle; print(paddle.__version__); paddle.utils.run_check()"
```

The revision command must print the commit above, and the Paddle version must be `3.2.0`. Record the Python, Paddle, CUDA, cuDNN, GPU, driver, PaddleOCR revision, and package lock in the model card.

## Assets and data preflight

From the project root, fetch and verify only the official checkpoint:

```bash
npm run training:ppocrv6:fetch
npm test -- tests/training/ppocrv6-captcha-assets.test.ts tests/training/ppocrv6-captcha-contract.test.ts tests/training/ppocrv6-captcha-dataset.test.ts
```

`data/manifest.json` is the source of truth. Every image needs an exact hash, source (`synthetic`, `public`, or `real`), license, and template/site group. Groups cannot cross splits. Duplicate images, unsupported characters, labels over 12 characters, unknown licenses, and any hash from the frozen benchmark are rejected. Generate PaddleOCR's tab-separated `train.txt` and `validation.txt` only from a successfully validated manifest.

Before an approved training run, require at least the planned 100k synthetic training and 10k synthetic validation samples, plus any separately licensed public/real data. Keep the committed benchmark fixtures test-only. Store the manifest validation result and source/license counts in the model card.

## Rendered training commands

These commands are documentation for a later approved run. They have not been executed. Run from the project root and replace `/opt/PaddleOCR-v3.7.0` only with an absolute checkout at the pinned commit.

Stage A freezes `model.backbone` and trains the MultiHead for three epochs:

```bash
PADDLEOCR_ROOT=/opt/PaddleOCR-v3.7.0 CUDA_VISIBLE_DEVICES=0 \
  python3 training/ppocrv6-captcha/train_head_warmup.py \
  -c training/ppocrv6-captcha/config.yml -o \
  Global.epoch_num=3 \
  Global.save_model_dir=./training/ppocrv6-captcha/output/warmup
```

The log must show nonzero `frozen_backbone` and `trainable_head` counts. It must also show that most backbone parameters loaded from the official checkpoint. Stop the experiment if the checkpoint revision/hash is wrong, the output dimensions are not 71 CTC classes, or backbone loading is sparse.

Stage B loads the warmup weights as pretrained parameters and starts a fresh optimizer for 60 epochs:

```bash
PADDLEOCR_ROOT=/opt/PaddleOCR-v3.7.0 CUDA_VISIBLE_DEVICES=0 \
  python3 /opt/PaddleOCR-v3.7.0/tools/train.py \
  -c training/ppocrv6-captcha/config.yml -o \
  Global.epoch_num=60 \
  Global.pretrained_model=./training/ppocrv6-captcha/output/warmup/latest.pdparams \
  Global.save_model_dir=./training/ppocrv6-captcha/output/full
```

To resume an interrupted Stage B with model and optimizer state, replace the `Global.pretrained_model` override with `Global.checkpoints=./training/ppocrv6-captcha/output/full/latest`. PaddleOCR accepts the path with or without `.pdparams`. Preserve the original `epoch_num`, config, manifest, and seed; do not treat a resumed run as a new experiment.

## Evaluation and export

Evaluate the selected full checkpoint against isolated validation data:

```bash
CUDA_VISIBLE_DEVICES=0 python3 /opt/PaddleOCR-v3.7.0/tools/eval.py \
  -c training/ppocrv6-captcha/config.yml -o \
  Global.checkpoints=./training/ppocrv6-captcha/output/full/best_accuracy.pdparams
```

Only after validation is complete may the frozen test corpus be used once for candidate comparison. Report whole-string and character accuracy, arithmetic raw-text and answer accuracy, per-source metrics, recalls/confusions for `* / x X = ?` and the multiplication/division glyphs in `charset.txt`, confidence-bucket errors, cold start, warm latency, and memory.

Export a Paddle inference model only after a candidate is selected:

```bash
CUDA_VISIBLE_DEVICES=0 python3 /opt/PaddleOCR-v3.7.0/tools/export_model.py \
  -c training/ppocrv6-captcha/config.yml -o \
  Global.pretrained_model=./training/ppocrv6-captcha/output/full/best_accuracy.pdparams \
  Global.save_inference_dir=./training/ppocrv6-captcha/output/exported
```

Paddle 3.x normally emits `inference.json` plus `inference.pdiparams`. Use the conversion path documented by the pinned PaddleOCR/PaddleX release for that format; pin and record the converter version and full command in the model card. Do not silently fall back to a legacy `inference.pdmodel` command. Save the unoptimized ONNX first, verify its output has 71 classes, then perform any graph optimization/FP16/INT8 experiments as separate hashed candidates.

For every ONNX candidate:

1. Compare Paddle and ONNX logits on a fixed input set with recorded absolute/relative tolerances.
2. Require identical CTC-decoded strings on that set.
3. Keep the candidate in an ignored experiment path until every release gate passes and its model card is approved.
4. Run the existing Node/WASM benchmark using an explicit candidate adapter/config.
5. Run Chrome and Edge recognition-only benchmarks on an Apple M4 before any production decision.

The existing official-model comparison remains:

```bash
npm run benchmark:ppocrv6
```

Its nonzero exit is expected while the official tiny and small variants fail their gates. Node/WASM latency is diagnostic and must not be presented as Chrome/Edge latency.

## Release gates

A candidate cannot replace the production model unless all of these pass:

- CTC output is exactly 71 classes and the 70-character dictionary order is unchanged.
- Every frozen real problem sample is exactly correct.
- Frozen arithmetic answer accuracy is at least 99%; raw expression accuracy is reported separately.
- Ordinary digit/letter/alphanumeric whole-string accuracy is no more than 0.5 percentage points below the ddddocr baseline.
- High-confidence errors and per-symbol failures are explicitly reviewed.
- ONNX size is reported and minimized after accuracy passes; 5 MiB is an optimization target, not a release blocker.
- Chrome and Edge cold start is at most 3 seconds and recognition-only warm P95 is at most 500 ms on the recorded reference system; the current internal warm-latency target is 100 ms.
- Paddle/ONNX parity passes, production builds remain offline, and all model/source/license hashes are recorded.

Passing this checklist authorizes a separate integration review. Only an approved model card may authorize copying a model to `public/models`, changing the default OCR engine, or deleting the current production model.
