import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { markdownToHtml } from "../../src/formatter.js";
import { markdownCodeBlock, markdownCodeSpan } from "../../src/markdown-code.js";
import { getIndexHtml } from "../../src/web/templates.js";

const names = [
  "test unit",
  "test  unit",
  "test\tunit",
  "test\nunit",
  "test`unit",
  "test " + "long-part-".repeat(28),
];
const commands = names.map((name) => ({
  name,
  command: `npm run '${name}'`,
  source: "package.json",
}));
const guide =
  "# Literal commands\n\n" +
  commands.map(({ command }) => markdownCodeBlock(command, "sh")).join("\n\n") +
  "\n\n## Inline commands\n\n" +
  commands
    .filter(({ command }) => !command.includes("\n"))
    .map(({ command }) => markdownCodeSpan(command))
    .join("\n\n");

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (text: string) => {
          (window as unknown as { copied: string }).copied = text;
        },
      },
    });
  });
  await page.route("http://bootcamp.test/", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: getIndexHtml("command-nonce"),
      headers: {
        "Content-Security-Policy":
          "default-src 'self'; script-src 'self' 'nonce-command-nonce'; style-src 'self' 'nonce-command-nonce'; style-src-attr 'none'",
      },
    })
  );
  await page.route("**/files/**", (route) =>
    route.fulfill({ json: { content: guide, html: markdownToHtml(guide) } })
  );
  await page.goto("http://bootcamp.test/");
});

test("First commands visibly distinguish literal arguments and copy the same payload without overflow", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.evaluate((values) => {
    document.getElementById("results")!.classList.add("show");
    // Exercise the application renderer rather than handcrafted command DOM.
    (
      window as unknown as { renderQuickstartCommands: (commands: typeof values) => number }
    ).renderQuickstartCommands(values);
  }, commands);
  const codes = page.locator("#quickstartCommands code");
  await expect(codes).toHaveCount(commands.length);
  for (let i = 0; i < commands.length; i++) {
    expect(await codes.nth(i).textContent()).toBe(commands[i].command);
    expect(await codes.nth(i).innerText()).toBe(commands[i].command);
    expect(await page.locator(".quickstart-name").nth(i).innerText()).toBe(commands[i].name);
    await page.locator("#quickstartCommands button").nth(i).click();
    await expect
      .poll(() => page.evaluate(() => (window as unknown as { copied: string }).copied))
      .toBe(commands[i].command);
  }
  // The terminal handoff uses a separate code surface and must also remain literal.
  await page.locator("#cliCommand").evaluate((el, value) => {
    el.textContent = value;
  }, "bootcamp https://github.com/fixture/repo --branch 'test  unit'");
  expect(await page.locator("#cliCommand").innerText()).toBe(
    "bootcamp https://github.com/fixture/repo --branch 'test  unit'"
  );
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});

test("inline reader commands preserve spacing while fences, Source, Copy and Download retain exact bytes", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.evaluate("currentJobId = 'commands'; viewFile('ONBOARDING.md')");
  await expect(page.locator("#renderedContent h1")).toHaveText("Literal commands");
  const fences = page.locator("#renderedContent pre code");
  for (let i = 0; i < commands.length; i++) {
    expect(await fences.nth(i).textContent()).toBe(commands[i].command);
    expect(await fences.nth(i).innerText()).toBe(commands[i].command);
  }
  const inline = page.locator("#renderedContent :not(pre) > code");
  const inlineCommands = commands.filter(({ command }) => !command.includes("\n"));
  await expect(inline).toHaveCount(inlineCommands.length);
  for (let i = 0; i < inlineCommands.length; i++)
    expect(await inline.nth(i).innerText()).toBe(inlineCommands[i].command);
  await expect(page.locator("#renderedContent pre").first()).toHaveAttribute("tabindex", "0");
  expect(
    await page
      .locator("#renderedContent pre")
      .first()
      .evaluate((el) => getComputedStyle(el).overflowX)
  ).toBe("auto");
  expect(
    await page
      .locator("#renderedContent pre")
      .first()
      .evaluate((el) => getComputedStyle(el).whiteSpace)
  ).toBe("pre-wrap");
  expect(await page.locator("#modal").evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(
    true
  );
  await page.getByRole("button", { name: "Source", exact: true }).click();
  expect(await page.locator("#modalContent").textContent()).toBe(guide);
  expect(await page.locator("#modalContent").innerText()).toBe(guide);
  await page.getByRole("button", { name: "Copy", exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { copied: string }).copied))
    .toBe(guide);
  const downloaded = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download", exact: true }).click();
  const download = await downloaded;
  expect(download.suggestedFilename()).toBe("ONBOARDING.md");
  expect(await readFile((await download.path())!, "utf8")).toBe(guide);
  await page.keyboard.press("Escape");
  await expect(page.locator("#modal")).toBeHidden();
  expect(errors).toEqual([]);
});

test("full namespaced and long labels fit readable rows with compact ordinary commands and keyboard Copy", async ({
  page,
}) => {
  const labels = [
    "test:integration:database:migrations:rollback:sqlite",
    "test:integration:database:migrations:rollback:sqlite:" + "tenant-".repeat(7),
    names.at(-1)!,
    "test unit",
  ];
  const values = labels.map((name) => ({
    name,
    command: `npm run '${name}'`,
    source: "package.json",
  }));
  await page.evaluate((values) => {
    document.getElementById("results")!.classList.add("show");
    (
      window as unknown as { renderQuickstartCommands: (commands: typeof values) => number }
    ).renderQuickstartCommands(values);
  }, values);
  for (let i = 0; i < values.length; i++) {
    const row = page.locator(".quickstart-item").nth(i);
    expect(await row.locator(".quickstart-name").innerText()).toBe(values[i].name);
    expect(await row.locator("code").innerText()).toBe(values[i].command);
    const size = await row.evaluate((el) => ({
      width: el.clientWidth,
      scrollWidth: el.scrollWidth,
      height: el.clientHeight,
      copyWidth: el.querySelector("button")!.getBoundingClientRect().width,
    }));
    expect(size.scrollWidth).toBeLessThanOrEqual(size.width);
    expect(size.height).toBeLessThan(i === 2 ? 350 : 180);
    expect(size.copyWidth).toBeLessThan(90);
    const button = row.getByRole("button");
    await button.focus();
    await page.keyboard.press("Enter");
    await expect
      .poll(() => page.evaluate(() => (window as unknown as { copied: string }).copied))
      .toBe(values[i].command);
  }
  expect(
    await page
      .locator(".quickstart-item")
      .last()
      .evaluate((el) => el.clientHeight)
  ).toBeLessThan(80);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
