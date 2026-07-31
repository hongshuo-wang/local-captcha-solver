# Release guide

Captcha Helper uses stable Semantic Versioning tags in the form `vMAJOR.MINOR.PATCH`. The tag, root `package.json` version, generated browser manifests, and `CHANGELOG.md` section must describe the same version.

## First store release

The first Chrome Web Store and Microsoft Edge Add-ons submissions must be completed manually. Store APIs update an existing product; they do not create the initial listing.

Before the first public release:

1. Complete and verify the browser-store developer contact details.
2. Upload the production ZIP manually and complete the listing, privacy, test, and distribution forms.
3. Save the resulting Chrome extension ID or Edge product ID.
4. Keep automatic store publishing disabled until the first listing is approved.

## Prepare a release

1. Move user-visible entries from `Unreleased` into a dated version section in `CHANGELOG.md`.
2. Update `package.json` and `package-lock.json` to the same stable version.
3. Run the local release gates:

   ```sh
   npm ci
   npm run typecheck
   npm test
   npm run test:e2e:extension
   npm run zip:chrome
   npm run zip:edge
   npm run release:prepare -- v1.0.0
   ```

4. Commit and push the release-ready source.
5. Create and push the matching tag only after reviewing the commit:

   ```sh
   git tag -a v1.0.0 -m "Release v1.0.0"
   git push origin v1.0.0
   ```

The Release workflow validates the tag and Changelog, runs unit and built-extension tests, rebuilds production Chrome and Edge ZIPs after E2E, writes `SHA256SUMS.txt`, and creates or updates the GitHub Release using the version's Changelog section.

## Chrome Web Store automation

After the first Chrome listing is approved, add these GitHub Actions secrets under **Settings → Secrets and variables → Actions**:

- `CHROME_EXTENSION_ID`
- `CHROME_CLIENT_ID`
- `CHROME_CLIENT_SECRET`
- `CHROME_REFRESH_TOKEN`

Then add this repository variable:

- `CHROME_STORE_PUBLISH_ENABLED=true`

When enabled, a successful tag Release downloads the exact Chrome ZIP attached to that GitHub Release, uploads it to the existing Chrome Web Store item, and submits the update for review with the default publish target.

Keep `CHROME_STORE_PUBLISH_ENABLED` absent or set to `false` while credentials are incomplete. Never commit Chrome API credentials or a generated `.env.submit` file.

## Microsoft Edge Add-ons automation

After Partner Center approval and the first manual Edge submission, add these GitHub Actions secrets:

- `EDGE_PRODUCT_ID`
- `EDGE_CLIENT_ID`
- `EDGE_API_KEY`

Then add this repository variable:

- `EDGE_STORE_PUBLISH_ENABLED=true`

When enabled, the same tag Release uploads and submits the attached Edge ZIP. Keep the variable disabled until the Edge product and API credentials are active.

## Failure behavior

- A malformed tag, version mismatch, or missing Changelog section stops the release before publication.
- A test or build failure prevents GitHub Release creation and store updates.
- Store jobs are skipped unless their explicit enable variable is `true`.
- A store API failure does not remove the GitHub Release; fix credentials or store state, then rerun the failed job.
- Never work around a failed release by replacing a tag that other users may have fetched. Fix the problem and publish the next patch version when artifacts changed.
