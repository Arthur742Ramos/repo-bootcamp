# 2.0.0 release qualification

The release is prepared from `main` at
`d8b532abe85735519d65aaa61e732001c549e004`, 132 commits after the `v1.1.1`
tag. Package metadata is aligned to `2.0.0` and the complete unreleased history
is promoted to that release.

## Release scope

The major version records the supported-runtime break: Node.js 20, 21, 23, and
Node.js 22 versions before 22.18.0 are no longer supported. The package,
doctor checks, packaging checks, CI matrices, and documentation use
`^22.18.0 || >=24.0.0`; Node 24 remains the recommended runtime.

The unreleased scope includes:

- bounded repository reads, prompt-aware cache identity, strict typing, LF
  checkout behavior, and hardened manifest, dependency, link, and export handling;
- deterministic Cargo, Go, Python, Task, package-scope, and command-guidance
  improvements, with exact provenance and conservative fallback behavior;
- evidence-backed onboarding guidance and resumable first-session checklists;
- Rust and .NET preflight checks, pull-request onboarding-impact summaries, and
  the pinned deterministic quality benchmark; and
- web workflow, accessibility, preview, retry, restoration, and mobile-layout
  fixes accumulated since `v1.1.1`.

## Baseline verification

The exact baseline
[CI run](https://github.com/Arthur742Ramos/repo-bootcamp/actions/runs/42845294697)
and
[onboarding-quality run](https://github.com/Arthur742Ramos/repo-bootcamp/actions/runs/42845294932)
passed for `d8b532abe85735519d65aaa61e732001c549e004`. The source change in
[pull request #231](https://github.com/Arthur742Ramos/repo-bootcamp/pull/231)
passed 3,235 unit tests with 1 skip, 391 CLI tests, 414 browser tests, strict
source and test typing, build, lint, formatting, packaging, packed-runtime, and
the deterministic quality benchmark.

The two Dependabot update runs for the same main commit
([42845538113](https://github.com/Arthur742Ramos/repo-bootcamp/actions/runs/42845538113)
and
[42845538226](https://github.com/Arthur742Ramos/repo-bootcamp/actions/runs/42845538226))
failed in their private-source metadata authentication path. They are separate
from the successful application CI and onboarding-quality jobs.

Application generation regressions use saved responses or injected fixture
clients. No fresh live-model quality, provider availability, generation-time,
large-repository memory, or manual accessibility benchmark is claimed.

## Lockfile reproducibility

Twenty-six lockfile `resolved` fields inherited Microsoft package-feed hosts.
Those tarballs returned content in the originating environment, but Dependabot
requires authenticated metadata access to the feed. The 2.0.0 lockfile rewrites
only those registry host prefixes to `https://registry.npmjs.org/`; locked
versions and integrity hashes are unchanged. Release validation includes a
clean install from a fresh npm cache so a warm local cache is not treated as
proof of portability.

## Publication handoff

This metadata preparation does not create or push a release tag and does not
publish an npm package or GitHub release. The v1.1.1 release workflow's npm job
failed because `NPM_TOKEN` was not configured, and the repository currently has
no Actions secrets. npm publication status must therefore remain unknown until
the maintainer completes and verifies publication.

The existing release workflow runs npm publication and the GitHub release
archive independently after the same test gate. When a maintainer creates
`v2.0.0`, the npm job still requires valid publishing credentials, while the
archive job can produce `repo-bootcamp-2.0.0.tgz` and `SHA256SUMS`. Quick Start
documents both versioned installation paths without implying either artifact
already exists.
