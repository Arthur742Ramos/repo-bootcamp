# Repo Bootcamp

> Turn any public GitHub repository into a Day 1 onboarding kit using GitHub Copilot SDK

[![Node.js](https://img.shields.io/badge/node-%3E%3D18-brightgreen)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.6-blue)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Repo Bootcamp analyzes any GitHub repository and generates comprehensive onboarding documentation for new contributors. It uses agentic AI with tool-calling to intelligently explore codebases and produce high-quality, actionable docs.

## Features

- **Agentic Analysis** - Uses Claude with tool-calling to read files, search code, and understand architecture
- **Complete Documentation Suite** - Generates 8 interconnected markdown files
- **Smart Prioritization** - Intelligently samples files based on importance and byte budget
- **Schema Validation** - Validates LLM output with auto-retry on failures
- **Multi-language Support** - Works with TypeScript, Python, Go, Rust, Java, and more

## Generated Documentation

| File | Description |
|------|-------------|
| `BOOTCAMP.md` | 1-page overview - start here! |
| `ONBOARDING.md` | Complete setup guide with commands |
| `ARCHITECTURE.md` | System design with Mermaid diagrams |
| `CODEMAP.md` | Directory tour for navigation |
| `FIRST_TASKS.md` | 8-10 starter issues by difficulty |
| `RUNBOOK.md` | Operations guide (for services) |
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
```

## Usage

```bash
# Basic usage
bootcamp <github-url>

# With options
bootcamp https://github.com/owner/repo \
  --branch main \
  --focus all \
  --audience oss-contributor \
  --output ./my-bootcamp \
  --verbose \
  --stats
```

### Options

| Option | Description | Default |
|--------|-------------|---------|
| `-b, --branch <branch>` | Branch to analyze | default branch |
| `-f, --focus <focus>` | Focus: onboarding, architecture, contributing, all | `all` |
| `-a, --audience <type>` | Target: new-hire, oss-contributor, internal-dev | `oss-contributor` |
| `-o, --output <dir>` | Output directory | `./bootcamp-{repo}` |
| `-m, --max-files <n>` | Maximum files to scan | `200` |
| `--model <model>` | Override model selection | auto |
| `--json-only` | Only generate repo_facts.json | false |
| `--keep-temp` | Keep temporary clone | false |
| `--stats` | Show detailed statistics | false |
| `-v, --verbose` | Show tool calls and reasoning | false |

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
                     ┌────────┼────────┐
                     ▼        ▼        ▼
              ┌──────────┬──────────┬──────────┐
              │read_file │list_files│ search   │  (tools.ts)
              └──────────┴──────────┴──────────┘
```

## How It Works

1. **Clone & Scan** - Shallow clones the repo, scans file tree, detects stack
2. **Priority Sampling** - Scores files by importance, reads within byte budget
3. **Agentic Analysis** - Claude explores the repo with tools, produces JSON
4. **Schema Validation** - Validates output, retries with targeted prompts if needed
5. **Generate Docs** - Transforms JSON into polished markdown documentation

## Example Output

See the [examples/](./examples/) directory for sample outputs:

- [examples/ky/](./examples/ky/) - TypeScript HTTP client library

### Sample BOOTCAMP.md

```markdown
# sindresorhus/ky Bootcamp

> Tiny Fetch-based HTTP client with ergonomic helpers, retries, and hooks.

## Quick Facts
| | |
|---|---|
| **Languages** | TypeScript |
| **Build System** | npm |

## Prerequisites
- Node.js >=18
- npm

## Quick Start
1. Install dependencies: npm install
2. Run tests: npm test
...
```

## Development

```bash
# Install dependencies
npm install

# Build
npm run build

# Run tests
npm test

# Watch mode
npm run test:watch

# Coverage
npm run test:coverage
```

## Requirements

- Node.js 18+
- GitHub Copilot SDK access (requires GitHub Copilot subscription)
- `GITHUB_TOKEN` environment variable for API authentication

## Configuration

The tool uses these models in order of preference:
1. `claude-opus-4-5`
2. `claude-sonnet-4-5`
3. `claude-sonnet-4-20250514`

Set `--model` to override.

## License

MIT

---

Built with [GitHub Copilot SDK](https://github.com/github/copilot-sdk)
