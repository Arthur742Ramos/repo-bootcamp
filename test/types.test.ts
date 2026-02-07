import { describe, it, expect, expectTypeOf } from "vitest";
import type { BootcampOptions, Entrypoint } from "../src/types.js";

describe("types module", () => {
  it("accepts core BootcampOptions fields", () => {
    const options = {
      branch: "main",
      focus: "all",
      audience: "oss-contributor",
      output: "./output",
      maxFiles: 200,
      noClone: false,
      verbose: false,
    } satisfies BootcampOptions;

    expectTypeOf(options).toMatchTypeOf<BootcampOptions>();
  });

  it("allows web entrypoint type", () => {
    const entry: Entrypoint = { path: "src/index.ts", type: "web" };
    expectTypeOf(entry.type).toEqualTypeOf<Entrypoint["type"]>();
  });

  it("loads without runtime exports", async () => {
    const mod = await import("../src/types.js");
    expect(Object.keys(mod)).toEqual([]);
  });
});
