# Copilot Instructions

## Design Context

This project has a committed design system. **Before changing any UI, read [`PRODUCT.md`](../PRODUCT.md) (strategy) and [`DESIGN.md`](../DESIGN.md) (tokens, components, do's and don'ts).** They are the source of truth; the sidecar lives in [`.impeccable/design.json`](../.impeccable/design.json).

- **Register:** product — design serves the task, not the other way around.
- **Audience:** the new developer on Day 1 (impatient, exploratory, terminal-native); secondarily maintainers, and an evaluator trying the web demo without installing the CLI.
- **Brand:** fast, confident, developer-native. Terminal heritage; credibility earned through evidence, not adjectives. Motion only ever conveys state.
- **North star:** "The Terminal Readout" — flat GitHub-dark canvas (`#0d1117`), one solid cyan accent (`#00d9ff`, never gradient), monospace for all machine values (URLs, file names, scores), semantic tones for grades.
- **Hard avoids:** gradient text (`background-clip: text`), gradient backgrounds/buttons, the generic navy "AI dark-mode dev tool" look, low-contrast gray body copy, hero-metric templates, over-animated SaaS choreography. All text must meet WCAG AA (≥4.5:1).

**Primary UI surface:** `src/web/templates.ts` — the inline HTML/CSS/JS returned by `getIndexHtml()`. Keep its CSS tokens in sync with `DESIGN.md`, and preserve the CSP constraint (no inline `onclick`; wire events via `addEventListener`).

To evolve the design system, use the `impeccable` skill (`/impeccable audit`, `/impeccable polish`, `/impeccable critique`, …).
