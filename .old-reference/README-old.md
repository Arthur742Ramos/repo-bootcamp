# Repo Bootcamp

<div align="center">

```
╦═╗╔═╗╔═╗╔═╗  ╔╗ ╔═╗╔═╗╔╦╗╔═╗╔═╗╔╦╗╔═╗
╠╦╝║╣ ╠═╝║ ║  ╠╩╗║ ║║ ║ ║ ║  ╠═╣║║║╠═╝
╩╚═╚═╝╩  ╚═╝  ╚═╝╚═╝╚═╝ ╩ ╚═╝╩ ╩╩ ╩╩  
```

**Turn any GitHub repository into a Day 1 onboarding kit**

[![GitHub Copilot SDK Contest Award](https://img.shields.io/badge/GitHub%20Copilot%20SDK-Contest%20Award%20Winner%20🏆-gold?style=for-the-badge&logo=github&logoColor=white)](https://github.com/features/copilot)

### 🏆 One of the Winners of the GitHub Copilot SDK Contest

[![Built with Copilot SDK](https://img.shields.io/badge/Built%20with-GitHub%20Copilot%20SDK-8957e5?logo=github&logoColor=white)](https://github.com/github/copilot-sdk)
[![CI](https://github.com/Arthur742Ramos/repo-bootcamp/actions/workflows/ci.yml/badge.svg)](https://github.com/Arthur742Ramos/repo-bootcamp/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/repo-bootcamp)](https://www.npmjs.com/package/repo-bootcamp)
[![npm downloads](https://img.shields.io/npm/dm/repo-bootcamp)](https://www.npmjs.com/package/repo-bootcamp)
[![codecov](https://codecov.io/gh/Arthur742Ramos/repo-bootcamp/branch/main/graph/badge.svg)](https://codecov.io/gh/Arthur742Ramos/repo-bootcamp)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18-brightgreen)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.6-blue)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

[Features](#features) • [Quick Start](#quick-start) • [How It Uses Copilot SDK](#how-it-uses-the-github-copilot-sdk) • [Examples](#example-output)

</div>

---

## 🏆 Award

Repo Bootcamp was selected as **one of the winners** of the GitHub Copilot SDK Contest, recognized for innovative use of the Copilot SDK to improve developer onboarding.

---

## The Problem

New developers joining a project waste **days or weeks** trying to understand:
- How do I set up my environment?
- What's the architecture? Where do I start reading?
- What are safe first contributions?
- Who do I ask when I'm stuck?

Most READMEs are outdated. Most wikis are incomplete. Most senior devs are too busy.

## The Solution

**Repo Bootcamp** uses agentic AI to analyze any GitHub repository and generate comprehensive, actionable onboarding documentation in **under 60 seconds**.

```bash
npx repo-bootcamp https://github.com/facebook/react
```

That's it. You get 12+ interconnected markdown files covering everything a new contributor needs.

<div align="center">

https://github.com/Arthur742Ramos/repo-bootcamp/raw/main/media/demo-sonnet.mp4

*Generate comprehensive onboarding docs in under 60 seconds*

</div>

<details>
<summary><b>See CLI in action</b></summary>

```
  ╦═╗╔═╗╔═╗╔═╗  ╔╗ ╔═╗╔═╗╔╦╗╔═╗╔═╗╔╦╗╔═╗
  ╠╦╝║╣ ╠═╝║ ║  ╠╩╗║ ║║ ║ ║ ║  ╠═╣║║║╠═╝
  ╩╚═╚═╝╩  ╚═╝  ╚═╝╚═╝╚═╝ ╩ ╚═╝╩ ╩╩ ╩╩  
  
  Turn any repo into a Day 1 onboarding kit

──────────────────────────────────────────────────
  Repository:  https://github.com/sindresorhus/ky
  Branch:      default
  Focus:       all
  Audience:    oss-contributor
  Style:       OSS (Community-friendly)
──────────────────────────────────────────────────

✔ Cloned sindresorhus/ky (branch: main)
✔ Scanned 45 files (12 key files read)

Detected Stack:
  Languages:  TypeScript
  Frameworks: None
  Build:      npm
  CI:         Yes
  Docker:     No

✔ Analysis complete

Security Score: 85/100 (B)
Onboarding Risk: 18/100 (A) 🟢

  ╔══════════════════════════════════════════════════════╗
  ║        ✓ Bootcamp Generated Successfully!            ║
  ╚══════════════════════════════════════════════════════╝

  📁 Output: ./bootcamp-ky/

  Generated files:
  ├── BOOTCAMP.md      → 1-page overview (start here!)
  ├── ONBOARDING.md    → Full setup guide
  ├── ARCHITECTURE.md  → System design & diagrams
  ├── CODEMAP.md       → Directory tour
  ├── FIRST_TASKS.md   → Starter issues
  ├── RUNBOOK.md       → Operations guide
  ├── DEPENDENCIES.md  → Dependency graph
  ├── SECURITY.md      → Security findings
  ├── RADAR.md         → Tech radar & risk score
  ├── IMPACT.md        → Change impact analysis
  ├── diagrams.mmd     → Mermaid diagrams
  └── repo_facts.json  → Structured data

  🚀 Next step: open ./bootcamp-ky/BOOTCAMP.md
```

</details>

## Why This Tool Wins

| Traditional Approach | Repo Bootcamp |
|---------------------|---------------|
| Manual documentation takes days | Generated in < 60 seconds |
| Gets outdated immediately | Regenerate anytime |
| Inconsistent quality | Structured, validated output |
| Requires deep knowledge | Works on any public repo |
| Static documents | Interactive Q&A mode |
| No security insights | Built-in security analysis |

### What Makes It Different

1. **Powered by GitHub Copilot SDK** - Leverages the official SDK for agentic AI with tool-calling
2. **Truly Agentic** - Claude autonomously explores codebases, not just template filling
3. **Schema Validated** - All output is validated with Zod schemas and auto-retried on failures
4. **Production Ready** - 205 tests, TypeScript, proper error handling
5. **Full Feature Set** - Interactive mode, web UI, GitHub integration, version diffing
6. **Beautiful Output** - Mermaid diagrams, structured markdown, professional formatting

### By the Numbers

| Metric | Value |
|--------|-------|
| Generated files | 12+ |
| Test coverage | 205 tests |
| Source files | 18 modules |
| Lines of code | 7,500+ |
| Languages supported | 12+ (incl. Terraform, Bicep) |
| Generation time | < 60 seconds |

## How It Uses the GitHub Copilot SDK

Repo Bootcamp is a showcase of the **GitHub Copilot SDK's agentic capabilities**. Here's how we leverage the SDK:

### Agentic Tool Calling

The SDK enables Claude to autonomously explore repositories using custom tools:

```typescript
import { CopilotClient } from "@github/copilot-sdk";

const client = new CopilotClient();

// Define tools the agent can use
const tools = [
  {
    name: "read_file",
    description: "Read contents of a file in the repository",
    parameters: { path: { type: "string" } }
  },
  {
    name: "list_files", 
    description: "List files matching a glob pattern",
    parameters: { pattern: { type: "string" } }
  },
  {
    name: "search",
    description: "Search for text across the codebase",
    parameters: { query: { type: "string" } }
  }
];

// Agent autonomously decides which files to read
const session = await client.createSession({
  model: "claude-opus-4-5",
  systemMessage: { content: systemPrompt },
  tools,
  streaming: true,
});

await session.sendAndWait({ prompt: analysisPrompt });
```

### Why This Matters

| Traditional LLM Approach | Copilot SDK Agentic Approach |
|--------------------------|------------------------------|
| Dump entire codebase into context | Agent selectively reads relevant files |
| Context window limits scalability | Works on repos of any size |
| Static, one-shot analysis | Dynamic, multi-turn exploration |
| No ability to search or drill down | Agent searches, reads, and follows references |

### Key SDK Features Used

1. **Multi-turn Conversations** - Agent iterates until it has enough information
2. **Tool Calling** - Custom tools for file reading, searching, and metadata
3. **Model Selection** - Automatic fallback through claude-opus-4-5 → claude-sonnet-4-5
4. **Streaming** - Real-time progress updates during analysis
5. **Schema Validation** - Zod schemas validate output, with auto-retry on failures

### Architecture Integration

```
┌─────────────────────────────────────────────────────────────┐
│                   GitHub Copilot SDK                         │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐  │
│  │   Claude    │  │   Tools     │  │   Streaming         │  │
│  │   Models    │  │   System    │  │   Responses         │  │
│  └──────┬──────┘  └──────┬──────┘  └──────────┬──────────┘  │
└─────────┼────────────────┼─────────────────────┼────────────┘
          │                │                     │
          ▼                ▼                     ▼
┌─────────────────────────────────────────────────────────────┐
│                    Repo Bootcamp Agent                       │
│                                                              │
│  "Read package.json" → "Search for test files" →            │
│  "Read src/index.ts" → "Find CI workflow" →                  │
│  "Generate structured onboarding JSON"                       │
└─────────────────────────────────────────────────────────────┘
```

The Copilot SDK transforms what would be a simple template-filler into an intelligent agent that understands code structure, identifies patterns, and produces genuinely useful onboarding documentation.

## Features

- **GitHub Copilot SDK Integration** - Built on the official SDK for agentic AI capabilities
- **Agentic Analysis** - Claude autonomously reads files, searches code, and understands architecture
- **Complete Documentation Suite** - Generates 12+ interconnected markdown files
- **Smart Prioritization** - Intelligently samples files based on importance and byte budget
- **Schema Validation** - Validates LLM output with auto-retry on failures
- **Multi-language Support** - Works with TypeScript, Python, Go, Rust, Java, and more
- **Interactive Q&A Mode** - Chat with the codebase using natural language
- **Tech Radar** - Identify modern, stable, legacy, and risky technologies
- **Change Impact Analysis** - Understand how file changes affect the codebase
- **Version Comparison** - Compare refs to see onboarding-relevant changes
- **Auto-Issue Creator** - Generate GitHub issues from starter tasks
- **Web Demo Server** - Beautiful browser UI for analyzing repositories
- **Template Packs** - Customize output style for different contexts
- **Diagram Rendering** - Convert Mermaid to SVG/PNG with mermaid-cli

## Example Output

<details>
<summary><b>BOOTCAMP.md</b> - 1-page overview</summary>

```markdown
# sindresorhus/ky Bootcamp

> Tiny Fetch-based HTTP client with ergonomic helpers, retries, and hooks.

## Quick Facts
| | |
|---|---|
| **Languages** | TypeScript |
| **Frameworks** | None |
| **Build System** | npm |

## Quick Start
1. Install dependencies: npm install
2. Run tests: npm test
3. Build: npm run build

## If You Only Have 30 Minutes
1. Read this document
2. Run `npm install && npm test`
3. Pick a starter task from FIRST_TASKS.md
```

</details>

<details>
<summary><b>ARCHITECTURE.md</b> - System design with diagrams</summary>

```markdown
# Architecture

## Component Diagram

​```mermaid
graph TD
    A[ky.ts] --> B[Ky Class]
    B --> C[request]
    B --> D[retry logic]
    B --> E[hooks]
    C --> F[Response helpers]
​```

## Data Flow
Request → Options Merge → Hooks (before) → Fetch → Retry? → Hooks (after) → Response
```

</details>

<details>
<summary><b>FIRST_TASKS.md</b> - Starter issues by difficulty</summary>

```markdown
# First Tasks

## Beginner Tasks

### 1. Add README badge for Node.js version
- **Files:** README.md
- **Why:** Easy first contribution, improves documentation

### 2. Add test for edge case
- **Files:** test/main.ts
- **Why:** Improves test coverage, low risk

## Intermediate Tasks

### 3. Improve TypeScript types for hooks
- **Files:** source/types/hooks.ts
- **Why:** Better DX, teaches you the hook system
```

</details>

## Generated Documentation

| File | Description |
|------|-------------|
| `BOOTCAMP.md` | 1-page overview - start here! |
| `ONBOARDING.md` | Complete setup guide with commands |
| `ARCHITECTURE.md` | System design with Mermaid diagrams |
| `CODEMAP.md` | Directory tour for navigation |
| `FIRST_TASKS.md` | 8-10 starter issues by difficulty |
| `RUNBOOK.md` | Operations guide (for services) |
| `DEPENDENCIES.md` | Dependency graph and analysis |
| `SECURITY.md` | Security patterns and findings |
| `RADAR.md` | Tech radar and onboarding risk score |
| `IMPACT.md` | Change impact analysis for key files |
| `DIFF.md` | Version comparison (with `--compare`) |
| `diagrams.mmd` | Mermaid diagram sources |
| `repo_facts.json` | Structured data for automation |

## Quick Start

```bash
# Clone and install
git clone https://github.com/your-username/repo-bootcamp.git
cd repo-bootcamp
npm install

# Build
npm run build

# Generate bootcamp for any repo
node dist/index.js https://github.com/sindresorhus/ky

# Or use with npx (after npm link)
npm link
bootcamp https://github.com/sindresorhus/ky
```

## Usage

### Basic Generation

```bash
# From GitHub URL
bootcamp https://github.com/owner/repo

# From local path (current directory)
bootcamp .

# From local path (absolute or relative)
bootcamp /path/to/repo
bootcamp ~/projects/myapp
bootcamp ../other-repo

# With options
bootcamp https://github.com/owner/repo \
  --branch main \
  --focus all \
  --audience oss-contributor \
  --output ./my-bootcamp \
  --verbose \
  --stats
```

### Fast Mode

```bash
# Generate bootcamp quickly (~15-30s instead of ~60s)
bootcamp https://github.com/owner/repo --fast

# Fast mode skips tool-calling and inlines key files directly
```

### Interactive Q&A Mode

```bash
# Start interactive mode after generation
bootcamp https://github.com/owner/repo --interactive

# Standalone Q&A without full generation
bootcamp ask https://github.com/owner/repo
```

### Version Comparison

```bash
# Compare current HEAD with a tag/branch/commit
bootcamp https://github.com/owner/repo --compare v1.0.0

# See what changed for onboarding (new deps, env vars, commands)
```

### Local Repository Analysis

Analyze repositories on your local filesystem—works offline for local repos!

```bash
# Analyze current directory
bootcamp .

# Analyze an absolute path
bootcamp /path/to/repo

# Home-relative path
bootcamp ~/projects/myapp

# Relative path
bootcamp ../other-repo

# Interactive Q&A with local repo
bootcamp ask .

# Docs analysis on local repo
bootcamp docs ~/projects/legacy-app --fix
```

> **💡 Tip:** Local analysis is instant—no cloning needed! Great for private repos or when working offline.

### Auto-Create GitHub Issues

```bash
# Preview issues that would be created
bootcamp https://github.com/owner/repo --create-issues --dry-run

# Actually create issues (requires gh CLI authenticated)
bootcamp https://github.com/owner/repo --create-issues
```

### Infrastructure as Code (IaC) Repositories

Repo Bootcamp fully supports IaC languages including **Terraform** and **Azure Bicep**:

```bash
# Analyze a Terraform infrastructure repo
bootcamp https://github.com/hashicorp/terraform-aws-vpc

# Analyze an Azure Bicep deployment
bootcamp https://github.com/Azure/bicep-registry-modules

# Mixed IaC + application repos (e.g., serverless apps with infra)
bootcamp https://github.com/owner/serverless-app
```

**What it detects:**
- **Terraform:** `main.tf`, `variables.tf`, `outputs.tf`, `providers.tf`, `versions.tf`, `backend.tf`, `terragrunt.hcl`, `.terraform.lock.hcl`
- **Bicep:** `main.bicep`, `modules.bicep`, module references
- **Dependencies:** Module sources, provider requirements, file references
- **Mixed repos:** Both IaC and application code in the same repository

### Web Demo Server

```bash
# Start the web UI
bootcamp web

# Or with custom port
bootcamp web --port 8080

# Then open http://localhost:3000 in your browser
```

### Documentation Analyzer

Analyze repo documentation for staleness, version mismatches, and missing information:

```bash
# Analyze docs vs repo state, show report
bootcamp docs https://github.com/owner/repo

# CI mode - exit with code 1 if docs are stale
bootcamp docs https://github.com/owner/repo --check

# Auto-fix stale documentation sections
bootcamp docs https://github.com/owner/repo --fix
```

**What it checks:**
- ⚠️ **Version Mismatches** - Node/Python version in README vs package.json
- ⚠️ **Undocumented Frameworks** - Detected frameworks missing from docs
- ⚠️ **CLI Drift** - CLI --help output vs documented usage
- ⚠️ **Prerequisites** - Required tools/env vars not documented
- ⚠️ **Badge Issues** - Broken or placeholder badge URLs

**Example output:**
```
📚 Docs Analyzer

Analyzing: owner/repo

📋 Analysis Results

⚠️  Version Mismatches:
   node: 16.0.0 → >=20.0.0 (README.md)

⚠️  Undocumented Frameworks:
   - react (^18.0.0)
   - tailwind (^3.0.0)

Summary:
   ⚠️  3 warning(s)
```

### Template Packs

```bash
# Use different output styles
bootcamp https://github.com/owner/repo --style startup    # Fast, casual, emoji
bootcamp https://github.com/owner/repo --style enterprise # Formal, comprehensive
bootcamp https://github.com/owner/repo --style oss        # Community-friendly (default)
bootcamp https://github.com/owner/repo --style devops     # Infrastructure-focused
```

### Diagram Rendering

```bash
# Render Mermaid diagrams to SVG (requires @mermaid-js/mermaid-cli)
bootcamp https://github.com/owner/repo --render-diagrams

# Render to PNG format
bootcamp https://github.com/owner/repo --render-diagrams png

# Install mermaid-cli globally
npm install -g @mermaid-js/mermaid-cli
```

## CLI Options

| Option | Description | Default |
|--------|-------------|---------|
| `-b, --branch <branch>` | Branch to analyze | default branch |
| `-f, --focus <focus>` | Focus: onboarding, architecture, contributing, all | `all` |
| `-a, --audience <type>` | Target: new-hire, oss-contributor, internal-dev | `oss-contributor` |
| `-o, --output <dir>` | Output directory | `./bootcamp-{repo}` |
| `-m, --max-files <n>` | Maximum files to scan | `200` |
| `--model <model>` | Override model selection | auto |
| `-s, --style <style>` | Output style: startup, enterprise, oss, devops | `oss` |
| `-i, --interactive` | Start Q&A mode after generation | false |
| `--transcript` | Save Q&A session to TRANSCRIPT.md | false |
| `-c, --compare <ref>` | Compare with git ref, generate DIFF.md | - |
| `--create-issues` | Create GitHub issues from FIRST_TASKS | false |
| `--dry-run` | Preview issues without creating | false |
| `--render-diagrams [format]` | Render Mermaid to SVG/PNG (requires mermaid-cli) | `svg` |
| `--json-only` | Only generate repo_facts.json | false |
| `--no-clone` | Use GitHub API instead of cloning (faster but limited) | false |
| `--fast` | Fast mode: inline key files, skip tools, much faster (~15-30s) | false |
| `--keep-temp` | Keep temporary clone | false |
| `--stats` | Show detailed statistics | false |
| `-v, --verbose` | Show tool calls and reasoning | false |

## Commands

| Command | Description |
|---------|-------------|
| `bootcamp <url>` | Generate full bootcamp documentation |
| `bootcamp ask <url>` | Interactive Q&A without full generation |
| `bootcamp web` | Start local web demo server |

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     CLI (index.ts)                          │
│  Parses args, orchestrates flow, displays progress          │
└─────────────────────────────────────────────────────────────┘
                              │
           ┌──────────────────┼──────────────────┐
           ▼                  ▼                  ▼
┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐
│   Ingest        │  │   Agent         │  │   Generator     │
│   (ingest.ts)   │  │   (agent.ts)    │  │   (generator.ts)│
│                 │  │                 │  │                 │
│ • Clone repo    │  │ • Copilot SDK   │  │ • BOOTCAMP.md   │
│ • Scan files    │  │ • Tool calling  │  │ • ONBOARDING.md │
│ • Detect stack  │  │ • Model fallback│  │ • ARCHITECTURE  │
│ • Read configs  │  │ • Schema valid. │  │ • And more...   │
└─────────────────┘  └─────────────────┘  └─────────────────┘
                              │
        ┌─────────────────────┼─────────────────────┐
        ▼                     ▼                     ▼
┌──────────────┐    ┌──────────────┐    ┌──────────────────┐
│   Analyzers  │    │   Web/CLI    │    │   Integrations   │
│              │    │              │    │                  │
│ • radar.ts   │    │ • web.ts     │    │ • issues.ts      │
│ • impact.ts  │    │ • interactive│    │ • diff.ts        │
│ • security.ts│    │ • plugins.ts │    │ • deps.ts        │
└──────────────┘    └──────────────┘    └──────────────────┘
```

## How It Works

1. **Clone & Scan** - Shallow clones the repo, scans file tree, detects stack
2. **Priority Sampling** - Scores files by importance, reads within byte budget
3. **Agentic Analysis** - Claude explores the repo with tools, produces JSON
4. **Schema Validation** - Validates output, retries with targeted prompts if needed
5. **Extended Analysis** - Tech radar, security scan, dependency graph, impact map
6. **Generate Docs** - Transforms JSON into polished markdown documentation

## Configuration

### bootcamp.config.json

Create a `bootcamp.config.json` in your project root for custom settings:

```json
{
  "style": "enterprise",
  "customStyle": {
    "emoji": false,
    "firstTasksCount": 15
  },
  "plugins": [],
  "prompts": {
    "system": "You are a helpful assistant for onboarding developers."
  },
  "output": {
    "excludeDocs": ["RUNBOOK.md"]
  }
}
```

### Plugin System

Extend Repo Bootcamp with custom analyzers:

```typescript
// my-plugin.ts
export default {
  name: "my-plugin",
  version: "1.0.0",
  analyze: async (repoPath, scanResult, facts, options) => {
    // Your custom analysis
    return {
      docs: [{ name: "CUSTOM.md", content: "..." }],
      extraData: { customMetric: 42 },
    };
  },
};
```

## Example Outputs

See the [examples/](./examples/) directory for full sample outputs:

- [examples/ky/](./examples/ky/) - TypeScript HTTP client library (sindresorhus/ky)

## Development

```bash
# Install dependencies
npm install

# Build
npm run build

# Generate API docs
npm run docs

# Run tests (205 tests)
npm test

# Watch mode
npm run test:watch

# Coverage
npm run test:coverage
```

## Requirements

- Node.js 18+
- GitHub Copilot SDK access (requires GitHub Copilot subscription)
- `GITHUB_TOKEN` environment variable for API authentication (provided by Copilot SDK)
- `gh` CLI (optional, for `--create-issues`)

## Model Configuration

The tool uses these models in order of preference:
1. `claude-opus-4-5`
2. `claude-sonnet-4-5`
3. `claude-sonnet-4-20250514`

Set `--model` to override.

## Tech Stack

- **Runtime:** Node.js 18+
- **Language:** TypeScript 5.6
- **AI:** GitHub Copilot SDK with Claude
- **Testing:** Vitest (205 tests)
- **CLI:** Commander.js
- **Validation:** Zod schemas
- **Web:** Express 5 with SSE

## Contributing

Contributions are welcome! Please:

1. Fork the repository
2. Create a feature branch
3. Run `npm test` to ensure all tests pass
4. Submit a pull request

## License

MIT

---

<div align="center">

### 🏆 Built for the GitHub Copilot SDK Challenge

**[Repo Bootcamp](https://github.com/Arthur742Ramos/repo-bootcamp)** showcases the power of the [GitHub Copilot SDK](https://github.com/github/copilot-sdk) for building agentic developer tools.

*Stop wasting time on manual onboarding docs. Let AI do the heavy lifting.*

[![Built with Copilot SDK](https://img.shields.io/badge/Built%20with-GitHub%20Copilot%20SDK-8957e5?logo=github&logoColor=white&style=for-the-badge)](https://github.com/github/copilot-sdk)

</div>
