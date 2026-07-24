# Remove Dead Build Verify Script

Date: 2026-07-24

## Decision

Remove the `build:verify` entry from `package.json`. The referenced
`scripts/verify-build.mjs` file does not exist, and no source file, test,
documentation page, or CI workflow consumes this command.

## Scope

- Do not add a placeholder verifier.
- Keep `build`, `build:edge`, asset integrity tests, and all other scripts unchanged.
- Do not change production dependencies or extension runtime behavior.

## Verification

- Confirm `build:verify` and `verify-build.mjs` have no remaining references.
- Run `npm test`, `npm run typecheck`, `npm run build`, and `npm run build:edge`.
- Run `npm audit` and confirm the dependency security result remains at zero.
