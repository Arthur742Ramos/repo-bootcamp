import { realpath } from "fs/promises";
import { relative, sep } from "path";

/** Resolve only a successfully written destination and its output base, without listing files. */
export async function emittedFileName(outputDir: string, destination: string): Promise<string> {
  const [base, file] = await Promise.all([realpath(outputDir), realpath(destination)]);
  return relative(base, file).split(sep).join("/");
}
