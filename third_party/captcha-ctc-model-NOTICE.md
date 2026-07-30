# CAPTCHA CTC model notice

`public/models/captcha-ctc.onnx` was trained by this project from the Apache-2.0
PP-OCRv6 tiny recognition checkpoint at PaddleOCR `v3.7.0`, commit
`b03f46425e8ff4442b268ce449e3eef758146cd4`.

Training data included project-generated samples plus these pinned public datasets:

- MathCaptcha10k v6, CC BY 4.0
- parsasam/CAPTCHA Dataset v1, CC0 1.0
- huthayfahodeb/Captcha Dataset v2, CC0 1.0
- daniilnxy/Math problem CAPTCHA images v1, Apache 2.0

Exact source URLs, archive hashes, limitations, sample provenance, and split groups are
recorded in `training/ppocrv6-captcha/public-datasets.ts`, the dataset manifest, and the
candidate model card. The model must not be presented as supporting CAPTCHA types outside
the documented project scope.
