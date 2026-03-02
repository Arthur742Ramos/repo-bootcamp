# Test Engineer Knowledge

## 2026-03-02T20:51:30+00:00
- Prompt construction in `src/agent.ts` is centralized with shared helpers, while fast mode intentionally keeps a stricter inline schema block.
- The codebase enforces causal error propagation on rethrows (`new Error(message, { cause })`).
- `src/web/server.ts` middleware typing depends on `helmet`, `express-rate-limit`, and `@types/helmet`, and current CI checks are green with those deps present.

## 2026-03-02T22:03:58+00:00
- Web route tests are most stable when each test uses a fresh `createApp()` instance because rate-limit middleware keeps in-memory counters.
- Prompt-related changes in `src/agent.ts` are highly test-sensitive, so error-boundary logic should stay isolated from prompt text blocks.
- Enforcing global coverage thresholds is straightforward technically, but current repository-wide baseline remains below 80/70 when running `npm run test:coverage`.

## 2026-03-02T22:05:20+00:00
- Prompt and session behavior in `src/agent.ts` is highly test-coupled, so DI changes must preserve flow exactly.
- CLI option-source tracking is essential to correctly apply config defaults without overriding explicit flags.
- The repo now supports clean layering: `cli` entrypoint, curated `api`, broader `lib`, and `index` as API re-export.

## 2026-03-02T22:06:01+00:00
- `agent.ts` behavior is highly test-coupled, especially prompt text and streaming event handling.
- `ingest` scanning changes can affect monorepo/workspace detection through `listFilesByPattern`, so parity tests are critical.
- Current build verification path uses `build:cjs` script orchestration and is now passing alongside lint/tests.

## 2026-03-02T22:14:31+00:00
- Rate limiting is route-scoped in `src/web/routes.ts` (`/api/analyze` stricter than other API endpoints).
- `parseGitHubUrl` remains a compatibility-named entrypoint but now covers GitHub/GitLab/Bitbucket with strict validation.
- Plugin execution is staged and test-guarded (analyzer → formatter → output target), with strong wiring coverage in `test/plugins.test.ts` and `test/pipeline-wiring.test.ts`.

