import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const question = JSON.parse(
  readFileSync(resolve("../questions/align-up.json"), "utf8"),
);

test("code edits survive navigation, execute in Docker, and update progress", async ({
  page,
}, testInfo) => {
  await page.goto("/");
  await page
    .getByRole("navigation", { name: "Main navigation" })
    .getByRole("button", { name: "Practice", exact: true })
    .click();
  const card = page.locator(".library-row").filter({ hasText: question.title });
  await card.locator(".row-open-target").click();
  await expect(
    page.getByRole("tablist", { name: "Source files" }),
  ).toBeVisible();
  const name = Object.keys(question.reference_solution).find(
    (name) => !name.endsWith(".h"),
  )!;
  await page.getByRole("tab", { name, exact: true }).click();
  const input = page.locator(".monaco-editor textarea.inputarea");
  await input.focus();
  await input.press(process.platform === "darwin" ? "Meta+A" : "Control+A");
  await page.keyboard.insertText(question.reference_solution[name]);
  await page
    .getByRole("button", { name: "Submit all tests", exact: true })
    .click();
  const output = page.getByRole("region", { name: "Execution output" });
  await expect(output).toContainText("8 / 8 tests passed", { timeout: 90000 });
  await page
    .getByRole("navigation", { name: "Main navigation" })
    .getByRole("button", { name: "Dashboard", exact: true })
    .click();
  await expect(page.locator(".metric-strip")).toContainText(
    "Questions completed",
  );
  await expect(
    page.locator(".metric-strip .dashboard-metric").first(),
  ).toContainText("1");
  await page.screenshot({
    path: testInfo.outputPath("dashboard-after-submit.png"),
    fullPage: true,
  });
  await page.reload();
  await expect(
    page.locator(".metric-strip .dashboard-metric").first(),
  ).toContainText("1");
  await page
    .getByRole("navigation", { name: "Main navigation" })
    .getByRole("button", { name: "Progress", exact: true })
    .click();
  await expect(
    page.getByRole("region", { name: "Learning summary" }),
  ).toContainText("Questions completed");
  await page.screenshot({
    path: testInfo.outputPath("progress-after-submit.png"),
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Review", exact: true })
    .first()
    .click();
  const detail = page.getByRole("dialog");
  await expect(detail).toContainText("Version 1");
  await expect(detail).toContainText(question.reference_solution[name]);
  await expect(detail).toContainText("Deterministic test results");
  await detail
    .getByRole("button", { name: "Practice this version again" })
    .click();
  await expect(page.locator(".monaco-editor")).toContainText("align_up");
  await page
    .getByRole("button", { name: "Run all tests", exact: true })
    .click();
  await expect(output.locator(".badge").first()).toHaveText("passed", {
    timeout: 90000,
  });
  // A failed retry must preserve the earlier passing submission.
  const retry = page.locator(".monaco-editor textarea.inputarea");
  await retry.focus();
  await retry.press(process.platform === "darwin" ? "Meta+A" : "Control+A");
  await page.keyboard.insertText("this is deliberately invalid C;");
  await page
    .getByRole("button", { name: "Submit all tests", exact: true })
    .click();
  await expect(output).toContainText("compilation error", { timeout: 90000 });
  await page
    .getByRole("navigation", { name: "Main navigation" })
    .getByRole("button", { name: "Practice", exact: true })
    .click();
  const saved = page
    .locator(".library-row")
    .filter({ hasText: question.title });
  await expect(saved).toContainText("Needs review");
  await expect(saved).toContainText("Practice again");
  await page
    .getByRole("navigation", { name: "Main navigation" })
    .getByRole("button", { name: "Progress", exact: true })
    .click();
  await expect(
    page.locator(".history-table tbody tr").filter({ hasText: question.title }),
  ).toHaveCount(2);
  await expect(
    page
      .getByRole("region", { name: "Learning summary" })
      .locator(".metric")
      .nth(2),
  ).toContainText("1");
  await page.reload();
  await page
    .getByRole("navigation", { name: "Main navigation" })
    .getByRole("button", { name: "Progress", exact: true })
    .click();
  await expect(
    page.locator(".history-table tbody tr").filter({ hasText: question.title }),
  ).toHaveCount(2);
});

test("written practice stays out of the code editor and survives reopening", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("navigation", { name: "Main navigation" })
    .getByRole("button", { name: "Practice", exact: true })
    .click();
  await page.getByLabel("Question type").selectOption("design");
  await page
    .locator(".library-row")
    .first()
    .locator(".row-open-target")
    .click();
  await expect(page.locator(".monaco-editor")).toHaveCount(0);
  await page
    .getByRole("textbox", { name: "Written response" })
    .fill(
      "Use a bounded queue. Define ownership and backpressure. Test overflow, recovery, and concurrent access.",
    );
  await page
    .getByRole("button", { name: "Submit response", exact: true })
    .click();
  await expect(
    page.getByText("Response submitted", { exact: true }),
  ).toBeVisible();
  await page.reload();
  await page
    .getByRole("navigation", { name: "Main navigation" })
    .getByRole("button", { name: "Practice", exact: true })
    .click();
  await page.getByLabel("Question type").selectOption("design");
  await page
    .locator(".library-row")
    .first()
    .locator(".row-open-target")
    .click();
  await expect(
    page.getByRole("textbox", { name: "Written response" }),
  ).toHaveValue(/bounded queue/);
});

test("guided interview supports pausing, responses, finishing, and replay", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("navigation", { name: "Main navigation" })
    .getByRole("button", { name: "Practice", exact: true })
    .click();
  await page
    .getByRole("navigation", { name: "Practice modes" })
    .getByRole("button", { name: "Mock Interview" })
    .click();
  await page
    .getByRole("combobox", { name: "Question", exact: true })
    .selectOption("sensor-pipeline");
  await page
    .getByRole("button", { name: "Start session", exact: true })
    .click();
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await expect(
    page.getByRole("textbox", { name: "Interview response" }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Resume", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Interview response" })
    .fill(
      "I would clarify sample rate and latency before choosing buffer ownership.",
    );
  await page.getByRole("button", { name: "Send response" }).click();
  await expect(page.locator(".transcript")).toContainText(
    "clarify sample rate",
  );
  await page
    .getByRole("button", { name: "Finish session", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Finish session", exact: true })
    .click();
  await page.getByRole("tab", { name: "Session replay" }).click();
  await expect(
    page.getByRole("heading", { name: "Session replay" }),
  ).toBeVisible();
  await expect(
    page.getByRole("slider", { name: "Replay position" }),
  ).toBeVisible();
  await page.getByRole("slider", { name: "Replay position" }).press("Home");
  await expect(page.locator(".replay-panel")).toContainText(/session|started/i);
});

test("goals link to filtered practice, library controls stay independent, and reset lives in Settings", async ({
  page,
}, testInfo) => {
  await page.goto("/");
  const nav = page.getByRole("navigation", { name: "Main navigation" });
  await nav.getByRole("button", { name: "Progress", exact: true }).click();
  await page.getByLabel("New practice goal").fill("Review DMA ownership");
  await page.getByRole("button", { name: "Add goal", exact: true }).click();
  await page
    .getByRole("button", { name: "Edit goal Review DMA ownership" })
    .click();
  const dialog = page.getByRole("dialog");
  await dialog
    .getByLabel("Goal", { exact: true })
    .fill("Review DMA boundaries");
  await dialog.getByLabel("Linked topic").selectOption("DMA");
  await dialog.getByRole("button", { name: "Save goal" }).click();
  await expect(dialog).toHaveCount(0);
  await page
    .locator(".goal-row")
    .filter({ hasText: "Review DMA boundaries" })
    .getByRole("button", { name: "DMA", exact: true })
    .click();
  await expect(page.getByLabel("Topic", { exact: true })).toHaveValue("DMA");
  await expect(page.locator(".library-row").first()).toBeVisible();
  const first = page.locator(".library-row").first();
  await first.getByRole("button", { name: /^Bookmark / }).click();
  await expect(
    page.getByRole("heading", { name: "Question Library" }),
  ).toBeVisible();
  await first.getByRole("button", { name: /^Actions for / }).click();
  await page.getByRole("button", { name: "Archive", exact: true }).click();
  await page.getByLabel("Show archived", { exact: true }).check();
  const archived = page.locator(".library-row.archived").first();
  await archived.getByRole("button", { name: /^Actions for / }).click();
  await page.getByRole("button", { name: "Unarchive", exact: true }).click();
  await page.getByRole("button", { name: "Clear filters" }).click();
  await page.keyboard.press("/");
  await expect(
    page.getByRole("textbox", { name: "Search questions" }),
  ).toBeFocused();
  await page
    .getByRole("textbox", { name: "Search questions" })
    .fill("wrapping packet");
  await expect(page.locator(".library-row")).toHaveCount(1);
  await page.setViewportSize({ width: 760, height: 900 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("library-small-laptop.png"),
    fullPage: true,
  });
  await nav.getByRole("button", { name: "Progress", exact: true }).click();
  await page.getByRole("checkbox", { name: "Review DMA boundaries" }).check();
  await page
    .getByRole("button", { name: "Delete goal Review DMA boundaries" })
    .click();
  await expect(
    page.locator(".goal-row").filter({ hasText: "Review DMA boundaries" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Reset Practice Data", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page
    .getByRole("button", { name: "Data Management", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Reset Practice Data", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toContainText("permanently deletes");
  await expect(
    page.getByRole("button", { name: "Delete practice data", exact: true }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
});
