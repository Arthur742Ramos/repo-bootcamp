# Lead Architect Knowledge

## 2026-03-02T20:51:30+00:00
- Prompt generation is centralized in `src/agent.ts`, with style/audience/custom guidance layered into both standard and fast modes
- Fast mode has intentionally stricter JSON-shape instructions and avoids tool usage
- Error-handling convention prefers preserving original exceptions via `cause`
- Test suite heavily validates prompt content via substring/section-based checks, so wording changes can have high blast radius

## 2026-03-02T22:03:58+00:00
- Vitest suite is large and fast; existing lint/build/test baseline is green.
- `test/web.test.ts` already has broad route/error assertions, but uses `fetch` rather than `supertest`.
- `src/web/routes.ts` has strong happy/error flow coverage but still has request-shape hardening opportunities.
- `src/agent.ts` has extensive tests and high prompt-coupling; wording changes have high blast radius.
- CI currently has test/lint/build jobs with Node 20/22 only and no dependency-review/SBOM steps.

## 2026-03-02T22:05:20+00:00
- Prompt generation and model fallback are centralized in `src/agent.ts`, and tests validate prompt text very aggressively.
- Runtime flow is already modularized through `services/*` (`clone`, `config-resolution`, `analysis-orchestration`, `output-writer`), which is the right seam for default option merging.
- `src/index.ts` is currently both CLI entry and partial API export (`runParallelAnalysis`), so splitting responsibilities will reduce coupling cleanly.
- Config already exists (`loadConfig` in `plugins.ts`) but is JSON-path based and not yet suitable for `.bootcamprc`/TS config discovery.

## 2026-03-02T22:06:01+00:00
- Prompt content is highly test-coupled; small wording changes can break many tests.
- Fast mode is intentionally stricter and schema-explicit, and should stay separate from shared schema helpers.
- Progress plumbing relies on `onProgress` + `ProgressTracker`; this is the safest integration point for non-verbose streaming.
- Existing cache logic is centralized and easy to refactor, but currently targets full `RepoFacts` only.
- Ingestion currently does sequential filesystem traversal; replacing it is a contained performance win.

## 2026-03-02T22:14:31+00:00
- `src/ingest.ts` is the true ingestion boundary: URL normalization, clone safety, monorepo detection, and scan shaping are centralized there.
- Route-level middleware in `src/web/routes.ts` cleanly supports differentiated rate limits and is already covered by `supertest` in `test/web.test.ts`.
- Plugin flow is now explicitly staged (analyzer → formatter → output target), with wiring guarded by `test/plugins.test.ts` and `test/pipeline-wiring.test.ts`.
- ADRs and GitHub contribution templates are already present and aligned with lightweight governance patterns.

