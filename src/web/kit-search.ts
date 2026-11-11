import { constants } from "fs";
import { open, realpath } from "fs/promises";
import { join } from "path";
import { markdownToHtml } from "../formatter.js";
import { getHeadingAnchor } from "../heading-anchors.js";
import { isPathInsideDir } from "../utils.js";

export const SEARCH_MAX_FILES = 64;
export const SEARCH_MAX_BYTES = 512 * 1024;
export const SEARCH_MAX_RESULTS = 50;
export interface KitSearchMatch {
  filename: string;
  line: number;
  snippet: string;
  heading: string;
  fragment: string;
}
export interface KitSearchReport {
  matches: KitSearchMatch[];
  searchedFiles: number;
  skippedFiles: number;
  truncated: boolean;
}

function plainText(html: string): string {
  return html
    .replace(/<[^>]*>/g, "")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

/** Literal, case-insensitive source search; one result per matching line. */
export function searchDocument(filename: string, content: string, query: string): KitSearchMatch[] {
  const matches: KitSearchMatch[] = [];
  const counts = new Map<string, number>();
  const used = new Set<string>();
  let heading = "";
  let fragment = "";
  let fence: string | undefined;
  if (!query) return matches;
  const literal = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "iu");
  const lines = content.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/\.md$/i.test(filename)) {
      const delimiter = line.match(/^( {0,3})(`{3,}|~{3,})(.*)$/);
      if (fence) {
        const closing = line.match(/^ {0,3}(`{3,}|~{3,})[ \t]*$/);
        if (closing && closing[1][0] === fence[0] && closing[1].length >= fence.length)
          fence = undefined;
      } else if (delimiter && !(delimiter[2][0] === "`" && delimiter[3].includes("`"))) {
        fence = delimiter[2];
      } else if (/^#{1,6}\s+/.test(line)) {
        heading = plainText(markdownToHtml(line)).trim();
        fragment = getHeadingAnchor(heading, counts, used);
      }
    }
    const offset = line.search(literal);
    if (offset < 0) continue;
    const start = Math.max(0, offset - 70);
    const end = Math.min(line.length, offset + query.length + 120);
    matches.push({
      filename,
      line: i + 1,
      heading,
      fragment,
      snippet: (start ? "…" : "") + line.slice(start, end) + (end < line.length ? "…" : ""),
    });
    if (matches.length > SEARCH_MAX_RESULTS) break;
  }
  return matches;
}

async function readSearchFile(root: string, name: string): Promise<string> {
  const target = await realpath(join(root, name));
  if (!isPathInsideDir(root, target)) throw new Error("File escapes output directory");
  const file = await open(target, constants.O_RDONLY | constants.O_NONBLOCK);
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size > SEARCH_MAX_BYTES) throw new Error("Unsupported search file");
    const bytes = Buffer.alloc(SEARCH_MAX_BYTES + 1);
    let size = 0;
    while (size < bytes.length) {
      const read = await file.read(bytes, size, bytes.length - size);
      if (!read.bytesRead) break;
      size += read.bytesRead;
    }
    if (size > SEARCH_MAX_BYTES) throw new Error("Search file grew beyond limit");
    return bytes.subarray(0, size).toString("utf8");
  } finally {
    await file.close();
  }
}

/** Search only the generated inventory, never arbitrary paths or repository files. */
export async function searchKit(
  root: string,
  inventory: string[],
  query: string
): Promise<KitSearchReport> {
  const realRoot = await realpath(root);
  const report: KitSearchReport = {
    matches: [],
    searchedFiles: 0,
    skippedFiles: 0,
    truncated: false,
  };
  const names = [...new Set(inventory)];
  let attempted = 0;
  for (const name of names) {
    if (
      !/\.(md|txt|json|mmd)$/i.test(name) ||
      /[\\/]/.test(name) ||
      name.includes("\0") ||
      name.includes("..") ||
      attempted >= SEARCH_MAX_FILES
    ) {
      report.skippedFiles++;
      continue;
    }
    attempted++;
    let content: string;
    try {
      content = await readSearchFile(realRoot, name);
    } catch {
      report.skippedFiles++;
      continue;
    }
    report.searchedFiles++;
    const matches = searchDocument(name, content, query);
    const remaining = SEARCH_MAX_RESULTS - report.matches.length;
    if (matches.length > remaining) report.truncated = true;
    report.matches.push(...matches.slice(0, remaining));
  }
  return report;
}
