import { expect, test } from "@playwright/test";
import { getIndexHtml } from "../../src/web/templates.js";

test.beforeEach(async ({ page }) => {
  await page.route("http://bootcamp.test/", (route) =>
    route.fulfill({ contentType: "text/html", body: getIndexHtml() })
  );
  await page.goto("http://bootcamp.test/");
});

for (const width of [1440, 320]) {
  test(`server repository rejection focuses its field and editing clears the error at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: width === 320 ? 640 : 1000 });
    let requests = 0;
    await page.route("**/api/analyze", (route) => {
      requests++;
      return route.fulfill({
        status: 400,
        json: {
          error: "Enter a public GitHub, GitLab, or Bitbucket repository.",
          field: "repoUrl",
        },
      });
    });
    const input = page.getByRole("textbox", { name: "Repository URL", exact: true });
    await input.fill("https://example.com/not-a-supported-repository");
    await page.getByRole("button", { name: "Analyze", exact: true }).click();
    await expect(input).toHaveAttribute("aria-invalid", "true");
    await expect(input).toBeFocused();
    await expect(page.locator("#repoUrlError")).toBeVisible();
    await expect(page.locator("#retryBtn")).toBeHidden();
    await expect(page.locator("#progress")).toBeHidden();
    await page.screenshot({ path: test.info().outputPath("repository-validation.png") });
    await input.fill("owner/repo");
    await expect(input).not.toHaveAttribute("aria-invalid", "true");
    await expect(page.locator("#repoUrlError")).toBeHidden();
    expect(requests).toBe(1);
  });
}

test("accepted parser forms reach the server unchanged with their run options", async ({
  page,
}) => {
  const submissions: { repoUrl: string; options: { branch: string; subdir: string } }[] = [];
  await page.route("**/api/analyze", (route) => {
    submissions.push(route.request().postDataJSON());
    return route.fulfill({ status: 503, json: { error: "Fixture capacity limit" } });
  });
  await page.locator("#advancedOptions").evaluate((el) => {
    (el as HTMLDetailsElement).open = true;
  });
  await page.locator("#branch").fill("release-fixture");
  await page.locator("#subdir").fill("packages/app");
  for (const repoUrl of [
    "owner/repo",
    "git@github.com:owner/repo.git",
    "gitlab.com/group/repo",
    "https://bitbucket.org/owner/repo",
  ]) {
    await page.locator("#repoUrl").fill(repoUrl);
    await page.getByRole("button", { name: "Analyze", exact: true }).click();
    await expect(page.locator("#retryBtn")).toBeVisible();
    await expect(page.locator("#repoUrl")).not.toHaveAttribute("aria-invalid", "true");
    expect(submissions.at(-1)).toMatchObject({
      repoUrl,
      options: { branch: "release-fixture", subdir: "packages/app" },
    });
  }
  expect(submissions).toHaveLength(4);
});

for (const edit of ["repoUrl", "branch"] as const) {
  test(`a delayed repository rejection preserves an edited ${edit} draft and its focus`, async ({
    page,
  }) => {
    let release!: () => void;
    let started!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const pending = new Promise<void>((resolve) => {
      started = resolve;
    });
    await page.route("**/api/analyze", async (route) => {
      started();
      await gate;
      await route.fulfill({
        status: 400,
        json: { error: "Rejected submitted repository", field: "repoUrl" },
      });
    });
    await page.locator("#repoUrl").fill("invalid-repository");
    await page.getByRole("button", { name: "Analyze", exact: true }).click();
    await pending;
    await page.locator("#advancedOptions").evaluate((el) => {
      (el as HTMLDetailsElement).open = true;
    });
    await page.locator("#" + edit).fill(edit === "repoUrl" ? "owner/corrected" : "release-edited");
    release();
    await expect(page.getByRole("button", { name: "Analyze", exact: true })).toBeEnabled();
    await expect(page.locator("#repoUrl")).not.toHaveAttribute("aria-invalid", "true");
    await expect(page.locator("#repoUrlError")).toBeHidden();
    await expect(page.locator("#" + edit)).toBeFocused();
    await expect(page.locator("#retryBtn")).toBeHidden();
  });
}
