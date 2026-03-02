# Shared Squad Decisions

## 2026-03-02T20:51:30+00:00
- Reuse helper functions to satisfy lint and reduce duplication, while preserving test-visible prompt structure
- Keep fast-mode schema block custom (not replaced by `buildJsonSchema`) to preserve stricter output constraints
- Prefer minimal source edits + dependency additions over broader refactors to keep CI fix low-risk and surgical

## 2026-03-02T22:03:58+00:00
- Prefer **surgical edits** to preserve current behavior and avoid prompt-test regressions.
- Add supertest-based HTTP tests for fidelity, while keeping existing test intent and route expectations.
- Keep error-boundary improvements focused on timeout/request/clone edges, not broad refactors.
- Treat coverage threshold rollout as the primary trade-off: strict immediate enforcement vs staged ratcheting.

## 2026-03-02T22:05:20+00:00
- **Use cosmiconfig-based loading** to gain flexible config-file discovery with minimal custom parser logic.
- **Keep `index.ts` library-only** and move CLI to `cli.ts` to eliminate import side effects for programmatic consumers.
- **Inject LLM client via interface** with default concrete client to improve testability without changing callsites immediately.
- **Adopt real dual ESM/CJS packaging** (extra build complexity) to satisfy `exports` requirements correctly instead of fragile `require` fallbacks.

## 2026-03-02T22:06:01+00:00
- Prefer helper-based extensions in `agent.ts` over prompt refactors to minimize regression risk.
- Move caching to deterministic analyzer phases for safer reuse and lower invalidation complexity.
- Keep radar uncached as derived output from cached deps/security to reduce cache surface.
- Prioritize behavior parity in ingest over perfect ordering stability; add tests only where parity is critical.
- Use minimal package.json changes to deliver DX gains without widening CI blast radius.

## 2026-03-02T22:14:31+00:00
- Favor **surgical maintenance edits** over broad refactors to avoid prompt-coupled and pipeline-coupled regressions.
- Keep fast, local parsing/validation logic in ingest (including lightweight pnpm YAML parsing) for lower complexity, accepting limited parser sophistication.
- Maintain backward compatibility (`parseGitHubUrl` entrypoint and analyzer plugin behavior) even when names/abstractions are broader than legacy semantics.
- Prioritize resilience (plugin stage isolation, route-level guards) over strict fail-fast behavior for user-facing generation flows.

