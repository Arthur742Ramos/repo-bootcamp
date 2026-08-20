# ADR 0002: Use Express for web dashboard API

## Status

Accepted

## Context

The project includes a local web dashboard that needs simple routing, middleware composition, and SSE support.

## Decision

Use Express as the HTTP framework for the web dashboard and API endpoints.

## Consequences

- Fast iteration for middleware concerns (security headers, CORS, rate limiting).
- Straightforward route organization and low operational complexity.
- Requires careful middleware ordering for endpoint-specific behavior.
