# Local CAPTCHA Solver

Local CAPTCHA Solver is a Chromium extension that recognizes simple CAPTCHA images on your device and fills a matching empty answer field. It never submits a form.

## Requirements

- Node.js 22 or later
- Microsoft Edge or Chromium

## Build and install in Edge

```sh
npm install
npm run build:edge
```

Open `edge://extensions`, turn on **Developer mode**, choose **Load unpacked**, and select `.output/edge-mv3`.

Open a supported HTTP or HTTPS page and use the extension popup to grant optional all-site access once. Recognition is enabled by default after access is granted; the current-site switch can disable individual hosts without removing the global permission. IP addresses, localhost, and pages using explicit ports are supported. You can also middle-click a CAPTCHA image or right-click it and choose **Recognize and fill CAPTCHA**. The popup lets you change the middle-click action to `Ctrl/Command`, `Alt`, or `Shift + left click`.

## What it supports

The current model is intended for simple digit, letter, alphanumeric, and one-operation arithmetic CAPTCHA images. Processing, model assets, and inference stay in the extension package and browser. The extension sends no CAPTCHA images, recognition results, telemetry, or browsing data to a server.

Automatic recognition fills only an empty eligible field. If the matched field already contains text, the extension leaves it unchanged and offers explicit **Replace** and **Copy** actions. It never overwrites user input, clicks a submit button, or submits a form. Right-click recognition can use the focused empty input when a page has multiple plausible fields. Optional automatic copying applies only when no matching field is found and is disabled by default.

Image acquisition is limited by browser same-origin and CORS rules. A cross-origin CAPTCHA image works only when the page can read it through a CORS-enabled canvas. Credentialed background fetching is intentionally same-origin-only; an extension host permission does not make a non-CORS or credentialed cross-origin image readable.

## Development commands

```sh
npm test
npm run typecheck
npm run build
npm run build:edge
npm run test:e2e
```

Model training and new CAPTCHA-style contributions follow the reproducible workflow in
[`docs/production-model-reproduction.md`](docs/production-model-reproduction.md) and the scenario
rules in [`docs/model-training.md`](docs/model-training.md). Public issue samples are not added directly
to a model: they need labels, provenance, license metadata, isolated scenario groups, and a
held-out benchmark before training.

The built-extension E2E suite requires Playwright Chromium. Install it with:

```sh
npx playwright install chromium
```

The focused E2E suite runs the production extension offline and calls its Offscreen OCR path from a plain extension test page. It intentionally does not automate the browser-owned action popup. The suite runs headed Chromium; on Linux without a desktop display, run it under Xvfb:

```sh
xvfb-run -a npm run test:e2e
```

## OCR status

The bundled 2.24 MB CAPTCHA CTC model runs fully offline. On the isolated 10,000-image validation set, the configured auto-fill policy reaches 99.587% precision at 82.38% coverage. The frozen 201-image benchmark reaches 98.01% whole-string/fill accuracy and 100% arithmetic-answer accuracy. The user-provided `7*3=?` sample is recognized exactly and filled as `21`.

Recognition-only browser checks on Apple M4 Pro measured warm P95 latency of 11.70 ms in Chrome for Testing 149 and 12.50 ms in Edge 150. Model warmup completed in 266 ms in Edge. These results cover common static styles, not every CAPTCHA generator; uncertain results are deliberately left unfilled.
