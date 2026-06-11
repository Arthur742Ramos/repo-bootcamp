# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

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

### Fixed

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

[1.0.0]: https://github.com/Arthur742Ramos/repo-bootcamp/releases/tag/v1.0.0
