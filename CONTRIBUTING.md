# Contributing to Repo Bootcamp

Thank you for your interest in contributing to Repo Bootcamp! This document provides guidelines and instructions for contributing.

## Code of Conduct

By participating in this project, you agree to maintain a respectful and inclusive environment for everyone.

## How to Contribute

### Reporting Bugs

Before submitting a bug report:

1. Check the [existing issues](https://github.com/Arthur742Ramos/repo-bootcamp/issues) to avoid duplicates
2. Use the latest version to see if the bug has been fixed
3. Use the Bug Report issue form (`.github/ISSUE_TEMPLATE/bug.yml`)

When submitting a bug report, include:

- A clear, descriptive title
- Steps to reproduce the issue
- Expected vs actual behavior
- Your environment (Node.js version, OS, etc.)
- Any relevant error messages or logs

### Suggesting Features

Feature suggestions are welcome! Please:

1. Check existing issues and discussions first
2. Provide a clear use case for the feature
3. Explain why it would benefit other users
4. Use the Feature Request issue form (`.github/ISSUE_TEMPLATE/feature.yml`)

### Pull Requests

1. **Fork the repository** and create your branch from `main`
2. **Install dependencies**: `npm install`
3. **Make your changes** following the code style guidelines
4. **Add tests** for any new functionality
5. **Run quality checks**: `npm run lint && npm run typecheck && npm test`
6. **Ensure the build passes**: `npm run build`
7. **Check formatting**: `npm run format:check`
8. **Submit a pull request** with a clear description of your changes (using `.github/PULL_REQUEST_TEMPLATE.md`)

## Development Setup

```bash
# Clone your fork
git clone https://github.com/YOUR_USERNAME/repo-bootcamp.git
cd repo-bootcamp

# Install dependencies
npm install

# Build the project
npm run build

# Lint and type-check
npm run lint
npm run typecheck

# Run tests
npm test

# Check formatting
npm run format:check

# Run tests in watch mode
npm run test:watch

# Run web UI with hot reload
npm run dev:web

# Run with coverage
npm run test:coverage
```

## Code Style Guidelines

- **TypeScript**: All code should be written in TypeScript
- **Formatting**: Follow the existing code style in the project
- **Types**: Prefer explicit types over `any`
- **Comments**: Add comments for complex logic, but prefer self-documenting code
- **Naming**: Use descriptive variable and function names

## Testing

- All new features should include tests
- All bug fixes should include regression tests
- Run `npm test` before submitting a PR
- Aim to maintain or improve test coverage
- Coverage gate targets are enforced in CI (`lines >= 80%`, `branches >= 70%`)

## Commit Messages

Write clear, concise commit messages:

- Use the present tense ("Add feature" not "Added feature")
- Use the imperative mood ("Move cursor to..." not "Moves cursor to...")
- Limit the first line to 72 characters
- Reference issues and PRs when relevant

Examples:

- `Add support for custom output templates`
- `Fix parsing error for repos with spaces in names`
- `Update documentation for --fast flag`

## Project Structure

```
repo-bootcamp/
├── src/           # Source code
│   ├── index.ts   # Package root API entry (re-exports src/api.ts)
│   ├── cli.ts     # Commander CLI entry point
│   ├── api.ts     # Curated programmatic API exports
│   ├── lib.ts     # Extended programmatic API exports
│   ├── agent.ts   # Copilot SDK agent logic
│   ├── ingest.ts  # Repository scanning
│   ├── generator.ts # Documentation generation
│   └── ...        # Other modules
├── test/          # Test files
├── examples/      # Example outputs
└── dist/          # Compiled output
```

## Architecture Decisions

Important technical decisions are captured in [docs/adr/](./docs/adr/).

## Questions?

If you have questions, feel free to:

- Open a [discussion](https://github.com/Arthur742Ramos/repo-bootcamp/discussions)
- Open an issue for clarification

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
