# Edge Experience Workflow Design

Date: 2026-07-24
Status: Approved in conversation; pending written-spec review

## 1. Purpose

Deliver an unpacked Edge extension that demonstrates the complete useful workflow now:

1. find or explicitly select a CAPTCHA image on a web page;
2. recognize it locally;
3. match it to a nearby input;
4. fill the result without submitting the form.

The existing 90% benchmark targets remain release-quality goals. They no longer block implementation of an experience build. The experience build exposes conservative automation and a right-click fallback so users can validate the product workflow while OCR quality continues to improve.

## 2. Scope

### Included

- Chrome and Edge Manifest V3 builds from the existing WXT project.
- Automatic recognition on exact hostnames explicitly enabled by the user.
- Recognition of page `<img>` elements only.
- Re-scanning after relevant DOM insertion or image `src` changes.
- An image context-menu action for explicit recognition and filling.
- Local ddddocr inference using the already bundled model and runtime.
- Matching a CAPTCHA image to a nearby eligible text input.
- Safe filling with framework-compatible `input` and `change` events.
- Popup controls for current-site automatic recognition and concise status.

### Excluded

- Uploading, pasting, or dropping an image into the popup.
- Popup-driven full-page manual scanning.
- Canvas, CSS background, screenshot-region, slider, or interactive challenge support.
- Remote OCR, telemetry, analytics, or runtime asset downloads.
- Automatic form submission or automatic CAPTCHA refresh clicks.
- Store publication, signing, or production branding.

## 3. User Experience

### 3.1 Automatic mode

The popup shows an `Automatically recognize on this site` toggle for the active tab. Enabling it is an explicit user gesture that:

- requests permission for the current page origin;
- stores the exact hostname in the local allowlist;
- registers or injects the page workflow;
- starts a scan of the current page.

On later visits to that hostname, the extension scans after page readiness. A debounced observer scans newly inserted images and images whose `src` changes, covering common CAPTCHA refresh behavior.

When one image and one empty target field are both sufficiently unambiguous, the extension recognizes and fills the value. It does not overwrite a non-empty value. Low OCR confidence, an invalid arithmetic result, an ambiguous field match, or a changed image produces a status instead of a fill.

Disabling the toggle removes the hostname from the allowlist, disables its automatic content-script behavior, and removes the optional host permission when practical.

### 3.2 Right-click fallback

The image context menu contains `Recognize and fill CAPTCHA`.

The explicit action bypasses automatic CAPTCHA-image scoring because the user selected the image, but it retains all field-safety and result-validity checks. The extension fills the nearest unique empty eligible input. If there is no unique match, it uses the currently focused eligible input when available. Otherwise it reports that the user should focus the intended field and retry.

Right-click recognition never silently replaces a non-empty field. Replacement is outside this experience-build scope.

### 3.3 Status feedback

The page displays a small temporary status near the selected image or target field. It reports only actionable states such as recognizing, filled, low confidence, no matching field, image unavailable, or recognition failed. The popup shows whether automatic mode is enabled for the current hostname and the latest in-memory status for the active tab.

Recognition results, images, page URLs, and field values are not persisted.

## 4. Architecture

### 4.1 Content script

The content script owns page-local behavior:

- CAPTCHA candidate discovery and scoring;
- field discovery, ranking, and ambiguity detection;
- image revision tracking and request deduplication;
- safe field filling;
- mutation observation;
- temporary page status UI.

It sends typed recognition requests and never loads the ONNX model itself.

### 4.2 Service worker

The service worker owns browser integration:

- context-menu creation and click routing;
- current-site permission and allowlist coordination;
- content-script registration or injection;
- active-tab status routing;
- communication with the inference host.

Browser API calls stay outside the shared core.

### 4.3 Inference host

An extension-owned offscreen document loads and reuses one `DdddOcrEngine` session. It accepts an image payload and recognition profiles, runs preprocessing and inference once, and returns typed candidate results or a typed error.

The service worker creates the host lazily. Concurrent requests share initialization, and a failed initialization may be retried by a later request.

### 4.4 Popup

The popup remains deliberately small. It owns only:

- the current hostname and automatic-mode toggle;
- permission progress or denial feedback;
- latest active-tab status;
- a retry instruction when the page requires a right-click action.

It is not an alternate OCR surface.

## 5. Data Flow

### Automatic recognition

1. The content script scores visible `<img>` elements and nearby eligible inputs.
2. It selects candidates above the automatic threshold with a unique field match.
3. It captures the image revision and obtains the image bytes.
4. It sends one typed request through the service worker to the inference host.
5. The host returns OCR candidates, confidence, and interpretation data.
6. The content script verifies that the image revision is unchanged and the field is still empty.
7. It fills through the native value setter and dispatches bubbling `input` and `change` events.

### Right-click recognition

1. The service worker receives the image context-menu event and routes it to the page.
2. The content script resolves the clicked `<img>` and ranks eligible inputs.
3. It prefers a unique nearest empty input, then an explicitly focused eligible input.
4. Recognition and stale-result validation use the same pipeline as automatic mode.

## 6. Detection and Filling Rules

### Image candidate evidence

Automatic scoring combines:

- short CAPTCHA-like dimensions and aspect ratio;
- terms such as `captcha`, `verify`, `verification`, or `code` in attributes and nearby text;
- proximity to a short text input;
- shared form, fieldset, or compact container ancestry;
- nearby refresh controls;
- negative evidence for logos, avatars, icons, and large content images.

Context-menu selection bypasses this score.

### Eligible fields

Eligible targets are visible, enabled, editable single-line text-like inputs. Hidden, disabled, readonly, password, file, checkbox, radio, button, and submit controls are excluded.

Ranking uses visual and DOM proximity, shared form ancestry, labels, placeholders, `name`, `id`, and ARIA text. Automatic filling requires one clearly superior candidate. Explicit right-click may use the currently focused eligible field to resolve ambiguity.

### Fill safety

- Automatic and right-click flows fill only empty fields.
- The field and image are revalidated after inference.
- No submit, click, Enter, or refresh event is generated.
- A fill dispatches only `input` and `change` after setting the value.
- Repeated observer events for the same image revision are deduplicated.

## 7. Image Acquisition

The first experience build supports image bytes obtainable from data URLs, blob URLs, same-origin URLs, and remote image origins for which the extension has permission. Acquisition failure is reported as `image_unavailable` and never modifies a field.

Enabling a hostname grants page-origin access, not blanket access to every third-party image CDN. The right-click fallback does not silently broaden permissions. Broader acquisition techniques, including screenshot cropping, remain a follow-up if real-site testing shows cross-origin images are a common blocker.

## 8. Accuracy Policy

The fixed benchmark and its 90% release targets remain unchanged and continue to measure OCR quality. The experience build is allowed to ship locally while those targets fail.

Automation remains conservative:

- digits may auto-fill at the existing high-confidence threshold because the current fixed corpus achieved 100% whole-string accuracy;
- letters, alphanumeric, and arithmetic use measured confidence and structural validity, but uncertain results do not fill automatically;
- explicit right-click uses the same minimum validity rules and does not treat user intent as permission to write an invalid result.

Threshold constants are centralized and covered by tests. They are not presented as a claim of 90% real-world accuracy.

## 9. Error Handling

The workflow exposes typed states:

- `recognizing`;
- `filled`;
- `needs_confirmation` for a plausible result that was not safe to fill;
- `no_candidate`;
- `no_field`;
- `image_unavailable`;
- `recognition_failed`;
- `stale` when the source changes during inference;
- `model_unavailable`;
- `permission_denied`.

Every failure is non-destructive. No error path clears a field, retries indefinitely, submits a form, or stores page data.

## 10. Testing and Acceptance

### Unit coverage

- candidate image scoring and negative evidence;
- field eligibility, ranking, focus fallback, and ambiguity;
- exact-hostname allowlist storage;
- stale image and empty-field revalidation;
- safe value setting and event dispatch;
- message validation and typed error mapping;
- confidence policy by recognition category.

### Browser fixtures

- automatic fill on an enabled hostname;
- no automatic behavior on a disabled hostname;
- right-click recognition and fill;
- nearest-field selection and focused-field ambiguity fallback;
- no overwrite of a pre-filled field;
- dynamic image insertion and `src` refresh;
- stale inference result rejection;
- React-style controlled input behavior;
- permission denial and inaccessible image feedback;
- proof that no workflow submits a form;
- offline recognition with bundled assets.

### Experience-build acceptance

- A user can load the unpacked Edge build and enable automatic mode for a local fixture hostname.
- A supported CAPTCHA is recognized locally and its result is written into the correct empty field.
- The same result can be triggered through the image context menu when automatic detection is disabled or misses the image.
- Image refresh causes a new recognition attempt without overwriting user input.
- No workflow uploads data or submits a form.
- Unit tests, type checking, production Edge build, and browser integration tests pass.
- The handoff documents current measured OCR accuracy and does not claim release readiness.

## 11. Delivery Boundary

This design replaces the previous sequencing rule that Tasks 7-14 cannot begin until both OCR benchmark gates pass. It does not weaken or remove the benchmark itself. The immediate milestone is an experience build with a safe end-to-end browser workflow; OCR improvement and release qualification continue as a separate track.
