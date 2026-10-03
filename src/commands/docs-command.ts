import chalk from "chalk";

import { analyzeDocumentation } from "../docs-analyzer.js";
import { fixDocumentation } from "../docs-fixer.js";
import { isLocalPath } from "../repo-resolver.js";
import { withResolvedRepo } from "./_shared.js";

/**
 * Run the docs analysis/fix command
 */
export async function runDocsCommand(
  repoUrl: string,
  opts: { check?: boolean; fix?: boolean; branch?: string; verbose?: boolean }
) {
  console.log(chalk.bold("\n📚 Docs Analyzer\n"));

  if (isLocalPath(repoUrl)) {
    console.log(chalk.dim("Using local repository..."));
  } else {
    console.log(chalk.dim("Cloning repository..."));
  }

  await withResolvedRepo(repoUrl, opts, "Documentation analysis failed", async (repoSource) => {
    console.log(chalk.dim(`Analyzing: ${repoSource.repoInfo.fullName}`));
    const repoPath = repoSource.path;
    let analysis = await analyzeDocumentation(repoPath);

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
          console.log(
            chalk.dim("   - ") +
              chalk.cyan(d.documented) +
              chalk.dim(" documented but doesn't exist")
          );
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
          chalk.green(
            `\n   Applied ${fixResult.changesApplied} fix(es) to ${fixResult.filesModified} file(s)`
          )
        );
      } else {
        console.log(chalk.dim("   No automatic fixes available for detected issues."));
      }

      if (fixResult.changesApplied > 0) {
        analysis = await analyzeDocumentation(repoPath);
        if (!analysis.isStale) {
          console.log(chalk.green("   ✅ Documentation is up to date after fixes!"));
        } else {
          console.log(
            chalk.yellow(
              `   Remaining issues: ${analysis.summary.errors} error(s), ${analysis.summary.warnings} warning(s)`
            )
          );
        }
      }
    }

    if (opts.check && analysis.isStale) {
      console.log(
        chalk.red(
          opts.fix
            ? "\n❌ Documentation remains stale after automatic fixes. Review the remaining issues.\n"
            : "\n❌ Documentation is stale. Run with --fix to auto-repair.\n"
        )
      );
      return 1;
    }

    console.log();
    return 0;
  });
}
