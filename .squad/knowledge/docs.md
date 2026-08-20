# Documentation Specialist Knowledge

## 2026-03-02T20:51:30+00:00

- Changelog follows Keep a Changelog with `Unreleased` sections split by `Added`/`Fixed`.
- Prompt-generation text is test-sensitive, so docs should describe behavior-level changes without renaming prompt section concepts.
- Error-handling and dependency hygiene are enforced by lint/type CI, so documenting those fixes is useful release context.

## 2026-03-02T22:03:58+00:00

- Keep-a-Changelog format is actively used and best for release-facing QA/CI notes.
- README “By the Numbers” and Development sections are key places for test/CI truth updates.
- CI quality gates now include matrix testing, dependency scanning, SBOM artifacts, and explicit lint/typecheck separation.
- Coverage thresholds are documented and enforced by Vitest config, but full-suite coverage remains an ongoing debt area.

## 2026-03-02T22:05:20+00:00

- README and CONTRIBUTING are treated as user-facing contracts and need to mirror entrypoint/export wiring precisely after refactors.
- Config behavior is now precedence-driven (CLI explicit > config defaults > built-ins), and documenting that prevents user confusion.
- This repo’s release notes follow Keep a Changelog style, so feature-level bullets in `Unreleased` are expected for architecture-level changes.

## 2026-03-02T22:06:01+00:00

- Documentation and implementation are tightly coupled around behavior-level terms (especially agent prompt/streaming behavior), so wording should stay aligned with real runtime flow.
- This repo favors explicit dev ergonomics in docs (`lint`, `typecheck`, `format:check`, `build`, `test`) instead of implicit expectations.
- Changelog discipline follows Keep a Changelog with clear `Unreleased` grouping for new capabilities vs fixes.

## 2026-03-02T22:14:31+00:00

- Documentation governance is already structured with ADRs and a lightweight ADR index (`docs/adr/README.md`).
- README is used as a living product contract (badges, provider support, and UI screenshot evidence are maintained there).
- Contribution flow is standardized through structured issue forms and a PR checklist template, matching the project’s quality-gate culture.
