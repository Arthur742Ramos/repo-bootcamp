# Core Developer Knowledge

## 2026-03-02T20:51:30+00:00

- Prompt generation in `src/agent.ts` is now centralized via reusable helper builders, while fast mode keeps a stricter inline schema block.
- The project prefers causal error wrapping (`new Error(message, { cause })`) for rethrows in async flows.
- Web server typings rely on runtime deps (`helmet`, `express-rate-limit`) plus `@types/helmet`, and current lint/build are green with this setup.
- ### CLI commands, services, and web dashboard (src/commands/, src/services/, src/web/)
- Done — the requested CI fixes are already in place (`src/agent.ts` helpers are used, `src/watch.ts` rethrow includes `{ cause: err }`, and `helmet`/`express-rate-limit`/`@types/helmet` are added), and `npm run lint && npm run build` passes locally.
- `main` already contains commit `8ead00b` (`fix: resolve CI lint and type errors`) with the required co-author trailer, and it is already on `origin/main`, so no new commit/push was needed.

## 2026-03-02T22:03:58+00:00

- `analyzeRepo` already routes LLM requests through a dedicated timeout boundary helper, so small targeted improvements there are low-risk.
- `cloneRepo` is already input/path-hardened; the main reliability gain comes from clearer command-timeout and command-failure error classification.
- `analysis.ts`, `tools.ts`, and `schema.ts` did not require additional changes for this subtask’s error-boundary scope.
- ### CLI commands, services, and web dashboard (src/commands/, src/services/, src/web/)
- Implemented for this subtask: `test/web.test.ts` now uses `supertest` for HTTP-level coverage (all major routes, error paths, CSP/security headers, and rate limiting including stricter `/api/analyze` limits), `src/web/routes.ts` now hardens request-shape handling and normalize...
- Also added formatter snapshot coverage (`test/formatter.test.ts` + `test/__snapshots__/formatter.test.ts.snap`), enforced coverage thresholds in `vitest.config.ts` (`lines: 80`, `branches: 70`), updated CI in `.github/workflows/ci.yml` (Node 24 matrix, separate lint/typecheck,...
- Validation run: `npm run lint && npm run build && npm test` passed; additionally, `npm run test:coverage` currently fails on global thresholds with repo baseline at ~70.34% lines / 60.49% branches.

## 2026-03-02T22:05:20+00:00

- `agent.ts` is highly test-sensitive and prompt/event behavior is heavily asserted, so DI changes must preserve flow and output shape.
- The repo is mid-refactor (CLI/API/config work already in flight), so keeping changes additive and interface-driven avoids conflicts.
- ### CLI commands, services, and web dashboard (src/commands/, src/services/, src/web/)
- I hit unexpected concurrent workspace drift (many unrelated tracked files changed, including `src/plugins.ts`, `src/agent.ts`, `package.json`, and tests), so I paused to avoid overwriting someone else’s in-flight work. I’ve only applied the CLI split scaffolding so far (`src/c...

## 2026-03-02T22:06:01+00:00

- Prompt text in `agent.ts` is highly test-coupled; structural prompt edits are risky.
- Fast mode intentionally inlines files and is the right place for model-based char budgeting.
- Progress UX is already wired through `onProgress`, making it the safest non-verbose streaming channel.
- `scanRepo` output feeds multiple downstream analyzers (including monorepo detection), so scan parity matters beyond ingestion speed.
- `listFilesByPattern` is a critical utility for workspace detection and needed robust glob-to-regex handling.
- ### CLI commands, services, and web dashboard (src/commands/, src/services/, src/web/)
- Implemented subtask 2 by adding phase-level cache APIs in `src/cache.ts` (`readPhaseCache`/`writePhaseCache`) and wiring them into analyzer execution in `src/analysis.ts`, then routing cache options from `prepareOutputDocuments` in `src/services/analysis-orchestration.ts` whil...
- I also added the DX CLI updates in `package.json`: `dev:web`, `format`, `format:check`, `typecheck`, and `lint-staged` config for husky pre-commit.

## 2026-03-02T22:14:31+00:00

- `parseGitHubUrl` is now a compatibility-named, multi-provider parser (GitHub/GitLab/Bitbucket) with strict segment/control-character validation.
- Clone safety is enforced in both ingest and service layers via argument-based `execFile` usage plus URL/branch validation (no shell interpolation path).
- The analysis pipeline is explicitly staged and cache-aware (`runParallelAnalysis`), with plugin flow split into analyzer → formatter → output-target.
- Web rate limiting is endpoint-specific in routes: stricter `/api/analyze` and broader `/api/jobs/*` limits.
- ### CLI commands, services, and web dashboard (src/commands/, src/services/, src/web/)
- Audit complete for the requested CLI/services/web scope: the URL sanitization + clone safety checks, granular `/api/analyze` vs default API rate limits, plugin-stage architecture wiring, monorepo/provider ingest support, ADRs, README badge/screenshot updates, and GitHub issue/...
- I re-ran `npm run lint && npm run build && npm test` and all tests pass (`30` test files, `613` tests).
