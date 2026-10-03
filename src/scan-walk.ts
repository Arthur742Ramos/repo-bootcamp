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
    let protectedPattern = pattern.replace(/\\[\s\S]/g, (escape) => {
      escapes.push(escape);
      return `\0${escapes.length - 1}\0`;
    });
    // Preserve the expander's special treatment of a leading literal {} before
    // adding the witness below. Input NULs were rejected, so markers cannot clash.
    if (protectedPattern.startsWith("{}")) {
      const index = escapes.length;
      escapes.push("\\{", "\\}");
      protectedPattern = `\0${index}\0\0${index + 1}\0${protectedPattern.slice(2)}`;
    }
    // Nonempty witnesses prevent dropped empty alternatives from concealing an
    // internal count limit. Brace rewrites replace each closing brace with an
    // escape sentinel shorter than 64 characters; bound raw results as well.
    const witness = "\0bootcamp-brace\0";
    const closingBraces = protectedPattern.split("}").length - 1;
    const rawBound = protectedPattern.length + witness.length + 64 * (closingBraces + 2);
    const allowed = Math.min(10_000, Math.floor(4_000_000 / rawBound));
    if (allowed < 1) throw new Error("Exclude pattern exceeds the brace-expansion memory budget.");
    const raw = expand(witness + protectedPattern, {
      max: allowed + 1,
      maxLength: (allowed + 1) * rawBound,
    });
    if (raw.length > allowed) {
      throw new Error("Exclude pattern exceeds the brace-alternative limit or memory budget.");
    }
    const expandedPatterns = raw.map((candidate) => candidate.slice(witness.length));
    if (expandedPatterns.reduce((total, candidate) => total + candidate.length, 0) > 4_000_000) {
      throw new Error("Exclude pattern exceeds the brace-expansion memory budget.");
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
          windows: false,
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
        if (isDirectory && !pruned) {
          try {
            // Older Windows Dirents can report junctions as directories. Validate
            // before retaining an entry as well as before opening queued trees.
            if (!(await lstat(join(scanRoot, path))).isDirectory()) continue;
          } catch {
            continue;
          }
          pending.push(path);
        }
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
