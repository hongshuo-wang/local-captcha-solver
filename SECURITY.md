# Security Policy

## Supported versions

Security fixes are provided for the latest published stable version. Users should update to the newest Chrome Web Store, Edge Add-ons, or GitHub Release build when a fix is available.

## Reporting a vulnerability

Do not disclose a vulnerability, privacy issue, credential, private website, or sensitive CAPTCHA sample in a public issue.

Use GitHub's private vulnerability reporting for this repository:

1. Open the repository's **Security** tab.
2. Choose **Report a vulnerability**.
3. Include the affected version, browser, impact, reproduction steps, and a minimal proof of concept.

If private vulnerability reporting is temporarily unavailable, contact the maintainer through the verified publisher contact shown on the extension store listing and request a private reporting channel before sending technical details.

Reports involving permission escalation, remote code execution, data leaving the device, unsafe form interaction, model asset substitution, or exposure of sensitive page content are treated as security issues.

Maintainers will acknowledge a valid report, investigate it, and coordinate disclosure after a fix is available. Please allow time for browser-store review before public disclosure.

## Security boundaries

Captcha Helper is designed to:

- run bundled recognition assets locally;
- request website access through browser permission APIs;
- avoid collecting or transmitting user data;
- avoid automatic form submission; and
- abstain when recognition or field matching is uncertain.

The extension does not bypass browser same-origin, CORS, or site authentication protections. A website and its content remain outside the extension's trust boundary.
