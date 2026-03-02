import { build } from "esbuild";
import fg from "fast-glob";

const entryPoints = await fg(["src/**/*.ts", "!src/cli.ts"], { onlyFiles: true });

await build({
  entryPoints,
  outbase: "src",
  outdir: "dist/cjs",
  platform: "node",
  format: "cjs",
  target: "node20",
  packages: "external",
  tsconfig: "tsconfig.json",
});
