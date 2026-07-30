# PP-OCRv6 tiny CAPTCHA 71-class model card

## Status

- Candidate ID:
- Status: experimental / rejected / approved-for-integration-review
- Owner:
- Created (UTC):
- Production model changed: no

## Reproducibility

- Git commit:
- PaddleOCR tag: `v3.7.0`
- PaddleOCR commit: `b03f46425e8ff4442b268ce449e3eef758146cd4`
- Python:
- PaddlePaddle: `3.2.0`
- CUDA / cuDNN / driver:
- GPU:
- Dependency lock artifact and SHA-256:
- Training config SHA-256:
- Charset SHA-256:
- Dataset manifest SHA-256:
- Random seed: `20260728`
- Warmup command:
- Fine-tune command:
- Resume events:

## Initialization

- Checkpoint URL: `https://paddle-model-ecology.bj.bcebos.com/paddlex/official_pretrained_model/PP-OCRv6_tiny_rec_pretrained.pdparams`
- Checkpoint bytes: `71,528,759`
- Checkpoint SHA-256: `960cb4aa5276e3ac235b7f671fb8c9a7c1c1423617da0f96da66a33d0ed53f84`
- Loaded parameter count / bytes:
- Skipped parameter names and reasons:
- Frozen backbone parameter count during Stage A:
- Trainable head parameter count during Stage A:

## Data

| Split | Source | Samples | Groups | License IDs | Redistributable |
| --- | --- | ---: | ---: | --- | --- |
| train | synthetic |  |  |  |  |
| train | public |  |  |  |  |
| train | real |  |  |  |  |
| validation | synthetic |  |  |  |  |
| validation | public |  |  |  |  |
| validation | real |  |  |  |  |
| frozen test | generated |  |  | repository fixture | yes |
| frozen test | real |  |  | user-authorized/private | no |

- Synthetic generator revision/config hash:
- Fonts and licenses:
- Public dataset names, versions, URLs, licenses:
- Real-data authorization and retention constraints:
- Split grouping rule:
- Duplicate/leakage validation result:
- Frozen benchmark hashes excluded: yes / no

## Training

| Stage | Epochs completed | Start checkpoint | Best validation metric | Wall time | Peak memory |
| --- | ---: | --- | ---: | ---: | ---: |
| head warmup |  |  |  |  |  |
| full fine-tune |  |  |  |  |  |

- Optimizer/schedule:
- Batch size and effective batch size:
- Augmentation configuration:
- Early stop or selection rule:
- Training anomalies:

## Evaluation

| Corpus/source | Samples | Whole-string accuracy | Character accuracy | Arithmetic raw | Arithmetic answer |
| --- | ---: | ---: | ---: | ---: | ---: |
| validation synthetic |  |  |  |  |  |
| validation public |  |  |  |  |  |
| validation real |  |  |  |  |  |
| frozen generated |  |  |  |  |  |
| frozen real |  |  |  |  |  |

| Symbol | Expected | Correct | Recall | Top confusions |
| --- | ---: | ---: | ---: | --- |
| `*` |  |  |  |  |
| `/` |  |  |  |  |
| multiplication glyph |  |  |  |  |
| division glyph |  |  |  |  |
| `=` |  |  |  |  |
| `?` |  |  |  |  |
| `x` |  |  |  |  |
| `X` |  |  |  |  |

- Confidence threshold and calibration method:
- High-confidence error count/rate:
- Representative failures:
- Statistical uncertainty / confidence intervals:

## Export and parity

- Paddle inference export command:
- Paddle inference artifact hashes:
- Paddle-to-ONNX tool and version:
- ONNX conversion command:
- Raw ONNX bytes and SHA-256:
- Optimized/quantized ONNX bytes and SHA-256:
- ONNX opset:
- Input name/shape/dtype/range:
- Output name/shape/dtype:
- CTC class count: 71 / other
- Logit parity tolerance and maximum observed error:
- Decode parity sample count/result:

## Runtime

| Runtime | Device/browser | Candidate | Cold start | Warm P50 | Warm P95 | Peak memory |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| Paddle |  |  |  |  |  |  |
| Node ORT WASM |  |  |  |  |  |  |
| Chrome ORT WASM/WebGPU | Apple M4 / version |  |  |  |  |  |
| Edge ORT WASM/WebGPU | Apple M4 / version |  |  |  |  |  |

## Gate decision

| Gate | Requirement | Result | Pass |
| --- | --- | --- | --- |
| CTC classes | exactly 71 |  |  |
| frozen real samples | 100% exact |  |  |
| arithmetic answer | at least 99% |  |  |
| ordinary regression | at most 0.5 percentage points below ddddocr |  |  |
| model size optimization target | 5 MiB (non-blocking) |  |  |
| Chrome warm P95 | at most 100 ms |  |  |
| Edge warm P95 | at most 100 ms |  |  |
| Paddle/ONNX parity | within recorded tolerance and identical decode |  |  |
| offline production build | no remote OCR/model requests |  |  |

- Final decision:
- Rejection reasons or integration-review conditions:
- Reviewer/date:
- Production integration commit (leave blank in this experiment):
