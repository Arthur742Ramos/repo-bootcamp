import { expect, test, type Page } from "@playwright/test";
import { getIndexHtml } from "../../src/web/templates.js";

const repoUrl = "https://github.com/fixture/monorepo";
const requested = {
  branch: "feature/app",
  subdir: "packages/app",
  focus: "architecture",
  audience: "frontend",
  maxFiles: 37,
};
const defaults = { branch: "", subdir: "", focus: "all", audience: "all", maxFiles: 200 };

function complete(options: typeof requested) {
  return {
    type: "complete",
    message: "Owned analysis complete",
    data: {
      files: ["BOOTCAMP.md"],
      stats: {
        securityScore: 100,
        securityGrade: "A",
        riskScore: 0,
        riskGrade: "A",
        dependencies: 0,
      },
      manifest: {
        repository: {
          fullName: "fixture/monorepo",
          branch: options.branch.startsWith("release/") ? "HEAD" : options.branch || "main",
        },
        options: {
          subdir: options.subdir,
          focus: options.focus,
          audience: options.audience,
          maxFiles: options.maxFiles,
        },
      },
    },
  };
}

async function fields(page: Page, options: typeof requested) {
  for (const key of ["branch", "subdir", "focus", "audience", "maxFiles"] as const) {
    await expect(page.locator("#" + key)).toHaveValue(String(options[key]));
  }
}

async function routes(
  page: Page,
  options: typeof requested,
  legacy = false,
  delayed?: "fetch" | "json"
) {
  let streams = 0;
  const submissions: any[] = [];
  await page.route("http://localhost/", (route) =>
    route.fulfill({ contentType: "text/html", body: getIndexHtml() })
  );
  await page.route("**/api/analyze", (route) => {
    submissions.push(route.request().postDataJSON());
    return route.fulfill({ json: { jobId: "owned-job" } });
  });
  await page.route("**/api/jobs/owned-job", (route) =>
    route.fulfill({
      json: {
        id: "owned-job",
        repoUrl,
        subdir: options.subdir,
        status: "running",
        startedAt: Date.now(),
        ...(legacy ? {} : { options }),
      },
    })
  );
  await page.route("**/stream", (route) => {
    streams++;
    return route.fulfill({
      contentType: "text/event-stream",
      body:
        "data: " +
        JSON.stringify(
          streams === 1
            ? { type: "phase", phase: "clone", message: "Owned clone pending" }
            : complete(options)
        ) +
        "\n\n",
    });
  });
  if (delayed) {
    await page.addInitScript(
      ({ mode }) => {
        localStorage.setItem("repo-bootcamp-job-id", "owned-job");
        const native = window.fetch.bind(window);
        let release!: () => void;
        const gate = new Promise<void>((resolve) => {
          release = resolve;
        });
        (window as any).releaseRestore = release;
        window.fetch = async (...args) => {
          const response = await native(...args);
          if (String(args[0]) !== "/api/jobs/owned-job") return response;
          if (mode === "fetch") {
            (window as any).restoreReady = true;
            await gate;
            setTimeout(() => {
              (window as any).restoreSettled = true;
            }, 0);
          } else {
            const json = response.json.bind(response);
            response.json = async () => {
              const value = await json();
              (window as any).restoreReady = true;
              await gate;
              setTimeout(() => {
                (window as any).restoreSettled = true;
              }, 0);
              return value;
            };
          }
          return response;
        };
      },
      { mode: delayed }
    );
  }
  await page.goto("http://localhost/");
  return { submissions, streamCount: () => streams };
}

for (const branch of ["feature/app", "release/v2.0", ""]) {
  test(`active ${branch || "default root"} reload preserves copied command and actual rerun selections`, async ({
    page,
    context,
  }) => {
    const options = branch ? { ...requested, branch } : defaults;
    const { submissions } = await routes(page, options);
    await page.locator("#repoUrl").fill(repoUrl);
    await page.getByText("Run options", { exact: true }).click();
    for (const key of ["branch", "subdir", "maxFiles"] as const)
      await page.locator("#" + key).fill(String(options[key]));
    for (const key of ["focus", "audience"] as const)
      await page.locator("#" + key).selectOption(options[key]);
    await page.getByRole("button", { name: "Analyze", exact: true }).click();
    await expect(page.locator("#progressItems")).toContainText("Owned clone pending");
    await page.reload();
    await expect(page.locator("#results")).toHaveClass("results show");
    await fields(page, options);
    const command =
      "bootcamp " +
      repoUrl +
      (branch
        ? ` --branch ${branch} --subdir 'packages/app' --focus architecture --audience frontend --max-files 37`
        : "");
    await expect(page.locator("#cliCommand")).toHaveText(command);
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.getByRole("button", { name: "Copy", exact: true }).click();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(command);
    expect(await page.evaluate(() => localStorage.getItem("repo-bootcamp-job-id"))).toBeNull();
    await page.getByRole("button", { name: "Analyze", exact: true }).click();
    await expect.poll(() => submissions.length).toBe(2);
    expect(submissions.map((body) => body.options)).toEqual([
      { ...options, format: "markdown" },
      { ...options, format: "markdown" },
    ]);
  });
}

test("legacy status retains subdir and defaults without inferring a tag from HEAD", async ({
  page,
}) => {
  await routes(page, { ...requested, branch: "release/v2.0" }, true);
  await page.locator("#repoUrl").fill(repoUrl);
  await page.getByRole("button", { name: "Analyze", exact: true }).click();
  await expect(page.locator("#progressItems")).toContainText("Owned clone pending");
  await page.reload();
  await expect(page.locator("#results")).toHaveClass("results show");
  await fields(page, { ...defaults, subdir: requested.subdir });
  await expect(page.locator("#cliCommand")).not.toContainText("--branch");
});

for (const mode of ["fetch", "json"] as const) {
  for (const field of ["branch", "subdir", "focus", "audience", "maxFiles"] as const) {
    test(`late ${mode} restoration cannot overwrite an edited ${field}`, async ({ page }) => {
      const { streamCount } = await routes(page, requested, false, mode);
      await page.waitForFunction(() => (window as any).restoreReady);
      await page.getByText("Run options", { exact: true }).click();
      const value =
        field === "focus"
          ? "contributing"
          : field === "audience"
            ? "sre"
            : field === "maxFiles"
              ? "88"
              : "new-draft";
      if (field === "focus" || field === "audience")
        await page.locator("#" + field).selectOption(value);
      else await page.locator("#" + field).fill(value);
      await page.evaluate(() => (window as any).releaseRestore());
      await page.waitForFunction(() => (window as any).restoreSettled);
      await expect(page.locator("#" + field)).toHaveValue(value);
      await expect(page.locator("#repoUrl")).toHaveValue("");
      await expect(page.locator("#emptyState")).toBeVisible();
      expect(streamCount()).toBe(0);
    });
  }
}

for (const mode of ["fetch", "json"] as const) {
  test(`late ${mode} restore leaves a newer run's URL and options snapshot intact`, async ({
    page,
  }) => {
    const { submissions } = await routes(page, requested, false, mode);
    await page.waitForFunction(() => (window as any).restoreReady);
    await page.route("**/stream", (route) =>
      route.fulfill({
        contentType: "text/event-stream",
        body: "data: " + JSON.stringify(complete(defaults)) + "\n\n",
      })
    );
    const draftUrl = "https://github.com/fixture/new-repository";
    await page.locator("#repoUrl").fill(draftUrl);
    await page.getByRole("button", { name: "Analyze", exact: true }).click();
    await expect(page.locator("#results")).toHaveClass("results show");
    await page.evaluate(() => (window as any).releaseRestore());
    await page.waitForFunction(() => (window as any).restoreSettled);
    await fields(page, defaults);
    await expect(page.locator("#repoUrl")).toHaveValue(draftUrl);
    await expect(page.locator("#cliCommand")).toHaveText("bootcamp " + draftUrl);
    expect(submissions).toEqual([
      { repoUrl: draftUrl, options: { ...defaults, format: "markdown" } },
    ]);
  });
}

for (const editDuringRun of [false, true]) {
  test(`a repository draft edit ${editDuringRun ? "during" : "after"} analysis cannot change its displayed or copied handoff`, async ({
    page,
    context,
  }) => {
    const { submissions } = await routes(page, defaults);
    await page.locator("#repoUrl").fill(repoUrl);
    await page.getByRole("button", { name: "Analyze", exact: true }).click();
    await expect(page.locator("#progressItems")).toContainText("Owned clone pending");
    const draftUrl = "https://github.com/fixture/next-repo";
    if (editDuringRun) await page.locator("#repoUrl").fill(draftUrl);
    // Release the same current job through its existing status recovery, without
    // a page reload that would intentionally discard an unsent draft.
    await page.route("**/api/jobs/owned-job", (route) =>
      route.fulfill({
        json: {
          id: "owned-job",
          repoUrl,
          status: "complete",
          progress: [],
          result: complete(defaults).data,
        },
      })
    );
    await expect(page.locator("#results")).toHaveClass("results show");
    if (!editDuringRun) await page.locator("#repoUrl").fill(draftUrl);
    await expect(page.locator("#cliCommand")).toHaveText("bootcamp " + repoUrl);
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.getByRole("button", { name: "Copy", exact: true }).click();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("bootcamp " + repoUrl);
    await expect(page.locator("#repoUrl")).toHaveValue(draftUrl);
    await page.getByRole("button", { name: "Analyze", exact: true }).click();
    await expect.poll(() => submissions.length).toBe(2);
    expect(submissions[1].repoUrl).toBe(draftUrl);
    await expect(page.locator("#cliCommand")).toHaveText("bootcamp " + draftUrl);
  });
}

test("malformed optional restoration fields fall back safely without exposing extra options", async ({
  page,
}) => {
  await routes(page, defaults);
  await page.locator("#repoUrl").fill(repoUrl);
  await page.getByRole("button", { name: "Analyze", exact: true }).click();
  await expect(page.locator("#progressItems")).toContainText("Owned clone pending");
  await page.route("**/api/jobs/owned-job", (route) =>
    route.fulfill({
      json: {
        id: "owned-job",
        repoUrl,
        status: "running",
        subdir: "packages/app",
        options: {
          branch: 12,
          subdir: {},
          focus: "invalid",
          audience: [],
          maxFiles: "invalid",
          model: "not-exposed",
          fullClone: true,
        },
      },
    })
  );
  await page.reload();
  await expect(page.locator("#results")).toHaveClass("results show");
  await fields(page, { ...defaults, subdir: "packages/app" });
  await expect(page.locator("#cliCommand")).not.toContainText("not-exposed");
});
