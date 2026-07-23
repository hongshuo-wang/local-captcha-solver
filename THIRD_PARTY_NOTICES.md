# Third-Party Notices

## Included in the extension

| Component | Pinned source | Use | License source |
| --- | --- | --- | --- |
| [ddddocr](https://github.com/sml2h3/ddddocr) | commit [`c40f56f95412e10bcb9bd0bd24411e92f896d238`](https://github.com/sml2h3/ddddocr/tree/c40f56f95412e10bcb9bd0bd24411e92f896d238) | `ddddocr/common_old.onnx`, shipped as `public/models/common_old.onnx` | [MIT license at the pinned commit](https://github.com/sml2h3/ddddocr/blob/c40f56f95412e10bcb9bd0bd24411e92f896d238/LICENSE) |
| [ddddocr-node](https://github.com/renhaoyeh/ddddocr-node) | commit [`f7be779568b08cbb3b12c895ce7f22fd6ccc554d`](https://github.com/renhaoyeh/ddddocr-node/tree/f7be779568b08cbb3b12c895ce7f22fd6ccc554d) | `onnx/common_old.json`, shipped as `public/models/common_old.json` | [MIT license at the pinned commit](https://github.com/renhaoyeh/ddddocr-node/blob/f7be779568b08cbb3b12c895ce7f22fd6ccc554d/LICENSE) |
| [ONNX Runtime](https://github.com/microsoft/onnxruntime) | `onnxruntime-web@1.23.2` ([tag](https://github.com/microsoft/onnxruntime/tree/v1.23.2), commit [`a83fc4d58cb48eb68890dd689f94f28288cf2278`](https://github.com/microsoft/onnxruntime/tree/a83fc4d58cb48eb68890dd689f94f28288cf2278)) | `ort-wasm-simd-threaded.wasm` and its `.mjs` loader, shipped under `public/ort`; browser runtime code is bundled from the package | [MIT license](https://github.com/microsoft/onnxruntime/blob/v1.23.2/LICENSE); the exact pinned [upstream third-party notices](https://github.com/microsoft/onnxruntime/blob/a83fc4d58cb48eb68890dd689f94f28288cf2278/ThirdPartyNotices.txt) are reproduced in the repository as [`third_party/onnxruntime-ThirdPartyNotices.txt`](third_party/onnxruntime-ThirdPartyNotices.txt) for the shipped ORT payload |

## Benchmark-only development dependencies

| Component | Pinned source | Use | License source |
| --- | --- | --- | --- |
| [Tesseract.js](https://github.com/naptha/tesseract.js) | `tesseract.js@6.0.1` ([tag](https://github.com/naptha/tesseract.js/tree/v6.0.1)) | OCR benchmark implementation only; not shipped in the extension | Installed package `LICENSE.md`: [Apache License 2.0](https://github.com/naptha/tesseract.js/blob/v6.0.1/LICENSE.md) |
| [English data for Tesseract.js](https://github.com/naptha/tessdata) | `@tesseract.js-data/eng@1.0.0` | English `traineddata` used only by benchmarks; not shipped in the extension | The installed package manifest declares MIT; the linked data repository publishes an [Apache License 2.0](https://github.com/naptha/tessdata/blob/gh-pages/LICENSE) for its data tree |

The installed `@tesseract.js-data/eng@1.0.0` package does not contain a separate
license file. Its package manifest and the upstream data repository currently
make different license declarations, so both authoritative sources are recorded
above rather than collapsing them into a single claim.

## MIT license notices

### ddddocr

The MIT License (MIT)

Copyright © 2022 <copyright holders>

Permission is hereby granted, free of charge, to any person obtaining a copy of
this software and associated documentation files (the “Software”), to deal in
the Software without restriction, including without limitation the rights to
use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of
the Software, and to permit persons to whom the Software is furnished to do so,
subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED “AS IS”, WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

### ddddocr-node

MIT License

Copyright (c) 2026 Ren-Hao Yeh

Permission is hereby granted, free of charge, to any person obtaining a copy of
this software and associated documentation files (the "Software"), to deal in
the Software without restriction, including without limitation the rights to
use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of
the Software, and to permit persons to whom the Software is furnished to do so,
subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

### ONNX Runtime

MIT License

Copyright (c) Microsoft Corporation

Permission is hereby granted, free of charge, to any person obtaining a copy of
this software and associated documentation files (the "Software"), to deal in
the Software without restriction, including without limitation the rights to
use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of
the Software, and to permit persons to whom the Software is furnished to do so,
subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## Apache-licensed benchmark tools

Tesseract.js 6.0.1 includes the unmodified Apache License, Version 2.0, January
2004, in its installed `LICENSE.md` and has no separate project `NOTICE` file.
The benchmark dependency is not part of the produced extension. The complete
license text is available from the exact-version link in the table above.
