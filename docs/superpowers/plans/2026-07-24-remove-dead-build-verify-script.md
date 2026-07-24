# Remove Dead Build Verify Script Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the unusable `build:verify` package command without changing any working build, test, asset, or runtime behavior.

**Architecture:** This is a package metadata cleanup. Delete the single orphaned script entry, verify no references remain, and run the existing security, test, type, and production build gates.

**Tech Stack:** npm, JSON, Vitest, TypeScript, WXT

---

## File Map

- Modify `package.json`: remove the command that points to the nonexistent verifier.

### Task 1: Remove the Orphaned Package Script

**Files:**
- Modify: `package.json:14`

- [ ] **Step 1: Reproduce the broken command**

Run:

```bash
npm run build:verify
```

Expected: exit nonzero with `Cannot find module 'scripts/verify-build.mjs'`.

- [ ] **Step 2: Remove the orphaned script entry**

Delete this exact property from `package.json`:

```json
"build:verify": "node scripts/verify-build.mjs",
```

Do not add a replacement file or modify another package command.

- [ ] **Step 3: Verify no stale references remain**

Run:

```bash
rg -n "build:verify|verify-build\.mjs" . \
  --glob '!node_modules/**' \
  --glob '!.git/**' \
  --glob '!docs/superpowers/**'
```

Expected: no output and exit code 1 from `rg` because there are no matches.

- [ ] **Step 4: Run the existing quality gates**

Run:

```bash
npm audit
npm test
npm run typecheck
npm run build
npm run build:edge
git diff --check
```

Expected: audit reports zero vulnerabilities; all 240 tests pass; typecheck and both MV3 builds exit 0; diff check has no output.

- [ ] **Step 5: Commit and push**

Run:

```bash
git add package.json
git commit -m "chore: remove dead build verification command"
git push origin main
```

Expected: only `package.json` is included in the implementation commit and GitHub `main` advances to that commit.
