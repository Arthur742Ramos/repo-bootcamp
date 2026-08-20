# ADR 0001: Use GitHub Copilot SDK for repository analysis

## Status

Accepted

## Context

Repo Bootcamp needs agentic repository exploration with tool-calling, multi-turn reasoning, and model portability.

## Decision

Use the GitHub Copilot SDK as the core AI orchestration layer for analysis and interactive Q&A flows.

## Consequences

- Enables structured tool-calling and streaming analysis flows.
- Keeps model/provider concerns encapsulated in agent/session setup.
- Requires SDK credentials/runtime availability for full functionality.
