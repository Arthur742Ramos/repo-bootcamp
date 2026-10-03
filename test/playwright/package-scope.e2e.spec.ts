import { expect, test, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { getIndexHtml } from "../../src/web/templates.js";
import { markdownToHtml } from "../../src/formatter.js";

const repoUrl = "https://github.com/fixture/monorepo";
const source = "https://github.com/fixture/monorepo/blob/main/packages/app/src/main.ts";
const guide = `# Selected app\n\nRun pnpm dev from packages/app.\n\n[\`src/main.ts\`](${source})`;
function result(subdir?: string) {
  return {
    files: ["ONBOARDING.md"],
    stats: {
      securityScore: 90,
      securityGrade: "A",
      riskScore: 20,
      riskGrade: "B",
      dependencies: 0,
      filesScanned: 3,
      durationMs: 1000,
    },
    manifest: {
      repository: { fullName: "fixture/monorepo", branch: "main", provider: "github" },
      options: subdir ? { subdir } : {},
    },
    quickstartCommands: [{ name: "dev", command: "pnpm dev", source: "package.json" }],
  };
}
async function fixture(page: Page, saved?: { subdir?: string }) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.addInitScript(() => {
    (window as any).copiedText = "";
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (text: string) => {
          (window as any).copiedText = text;
        },
      },
    });
  });
  if (saved)
    await page.addInitScript(() => localStorage.setItem("repo-bootcamp-job-id", "scope-job"));
  await page.route("http://bootcamp.test/", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: getIndexHtml("scope-nonce"),
      headers: {
        "Content-Security-Policy":
          "default-src 'self'; script-src 'self' 'nonce-scope-nonce'; style-src 'self' 'nonce-scope-nonce'; style-src-attr 'none'",
      },
    })
  );
  const submissions: any[] = [];
  let scope = saved?.subdir;
  await page.route("**/api/analyze", async (route) => {
    const body = route.request().postDataJSON();
    submissions.push(body);
    scope = body.options.subdir.trim() || undefined;
    return route.fulfill({ json: { jobId: "scope-job" } });
  });
  await page.route("**/api/jobs/scope-job", (route) =>
    route.fulfill({ json: { id: "scope-job", repoUrl, subdir: scope, status: "complete" } })
  );
  await page.route("**/stream", (route) =>
    route.fulfill({
      contentType: "text/event-stream",
      body:
        "data: " +
        JSON.stringify({
          type: "complete",
          message: "Offline fixture complete",
          data: result(scope),
        }) +
        "\n\n",
    })
  );
  await page.route("**/files/**", (route) =>
    route.fulfill({ json: { content: guide, html: markdownToHtml(guide) } })
  );
  await page.route("**/ask", (route) =>
    route.fulfill({ json: { answer: "Start with src/main.ts in packages/app." } })
  );
  await page.goto("http://bootcamp.test/");
  return { submissions, errors };
}
async function submit(page: Page, scope: string) {
  await page.getByRole("textbox", { name: "Repository URL", exact: true }).fill(repoUrl);
  await page.getByText("Run options", { exact: true }).click();
  await page
    .getByRole("textbox", { name: "Package directory (optional)", exact: true })
    .fill(scope);
  await page
    .getByRole("textbox", { name: "Package directory (optional)", exact: true })
    .press("Enter");
  await expect(page.locator("#resultMeta")).toContainText("fixture/monorepo");
}

test("selected package is submitted, identified, copied, read and retained for follow-up under strict CSP", async ({
  page,
}) => {
  const { submissions, errors } = await fixture(page);
  await submit(page, "packages/app");
  expect(submissions[0].options.subdir).toBe("packages/app");
  await expect(page.locator("#resultMeta")).toContainText("package packages/app");
  await expect(page.locator("#cliCommand")).toContainText("--subdir 'packages/app'");
  await page.locator("#copyCommandBtn").click();
  expect(await page.evaluate(() => (window as any).copiedText)).toContain(
    "--subdir 'packages/app'"
  );
  await expect(page.locator("#quickstartCommands")).toContainText("pnpm dev");
  await page.getByRole("button", { name: /ONBOARDING.md/ }).click();
  await expect(page.getByRole("heading", { name: "Selected app" })).toBeVisible();
  await expect(page.locator("#renderedContent a")).toHaveAttribute("href", source);
  await page.keyboard.press("Escape");
  await page.getByText("Ask a follow-up question", { exact: true }).click();
  await page.locator("#askQuestion").fill("Where do I start?");
  const question = page.waitForRequest((req) => req.url().endsWith("/scope-job/ask"));
  await page.getByRole("button", { name: "Ask", exact: true }).click();
  expect((await question).postDataJSON()).toEqual({ question: "Where do I start?" });
  await expect(page.locator("#askAnswer")).toContainText("packages/app");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(page.locator("[style], [onclick], [onchange]")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("copied CLI safely preserves spaces, quotes and shell metacharacters in a package name", async ({
  page,
}) => {
  await fixture(page);
  const scope = "packages/app's ui $(printf unsafe)";
  await submit(page, scope);
  await page.locator("#copyCommandBtn").click();
  const command = await page.evaluate(() => (window as any).copiedText as string);
  expect(command).toBe(
    "bootcamp " + repoUrl + " --subdir 'packages/app'\"'\"'s ui $(printf unsafe)'"
  );
  // Executing only a local function proves argument boundaries and that the
  // package value cannot become command substitution in the copied POSIX command.
  if (process.platform !== "win32") {
    const output = execFileSync("bash", ["-s"], {
      input: "bootcamp() { printf '%s\\n' \"$@\"; }\n" + command + "\n",
      encoding: "utf8",
    });
    expect(output.trim().split("\n")).toEqual([repoUrl, "--subdir", scope]);
  }
});

for (const saved of [{ subdir: "packages/app" }, {}]) {
  test(`restores ${saved.subdir ? "selected package" : "legacy root job"} without losing scope`, async ({
    page,
  }) => {
    const { errors } = await fixture(page, saved);
    await expect(page.locator("#resultMeta")).toContainText("fixture/monorepo");
    await page.getByText("Run options", { exact: true }).click();
    await expect(page.locator("#subdir")).toHaveValue(saved.subdir || "");
    if (saved.subdir) {
      await expect(page.locator("#cliCommand")).toContainText("--subdir 'packages/app'");
      await expect(page.locator("#resultMeta")).toContainText("package packages/app");
    } else {
      await expect(page.locator("#cliCommand")).not.toContainText("--subdir");
      await expect(page.locator("#resultMeta")).not.toContainText("package ");
    }
    expect(errors).toEqual([]);
  });
}

test("invalid package responses expose an accessible field error and allow correction", async ({
  page,
}) => {
  await fixture(page);
  await page.route("**/api/analyze", (route) =>
    route.fulfill({
      status: 400,
      json: { error: "Use a package directory within the repository.", field: "subdir" },
    })
  );
  await page.locator("#repoUrl").fill(repoUrl);
  await page.getByText("Run options", { exact: true }).click();
  await page.locator("#subdir").fill("../app");
  await page.getByRole("button", { name: "Analyze", exact: true }).click();
  await expect(page.locator("#subdirError")).toHaveText(
    "Use a package directory within the repository."
  );
  await expect(page.locator("#subdir")).toBeFocused();
  await expect(page.locator("#subdir")).toHaveAttribute("aria-invalid", "true");
  await expect(page.locator("#subdir")).toHaveAttribute(
    "aria-describedby",
    "subdirHint subdirError"
  );
  await expect(page.getByRole("button", { name: "Analyze", exact: true })).toBeEnabled();
  await page.locator("#subdir").fill("packages/app");
  await expect(page.locator("#subdirError")).toBeHidden();
  await expect(page.locator("#subdir")).not.toHaveAttribute("aria-invalid");
});

test("editing a package directory owns the form over a delayed saved-job restoration", async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem("repo-bootcamp-job-id", "scope-job");
    const nativeFetch = window.fetch.bind(window);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    (window as any).releaseSavedScope = release;
    window.fetch = async (...args) => {
      const response = await nativeFetch(...args);
      if (String(args[0]) === "/api/jobs/scope-job") {
        (window as any).savedScopeReady = true;
        await gate;
        (window as any).savedScopeSettled = true;
      }
      return response;
    };
  });
  await fixture(page, { subdir: "packages/app" });
  await page.waitForFunction(() => (window as any).savedScopeReady);
  await page.getByText("Run options", { exact: true }).click();
  await page.locator("#subdir").fill("packages/core");
  await page.evaluate(() => (window as any).releaseSavedScope());
  await page.waitForFunction(() => (window as any).savedScopeSettled);
  await expect(page.locator("#subdir")).toHaveValue("packages/core");
  await expect(page.locator("#results")).not.toHaveClass(/show/);
});
