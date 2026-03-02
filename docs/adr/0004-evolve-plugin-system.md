# ADR 0004: Evolve plugin system to typed multi-stage architecture

## Status
Accepted

## Context
The original plugin design supported analyzer-only extensions, which limited customization points in output transformation and delivery.

## Decision
Introduce a typed plugin API with three extension stages:
- Analyzer plugins (facts/docs enrichment)
- Formatter plugins (document transformation)
- Output target plugins (custom publishing/writing)

Backward compatibility is preserved for existing analyzer plugins.

## Consequences
- Expands extension surface without forcing core refactors.
- Keeps existing plugin users compatible with minimal migration.
- Adds lifecycle complexity and requires robust failure isolation per plugin stage.
