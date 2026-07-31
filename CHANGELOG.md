# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project follows [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [1.0.0] - 2026-07-31

### Added

- Fully local recognition for common digit, English-letter, alphanumeric, and one-step integer arithmetic CAPTCHAs.
- Conservative automatic filling with per-category confidence thresholds and explicit abstention for uncertain results.
- User-controlled global or selected-site permissions with authorized and disabled site management.
- A standalone first-install onboarding experience and a full-tab settings page.
- Popup controls, image context-menu recognition, configurable mouse shortcuts, and optional result copying.
- Local model status, retry controls, and up to 20 sanitized diagnostic records with clear and copy actions.
- English and Simplified Chinese extension localization.
- Chrome Manifest V3 and Microsoft Edge production builds using bundled ONNX/WebAssembly assets.
- Public project documentation, contribution templates, and automated SemVer release infrastructure.

### Privacy

- CAPTCHA images and recognition results remain on the device.
- No account, advertising, analytics, telemetry, remote OCR, remote code, or automatic form submission.

### Model

- Production 2.24 MB CAPTCHA CTC model approved at 99.587% automatic-fill precision and 82.38% coverage on the isolated 10,000-image validation set.
- Frozen 201-image benchmark at 98.01% whole-string/fill accuracy and 100% arithmetic-answer accuracy.
- Documented data provenance, licenses, split-group isolation, Paddle/ONNX parity, and offline Chrome/Edge verification.

[Unreleased]: https://github.com/hongshuo-wang/local-captcha-solver/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/hongshuo-wang/local-captcha-solver/releases/tag/v1.0.0
