import { describe, expect, it } from "vitest";
import { markdownToHtml } from "../src/formatter.js";
import { buildBlobUrl } from "../src/source-links.js";
import type { RepoInfo } from "../src/types.js";
const repo: RepoInfo = {
  owner: "owner",
  repo: "project",
  url: "https://github.com/owner/project",
  branch: "main",
  fullName: "owner/project",
  host: "github.com",
};
describe("selected-directory source links", () => {
  it.each([
    ["github", "github.com", "blob"],
    ["gitlab", "gitlab.example", "-/blob"],
    ["bitbucket", "bitbucket.org", "src"],
  ] as const)(
    "prefixes scoped %s paths and percent-encodes each segment",
    (provider, host, route) => {
      expect(
        buildBlobUrl({ ...repo, provider, host, sourcePathPrefix: "packages/my app" }, "src/a#b.ts")
      ).toBe(`https://${host}/owner/project/${route}/main/packages/my%20app/src/a%23b.ts`);
    }
  );
  it("preserves existing root links and normalizes scoped relative wrappers", () => {
    expect(buildBlobUrl(repo, "./src/index.ts")).toBe(
      "https://github.com/owner/project/blob/main/src/index.ts"
    );
    expect(buildBlobUrl({ ...repo, sourcePathPrefix: "./packages/app/" }, "./src/index.ts")).toBe(
      "https://github.com/owner/project/blob/main/packages/app/src/index.ts"
    );
  });
  it("keeps parentheses in directory and file names intact through HTML conversion", () => {
    const url = buildBlobUrl({ ...repo, sourcePathPrefix: "packages/app(test)" }, "src/a(b).ts");
    expect(url).toBe(
      "https://github.com/owner/project/blob/main/packages/app%28test%29/src/a%28b%29.ts"
    );
    expect(markdownToHtml(`- [source](${url})`)).toContain(`href="${url}"`);
  });
  it("keeps local or unknown remotes as bare paths", () => {
    expect(buildBlobUrl(undefined, "src/index.ts")).toBeNull();
    expect(
      buildBlobUrl({ ...repo, owner: "local", sourcePathPrefix: "packages/app" }, "src/index.ts")
    ).toBeNull();
    expect(buildBlobUrl({ ...repo, host: undefined }, "src/index.ts")).toBeNull();
  });
  it("does not turn traversal, empty files, or an absolute prefix into a scoped remote link", () => {
    const scoped = { ...repo, sourcePathPrefix: "packages/app" };
    expect(buildBlobUrl(scoped, "../other/index.ts")).toBeNull();
    expect(buildBlobUrl(scoped, "")).toBeNull();
    expect(buildBlobUrl({ ...repo, sourcePathPrefix: "/packages/app" }, "src/index.ts")).toBeNull();
  });
});
