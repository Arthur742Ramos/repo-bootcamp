# Product

## Register

product

## Users

**Primary — the new developer on Day 1.** Someone dropped into an unfamiliar codebase: a new hire, an open-source contributor, a consultant. Their context is impatient and exploratory — they're at a terminal or a browser, trying to answer "where do I start, how do I run this, what's safe to touch?" without waiting days for a senior dev to explain. They want signal, not a wall of outdated docs.

**Secondary — maintainers and team leads.** OSS maintainers and engineering leads who want to generate or refresh onboarding material for their own repos so newcomers ramp faster. Their job is to lower the cost of contribution.

**The web surface specifically** serves an evaluator: someone trying the tool without installing the CLI. They paste a repository URL, watch streamed progress, and skim the generated files. The web UI is a fast, trustworthy demo of what the CLI delivers — not a marketing site.

## Product Purpose

Repo Bootcamp turns any public GitHub, GitLab, or Bitbucket repository into a Day-1 onboarding kit in under 60 seconds. It uses the GitHub Copilot SDK's agentic capabilities — Claude autonomously explores the codebase with file/search tools rather than dumping context — to produce 14+ interconnected, schema-validated markdown documents (overview, onboarding, architecture, codemap, first tasks, runbook, dependencies, security, tech radar, metrics, health) plus security and onboarding-risk scoring and Mermaid diagrams.

Success looks like a newcomer going from "I'm lost" to a productive first contribution without consuming a senior engineer's week. The project doubles as a flagship showcase of the Copilot SDK for building agentic developer tools.

## Brand Personality

Three words: **fast, confident, developer-native.**

The voice is direct and benefit-first, with a dry, lightly irreverent edge ("Stop wasting time on manual onboarding docs. Let AI do the heavy lifting."). Credibility is earned through evidence, not adjectives — 1,270+ tests, Zod-validated output, sub-60-second generation. The heritage is the terminal: ASCII banners, CLI-first ergonomics, precise output. Emotionally, the interface should make onboarding feel effortless and a little exciting instead of tedious, and it should radiate competence so a developer trusts the results immediately.

## Anti-references

- **The generic "AI dark-mode dev tool" look** the current web demo embodies: a navy-gradient background, neon cyan→green gradient text and buttons, and muted gray body copy. This is the saturated 2026 AI default and the single thing to move away from — it makes a genuinely capable tool read as a weekend template.
- **Gradient text headings** (`background-clip: text`). A shared absolute ban; never meaningful.
- **Heavyweight enterprise doc portals** (Confluence / SharePoint wikis): slow, bureaucratic, perpetually stale. Repo Bootcamp is their opposite — instant and regenerable.
- **Over-animated, pitch-deck SaaS landing pages.** This is a tool, not a funnel. The web surface stays task-focused; no orchestrated scroll choreography or hero-metric templates.

## Design Principles

1. **Speed is the product.** The interface must feel as fast as the sub-60-second promise. Never make the user wait on decoration or choreography; motion only ever conveys state.
2. **Show the work.** Stream real progress, show real scores, list real files. Trust is earned by being transparent about what the agent is doing, not by hiding it behind a spinner.
3. **Terminal-native credibility.** Honor the CLI heritage. The web surface should feel built by people who live in the terminal — precise, unfussy, monospace where code and data belong.
4. **Signal over noise.** Like the docs it generates, the UI surfaces what matters (status, scores, files) and lets nothing decorative compete for attention.
5. **Familiar, not strange.** It's a developer tool. Lean on conventions developers already trust — standard form controls, clear interactive states, obvious affordances — and save surprise for earned moments.

## Accessibility & Inclusion

Target **WCAG 2.1 AA.** The existing web template already does some things right — `sr-only` labels, `aria-live` progress regions, a proper `role="dialog"` modal with Escape-to-close — and that baseline must be preserved and extended.

Known debts to fix: muted gray (`#888`) subtitle and label text on the dark background fails AA; body and placeholder text must reach ≥4.5:1 and large text ≥3:1. Every interactive control needs a visible focus ring and full keyboard operability, and the modal needs proper focus trapping/restoration. All progress and transition motion must honor `prefers-reduced-motion` with a non-animated fallback.
