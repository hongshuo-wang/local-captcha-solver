# Dataset staging

This directory is intentionally empty until licensed training data is prepared.

`manifest.json` is the source of truth. Every sample must record a SHA-256, one of the `synthetic`, `public`, or `real` sources, a license id, and a template/site group. A group may appear in only one of `train`, `validation`, or `test`.

`train.txt`, `train-balanced.txt`, and `validation.txt` use PaddleOCR's tab-separated `relative/image/path<TAB>label` format and must be generated from a validated manifest. `train.txt` lists each source sample once; `train-balanced.txt` is the deterministic category/operator-balanced training input. The committed `benchmark/fixtures/generated` corpus and `benchmark/fixtures/real` samples are frozen evaluation data and must never be listed here.

Public source metadata lives in `../public-datasets.ts`. Only `verified` entries may be fetched or imported. Keep every upstream generator/version in one manifest group and use it in one split only; a random subset of the same public generator is not an independent validation set.
