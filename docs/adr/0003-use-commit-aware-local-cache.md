# ADR 0003: Use commit-aware local cache for analysis reuse

## Status

Accepted

## Context

Repository analysis can be expensive and repeated frequently for the same commit and generation options.

## Decision

Store analysis outputs in a local cache keyed by repository identity, commit SHA, and generation options.

## Consequences

- Reduces repeated model calls and improves user-perceived speed.
- Keeps cache correctness tied to immutable commit references.
- Requires pruning/clear workflows to prevent stale growth.
