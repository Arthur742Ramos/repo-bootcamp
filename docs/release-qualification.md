# Campaign release qualification

This campaign is unreleased. `package.json` remains at 1.1.1. The evaluated main
commit is `d05efc197ed7e47c5c95b09784afddb1ac647d58`, with 86 main commits after
the `v1.1.1` tag. Draft changes require human review and successful CI for each
exact remote commit before release planning. No version, tag, merge, publication,
deployment, credential or repository setting is changed by this campaign.

## Implemented scope

- Contain and bound implicit dependency, default prompt and equivalent metadata
  reads. Keep the explicitly requested external prompt behavior and existing
  manifest parser precedence.
- Key facts by effective prompt content, resolved prompt style and analysis mode.
  Keep output-format reuse and unrelated deterministic phase identities. Treat
  malformed payloads as misses and cache-write failures as optional persistence
  failures; preserve model and output-directory errors.
- Support `^22.18.0 || >=24.0.0`, default to Node 24, and enforce the same contract
  in package metadata, doctor, packaging checks and workflows. Node 23 is excluded
  by the locked configuration loader's supported runtime range.
- Restore strict source and test typing and check fresh LF checkouts on Windows
  and Linux CI.

## Verification record

The final code batch passed 137 local unit-configuration files: 3,201 tests passed
and 8 retained their existing skips. Strict source and complete test typing, build,
lint, whole-tree formatting, packaging invariants, and compiled direct/symlink CLI
entry points passed locally. Exact Node 22.18.0 passed strict locked installation
and packed CLI/API/JSON/TypeScript config smoke tests. Fresh task-owned checkouts
with both `core.autocrlf=true` and `false` passed formatting and retained LF files.

[Containment CI](https://github.com/Arthur742Ramos/repo-bootcamp/actions/runs/38318928043)
passed for `b59da98faefc8ee4c36855fe49935cabd7bab20f`.
[Cache CI](https://github.com/Arthur742Ramos/repo-bootcamp/actions/runs/38321769564)
passed for `9edc36b4dfc66c45626fcfa2ccd13c84d780e878`, including full CLI and 370
automated browser cases. The final cache batch's local CLI run passed 387 cases
with 1 skip and one Windows `EBUSY` cleanup failure; a single isolated replay
passed both cases. This was a cleanup failure after the assertions, not evidence
of a product regression. Later draft CI must be checked on its own head; an older
green run does not qualify a changed commit.

All application generation regressions used saved responses or injected fixture
clients. No fresh live-model quality, provider availability, generation-time,
large-repository memory or manual browser accessibility evaluation was performed.
The deterministic security score is a heuristic, not an audit conclusion.

## Decisions before publication

1. Complete human review of the stacked drafts and confirm exact-head CI after
   any rebases or fixes. Check both source and test types, coverage thresholds,
   full CLI/browser regressions, LF formatting and dependency audits.
2. Choose the next version and release notes deliberately. Node 20 installations
   are no longer supported by the locked dependency set; communicate the new
   runtime policy. Verify the release tag equals the chosen package version and
   rerun packed installation at the supported minimum.
3. Decide separately whether to enable branch protection and required checks.
   The evaluation found protection disabled; this campaign does not authorize a
   settings change.

The historical Dependabot runs
[37373643320](https://github.com/Arthur742Ramos/repo-bootcamp/actions/runs/37373643320)
and [37373643028](https://github.com/Arthur742Ramos/repo-bootcamp/actions/runs/37373643028)
report a failed workflow with a cancelled job. A campaign read-only log retrieval
returned no log content, so their root cause remains unverified. Neither run was
rerun or cancelled by this campaign. This operational issue remains separate from
successful application CI.
