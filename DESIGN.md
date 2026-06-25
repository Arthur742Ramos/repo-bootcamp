---
name: Repo Bootcamp
description: A high-signal developer console for turning any repo into a Day-1 onboarding kit.
colors:
  canvas: "#0d1117"
  surface: "#161b22"
  surface-raised: "#21262d"
  border: "#30363d"
  ink: "#e6edf3"
  ink-muted: "#8b949e"
  ink-subtle: "#6e7681"
  accent: "#00d9ff"
  accent-hover: "#2bb8d9"
  accent-press: "#1f9fbf"
  success: "#3fb950"
  danger: "#f85149"
  warning: "#d29922"
  scrim: "rgba(0, 0, 0, 0.8)"
typography:
  display:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif"
    fontSize: "2rem"
    fontWeight: 700
    lineHeight: 1.1
    letterSpacing: "-0.01em"
  title:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif"
    fontSize: "1.25rem"
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: "normal"
  body:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "normal"
  label:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif"
    fontSize: "0.8125rem"
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: "normal"
  data:
    fontFamily: "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, 'Liberation Mono', monospace"
    fontSize: "2rem"
    fontWeight: 700
    lineHeight: 1
    letterSpacing: "normal"
  mono:
    fontFamily: "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, 'Liberation Mono', monospace"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "normal"
rounded:
  sm: "6px"
  md: "8px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "16px"
  lg: "24px"
  xl: "32px"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.canvas}"
    rounded: "{rounded.sm}"
    padding: "12px 24px"
    typography: "{typography.label}"
  button-primary-hover:
    backgroundColor: "{colors.accent-hover}"
    textColor: "{colors.canvas}"
  button-primary-disabled:
    backgroundColor: "{colors.surface-raised}"
    textColor: "{colors.ink-subtle}"
  button-ghost:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
    padding: "8px 14px"
    typography: "{typography.label}"
  input-url:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "12px 16px"
    typography: "{typography.mono}"
  card-stat:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "16px"
  card-file:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "16px"
  progress-log:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "24px"
    typography: "{typography.mono}"
---

# Design System: Repo Bootcamp

## 1. Overview

**Creative North Star: "The Terminal Readout"**

Repo Bootcamp is a tool that lives in the terminal; its web surface should feel like the calmest, clearest console a developer has ever read. The system is anchored on GitHub's own dark canvas (`#0d1117` and the Primer-dark surface ramp) because the audience already trusts that environment — it reads as "made by people who live where you work," not as a generic web app dressed in dark mode. Data is monospace. Status is honest and streamed. One confident cyan is the single signal color, and it is spent only on the things the user acts on or waits for.

This system explicitly rejects the saturated "AI dark-mode dev tool" look the project shipped with: the navy gradient background (`#1a1a2e → #16213e`), the cyan→green gradient wordmark, the gradient button, and muted `#888` gray text that washes out against a tinted ground. Those moves make a genuinely capable tool read as a weekend template. It also rejects heavyweight enterprise doc-portal chrome (Confluence/SharePoint) and pitch-deck SaaS choreography — this is a fast instrument, not a funnel. Depth comes from tonal layering and 1px borders, never from decorative shadows or glass.

The feeling is precise, quick, and quietly confident. Every transition is short enough to stay out of the user's flow (the interface must feel as fast as the sub-60-second promise), and nothing decorative is allowed to compete with the agent's live work.

**Key Characteristics:**
- GitHub Primer-dark surface ramp as the identity anchor (`canvas → surface → surface-raised`).
- One committed cyan accent, used for primary action / focus / active state only.
- Monospace for everything that is code, a path, a URL, or a score.
- Flat by default; depth via tonal layers and 1px borders.
- Honest, streamed status as the signature interaction — "show the work."

## 2. Colors

A near-black GitHub-dark ground, a tight neutral ramp for layering, one vivid cyan signal, and a standard semantic set for scores and status.

### Primary
- **Signal Cyan** (`#00d9ff`): The single accent. Primary action ("Analyze"), input focus ring, active/selected state, and the in-progress phase marker. Used solid — never as a gradient. Spent sparingly so its presence always means "act here" or "happening now."

### Neutral
- **Canvas** (`#0d1117`): The app background and the inside of focused inputs. Flat, no gradient.
- **Surface** (`#161b22`): Cards (stats, files), the progress log, code previews, the modal body.
- **Surface Raised** (`#21262d`): Hover state for interactive surfaces and inset/disabled controls.
- **Border** (`#30363d`): 1px separators, input strokes, card edges. The primary depth cue.
- **Ink** (`#e6edf3`): Primary text. ~14:1 on canvas.
- **Ink Muted** (`#8b949e`): Secondary text, labels, placeholders. ~5.9:1 on canvas — passes AA. This is the floor; nothing lighter carries text.
- **Ink Subtle** (`#6e7681`): Disabled text and decorative glyphs only. Never body copy.

### Semantic
- **Success** (`#3fb950`): Good security grade, completed phase, success states.
- **Danger** (`#f85149`): Errors, failed phases, destructive feedback.
- **Warning** (`#d29922`): Medium risk, attention, caution states.

### Named Rules
**The One Signal Rule.** Cyan appears on ≤10% of any screen. If two things are cyan at once, one of them is wrong. Scores and grades use the semantic set (success/warning/danger), not the accent.

**The Earned-Dark Rule.** The dark ground is GitHub's, not a generic navy. Never reintroduce the `#1a1a2e → #16213e` gradient or any tinted-navy body; the canvas is flat `#0d1117`.

## 3. Typography

**Body / UI Font:** system sans (`-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, …`)
**Data / Mono Font:** `ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace`

**Character:** One workhorse sans for everything human-readable, one monospace for everything machine-readable. The contrast between them carries the whole hierarchy — no display face, no second sans. The split itself is the brand: prose is sans, anything a developer would copy-paste is mono.

### Hierarchy
- **Display** (700, 2rem fixed, lh 1.1): The "Repo Bootcamp" wordmark and page title. A single solid `ink` color — never gradient-filled. Fixed rem, not fluid; this is product UI.
- **Title** (600, 1.25rem, lh 1.25): Section headings ("Generated Files"), modal title (mono is also acceptable for the filename).
- **Body** (400, 1rem, lh 1.5): Subtitle, descriptions, prose. Cap measure at 65–75ch.
- **Label** (600, 0.8125rem): Stat labels, helper text, button text. Sentence case — not wide-tracked uppercase.
- **Data** (700, 2rem, mono): The big stat values (security score, risk score, counts). Monospace so digits align and read as readouts.
- **Mono** (400, 0.875rem): Repo URL input, file names, the code preview (`pre`), progress-log lines.

### Named Rules
**The Mono-For-Machines Rule.** If it's a path, a URL, a score, a grade, or generated content, it's monospace. If it's a sentence written for a human, it's sans. No exceptions for "looks techy."

## 4. Elevation

Flat by default. This system conveys depth through the tonal surface ramp (`canvas` → `surface` → `surface-raised`) and 1px `border` strokes, not drop shadows. There is no ambient shadow vocabulary at rest — a GitHub-dark surface earns separation from its neighbor by being one step lighter and outlined, the same way Primer does.

The only permitted "lift" is interactive feedback: a focused control gets a 2px cyan focus ring (offset from the element), and the modal sits above the page on a plain dark scrim. No backdrop blur, no glassmorphism, no soft glows used decoratively.

### Named Rules
**The Flat-By-Default Rule.** Surfaces are flat and bordered at rest. The only depth signal that moves is focus (a ring) and hover (a one-step tonal shift to `surface-raised`).

## 5. Components

### Buttons
- **Shape:** `rounded.sm` (6px).
- **Primary ("Analyze"):** solid `accent` background, `canvas` text, `label` type, padding `12px 24px`. The most important action on the page; there is normally one.
- **Hover / Focus:** hover shifts background to `accent-hover` over 150–200ms (color only). `:focus-visible` shows a 2px `accent` ring with 2px offset. Active uses `accent-press`.
- **Disabled:** `surface-raised` background, `ink-subtle` text, no pointer — used while a job is streaming.
- **Ghost (Copy / Download / modal actions):** `surface` background, `ink` text, 1px `border`; hover goes to `surface-raised` with a `border`→`accent` edge.

### Cards / Containers
- **Corner Style:** `rounded.md` (8px).
- **Background:** `surface`; hover (file cards) → `surface-raised`.
- **Shadow Strategy:** none — see Elevation. Separation is the 1px `border`.
- **Internal Padding:** `md` (16px); the progress log uses `lg` (24px).
- Stat cards: `data` (mono) value in `ink` or the matching semantic color, `label` in `ink-muted`. Cards are used here because the stat grid and file list are genuinely a set of peers — do not nest cards inside cards.

### Inputs / Fields
- **Style:** `canvas` background, 1px `border`, `rounded.md`, `mono` type (it holds a repo URL).
- **Focus:** border shifts to `accent` plus a soft 2px `accent` ring; no layout shift.
- **Placeholder:** `ink-muted` (`#8b949e`) — passes AA; never lighter.
- **Disabled / error:** disabled uses `surface-raised` + `ink-subtle`; error pairs a `danger` border with a `danger` helper line below.

### Progress Log (signature component)
The honest readout. `surface` panel, `mono` lines, scroll-pinned to newest. Phase lines are prefixed `▶` in `accent`; success lines `✓` in `success`; error lines `✗` in `danger`; plain steps in `ink-muted`. This is where "show the work" lives — it is never replaced by a single spinner.

### Modal (file preview)
`role="dialog"`, `aria-modal`, `surface` body, 1px `border`, `rounded.md`, on a plain `rgba(0,0,0,0.8)` scrim (no blur). Closes on `×`, backdrop click, and Escape. Must trap focus while open and restore focus to the trigger on close. Build a semantic z-index scale (scrim → modal → toast → tooltip); never arbitrary `999`/`1000`.

## 6. Do's and Don'ts

### Do:
- **Do** anchor on the GitHub Primer-dark ramp: flat `#0d1117` canvas, `#161b22` surfaces, `#30363d` borders. Convey depth with tonal layers + 1px strokes.
- **Do** keep one committed cyan accent (`#00d9ff`), solid, for primary action / focus / active only (The One Signal Rule).
- **Do** set monospace for repo URLs, file names, scores/grades, and code previews (The Mono-For-Machines Rule).
- **Do** give every control all states — default, hover, `:focus-visible` ring, active, disabled, loading, error — and keep transitions 150–250ms (motion conveys state, not decoration).
- **Do** honor `prefers-reduced-motion` with a non-animated fallback on every transition.
- **Do** keep body prose at 65–75ch and use `#e6edf3` for primary text, `#8b949e` as the muted floor.

### Don't:
- **Don't** use gradient text (`background-clip: text`) on the wordmark or anywhere — single solid color, emphasis via weight/size. (Absolute ban.)
- **Don't** fill the primary button (or anything) with the cyan→green gradient; primary actions are a single solid accent.
- **Don't** reintroduce the navy gradient background (`#1a1a2e → #16213e`) or any tinted-navy ground — the canvas is flat `#0d1117` (The Earned-Dark Rule).
- **Don't** use `#888` or lighter gray for text on dark; `#8b949e` is the floor and body prefers `#e6edf3` (AA).
- **Don't** make `transform: scale(1.05)` the button's hover feedback — shift background/border instead.
- **Don't** reach for glassmorphism, backdrop blur, the hero-metric template, per-section uppercase eyebrows, or a modal when an inline affordance would do.
