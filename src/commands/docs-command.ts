import chalk from "chalk";

import { analyzeDocumentation } from "../docs-analyzer.js";
import { fixDocumentation } from "../docs-fixer.js";
import { isLocalPath, resolveRepo, type RepoSource } from "../repo-resolver.js";

/**
 * Run the docs analysis/fix command
 */
export async function runDocsCommand(
  repoUrl: string,
  opts: { check?: boolean; fix?: boolean; branch?: string; verbose?: boolean }
) {
  console.log(chalk.bold("\n📚 Docs Analyzer\n"));

  let repoSource: RepoSource;
  try {
    if (isLocalPath(repoUrl)) {
      console.log(chalk.dim("Using local repository..."));
    } else {
      console.log(chalk.dim("Cloning repository..."));
    }
    repoSource = await resolveRepo(repoUrl, process.cwd(), opts.branch || undefined);
    console.log(chalk.dim(`Analyzing: ${repoSource.repoInfo.fullName}`));
  } catch (error: unknown) {
    console.error(chalk.red(`❌ Failed to resolve repository: ${error instanceof Error ? error.message : String(error)}`));
    process.exit(1);
  }

  const repoPath = repoSource.path;

  try {
    const analysis = await analyzeDocumentation(repoPath);

    console.log(chalk.bold("\n📋 Analysis Results\n"));

    if (analysis.versionMismatches.length > 0) {
      console.log(chalk.yellow("⚠️  Version Mismatches:"));
      for (const m of analysis.versionMismatches) {
        console.log(
          chalk.dim(`   ${m.type}: `) +
            chalk.red(m.documented) +
            chalk.dim(" → ") +
            chalk.green(m.actual) +
            chalk.dim(` (${m.location})`)
        );
      }
      console.log();
    }

    if (analysis.frameworkIssues.length > 0) {
      console.log(chalk.yellow("⚠️  Undocumented Frameworks:"));
      for (const f of analysis.frameworkIssues) {
        console.log(
          chalk.dim("   - ") +
            chalk.cyan(f.framework) +
            (f.version ? chalk.dim(` (${f.version})`) : "")
        );
      }
      console.log();
    }

    if (analysis.cliDrift.length > 0) {
      console.log(chalk.yellow("⚠️  CLI Documentation Drift:"));
      for (const d of analysis.cliDrift) {
        if (d.type === "missing") {
          console.log(chalk.dim("   - ") + chalk.cyan(d.actual) + chalk.dim(" not documented"));
        } else if (d.type === "extra") {
          console.log(chalk.dim("   - ") + chalk.cyan(d.documented) + chalk.dim(" documented but doesn't exist"));
        }
      }
      console.log();
    }

    if (analysis.prerequisiteIssues.length > 0) {
      console.log(chalk.yellow("⚠️  Undocumented Prerequisites:"));
      for (const p of analysis.prerequisiteIssues) {
        const icon = p.type === "env" ? "🔑" : "🔧";
        console.log(chalk.dim(`   ${icon} `) + chalk.cyan(p.name));
      }
      console.log();
    }

    if (analysis.badgeIssues.length > 0) {
      console.log(chalk.yellow("⚠️  Badge Issues:"));
      for (const b of analysis.badgeIssues) {
        console.log(
          chalk.dim(`   Line ${b.line}: `) +
            chalk.red(b.status) +
            chalk.dim(` - ${b.url.slice(0, 60)}...`)
        );
      }
      console.log();
    }

    console.log(chalk.bold("Summary:"));
    if (analysis.summary.errors > 0) {
      console.log(chalk.red(`   ❌ ${analysis.summary.errors} error(s)`));
    }
    if (analysis.summary.warnings > 0) {
      console.log(chalk.yellow(`   ⚠️  ${analysis.summary.warnings} warning(s)`));
    }
    if (!analysis.isStale) {
      console.log(chalk.green("   ✅ Documentation is up to date!"));
    }

    if (opts.fix && analysis.isStale) {
      console.log(chalk.bold("\n🔧 Applying fixes...\n"));
      const fixResult = await fixDocumentation(repoPath, analysis);

      if (fixResult.changesApplied > 0) {
        for (const r of fixResult.results) {
          console.log(chalk.green(`   ✅ ${r.file}:`));
          for (const change of r.changes) {
            console.log(chalk.dim(`      - ${change}`));
          }
        }
        console.log(
          chalk.green(`\n   Applied ${fixResult.changesApplied} fix(es) to ${fixResult.filesModified} file(s)`)
        );
      } else {
        console.log(chalk.dim("   No automatic fixes available for detected issues."));
      }
    }

    if (opts.check && analysis.isStale) {
      console.log(chalk.red("\n❌ Documentation is stale. Run with --fix to auto-repair.\n"));
      process.exit(1);
    }

    console.log();
  } finally {
    await repoSource.cleanup();
  }
}
