---
target: src/web/templates.ts
total_score: 30
p0_count: 0
p1_count: 2
timestamp: 2026-06-25T18-34-00Z
slug: src-web-templates-ts
---
## Critique: Repo Bootcamp web demo (`src/web/templates.ts`)

### Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 4 | Streamed progress (▶/✓/✗ + color), disabled "Analyzing…" button, aria-live, copy feedback |
| 2 | Match System / Real World | 3 | "Tool Calls" / "Onboarding Risk" grades read as internal jargon without a legend |
| 3 | User Control and Freedom | 3 | Modal has Esc/close/backdrop + focus restore, but a running analysis cannot be cancelled |
| 4 | Consistency and Standards | 4 | Coherent token system; GitHub Primer-dark conventions developers recognize |
| 5 | Error Prevention | 2 | Only guard is a native `alert()` for empty URL; no inline URL validation before submit |
| 6 | Recognition Rather Than Recall | 4 | Placeholder shows URL format; file cards self-describe; nothing to memorize |
| 7 | Flexibility and Efficiency | 3 | Enter-to-submit works, but no recent-repo recall or shortcuts beyond it |
| 8 | Aesthetic and Minimalist Design | 4 | Restrained, single accent, strong hierarchy, zero clutter |
| 9 | Error Recovery | 2 | Errors show as a red ✗ line but messages are raw and offer no retry path |
| 10 | Help and Documentation | 1 | No help, no docs link, no legend for what the scores/grades mean |
| **Total** | | **30/40** | **Good — polished surface, product-level gaps remain** |

### Anti-Patterns Verdict — PASS

**LLM assessment**: Does not read as AI-generated. The prior slop (gradient text h1, cyan→green gradient button, generic navy `#1a1a2e→#16213e` body gradient, low-contrast `#888` text) is gone, replaced by a committed GitHub-native "Terminal Readout" identity: flat `#0d1117` canvas, one solid cyan accent, monospace for all machine values, semantic grade tones.

**Deterministic scan**: `detect.mjs` on the rendered HTML returns **0 findings (exit 0)**. The single prior advisory — an undocumented `rgba(0,0,0,0.8)` modal scrim — was tokenized as `--scrim` and documented in DESIGN.md, so it is now an intentional system value rather than drift.

**Visual overlays**: Not available — the harness browser requires Google Chrome, which cannot be installed without sudo in this environment. Fallback: the surface was instead inspected with headless Chromium screenshots (desktop 1280, mobile 390, results state, modal) plus DOM assertions; no console errors, no horizontal overflow, correct focus management.

### Overall Impression
A genuinely clean, confident developer tool. The visual system and accessibility are excellent; the remaining weaknesses are all *product* gaps (validation, error recovery, help, cancel) that styling can't fix and that polish correctly left alone.

### What's Working
1. **Streamed status with glyph+color** is real, well-paced system feedback — the strongest part of the UX.
2. **Semantic grade tones** (B→green, C→amber) turn raw numbers into scannable signal; the north-star "Terminal Readout" reads instantly.
3. **Accessibility foundation** is verified-excellent: keyboard-complete flow, visible cyan focus rings, file cards as real `<button>`s with aria-labels, `role="dialog"`/`aria-modal` + focus trap + restore, contrast all ≥AA.

### Priority Issues
- **[P1] No input validation; native `alert()`** — Empty/invalid URLs are only caught by a jarring `alert()` or a server round-trip. *Fix*: inline validation, gate the submit on a plausible URL, replace `alert()` with an inline message. *Command*: `/impeccable harden`.
- **[P1] Scores have no legend** — "Security Score (B)" and "Onboarding Risk (C)" ship with no explanation of scale or meaning. *Fix*: add concise tooltips/legend. *Command*: `/impeccable clarify`.
- **[P2] A running analysis can't be cancelled** — Once streaming starts there is no abort. *Fix*: a Cancel control that closes the EventSource. *Command*: `/impeccable harden`.
- **[P2] Errors offer no recovery** — Raw `err.message` with no retry affordance. *Fix*: human messages + a retry action. *Command*: `/impeccable clarify`.
- **[P3] Thin power-user efficiency** — No recent-repo recall or shortcuts beyond Enter. *Command*: `/impeccable onboard`.

### Persona Red Flags
**Alex (Power User)**: Enter submits and Esc closes the modal (good), but every run requires re-pasting the URL — no recent-repo memory; no abort on a slow analysis; no "download all files" in one action.

**Sam (Accessibility)**: Strong pass — keyboard-complete, visible focus indicators, real buttons with labels, focus trap + restore, status carried by glyph **and** color (not color alone). Minor: the empty-URL `alert()` is abrupt, and `aria-live="polite"` on the progress log may over-announce during rapid streaming.

**Jordan (First-Timer)**: Placeholder makes the first action clear, but "Onboarding Risk (C)", "Security Score (B)" and "Tool Calls" arrive with no explanation and no help link; after generation it isn't stated what to do with the files.

### Minor Observations
- Mobile primary button is ~42.6px tall — just under the 44px best-practice target (still clears WCAG 2.2 AA's 24px comfortably).
- Progress container `aria-live="polite"` could be chatty for screen readers during fast streams.

### Questions to Consider
- If the **grade** (not the number) were the hero of each stat, would the readout communicate faster?
- Should the tool remember the last analyzed repo so a re-run is one click?
- After generation, is "Download all" the missing primary call-to-action?
