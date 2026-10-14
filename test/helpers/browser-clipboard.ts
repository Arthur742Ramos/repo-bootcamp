import type { Page } from "@playwright/test";

/** Keep clipboard payload checks inside the disposable page, never the OS clipboard. */
export async function useMemoryClipboard(page: Page): Promise<void> {
  await page.addInitScript(() => {
    let copied = "";
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (text: string) => {
          copied = text;
        },
        readText: async () => copied,
      },
    });
  });
}
