# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

No unreleased changes yet.

## [1.1.0] - 2026-09-05

### Added

- Web previews offer a rendered Markdown view and an exact-source toggle, with safe links and unchanged Copy/Download output.
- Desktop and mobile browser checks cover preview request races, failed loads, hostile Markdown, and keyboard navigation.

- `bootcamp tasks <repo-url>` command: a deterministic, cross-ecosystem **task discovery** report answering the #1 Day-1 question — "how do I build, test, and run this?" — without invoking the LLM. Parses the task-definition files a repo already ships: `package.json` scripts (package-manager aware — npm/pnpm/yarn/bun detected from `packageManager` and lockfiles), `Makefile`, `justfile`, go-task `Taskfile`, `docker-compose`, `pyproject.toml` (Poetry scripts and PEP 621 `project.scripts`), and `composer.json`. Categorizes each task (install/build/test/lint/dev/run/release/other), groups the report by category, and suggests a first-session getting-started sequence (install → build → test → dev/run). Supports `--json` and `--category <name>` filtering, with a non-zero exit on an unknown category. Also extends `COMMANDS`/`GETTING_STARTED` generation in the standard kit so **non-npm repos** (Rust, Go, Python, PHP) finally surface runnable commands; existing npm `npm run <name>` command strings are preserved byte-for-byte. Exposed via the `./tasks` package subpath and public re-exports from `src/api.ts` (`discoverTasks`, `categorizeTask`, `suggestGettingStarted`, `toCommands`, `CATEGORY_ORDER`, and related types).
- `bootcamp owners <repo-url>` command: a deterministic **ownership map** answering "who do I ask?" for any repository. Parses `CODEOWNERS` (from `.github/`, the repo root, or `docs/`), lists the **default owners** (the `*` rule), maps owners to each **top-level area** with the canonical last-match-wins semantics, lists all **maintainers**, and adds a best-effort **top-committers** list from whatever git history is available. Supports `--json`. Never invokes the LLM.
- `bootcamp preflight <repo-url>` command: a deterministic **toolchain preflight** that checks _your_ machine against the _target_ repo's declared requirements (the #1 silent first-run friction). Reads the repo's declared toolchain — Node (`engines.node`, `.nvmrc`, `.node-version`), package manager (`packageManager` / Corepack, or `engines.<pm>`), Python (`requires-python` / `pyproject` Poetry / `.python-version`), and Go (`go.mod`) — probes the locally installed versions, and reports a per-tool status (ok / mismatch / missing) with a remedy line. Supports `--json` and a CI gate via `--check` (exit non-zero when any declared tool is missing or mismatched). Distinct from `bootcamp doctor`, which checks whether your machine can run bootcamp itself.
- `bootcamp coupling <repo-url>` command: a standalone, deterministic **module coupling map** for any repository (local path or remote URL) without invoking the LLM. Builds the internal import graph and ranks every source module by fan-in (how many modules depend on it) and fan-out (how many it depends on), surfacing the **load-bearing core** (most depended-upon — the best place to start reading), the **orchestrator hubs** (highest fan-out), and **possibly-orphaned** modules (isolated in the import graph — candidate dead code). Prints a human-readable report by default and supports `--json` (with per-module fan-in/fan-out) and `--top <n>`. Reuses the same hardened `buildImportGraph` engine as `IMPACT.md`; distinct from `bootcamp impact` (which traces one file's blast radius) in that it ranks the whole codebase by centrality.
- `bootcamp impact <repo-url> [file]` command: a standalone, deterministic **change-impact ("blast radius")** report for any repository (local path or remote URL) without invoking the LLM. Builds an import graph and, for a given file, reports what it imports, what imports it, and the transitively affected files, tests, and docs; with no file argument it summarizes the repository's key entry-point files (bounded by `--top`). Prints a human-readable report by default and supports `--json` for scripting. Reuses the same `buildImportGraph`/`analyzeChangeImpact` engine that powers `IMPACT.md`, completing the standalone deterministic command set (`scan`/`health`/`metrics`/`security`/`deps`/`radar`/`impact`).
- `bootcamp radar <repo-url>` command: a standalone, deterministic **tech radar + onboarding-risk** report for any repository (local path or remote URL) without invoking the LLM. Scans once, gathers the dependency and security analyses, and maps the tech stack onto modern/stable/legacy/risky rings while scoring onboarding risk (0-100, **lower is better**) with a grade and human-readable risk factors. Prints a human-readable report by default, supports `--json` for scripting, and offers a CI gate via `--check`/`--max-risk` (exits non-zero when the risk score exceeds the threshold). Reuses the same `generateTechRadar` engine that powers `RADAR.md`.
- `bootcamp deps <repo-url>` command: a standalone, deterministic dependency report for any repository (local path or remote URL) without invoking the LLM. Detects the package manager (npm, Cargo, pip/Poetry, or Go), groups dependencies into smart categories, and lists runtime/dev/peer counts and versions. Prints a human-readable report by default, supports `--json` for scripting, and `--diagram` to emit the Mermaid dependency graph. Reuses the same `extractDependencies` engine that powers `DEPENDENCIES.md` — extending the standalone deterministic command set (`scan`/`health`/`metrics`/`security`/`deps`).
- `bootcamp scan <repo-url>` command: clone or resolve a repository **once** and run all three deterministic analyses — health, metrics, and security — from that single scan, then print a combined dashboard (or `--json`). Surfaces the three headline scores side-by-side with the top cross-report suggestions, and offers a CI gate via `--check`/`--min-score` that fails on the **lowest** of the three scores. Avoids cloning the same repository three times when you want the full picture — an umbrella over the standalone `health`/`metrics`/`security` commands.
- `bootcamp doctor` now reports the running `repo-bootcamp` version as the first diagnostic line (and `environment.toolVersion` in `--json` output), so it's easy to include in bug reports.
- `bootcamp security <repo-url>` command: a standalone, deterministic security pattern analysis for any repository (local path or remote URL) without invoking the LLM. Reports detected security findings (with severity, file/line, and remediation), protection coverage (security headers, CORS, CSP, rate limiting, input validation, SQL-injection prevention, secret handling), security-relevant dependencies, and a **0-100 score + A–F grade**. Prints a human-readable report by default, supports `--json` for scripting, and offers a CI gate via `--check`/`--min-score`. Reuses the same `analyzeSecurityPatterns` engine that powers `SECURITY.md` — completing the deterministic `health`/`metrics`/`security` trio.
- Interactive Q&A mode (`bootcamp ask` and `--interactive`) now supports **slash commands**: `/help` (alias `/?`) shows the command reference, `/files` lists the detected repository files, `/clear` clears the screen, and `/exit` (aliases `/quit`, `exit`, `quit`) ends the session. Unknown slash commands are reported instead of being sent to the assistant. The input classifier and renderers are pure and unit-tested.
- `bootcamp metrics <repo-url>` command: a standalone, deterministic codebase-metrics report for any repository (local path or remote URL) without invoking the LLM. Surfaces language breakdown, source/test/doc/config composition, average/median file size, test-to-source ratio, size classification, top-level directory distribution, largest-file hotspots, and an **approachability score (0-100 + A–F grade)** with human-readable drivers. Prints a human-readable report by default, supports `--json` for scripting, and offers a CI gate via `--check`/`--min-score` (exits non-zero when approachability is below the threshold). Reuses the same `computeCodebaseMetrics` engine that powers `METRICS.md` — mirroring the existing `bootcamp health` command.
- Web demo file viewer now has **Copy** and **Download** buttons: copy a generated doc's contents to the clipboard (async Clipboard API with a `document.execCommand` fallback and a timeout guard) or download it as a file, directly from the preview modal.
- `bootcamp completion <bash|zsh|fish>` command to print a shell completion script for tab-completing subcommands, their aliases, and option flags. The completion data is derived from the live CLI definition, so it can never drift from the actual command surface; pipe it to your shell's completion directory (or `source <(bootcamp completion bash)`).
- `--quiet`/`-q` flag for the main `bootcamp <repo-url>` command: suppresses the banner, run header, detected-stack table, progress spinners, score summary, and file-tree listing, printing only the output directory path on stdout so the command composes cleanly in scripts and CI (`OUT=$(bootcamp <url> --quiet)`). Failures and warnings are still written to stderr. Mutually exclusive with `--verbose`.
- `bootcamp styles` command (alias `style`) to list the built-in style packs and the documentation sections each one enables, so users can choose a `--style` without reading the source. Prints a per-pack summary (tone, depth, emoji, first-task count, enabled sections) plus a section-coverage matrix, flags the default pack (`oss`), and supports `--json` for scripting.
- `bootcamp init` command to scaffold a `.bootcamprc.json` configuration file in the current directory. Refuses to overwrite an existing config unless `--force`, supports `--print` to preview the config on stdout without writing, `--path` for a custom output location, and `--style` to preset a built-in style pack.
- `bootcamp health <repo-url>` command: a standalone, deterministic onboarding-readiness score for any repository (local path or remote URL) without invoking the LLM. Prints a human-readable report by default, supports `--json` for scripting, and offers a CI gate via `--check`/`--min-score` (exits non-zero when the score falls below the threshold). Reuses the same `computeRepoHealth` engine that powers `HEALTH.md`.
- `HEALTH.md` repo-health & onboarding-readiness report (flagship): a deterministic, AI-free evaluation of the signals that make a project approachable to new contributors — documentation (README, license, contributing, changelog), community files (code of conduct, security policy, issue/PR templates, CODEOWNERS), quality tooling (tests, linter, formatter, EditorConfig, .gitignore), and automation (CI, dependency bots, git hooks). Produces a weighted **0-100 score + A–F grade** with prioritized, actionable recommendations. Gated by the new `showHealth` style-pack section (on for all packs except `minimal`) and surfaced in the run summary.
- `./health` package subpath export, plus public re-exports from `src/api.ts` (`computeRepoHealth`, `generateHealthDocs`, `getHealthGrade`, and related types).
- `METRICS.md` codebase metrics & hotspots report (flagship): a deterministic, AI-free analysis of language breakdown, source/test/doc/config counts, largest-file hotspots, top-level directory distribution, test-to-source ratio, size classification, and an **Approachability score (0-100 + A–F grade)** with human-readable drivers. Gated by the new `showMetrics` style-pack section (on for all packs except `minimal`) and surfaced in the run summary.
- `bootcamp doctor` command to diagnose the local environment before a run: checks Node.js (>= 20, required), git (required), GitHub CLI + authentication, a Copilot/GitHub token env var, optional `mermaid-cli`, and analysis-cache health. Supports `--json` for scripting and exits non-zero when a required check fails (CI-friendly).
- `./metrics` and `./doctor` package subpath exports, plus public re-exports from `src/api.ts` (`computeCodebaseMetrics`, `generateMetricsDocs`, `evaluateDoctor`, `gatherEnvironment`, and related types).
- `bootcamp cache list` (alias `ls`) subcommand to inspect cached analysis entries, with a human-readable table and `--json` output for scripting. Surfaces repository, phase, SHA, age, size, model, and style, and reports `(legacy)`/`(malformed)` files so users can see disk usage from stray cache files instead of silently hiding them.
- `bootcamp diff <owner/repo#pr>` command for onboarding-focused PR diffing
- Developer workflow scripts: `format`, `format:check`, `typecheck`, and `dev:web`
- `lint-staged` configuration for husky pre-commit usage
- Formatter snapshot tests for markdown/HTML/PDF output stability in `test/formatter.test.ts`
- Supertest HTTP-level web server tests for routes, error paths, rate limiting, and security headers
- Vitest global coverage thresholds (`lines: 80`, `branches: 70`)
- CI test matrix support for Node.js 24
- PR dependency scanning with `actions/dependency-review-action`
- SBOM generation/upload in CI via `npm sbom --sbom-format spdx`
- Separate CI jobs for linting and type-checking
- Programmatic API entry modules (`src/api.ts`, `src/lib.ts`) with package root re-export from `src/index.ts`
- CLI/core split with `src/cli.ts` as bin entrypoint (`dist/cli.js`) and library-safe `src/index.ts`
- Project config file discovery via cosmiconfig (`.bootcamprc`, `bootcamp.config.ts`, and related variants)
- Config `defaults` support for audience/focus/style/model/maxFiles with CLI-over-config precedence
- Agent dependency injection interfaces (`LlmClient`, `LlmSession`, `AnalyzeRepoDependencies`) for testable client wiring
- npm `exports` map with subpath exports (`./api`, `./lib`, and focused modules) for ESM/CJS consumers
- CJS build output generation (`dist/cjs`) for `require(...)` compatibility alongside ESM output
- Multi-host repository URL support (GitHub, GitLab, Bitbucket) with normalized parsing metadata
- Monorepo detection for npm workspaces, pnpm workspaces, Lerna, Nx, and Turborepo
- Typed plugin API (`src/plugin-api.ts`) supporting analyzer, formatter, and output-target plugin stages
- Architecture Decision Records in `docs/adr/` for Copilot SDK, Express, cache strategy, and plugin architecture
- Structured GitHub issue forms (`bug.yml`, `feature.yml`) and pull request template
- npm provenance badge and related documentation updates in `README.md`

### Changed

- `bootcamp scan` now also reports the tech-radar **onboarding-risk** score (0-100, lower is better) in its single-clone dashboard alongside health, metrics, and security — a near-free addition since `scan` already computes the file scan, security analysis, and `package.json` that the radar needs. The top onboarding-risk factor joins the cross-report "Top suggestions", and `onboardingRisk` is included in `--json`. The `--check` gate is unchanged (still the lowest of the three higher-is-better scores; onboarding risk is shown but not gated).
- Refactored the three deterministic scan commands (`health`, `metrics`, `security`) in `src/cli.ts` to register through a single shared `registerScanCommand` helper. They expose an identical flag surface (`--branch`, `--check`, `--min-score`, `--json`, `--max-files`, `--keep-temp`, `--verbose`) and identical option plumbing (including the raw-argv fallback for the `-b`/`-m` root-collision), so a 4th scan command is now a small config object rather than a ~28-line copy-paste. No behavior change — verified by the existing unit and E2E suites.

### Fixed

- Updated qs and humanfs transitive dependencies to address the current dependency advisories.
- GitHub release archives and SHA-256 checksums are published independently of npm credentials after CI gates pass.
- Closing or replacing a file preview cancels its request and ignores late responses, preventing stale contents from appearing under another filename.

- Several smaller correctness fixes from the audit: **PR diffs** (`src/diff.ts`) now record the _new_ path for a renamed/copied file — `git diff --name-status` emits `R<score>\toldpath\tnewpath`, and the old code joined the fields into a single `oldpath\tnewpath` string that corrupted the "Files Modified" listing and silently dropped renamed files from later per-file scans. **Markdown→HTML** (`src/formatter.ts`) now escapes the contents of inline code spans, so common type signatures like `` `Promise<void>` `` no longer emit raw `<void>` markup that browsers swallow (fenced blocks were already escaped — this restores the symmetry). The main command's **`--render-diagrams`** flag no longer renders on _every_ run: because the option carries a default value, the old `!== undefined` presence check was always true; it now detects real CLI presence via the option source. And **watch mode** (`src/watch.ts`) advances its commit cursor only after a successful re-analysis, so a transient failure during regeneration is retried on the next poll instead of leaving the generated docs permanently stale.
- Documentation-drift analysis (`src/docs-analyzer.ts`) no longer mis-reports three cases an audit found: a string `bin` in `package.json` (the common single-binary form, e.g. `"bin": "dist/cli.js"`) now resolves the CLI command from the package **`name`** instead of `Object.keys(<string>)[0]`, which yielded the literal `"0"` for every CLI-drift entry; a Corepack `packageManager` field with an integrity hash (`pnpm@8.6.0+sha512.<hash>`) no longer triggers a spurious version mismatch (the hash suffix is stripped before comparison); and the framework-doc coverage check matches short, ambiguous terms like `ts` as **whole words**, so a README containing `scripts`/`tests` no longer makes undocumented TypeScript register as documented.
- Repository ingest parsing (`src/ingest.ts`): GitHub Actions **workflow triggers** are now parsed correctly for the common block form (`on:` on its own line followed by indented `push:`/`pull_request:` keys) — previously the regex captured only the first key _with_ its trailing colon (e.g. `["push:"]`); nested keys like `branches:` are skipped and the inline `on: [push, pull_request]` form still works. **Makefile** target extraction no longer emits phantom targets from `:=` variable assignments (e.g. `CC := gcc`). **Key-file selection** now recognizes modern ESM/TypeScript extensions (`.mjs`, `.cjs`, `.mts`, `.cts`), so repos authored in those are no longer handed an empty "key source files" context. And **README/CONTRIBUTING discovery** covers more real filename variants (`Readme.md`, `README.MD`, and the non-Markdown `README.rst`/`README.txt`).
- Tech-radar accuracy (`src/radar.ts` + `radar-signals.json`, behind `bootcamp radar` and `RADAR.md`): dependency-signal lookup is now scope-aware, so scoped packages match their signal (e.g. `@remix-run/react` and `@trpc/server`, whose stub keys `@remix-run`/`trpc` previously never matched the real package names and were dropped from the radar entirely). Onboarding-risk **test detection** now matches on path segments and covers non-JS conventions — so the very common plural `tests/` directory and Go (`*_test.go`) / Python (`test_*.py`, `*_test.py`) tests are recognized, while unrelated directories like `latest/` no longer count as tests. And **TypeScript** is no longer emitted in two contradictory rings at once (the language-derived "modern" signal is skipped when a `typescript` dependency was already categorized).
- Codebase-metrics scoring (`src/metrics.ts`, behind `bootcamp metrics` and `METRICS.md`) no longer mis-scores three cases an audit surfaced: a large, sparsely-tested repo whose test-to-source ratio rounds to `0.00` is no longer reported as having **no tests** (the zero-test decision now uses the raw test-file count, and the `<0.2`/`<0.5` thresholds use the unrounded ratio, so a repo with 1 test across 250 source files reads "low ratio", not "no tests"); a repo written entirely in a language the analyzer doesn't recognize (e.g. Terraform/HCL) is no longer given a perfect **100/A "Tiny"** approachability score (the size penalty falls back to total file count and a factor flags the unrecognized language); and **generated/vendored** code (e.g. a committed `*.min.js` bundle) is now excluded from source counts, the language breakdown, and the average/largest-file penalties consistently — previously it was excluded only from the hotspot list while still inflating those metrics.
- Security pattern accuracy (`src/security.ts` + `security-patterns.json`, behind `bootcamp security` and `SECURITY.md`) was sharpened after an audit found inverted and over/under-broad matchers: the **SQL-injection** detector now matches the canonical `SELECT … ${id}` order (it previously required the interpolation _before_ the keyword, missing virtually every real case); **`eval(`** is anchored with a word boundary so identifiers like `retrieval(` no longer trip a "Use of eval()" finding; the **SSL/TLS** matcher requires real TLS context (`rejectUnauthorized: false`, `strictSSL: false`, `ssl*: false`, `disable…ssl/tls`) instead of the over-broad `verify.*false` that fired on `verifyEmail: false`; the **hardcoded API-key** value class accepts the non-alphanumeric separators real tokens use (`ghp_…`, `sk-…`, `xoxb-…`); **`innerHTML`** matches a real assignment or `+=` append but not an `===`/`==` comparison; and **`.env.sample`** is treated as a template (like `.env.example`) rather than being double-counted as a real, secret-bearing env file.
- Change-impact import graph (`src/impact.ts`) now captures the import forms it previously dropped: `import type { … }` / `export type { … }` (ubiquitous under `isolatedModules`/`verbatimModuleSyntax`), combined default-plus-named imports (`import D, { N } from …`), and dynamic `import("…")`. Python imports are now resolved too — relative (`from .mod import …`, `from ..pkg import …`) and package-absolute (`from pkg.mod import …`), probing `<module>.py` and `<module>/__init__.py` — where previously the leading dot was kept and bare module names were discarded as external. `findRelatedTests` now matches co-located tests for repo-root files (`dirname` is `.`, which no longer becomes a literal `./` prefix the forward-slash scan keys can't match), and `findRelatedDocs` no longer ties _every_ file under a `docs/` directory to _every_ target (that blanket match made the "related docs" list identical and misleading across unrelated files).
- Dependency manifest parsing (`src/deps.ts`, behind `bootcamp deps` and `DEPENDENCIES.md`) was substantially hardened after an audit found systematic mis-parsing of real-world files: **Cargo** no longer leaks state across sections (so `[features]`/`[profile.*]`/`[[bin]]` keys are no longer counted as dependencies), reads `{ version = "…" }` inline tables and `[dependencies.<crate>]` detailed tables correctly (previously recorded the version as `"{"` and invented a `version` dependency); **Poetry** sections now terminate at the next table header instead of the first `[` in a value, so dependencies after an inline-table line (`extras = [...]`) are no longer dropped; **requirements.txt** skips pip option/include lines (`-r`, `-e`, `-c`, `--hash`, `--index-url`) and strips extras/markers instead of recording them as packages; **go.mod** reads every `require ( … )` block (gofmt emits separate direct and `// indirect` blocks) rather than only the first; **npm** now includes `optionalDependencies`. The npm/Cargo extractors are also silent on the "not this manifest" path, so `--json` output on non-npm repos is no longer corrupted by a stray debug line.
- Change-impact import resolution (`src/impact.ts`) now resolves ESM/TypeScript module specifiers that reference the compiled `.js`/`.mjs`/`.cjs` extension (e.g. `import "./util.js"` → `util.ts`). Previously the resolver only appended extensions to the literal path, so these specifiers never matched — leaving `imports`/`importedBy` (and therefore `IMPACT.md`'s "affected files") silently empty for virtually every modern TypeScript project. Also normalizes index-file lookups (`import "./lib"` → `lib/index.ts`) to forward slashes so they resolve on Windows, where `path.join` produced back-slashed paths that never matched the scan's forward-slash file set.
- Web demo modal controls (close button, click-outside-to-dismiss) were wired with inline `onclick` handlers that the server's Content-Security-Policy (`script-src-attr 'none'`) silently blocked, so they did nothing. All modal controls now use `addEventListener`, restoring close/dismiss behavior and enabling the new Copy/Download buttons under the same CSP.
- Raised the Vitest unit-test timeout from the 5s default to 30s (`testTimeout`/`hookTimeout` in `vitest.config.ts`). Several unit tests perform real git operations (init/clone/commit) and filesystem fixture setup that can exceed 5s on busy CI runners, Windows, or under parallel load, causing intermittent "Test timed out in 5000ms" failures unrelated to the code under test. Fast tests are unaffected.
- `bootcamp ask`, `docs`, and `diff` now honor options whose flag names collide with the root command. `ask --branch/--model`, `docs --branch`, and `diff --format/--full-clone/--keep-temp` were captured by the root command and silently ignored; they are now read from raw argv (via shared, tested `getFlagValue`/`hasFlag` helpers in `src/utils.ts`).
- `bootcamp health` now honors `--branch` and `--max-files`. These short flags (`-b`/`-m`) collide with the root command's options, which captured them before the subcommand could; the command now falls back to reading raw argv (matching the `diff --output` approach). The `--json` output also gained a `filesScanned` field.
- Reused shared prompt helper builders in `src/agent.ts` for standard/fast prompt construction.
- Preserved caught error causes in `src/watch.ts` non-fast-forward rethrows.
- Added missing web middleware dependencies/types (`helmet`, `express-rate-limit`, `@types/helmet`) for type-checking.
- Streamed Copilot assistant output incrementally in analysis flows (verbose stdout and non-verbose progress updates).
- Added model-aware fast-mode inline file budgets based on selected model context window.
- Switched repository walking to concurrent `fast-glob` traversal while preserving skip/max-file behavior.
- Added phase-level analyzer cache entries for dependency, security, and impact analysis.
- Hardened async error boundaries for Copilot timeouts (`src/agent.ts`), clone failures (`src/ingest.ts`), and web request handling (`src/web/routes.ts`).
- Hardened repository URL/branch sanitization before clone execution and added safer clone path construction.
- Replaced coarse API throttling with endpoint-level limits (`/api/analyze`: 5/15m, other API routes: 100/15m).

## [1.0.0] - 2026-01-25

### Added

- **Core Features**
  - Agentic repository analysis using GitHub Copilot SDK
  - Generate 12+ interconnected markdown documentation files
  - Support for TypeScript, Python, Go, Rust, Java, and more languages
  - Schema validation with Zod and auto-retry on failures
  - Smart file prioritization and byte budget management

- **CLI Commands**
  - `bootcamp <url>` - Generate full bootcamp documentation
  - `bootcamp ask <url>` - Interactive Q&A mode without full generation
  - `bootcamp web` - Start local web demo server

- **CLI Options**
  - `--branch` - Analyze specific branch
  - `--focus` - Focus on onboarding, architecture, contributing, or all
  - `--audience` - Target backend, frontend, or sre
  - `--output` - Custom output directory
  - `--style` - Output styles: corporate, startup, oss, academic, minimal
  - `--interactive` - Start Q&A mode after generation
  - `--compare` - Compare with git ref for version diffing
  - `--create-issues` - Create GitHub issues from starter tasks
  - `--render-diagrams` - Render Mermaid to SVG/PNG
  - `--fast` - Fast mode with inlined files (~15-30s)
  - `--json-only` - Only generate repo_facts.json
  - `--no-clone` - Use GitHub API instead of cloning

- **Generated Documentation**
  - BOOTCAMP.md - 1-page overview
  - ONBOARDING.md - Complete setup guide
  - ARCHITECTURE.md - System design with Mermaid diagrams
  - CODEMAP.md - Directory tour
  - FIRST_TASKS.md - 8-10 starter issues by difficulty
  - RUNBOOK.md - Operations guide
  - DEPENDENCIES.md - Dependency graph and analysis
  - SECURITY.md - Security patterns and findings
  - RADAR.md - Tech radar and onboarding risk score
  - IMPACT.md - Change impact analysis
  - diagrams.mmd - Mermaid diagram sources
  - repo_facts.json - Structured data for automation

- **Analysis Features**
  - Tech radar for identifying modern, stable, legacy, and risky technologies
  - Security analysis with scoring
  - Change impact analysis for key files
  - Dependency graph generation
  - Version comparison (DIFF.md)

- **Integrations**
  - GitHub issue creation from starter tasks
  - Web demo server with Express
  - Plugin system for custom analyzers
  - Template packs for output customization

- **Developer Experience**
  - 205 passing tests with Vitest
  - Full TypeScript support
  - Beautiful CLI output with progress indicators
  - Streaming responses during analysis

[Unreleased]: https://github.com/Arthur742Ramos/repo-bootcamp/compare/v1.1.0...HEAD
[1.1.0]: https://github.com/Arthur742Ramos/repo-bootcamp/releases/tag/v1.1.0
[1.0.0]: https://github.com/Arthur742Ramos/repo-bootcamp/releases/tag/v1.0.0
