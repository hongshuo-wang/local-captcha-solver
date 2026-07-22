# Local CAPTCHA Solver Design

Date: 2026-07-22
Status: Approved for implementation planning
Working name: Local CAPTCHA Solver

## 1. Product Summary

Local CAPTCHA Solver is a Chrome and Edge extension that recognizes common, simple image CAPTCHAs and fills the associated form field. Recognition runs entirely inside the browser. The extension never uploads CAPTCHA images, page URLs, recognition results, or usage data.

The extension solves a narrow productivity problem: users should not need to manually type short number or letter CAPTCHAs, or calculate simple arithmetic CAPTCHAs, while completing a larger form.

The extension is not a form automation tool. It never submits a form, clicks a submit button, or performs any action beyond recognizing a CAPTCHA and filling a field.

## 2. Goals

- Recognize common single-line image CAPTCHAs containing:
  - digits;
  - case-sensitive English letters;
  - mixed English letters and digits;
  - one simple arithmetic operation between two non-negative integers.
- Support `+`, `-`, `*`, `/`, `x`, `X`, multiplication sign, and division sign as arithmetic operator variants.
- Offer three complementary entry points:
  - automatic recognition on explicitly allowlisted sites;
  - recognition from an image context-menu action;
  - manual current-page recognition from the extension popup.
- Fill only an empty, confidently matched field during automatic operation.
- Preserve a browser-independent core so Firefox and other browsers can be added later.
- Keep all inference, configuration, and processing local.
- Provide an unpacked MVP for real-world validation before any store submission work begins.

## 3. Non-Goals

The MVP does not support:

- Chinese-character CAPTCHAs;
- arbitrary special-character CAPTCHAs;
- image-selection challenges;
- sliders;
- reCAPTCHA, hCaptcha, Turnstile, GeeTest, or FunCaptcha;
- automatic form submission;
- automatic clicking of CAPTCHA refresh or form controls;
- remote OCR APIs, local HTTP servers, cloud fallback, telemetry, advertising, or analytics;
- automatic detection of canvas-rendered CAPTCHAs or CSS background images;
- Firefox packaging;
- Chrome Web Store or Edge Add-ons publication.

Canvas, CSS background image, screenshot-region, additional OCR engine, and browser adapters must be possible through stable interfaces, but they are not MVP deliverables.

## 4. Product Principles

### 4.1 Local by construction

The ONNX model, WebAssembly runtime, character map, and processing code ship inside the extension. Runtime code must not load scripts, models, or configuration from a CDN or remote server.

### 4.2 No submission authority

The extension only fills a CAPTCHA field. It must not call `form.submit()`, click submit controls, synthesize Enter, or otherwise cause form submission.

### 4.3 Preserve user input

Automatic flows must never replace a non-empty field. A replacement is allowed only after an explicit user action labeled as a replacement.

### 4.4 Conservative automation

Automatic fill requires high confidence in both the OCR result and the target-field match. Ambiguous cases are surfaced to the user instead of being guessed.

### 4.5 Small, replaceable modules

Image acquisition, preprocessing, OCR, result interpretation, field matching, storage, and browser integration communicate through explicit interfaces. No module should require consumers to understand its internals.

## 5. Technical Direction

### 5.1 OCR engine

The MVP primary engine is the ddddocr `common_old.onnx` model, approximately 13.6 MB, executed with `onnxruntime-web`.

The Python ddddocr SDK is not embedded or launched. There is no Python installation and no localhost service. The project ports only the browser-relevant inference flow into TypeScript:

1. decode image pixels;
2. resize to a height of 64 pixels while preserving aspect ratio;
3. convert to grayscale;
4. normalize to the model's expected float tensor;
5. run ONNX inference;
6. restrict candidate logits before argmax;
7. perform CTC decoding;
8. calculate result confidence.

The beta `common.onnx` model, approximately 54 MB, is excluded from the MVP because of extension size and startup cost. It may be evaluated later if the smaller model fails the agreed accuracy target.

The implementation may use the browser port in `ddddocr-node` as a reference, but it should not depend on the complete package. Its Jimp, TensorFlow.js, Node compatibility, and unrelated detection/slider code would unnecessarily increase bundle size. Browser Canvas APIs and small local TypeScript utilities are sufficient for the MVP pipeline.

### 5.2 Character restriction

The decoder supports these profiles:

- digits: `0-9`;
- letters: `a-zA-Z`;
- alphanumeric: `a-zA-Z0-9`;
- arithmetic: digits and supported operator variants, with optional `=` and `?` ignored during interpretation.

Invalid character classes are masked at the logits stage before argmax. Filtering only after argmax is insufficient because it can discard an otherwise valid second-ranked character.

### 5.3 Arithmetic interpretation

The arithmetic parser accepts exactly one expression containing:

- one non-negative integer;
- one supported binary operator;
- one non-negative integer;
- optional surrounding whitespace, trailing equals sign, or question mark.

Operator variants are normalized before evaluation. Division is eligible for automatic filling only when the divisor is nonzero and the quotient is an integer. A non-integer quotient is shown as requiring confirmation rather than being formatted or filled automatically. Division by zero, incomplete expressions, multiple operators, or extra characters are rejected. The parser uses explicit arithmetic operations and never uses `eval`, `Function`, or dynamic code generation.

For a valid arithmetic CAPTCHA, the UI may display the normalized expression and result, while only the result is written to the input field.

### 5.4 Comparative spike

Before the product commits permanently to the ddddocr adapter, a focused benchmark compares ddddocr with bundled Tesseract on the labeled MVP sample set. Ddddocr remains the intended engine, but the benchmark records an evidence-based decision. Tesseract is not shipped in the MVP unless the benchmark demonstrates a material coverage gap that justifies its package and runtime cost.

## 6. Architecture

### 6.1 Browser-independent core

The core contains no `chrome.*` calls and exposes:

- `ImageSource`: obtains an image payload and source metadata;
- `ImagePreprocessor`: converts an image payload to one or more model-ready candidates;
- `OcrEngine`: recognizes candidates and returns text, confidence, and diagnostics;
- `ResultInterpreter`: classifies plain text versus arithmetic and returns the value to fill;
- `CaptchaCandidateScorer`: scores DOM elements as likely CAPTCHA images;
- `FieldMatcher`: ranks candidate input fields and reports ambiguity;
- shared request, response, error, and settings types.

The initial `ImageSource` implementation supports HTML `<img>` elements. Future implementations can add canvas, CSS backgrounds, or screenshot regions without changing OCR or field matching.

### 6.2 Ddddocr adapter

The ddddocr adapter owns:

- the bundled `common_old.onnx` model;
- the matching character map;
- `onnxruntime-web` session creation;
- Canvas-based model preprocessing;
- logits masking;
- CTC decoding;
- confidence calculation;
- model lifecycle and warm-session reuse.

Inference runs outside the content script in an extension-owned inference host and worker. The inference host interface hides Chromium-specific lifecycle choices so another browser implementation can replace it later.

### 6.3 Chromium extension layer

The Chromium layer contains:

- a Manifest V3 service worker for menus, permissions, dynamic registration, and message routing;
- a content script for DOM candidate discovery, field matching, filling, and page-local status UI;
- a popup for current-site allowlist state, manual page scanning, candidates, and results;
- a Chromium adapter around storage, context menus, scripting, tabs, and permissions;
- an inference host that loads and reuses the ONNX session.

Chrome and Edge use the same build artifact for the MVP.

### 6.4 Future browser layer

A future Firefox adapter replaces browser APIs and manifest differences while reusing the core and ddddocr adapter. Browser API access must not leak into shared modules.

## 7. Permissions and Storage

### 7.1 Permission model

The extension uses the smallest practical permission set:

- `activeTab` for explicit popup and context-menu actions;
- `contextMenus` for the image action;
- `storage` for local settings;
- `scripting` for on-demand and allowlisted content-script registration;
- only the extension-runtime permission required by the chosen inference host;
- optional host permissions requested when a user enables automatic recognition for a site.

The MVP must not request blanket access to all sites at installation. Enabling an allowlist entry is an explicit user gesture that requests the required hostname permission.

### 7.2 Allowlist semantics

- Entries are stored by exact hostname.
- An entry applies to all paths on that hostname.
- Subdomains are separate entries by default.
- Removing an entry disables automatic recognition and releases its optional permission when practical.

### 7.3 Local data

The extension stores only:

- allowlisted hostnames;
- user-visible extension settings;
- schema version information required for local migrations.

The extension does not persist CAPTCHA images, recognized text, page URLs, result history, field contents, or error telemetry.

## 8. Interaction Design

### 8.1 Allowlisted automatic recognition

On an allowlisted hostname, the content script scans after the document is ready and observes relevant DOM and image-source changes with debouncing.

Automatic filling occurs only when:

- the image candidate score is above the configured automatic threshold;
- exactly one field match is above the field-confidence threshold;
- the target field is empty;
- the OCR result is structurally valid;
- the OCR confidence is above the automatic threshold;
- the CAPTCHA image has not changed since the recognition request began.

### 8.2 Image context menu

The image context menu contains a command equivalent to "Recognize and fill CAPTCHA". It uses the clicked image URL and the active page to resolve the corresponding `<img>` element, recognize it, and rank nearby fields.

If there is no unique target field, the result remains available in the extension UI for copying or explicit target selection. An explicit context-menu action may offer replacement, but replacement must be clearly labeled and cannot happen implicitly.

### 8.3 Popup

The popup provides:

- an "Automatically recognize on this site" toggle;
- a "Recognize this page" command;
- current-page candidate and result status;
- a resolution flow for ambiguous candidates or fields;
- retry and explicit replacement actions when applicable.

Manual page recognition processes only images with meaningful CAPTCHA evidence. If several independent CAPTCHAs each have a unique field, they can be processed independently. Ambiguous image-to-field mappings require user confirmation.

### 8.4 Field filling

Field matching considers:

- shared form or fieldset ancestry;
- DOM and visual proximity;
- labels and nearby text;
- `id`, `name`, `placeholder`, `aria-label`, and autocomplete hints;
- field type, visibility, enabled state, and editability.

Password, hidden, disabled, readonly, and non-editable controls are excluded.

Filling uses the native value setter when necessary and dispatches bubbling `input` and `change` events for React, Vue, and similar controlled-input implementations. Filling must not dispatch submit-related events.

## 9. Result and Error Policy

### 9.1 Result states

- `filled`: a high-confidence result was written to an empty, unique field;
- `needs_confirmation`: a result exists but confidence or field matching is ambiguous;
- `no_candidate`: no likely CAPTCHA image was found;
- `no_field`: recognition succeeded but no suitable input field was found;
- `image_unavailable`: image bytes could not be obtained;
- `recognition_failed`: the model returned no structurally valid result;
- `stale`: the image changed while recognition was running;
- `model_unavailable`: model initialization or inference failed.

### 9.2 User-visible behavior

- Low-confidence results are shown but not filled automatically.
- Failures do not clear or modify fields.
- A recognized value without a field can be copied.
- Retrying does not refresh the CAPTCHA automatically.
- Status UI remains small and temporary, and it never blocks the rest of the form.

### 9.3 Concurrency and deduplication

- Recognition requests carry the image source revision or fingerprint.
- A result is discarded if the source changes before completion.
- Repeated mutation events for the same source are deduplicated.
- Newer explicit user requests supersede older pending automatic requests for the same candidate.

## 10. CAPTCHA Candidate Detection

The MVP detects only `<img>` elements. A candidate score combines:

- CAPTCHA-related terms in `src`, `alt`, `title`, `id`, class, or nearby text;
- proximity to a short text input;
- presence inside a form or authentication flow;
- dimensions typical of short CAPTCHA images;
- refresh controls or labels near the image;
- negative evidence such as logos, avatars, product images, icons, and large editorial media.

Automatic recognition uses a higher threshold than manual page scanning. A context-menu action bypasses image candidate scoring because the user selected the image explicitly, but it does not bypass OCR or field-safety checks.

## 11. Testing Strategy

### 11.1 OCR benchmark corpus

The labeled corpus contains at least 200 images, distributed across:

- pure digits;
- pure case-sensitive letters;
- mixed letters and digits;
- arithmetic expressions.

The corpus should combine generated images with legally usable real-world samples contributed for testing. Each sample records the expected source string and, for arithmetic, the expected fill value.

The benchmark reports:

- whole-string accuracy by category;
- character accuracy;
- arithmetic final-answer accuracy;
- false high-confidence rate;
- cold model initialization time;
- warm inference latency;
- package-size contribution.

### 11.2 Unit tests

Unit tests cover:

- character-logit masking;
- CTC repeated-character and blank handling;
- confidence aggregation;
- arithmetic normalization and parsing;
- division by zero and malformed expressions;
- candidate scoring;
- field ranking and ambiguity;
- storage schema and allowlist behavior;
- stale-result and deduplication logic.

### 11.3 Browser integration tests

Local fixture pages cover:

- one CAPTCHA and one field;
- multiple independent CAPTCHAs;
- dynamically inserted CAPTCHAs;
- image `src` refresh during inference;
- missing and ambiguous fields;
- pre-filled fields;
- React- and Vue-style controlled inputs;
- context-menu, popup, and allowlist entry points;
- permission grant and removal flows;
- confirmation and replacement behavior;
- proof that no flow submits a form.

### 11.4 Privacy and offline tests

- Run the extension with network access disabled after test pages are loaded.
- Confirm OCR remains functional.
- Inspect extension network requests and confirm no external destinations are contacted.
- Confirm local storage contains no images, URLs, recognition history, or field values.

### 11.5 Browser matrix

The MVP is manually verified in current stable Chrome and Edge. Automated Chromium coverage is shared where possible, but both branded browsers receive a final smoke test using unpacked builds.

## 12. MVP Acceptance Criteria

- At least 90% whole-string accuracy for clear, low-interference 4-6 character digit, letter, and alphanumeric CAPTCHAs in the agreed corpus.
- At least 90% final-answer accuracy for simple arithmetic CAPTCHAs in the agreed corpus.
- Warm inference should normally complete within one second on a typical desktop computer; cold model initialization may take longer and is measured separately.
- No automatic flow overwrites an existing field.
- No flow submits a form.
- The extension works offline after the page and bundled assets are available.
- No extension-originated external requests occur.
- Automatic recognition works only on explicitly allowlisted hostnames.
- Popup and context-menu recognition work without permanently allowlisting the site.
- Chrome and Edge unpacked builds pass the agreed real-site smoke tests.

## 13. Delivery Phases

### Phase 1: OCR feasibility spike

- Assemble the initial labeled corpus.
- Run ddddocr and Tesseract comparison benchmarks.
- Validate `common_old.onnx` with `onnxruntime-web` under Manifest V3 constraints.
- Record the model, preprocessing, accuracy, latency, and package-size decision.

### Phase 2: MVP extension

- Implement the shared core, ddddocr adapter, Chromium adapter, service worker, content script, inference host, popup, and local settings.
- Implement all three entry points.
- Complete unit and local browser fixture tests.
- Produce unpacked Chrome and Edge builds.

### Phase 3: Real-world validation

- Test representative real sites and samples.
- Fix compatibility issues through the defined extension points.
- Confirm the acceptance criteria with the user.

### Phase 4: Store readiness

This phase starts only after explicit approval of the MVP. It includes:

- final product naming and branding;
- repository documentation and contribution guidance;
- privacy policy and store disclosure text;
- third-party notices and packaged license review;
- production signing and package generation;
- Chrome Web Store and Edge Add-ons submissions.

## 14. Open-Source and Licensing

The project is open source under the MIT License. Third-party notices preserve the applicable MIT notices for:

- ddddocr;
- the referenced ddddocr-node port where code is adapted;
- ONNX Runtime.

Model provenance and the exact upstream revision used must be recorded so future upgrades remain auditable.

## 15. Research References

- ddddocr: https://github.com/sml2h3/ddddocr
- ddddocr Node/browser port: https://github.com/renhaoyeh/ddddocr-node
- ONNX Runtime Web: https://onnxruntime.ai/docs/tutorials/web/
- Buster, a mature but non-local reCAPTCHA audio solver: https://github.com/dessant/buster
- Captcha Radar, a bundled Tesseract prototype: https://github.com/andix/crx-captcha-radar-chrome
