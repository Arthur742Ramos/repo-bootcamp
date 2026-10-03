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
  it.each([
    ["github", "github.com", "blob"],
    ["gitlab", "gitlab.com", "-/blob"],
    ["bitbucket", "bitbucket.org", "src"],
  ] as const)("links detached %s content to the known commit only", (provider, host, route) => {
    const commitSha = "0123456789abcdef0123456789abcdef01234567";
    const scoped = {
      ...repo,
      provider,
      host,
      branch: "HEAD",
      commitSha,
      sourcePathPrefix: "packages/my app",
    };
    expect(buildBlobUrl(scoped, "src/a(b).ts")).toBe(
      `https://${host}/owner/project/${route}/${commitSha}/packages/my%20app/src/a%28b%29.ts`
    );
    expect(buildBlobUrl({ ...scoped, commitSha: undefined }, "src/a(b).ts")).toBe(
      `https://${host}/owner/project/${route}/HEAD/packages/my%20app/src/a%28b%29.ts`
    );
    expect(buildBlobUrl({ ...scoped, branch: "release/v2" }, "src/a(b).ts")).toBe(
      `https://${host}/owner/project/${route}/release/v2/packages/my%20app/src/a%28b%29.ts`
    );
    expect(buildBlobUrl({ ...scoped, branch: "local" }, "src/a(b).ts")).toBeNull();
  });
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
  it.each([
    ["github", "github.com", "blob"],
    ["gitlab", "gitlab.com", "-/blob"],
    ["bitbucket", "bitbucket.org", "src"],
  ] as const)(
    "preserves reserved characters in detected %s default refs",
    (provider, host, route) => {
      for (const [branch, encodedRef] of [
        ["release/v2#candidate", "release/v2%23candidate"],
        ["release/v2(candidate)", "release/v2%28candidate%29"],
        ["release/v2%complete", "release/v2%25complete"],
        ["release/v2%25encoded", "release/v2%2525encoded"],
        ["release/v2+candidate", "release/v2%2Bcandidate"],
        ["release/v2'candidate", "release/v2%27candidate"],
        ["release/v2!candidate", "release/v2%21candidate"],
        ["release/v2&candidate", "release/v2%26candidate"],
      ]) {
        const url = buildBlobUrl(
          { ...repo, provider, host, branch, sourcePathPrefix: "packages/ref app" },
          "src/a(b).ts"
        );
        const expected = `https://${host}/owner/project/${route}/${encodedRef}/packages/ref%20app/src/a%28b%29.ts`;
        expect(url).toBe(expected);
        expect(new URL(url!).hash).toBe("");
        expect(new URL(url!).search).toBe("");
        expect(markdownToHtml(`- [source](${url})`)).toContain(`href="${expected}"`);
      }
    }
  );
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
