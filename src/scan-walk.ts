import { lstat, opendir } from "fs/promises";
import { isAbsolute, join, posix, sep } from "path";
import { expand } from "brace-expansion";
import picomatch from "picomatch";
import type { FileInfo } from "./types.js";

/** Preserve the distinction between hiding an entry and pruning its children. */
function staticBasename(pattern: string): boolean {
  const name = posix.basename(pattern);
  return (
    !name.includes("\\") &&
    !/[*?]|^!|\[[^[]*\]|(?:^|[^!*+?@])\([^(]*\|[^|]*\)|[!*+?@]\([^(]*\)/.test(name)
  );
}

function compileIgnores(patterns: readonly string[]) {
  return patterns.flatMap((pattern) => {
    if (pattern.includes("\0")) throw new Error("Exclude patterns cannot contain NUL characters.");
    // Brace expansion unescapes backslashes; protect glob escapes so they reach
    // the matcher unchanged, including literal braces and escaped brackets.
    const escapes: string[] = [];
    const protectedPattern = pattern.replace(/\\./g, (escape) => {
      escapes.push(escape);
      return `\0${escapes.length - 1}\0`;
    });
    const expandedPatterns = expand(protectedPattern, { max: 10_001 });
    if (expandedPatterns.length > 10_000) {
      throw new Error("Exclude pattern exceeds the 10,000 brace-alternative limit.");
    }
    return expandedPatterns.filter(Boolean).map((candidate) => {
      const expanded = candidate.replace(
        /\0(\d+)\0/g,
        (_, index: string) => escapes[Number(index)]
      );
      // A leading ! in an ignore list excludes the following pattern; !(...)
      // remains a negative extglob. Match paths case-sensitively on every OS.
      const positive =
        expanded.startsWith("!") && expanded[1] !== "(" ? expanded.slice(1) : expanded;
      const normalized = positive.replace(/(?!^)\/{2,}/g, "/").replace(/^(?:\.\/)+/, "");
      return {
        matcher: picomatch(normalized, {
          dot: true,
          nocase: false,
          nonegate: true,
          nobrace: true,
          posix: true,
          strictSlashes: false,
        }),
        absolute: isAbsolute(normalized),
        subtree: normalized.endsWith("/**"),
        prune: normalized.endsWith("/**") || staticBasename(normalized),
      };
    });
  });
}

/**
 * Walk one directory at a time, retaining at most maxFiles entries. Native
 * directory iteration closes its handle on exhaustion, failure, or early return;
 * queued directories are never opened after the limit has been reached.
 */
export async function walkRepositoryFiles(
  scanRoot: string,
  maxFiles: number,
  ignorePatterns: readonly string[]
): Promise<FileInfo[]> {
  const ignores = compileIgnores(ignorePatterns);
  const pending = [""];
  const files: FileInfo[] = [];
  for (let index = 0; index < pending.length; index++) {
    const directoryPath = pending[index];
    let directory;
    try {
      // Recheck queued directories: never follow a directory replaced by a link.
      if (directoryPath && !(await lstat(join(scanRoot, directoryPath))).isDirectory()) continue;
      directory = await opendir(join(scanRoot, directoryPath));
    } catch {
      continue; // unreadable/deleted directories contribute no entries
    }
    try {
      for await (const entry of directory) {
        if (entry.isSymbolicLink()) continue;
        const path = directoryPath ? `${directoryPath}/${entry.name}` : entry.name;
        const isDirectory = entry.isDirectory();
        const absolutePath = join(scanRoot, path).split(sep).join("/");
        const excluded = ignores.some(({ matcher, absolute, subtree }) => {
          const subject = absolute ? absolutePath : path;
          return matcher(subject) || ((isDirectory || subtree) && matcher(`${subject}/`));
        });
        const pruned =
          isDirectory &&
          ignores.some(({ matcher, absolute, subtree, prune }) => {
            const subject = absolute ? absolutePath : path;
            return prune && (matcher(subject) || (subtree && matcher(`${subject}/`)));
          });
        if (isDirectory && !pruned) pending.push(path);
        if (excluded) continue;
        let size = 0;
        if (!isDirectory) {
          try {
            const metadata = await lstat(join(scanRoot, path));
            if (!metadata.isFile()) continue;
            size = metadata.size;
          } catch {
            continue;
          }
        }
        files.push({ path, size, isDirectory });
        if (files.length >= maxFiles) return files;
      }
    } catch (error) {
      if (!(error as NodeJS.ErrnoException).code) throw error;
      // A read failure closes this iterator and leaves other queued trees usable.
    }
  }
  return files;
}
