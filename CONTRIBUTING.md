# Contributing to httptape

Thanks for considering a contribution. This document tells you what the CI gate runs and the few hard rules this repository enforces.

## The gate

CI runs these commands; every one must pass locally before you open a PR:

```bash
npm ci
npm run typecheck
npm test
npm run build
npm run coverage
npm audit --audit-level=high
```

The same list is derived from `.github/workflows/ci.yml` and pinned by `tests/guards.test.ts`; if CI changes, the guard test fails until this file matches.

## Node versions

- The package promises Node `>=20.11` at runtime.
- The dev toolchain (vitest 4, vite 8) needs Node `20.19+` (or 22.12+). Use a recent Node for development; the runtime floor applies to consumers, not contributors.

## Rules that CI actually enforces

1. **Zero runtime dependencies.** `npm run test` guards `dependencies: {}` in package.json.
2. **Tests are offline.** The only network used is a loopback `node:http` server started inside the test process.
3. **README transcripts are hand-verified.** Maintainers re-run every command block in README.md with the vtf3 transcript tool before a release; CI runs unit and guard tests only and never re-executes the transcripts. Do not edit output you have not produced yourself.
4. **No hand-maintained mutable numbers.** Counts that appear in docs must be pinned by a test or expressed structurally.

## Releases

Releases are tag-driven: pushing `vX.Y.Z` triggers `.github/workflows/release.yml`, which verifies the tag matches package.json, attaches the npm tarball and a `SHA256SUMS.txt`, and publishes release notes extracted from CHANGELOG.md. Maintain push the tag; contributors never run the publish step.
