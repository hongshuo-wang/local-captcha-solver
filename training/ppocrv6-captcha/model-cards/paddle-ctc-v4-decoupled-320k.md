# CAPTCHA CTC tiny 71-class model card

## Status

- Candidate ID: `paddle-ctc-v4-decoupled-320k`
- Status: approved for production integration
- Owner: Local CAPTCHA Solver maintainers
- Created: 2026-07-29 (Asia/Shanghai)
- Production model changed: yes, replacing `ddddocr/common_old.onnx`
- Scope: common static digit, English letter, alphanumeric, and one-step integer arithmetic CAPTCHAs
- Dynamic slider Beta is a separate non-OCR feature and does not use this model or its training data.

## Reproducibility

- Repository base commit: `a7e6dade18319d8f39e877d3fd71ae2ff1078350` plus the model-training worktree recorded by this card
- PaddleOCR: `v3.7.0`, commit `b03f46425e8ff4442b268ce449e3eef758146cd4`
- Python / PaddlePaddle: `3.12.11` / `3.2.0`
- Device: Apple M4 Pro CPU, no CUDA or cuDNN
- Python environment: `training/ppocrv6-captcha/python-environment.txt`, SHA-256 `e093de4865b6fd85382be69987ca9ae99f097561f8a8d7abd0e3f2b62db56823`
- Package lock SHA-256: `ae9285cb3003efe743f87cb9a151444eda835237c391e2dd0c4e636dcb0b9676`
- Final resolved config SHA-256: `de138407529e87d09cac4dc03bfe695cca049d836ca93526d18d08efda108ee4`
- Charset SHA-256: `1933b1e9373a814f1c2a9a12de963b088832e4867eea279add473f9b11ee6961`
- Dataset manifest SHA-256: `1aa36d0b16fcc4e7bb3122e1a9ea686937cf6eb45d4dceb2fb755ef43c6d2ac3`
- Random seed: `20260728`

The selected checkpoint is the last stage of an exploratory continuation chain. Every full-data
stage used `training/ppocrv6-captcha/data/train-balanced.txt`, the isolated validation labels,
Adam/Cosine/L2, batch size 128, and the resolved configs retained in the ignored output folders.
The stage lineage is:

| Stage | Epochs | Learning rate | Parent | Best validation exact |
| --- | ---: | ---: | --- | ---: |
| `paddle-probe8k-ctc-only` | 2 | 0.0001 | fitted 8k full-head probe | 84.77% on probe split |
| `paddle-ctc-v1-160k` | 3 | 0.0002 | probe CTC-only | 88.31% |
| `paddle-ctc-v2-320k` | 2 | 0.0001 | v1 | 89.71% |
| `paddle-ctc-v3-fitted-320k` | 1 | 0.00005 | v2 | 91.94% |
| `paddle-ctc-v4-decoupled-320k` | 1 | 0.00005 | v3 | 94.66% Paddle greedy |

The final stage uses the corrected synthetic renderer: canvas size is measured from rendered text,
and arithmetic operator/style assignments are independently cycled. The release benchmark uses the
browser decoder rather than Paddle's greedy metric, which explains the different validation number.

## Initialization

- Official checkpoint URL: `https://paddle-model-ecology.bj.bcebos.com/paddlex/official_pretrained_model/PP-OCRv6_tiny_rec_pretrained.pdparams`
- Official checkpoint: 71,528,759 bytes; SHA-256 `960cb4aa5276e3ac235b7f671fb8c9a7c1c1423617da0f96da66a33d0ed53f84`
- Final parent checkpoint SHA-256: `a3223fd155ef7ef4837594bc633850ddeec6f83a2e1c4f7b58355f99c8186260`
- Selected Paddle checkpoint: 48,316,987 bytes; SHA-256 `5024e5c904ba582b1bdc5c4bc3cb84ff0f8aee8eb0463b8bf15a0d2c560ff196`

## Data

| Split/source | Samples | Groups | Licenses |
| --- | ---: | ---: | --- |
| train/public | 145,183 | 4 | CC-BY-4.0, CC0-1.0, Apache-2.0 |
| train/synthetic | 100,000 | 4 | generated-project |
| validation/synthetic | 10,000 | 4 | generated-project |
| frozen/generated | 200 | benchmark fixtures | repository fixtures |
| frozen/real | 1 | user-authorized | local benchmark use only |

- Manifest total: 255,183 unique samples; balanced training label list: 320,000 rows
- Generator SHA-256: `59599f2546e2f12b2182701e8405f08b9f76e4d9f9b57dacc1d2a0db0bb42ebf`
- Balance recipe SHA-256: `ec988e343765fb1785f71cc3a7dd74ec74b40f8d0a7bcb4ee3c293296a3bcf95`
- Fonts: DejaVu plus Kalam, Patrick Hand, and Special Elite; font packages use their recorded open licenses
- Public sources and archive hashes: `training/ppocrv6-captcha/public-datasets.ts`
- Isolation: all generator/site families use distinct groups; no group crosses splits
- Leakage check: dataset validation rejects every frozen benchmark hash; passed before training

## Evaluation

Browser-equivalent Node/WASM evaluation used all 10,000 isolated validation images and the frozen
201-image corpus. Arithmetic accuracy means the final calculated fill value is correct.

| Corpus/category | Samples | Raw whole-string/fill accuracy | 99.5%-precision coverage |
| --- | ---: | ---: | ---: |
| validation/all | 10,000 | 95.22% | 84.51% |
| validation/digits | 2,500 | 99.68% | 100.00% |
| validation/letters | 3,548 | 92.78% | 72.01% |
| validation/alphanumeric | 1,608 | 87.38% | 55.04% |
| validation/arithmetic | 2,344 | 99.53% | 100.00% |
| frozen/all | 201 | 98.01% | n/a |
| frozen/digits | 50 | 100.00% | n/a |
| frozen/letters | 50 | 98.00% | n/a |
| frozen/alphanumeric | 50 | 94.00% | n/a |
| frozen/arithmetic | 51 | 100.00% | n/a |
| frozen/real `7*3=?` | 1 | 100.00%, fill `21` | confidence 0.957862 |

Per-operator validation fill accuracy:

| Operator | Samples | Accuracy | Coverage at >=99.5% precision |
| --- | ---: | ---: | ---: |
| `*` | 313 | 99.68% | 100.00% |
| `+` | 313 | 99.68% | 100.00% |
| `-` | 313 | 99.68% | 100.00% |
| `/` | 313 | 98.08% | 89.78% |
| `X` | 234 | 100.00% | 100.00% |
| `x` | 234 | 99.57% | 100.00% |
| `×` | 312 | 99.68% | 100.00% |
| `÷` | 312 | 100.00% | 100.00% |

Production thresholds are digits `0.86`, letters `0.984`, alphanumeric `0.994`, and arithmetic
`0.62`. At those fixed thresholds, precision is 99.587% and coverage is 82.38% (8,238 accepted,
34 errors). High-confidence failures are mostly dropped/repeated glyphs and ambiguous `0/O`, `l/I/1`,
or occluded arithmetic operands. Structurally ambiguous arithmetic always abstains rather than falling
back to digit auto-fill.

## Export and parity

- Paddle inference JSON: 108,937 bytes; SHA-256 `cbf6b9e89468ce400fe0c846ec5982baa3b7702dfc36481808cbc7fbc4f7405b`
- Paddle inference parameters: 2,205,868 bytes; SHA-256 `e093a9241b10ffc5ee2799156168c0a7fbcbeab5d668d1fd6a889cfce37e672a`
- Converter: `paddle2onnx 2.1.0`, ONNX opset 17
- Production ONNX: 2,242,324 bytes; SHA-256 `bce3e791636f369dd8bbac9b4eee2a0d9515f001b89b422f6d250c33ee6bbc28`
- Runtime config: 768 bytes; SHA-256 `efebc4c5e6a9de3d3cdf0a58d482a869f801352dd2ab8da73dc6f2baa8f29a5a`
- Input: `x`, Float32 NCHW `[batch,3,48,dynamic-width]`, BGR normalized to `[-1,1]`
- Output: `fetch_name_0`, Float32 `[batch,time,71]` probabilities
- Parity: four deterministic random tensors plus two image tensors; identical argmax decode;
  maximum absolute probability difference `6.23e-6`

## Runtime

| Runtime | Device/browser | Cold/model ready | Warm P95 | Result |
| --- | --- | ---: | ---: | --- |
| Node ORT WASM | Apple M4 Pro | 142.995 ms | not used as browser claim | pass |
| Chrome for Testing 149 | Apple M4 Pro | startup-to-ready upper bound 1,511 ms | 11.70 ms | pass |
| Microsoft Edge 150 | Apple M4 Pro | 266 ms model warmup | 12.50 ms | pass |

Both browser runs started offline, made zero HTTP(S) requests, loaded only packaged assets, and
recognized `14975`, `99067`, and real `7*3=? -> 21`. Peak memory was not recorded. The current
production entrypoint deliberately uses WASM for predictable MV3 compatibility; WebGPU is not needed
to meet the latency gate and remains a separately benchmarked future optimization.

## Gate decision

| Gate | Requirement | Result | Pass |
| --- | --- | --- | --- |
| CTC classes | exactly 71 | 71 | yes |
| configured policy | >=99.5% precision, >=80% coverage | 99.587%, 82.38% | yes |
| frozen real samples | 100% exact | 1/1 exact and fill correct | yes |
| frozen arithmetic answer | at least 99% | 100% | yes |
| ordinary regression | no more than 0.5 points below ddddocr | 97.33% vs 64.67% | yes |
| model size target | at most 5 MiB | 2.14 MiB | yes |
| Chrome warm P95 | at most 100 ms | 11.70 ms | yes |
| Edge warm P95 | at most 100 ms | 12.50 ms | yes |
| Paddle/ONNX parity | <=1e-5 and identical decode | 6.23e-6, identical | yes |
| offline production build | no remote model/OCR requests | zero HTTP(S) requests | yes |

Final decision: approved as the single production model for common static CAPTCHA scope. This does
not authorize claims for rare scripts, multi-step math, animation, sliders, image selection, or
behavioral challenges. New styles must enter through an isolated held-out scenario contribution.

## Follow-up scenario record

On 2026-08-04, the frozen real corpus gained an authorized alphanumeric regression labeled `UDJN`
with SHA-256 `36ffa6f15c1962fc484e8e2d0e31791e85b5a7b1f4a551af6b76e3a6eb66136a`. The production model
decodes it as `UDJ9` in alphanumeric mode and therefore fails exact recognition. The follow-up data
recipe adds independent multicolor-crossline train/validation groups plus deterministic `0/O`
co-occurrence sampling. None of those changes were used for this card's training or reported metrics;
the approved production ONNX and thresholds remain unchanged pending a separately carded candidate.
