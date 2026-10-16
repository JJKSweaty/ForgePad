import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";

const modifier = process.platform === "darwin" ? "Meta" : "Control";
test("Practice explains the next step, uses readable neutral surfaces, and closes from the upper left", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/");
  await page
    .getByRole("navigation", { name: "Main navigation" })
    .getByRole("button", { name: "Practice", exact: true })
    .click();
  await expect(
    page.getByRole("region", { name: "How practice works" }),
  ).toContainText("Submit & review");
  const close = await page
    .getByRole("button", { name: "Hide sidebar" })
    .boundingBox();
  expect(close!.x).toBeLessThan(60);
  expect(close!.y).toBeLessThan(80);
  for (const theme of ["light", "dark"]) {
    if (theme === "dark")
      await page.getByRole("button", { name: "Use dark appearance" }).click();
    const contrast = await page.evaluate(() => {
      const style = getComputedStyle(document.documentElement);
      const rgb = (token: string) =>
        style
          .getPropertyValue(token)
          .trim()
          .replace("#", "")
          .match(/.{2}/g)!
          .map((part) => parseInt(part, 16) / 255);
      const luminance = (token: string) =>
        rgb(token)
          .map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
          .reduce(
            (sum, value, index) =>
              sum + value * [0.2126, 0.7152, 0.0722][index],
            0,
          );
      const a = luminance("--muted"),
        b = luminance("--bg");
      const neutral = rgb("--bg");
      return {
        ratio: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05),
        tint: Math.max(...neutral) - Math.min(...neutral),
      };
    });
    expect(contrast.ratio).toBeGreaterThanOrEqual(4.5);
    expect(contrast.tint).toBe(0);
    await page.screenshot({
      path: testInfo.outputPath(`practice-${theme}.png`),
      fullPage: true,
    });
  }
});
async function openEditor(page: Page) {
  await page.goto("/");
  await page
    .getByRole("navigation", { name: "Main navigation" })
    .getByRole("button", { name: "Practice", exact: true })
    .click();
  await page
    .locator(".question-card")
    .filter({ hasText: "Checked alignment for DMA buffers" })
    .locator(".question-link")
    .click();
  await expect(
    page.locator(".monaco-editor textarea.inputarea"),
  ).toBeAttached();
}
async function replaceCode(page: Page, code: string) {
  const input = page.locator(".monaco-editor textarea.inputarea");
  await input.focus();
  await input.press(`${modifier}+A`);
  await page.keyboard.insertText(code);
}
async function reopenEditor(page: Page) {
  await page.reload();
  const showSidebar = page.getByRole("button", { name: "Show sidebar" });
  if (await showSidebar.count()) await showSidebar.click();
  await page
    .getByRole("navigation", { name: "Main navigation" })
    .getByRole("button", { name: "Practice", exact: true })
    .click();
  await page
    .getByRole("navigation", { name: "Practice modes" })
    .getByRole("button", { name: "Code workspace" })
    .click();
  await expect(
    page.locator(".monaco-editor textarea.inputarea"),
  ).toBeAttached();
}

test("C autocomplete offers unopened-header identifiers and inserts function snippets", async ({
  page,
}) => {
  await openEditor(page);
  await replaceCode(page, '#include "exercise.h"\nvoid demo(void) {\n    ');
  await page.keyboard.type("ali", { delay: 50 });
  const suggestions = page.locator(".suggest-widget.visible");
  await expect(suggestions).toBeVisible();
  await expect(suggestions).toContainText("align_up");
  await page.keyboard.press("Tab");
  await expect(page.locator(".view-lines")).toContainText("align_up");
  await page.keyboard.insertText(";\n    pri");
  await page.getByRole("button", { name: "Autocomplete", exact: true }).click();
  await expect(suggestions).toBeVisible();
  await expect(suggestions).toContainText("printf");
  await expect(page.locator(".monaco-editor textarea.inputarea")).toBeFocused();
  await expect(suggestions.locator(".monaco-list-row.focused")).toContainText(
    "printf",
  );
  await page.keyboard.press("Tab");
  await expect(page.locator(".view-lines")).toContainText(
    'printf("%s\\n", value)',
  );
  await page.keyboard.press("Escape");
});

test("layout resizes by pointer and keyboard, persists, and fits a narrow screen", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await openEditor(page);
  const divider = page.getByRole("separator", { name: "Resize problem pane" });
  const before = await divider.getAttribute("aria-valuenow");
  const bounds = (await divider.boundingBox())!;
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + 100);
  await page.mouse.down();
  await page.mouse.move(bounds.x + 100, bounds.y + 100);
  await page.mouse.up();
  await expect(divider).not.toHaveAttribute("aria-valuenow", before!);
  await divider.press("Home");
  await expect(divider).toHaveAttribute("aria-valuenow", "25");
  await divider.press("ArrowRight");
  await page.getByRole("button", { name: "Hide problem", exact: true }).click();
  await expect(
    page.getByRole("region", { name: "Problem panel" }),
  ).toBeHidden();
  await page.getByRole("button", { name: "Hide sidebar", exact: true }).click();
  await expect(
    page.getByRole("navigation", { name: "Main navigation" }),
  ).toBeHidden();
  await page.screenshot({
    path: testInfo.outputPath("editor-wide.png"),
    fullPage: true,
  });
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Show sidebar" }),
  ).toBeVisible();
  await reopenEditor(page);
  await expect(
    page.getByRole("button", { name: "Show problem" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Show problem" }).click();
  await expect(divider).toHaveAttribute("aria-valuenow", "27");
  await page.getByRole("button", { name: "Use dark appearance" }).click();
  await page.getByRole("button", { name: "Hide sidebar" }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(divider).toBeHidden();
  await expect(
    page.getByRole("button", { name: "Run public tests" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("editor-narrow-dark.png"),
    fullPage: true,
  });
});

test("autosaved drafts reopen and checkpoints restore independently with keyboard-safe dialogs", async ({
  page,
}) => {
  await openEditor(page);
  await replaceCode(page, "int checkpoint_value;\n");
  await page
    .getByRole("button", { name: "Save checkpoint", exact: true })
    .click();
  await expect(page.getByText(/^Checkpoint saved:/)).toBeVisible();
  await replaceCode(page, "int autosaved_value;\n");
  await expect
    .poll(
      async () =>
        (await (await page.request.get("/api/drafts/align-up")).json()).files[
          "exercise.c"
        ],
    )
    .toBe("int autosaved_value;\n");
  await reopenEditor(page);
  await expect(page.locator(".view-lines")).toContainText("autosaved_value");
  const restore = page.getByRole("button", {
    name: "Restore saved checkpoint",
  });
  await restore.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(restore).toBeFocused();
  await restore.click();
  await dialog
    .getByRole("button", { name: "Restore checkpoint to draft" })
    .click();
  await expect(page.locator(".view-lines")).toContainText("checkpoint_value");
  await page.getByRole("button", { name: "Reset to starter files" }).click();
  await dialog
    .getByRole("button", { name: "Reset draft to starter files" })
    .click();
  await expect(page.locator(".view-lines")).toContainText(
    "Implement the declared function",
  );
});

test("execution feedback links compiler locations and clears stale editor markers", async ({
  page,
}) => {
  let mode = "";
  let polls = 0;
  await page.route("**/api/runs{,/**}", async (route) => {
    if (route.request().method() === "POST") {
      mode = route.request().postDataJSON().mode;
      polls = 0;
      await route.fulfill({ json: { id: "diagnostic-run", status: "queued" } });
    } else if (++polls === 1) {
      await route.fulfill({
        json: { id: "diagnostic-run", status: "running" },
      });
    } else {
      await route.fulfill({
        json: {
          id: "diagnostic-run",
          status: "complete",
          result: {
            status: "compile_error",
            passed: 0,
            total: 3,
            tests: [],
            compiler_output:
              "/workspace/exercise.h:3:6: error: expected semicolon",
          },
        },
      });
    }
  });
  await openEditor(page);
  await page.getByRole("button", { name: "Run public tests" }).click();
  await expect(
    page.getByRole("progressbar", { name: "Test execution in progress" }),
  ).toBeVisible();
  const diagnostic = page.getByRole("button", {
    name: /exercise.h:3:6.*expected semicolon/,
  });
  await expect(diagnostic).toBeVisible();
  expect(mode).toBe("run");
  await diagnostic.click();
  await expect(
    page.getByRole("tab", { name: "exercise.h", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(page.locator(".squiggly-error").first()).toBeVisible();
  await page.keyboard.press("Home");
  await page.keyboard.insertText("// diagnostic location\n");
  await expect(
    page.getByText(/Code changed since these results/),
  ).toBeVisible();
  await expect(diagnostic).toBeDisabled();
  await expect(page.locator(".squiggly-error")).toHaveCount(0);
  await expect
    .poll(
      async () =>
        (await (await page.request.get("/api/drafts/align-up")).json()).files[
          "exercise.h"
        ].split("\n")[2],
    )
    .toBe("// diagnostic location");
  await page.getByRole("button", { name: "Submit all tests" }).click();
  await expect(page.getByRole("progressbar")).toBeVisible();
  await expect.poll(() => mode).toBe("submit");
  await expect(diagnostic).toBeEnabled();
});
