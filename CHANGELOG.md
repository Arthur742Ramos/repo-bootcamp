# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- `bootcamp diff <owner/repo#pr>` command for onboarding-focused PR diffing

## [1.0.0] - 2026-01-25

### Added

- **Core Features**
  - Agentic repository analysis using GitHub Copilot SDK
  - Generate 12+ interconnected markdown documentation files
  - Support for TypeScript, Python, Go, Rust, Java, and more languages
  - Schema validation with Zod and auto-retry on failures
  - Smart file prioritization and byte budget management

- **CLI Commands**
  - `bootcamp <url>` - Generate full bootcamp documentation
  - `bootcamp ask <url>` - Interactive Q&A mode without full generation
  - `bootcamp web` - Start local web demo server

- **CLI Options**
  - `--branch` - Analyze specific branch
  - `--focus` - Focus on onboarding, architecture, contributing, or all
  - `--audience` - Target new-hire, oss-contributor, or internal-dev
  - `--output` - Custom output directory
  - `--style` - Output styles: startup, enterprise, oss, devops
  - `--interactive` - Start Q&A mode after generation
  - `--compare` - Compare with git ref for version diffing
  - `--create-issues` - Create GitHub issues from starter tasks
  - `--render-diagrams` - Render Mermaid to SVG/PNG
  - `--fast` - Fast mode with inlined files (~15-30s)
  - `--json-only` - Only generate repo_facts.json
  - `--no-clone` - Use GitHub API instead of cloning

- **Generated Documentation**
  - BOOTCAMP.md - 1-page overview
  - ONBOARDING.md - Complete setup guide
  - ARCHITECTURE.md - System design with Mermaid diagrams
  - CODEMAP.md - Directory tour
  - FIRST_TASKS.md - 8-10 starter issues by difficulty
  - RUNBOOK.md - Operations guide
  - DEPENDENCIES.md - Dependency graph and analysis
  - SECURITY.md - Security patterns and findings
  - RADAR.md - Tech radar and onboarding risk score
  - IMPACT.md - Change impact analysis
  - diagrams.mmd - Mermaid diagram sources
  - repo_facts.json - Structured data for automation

- **Analysis Features**
  - Tech radar for identifying modern, stable, legacy, and risky technologies
  - Security analysis with scoring
  - Change impact analysis for key files
  - Dependency graph generation
  - Version comparison (DIFF.md)

- **Integrations**
  - GitHub issue creation from starter tasks
  - Web demo server with Express
  - Plugin system for custom analyzers
  - Template packs for output customization

- **Developer Experience**
  - 205 passing tests with Vitest
  - Full TypeScript support
  - Beautiful CLI output with progress indicators
  - Streaming responses during analysis

[1.0.0]: https://github.com/Arthur742Ramos/repo-bootcamp/releases/tag/v1.0.0
