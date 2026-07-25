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

Open a supported HTTP or HTTPS page, open the extension popup, and enable automatic recognition for the current site. This grants an exact hostname permission; it does not enable subdomains or other sites. You can also right-click a CAPTCHA image and choose **Recognize and fill CAPTCHA** when automatic recognition is not enabled.

## What it supports

The current model is intended for simple digit, letter, alphanumeric, and one-operation arithmetic CAPTCHA images. Processing, model assets, and inference stay in the extension package and browser. The extension sends no CAPTCHA images, recognition results, telemetry, or browsing data to a server.

Automatic recognition fills only an empty eligible field and never clicks a submit button or submits a form. Right-click recognition can use the focused empty input when a page has multiple plausible fields.

Image acquisition is limited by browser same-origin and CORS rules. A cross-origin CAPTCHA image works only when the page can read it through a CORS-enabled canvas. Credentialed background fetching is intentionally same-origin-only; an extension host permission does not make a non-CORS or credentialed cross-origin image readable.

## Development commands

```sh
npm test
npm run typecheck
npm run build
npm run build:edge
npm run test:e2e
```

The built-extension E2E suite requires Playwright Chromium. Install it with:

```sh
npx playwright install chromium
```

The E2E suite runs headed Chromium because the real action popup and permission prompt require browser user activation. On Linux without a desktop display, run it under Xvfb:

```sh
xvfb-run -a npm run test:e2e
```

## OCR status

Measured deterministic benchmark accuracy is digits 100%, letters 46%, alphanumeric 48%, and arithmetic fill values 74%. The 90% release target remains unmet for the ordinary aggregate and arithmetic fill gate. Treat this extension as an MVP workflow build, not a release-ready CAPTCHA solver.
