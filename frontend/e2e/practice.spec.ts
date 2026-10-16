import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const question = JSON.parse(
  readFileSync(resolve("../questions/align-up.json"), "utf8"),
);

test("code edits survive navigation, execute in Docker, and update progress", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("navigation", { name: "Main navigation" })
    .getByRole("button", { name: "Practice", exact: true })
    .click();
  const card = page
    .locator(".question-card")
    .filter({ hasText: question.title });
  await card.locator(".question-link").click();
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
  await expect(page.locator(".metric-strip")).toContainText("Questions solved");
  await expect(
    page.locator(".metric-strip .dashboard-metric").first(),
  ).toContainText("1");
  await page.reload();
  await expect(
    page.locator(".metric-strip .dashboard-metric").first(),
  ).toContainText("1");
  await page
    .getByRole("button", { name: /Continue|Resume draft/ })
    .first()
    .click();
  await expect(page.locator(".monaco-editor")).toContainText("align_up");
  await page
    .getByRole("button", { name: "Run public tests", exact: true })
    .click();
  await expect(output.locator(".badge").first()).toHaveText("passed", {
    timeout: 90000,
  });
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
    .locator(".question-card")
    .first()
    .locator(".question-link")
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
    .locator(".question-card")
    .first()
    .locator(".question-link")
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
