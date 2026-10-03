import { mkdtemp, mkdir, readdir, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, expect, it, vi } from "vitest";
const io = vi.hoisted(() => ({ opendir: vi.fn() }));
vi.mock("fs/promises", async () => ({
  ...(await vi.importActual<typeof import("fs/promises")>("fs/promises")),
  opendir: io.opendir,
}));
import { cargoMemberTopology } from "../src/cargo-workspace.js";
const dirs: string[] = [];
afterEach(async () => {
  io.opendir.mockReset();
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});
it("retains stable completed observations and drops all partial observations on limit/failure", async () => {
  const root = await mkdtemp(join(tmpdir(), "cargo-topology-order-"));
  dirs.push(root);
  await mkdir(join(root, "crates/a"), { recursive: true });
  await mkdir(join(root, "crates/b"));
  for (let i = 0; i < 511; i++) await writeFile(join(root, `crates/note${i}`), "Owned");
  const entries = await readdir(join(root, "crates"), { withFileTypes: true });
  let closed = 0;
  const iterator = (rows: typeof entries, fail = false) => ({
    async *[Symbol.asyncIterator]() {
      try {
        for (const row of rows) {
          yield row;
          if (fail) throw new Error("Owned iteration failure");
        }
      } finally {
        closed++;
      }
    },
  });
  io.opendir
    .mockResolvedValueOnce(iterator(entries))
    .mockResolvedValueOnce(iterator([...entries].reverse()));
  const forward = await cargoMemberTopology(root, ["crates/*"]),
    reverse = await cargoMemberTopology(root, ["crates/*"]);
  expect(forward).toEqual(reverse);
  expect(forward).toEqual({
    status: "entry-limit",
    prefixes: [{ path: "crates", type: "directory" }],
  });
  expect(closed).toBe(2);
  io.opendir
    .mockResolvedValueOnce(iterator(entries, true))
    .mockResolvedValueOnce(iterator([...entries].reverse(), true));
  expect(await cargoMemberTopology(root, ["crates/*"])).toEqual(
    await cargoMemberTopology(root, ["crates/*"])
  );
  expect(closed).toBe(4);
  const small = entries.filter((entry) => entry.isDirectory());
  io.opendir
    .mockResolvedValueOnce(iterator(small))
    .mockResolvedValueOnce(iterator([...small].reverse()));
  expect(await cargoMemberTopology(root, ["crates/*"])).toEqual(
    await cargoMemberTopology(root, ["crates/*"])
  );
  expect(closed).toBe(6);
});
