import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import { readFileSync } from "node:fs";

async function openQuestion(page: Page, type: string, title?: string) {
  await page.goto("/");
  await page
    .getByRole("navigation", { name: "Main navigation" })
    .getByRole("button", { name: "Practice", exact: true })
    .click();
  await page.getByLabel("Question type").selectOption(type);
  const rows = page.locator(".library-row");
  await (title ? rows.filter({ hasText: title }) : rows)
    .first()
    .locator(".row-open-target")
    .click();
  await expect(page.locator(".practice-page")).toBeVisible();
}
async function noDocumentOverflow(page: Page) {
  const overflow = await page.evaluate(() => ({
    width: document.documentElement.scrollWidth,
    height: document.documentElement.scrollHeight,
    w: innerWidth,
    h: innerHeight,
  }));
  expect(overflow.width, JSON.stringify(overflow)).toBeLessThanOrEqual(
    overflow.w + 1,
  );
  expect(overflow.height, JSON.stringify(overflow)).toBeLessThanOrEqual(
    overflow.h + 1,
  );
}

test("studios keep primary actions and editors in the viewport across modes and sizes", async ({
  page,
}, testInfo) => {
  const investigation = JSON.parse(
    readFileSync(
      new URL("../../questions/dma-cache.json", import.meta.url),
      "utf8",
    ),
  );
  Object.assign(investigation, {
    id: "qa-studio-investigation",
    type: "code_review",
    title: "QA investigation workspace",
    prompt:
      investigation.prompt +
      "\n\n" +
      "Review the evidence and explain your reasoning. ".repeat(150),
  });
  investigation.follow_ups.push(
    "Which observation would disprove the leading hypothesis?",
  );
  const validation = await page.request.post("/api/imports/validate", {
    data: { question: investigation },
  });
  expect(validation.ok(), await validation.text()).toBe(true);
  const validated = await validation.json();
  expect(validated.valid, JSON.stringify(validated.errors)).toBe(true);
  expect(
    (
      await page.request.post("/api/imports/publish", {
        data: { token: validated.token },
      })
    ).ok(),
  ).toBe(true);
  for (const [type, title] of [
    ["coding", "Checked alignment"],
    ["theory", "DMA"],
    ["design", "sensor"],
    ["code_review", "QA investigation"],
  ]) {
    await openQuestion(page, type, title);
    for (const theme of ["light", "dark"]) {
      const toggle = page.getByRole("button", {
        name: `Use ${theme} appearance`,
      });
      if (await toggle.count()) await toggle.click();
      for (const viewport of [
        { width: 1440, height: 900 },
        { width: 1280, height: 720 },
        { width: 1024, height: 600 },
        { width: 390, height: 844 },
      ]) {
        await page.setViewportSize(viewport);
        const actions = page.getByRole("button", {
          name: type === "coding" ? "Run all tests" : "Submit response",
          exact: true,
        });
        await expect(actions).toBeInViewport();
        await expect(
          page.getByRole("button", { name: "Save checkpoint", exact: true }),
        ).toBeInViewport();
        await noDocumentOverflow(page);
        if (type !== "coding")
          await expect(
            page.getByRole("button", { name: "Speak your answer" }),
          ).toBeInViewport();
        if (
          await page
            .getByRole("tablist", { name: "Practice panes" })
            .isVisible()
        ) {
          const panes = page.getByRole("tablist", { name: "Practice panes" });
          await panes
            .getByRole("tab", { name: "Problem", exact: true })
            .click();
          await expect(
            page.getByRole("region", { name: "Problem panel" }),
          ).toBeInViewport();
          await page.locator(".problem-content").evaluate((e) => {
            e.scrollTop = e.scrollHeight;
          });
          await noDocumentOverflow(page);
          await expect(actions).toBeInViewport();
          await panes
            .getByRole("tab", { name: "Workspace", exact: true })
            .click();
        } else {
          await page.locator(".problem-content").evaluate((e) => {
            e.scrollTop = e.scrollHeight;
          });
          await expect(actions).toBeInViewport();
        }
        await expect(
          type === "coding"
            ? page.locator(".editor-container")
            : page.getByRole("textbox", { name: "Written response" }),
        ).toBeInViewport();
        await page.screenshot({
          path: testInfo.outputPath(
            `${type}-${theme}-${viewport.width}x${viewport.height}.png`,
          ),
          animations: "disabled",
        });
      }
    }
  }
});

test("design sections and architecture graphs survive checkpoints, reload, submit and review", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openQuestion(page, "design", "sensor");
  const response = page.getByRole("textbox", { name: "Written response" });
  await response.fill("Bound memory and latency.");
  await page.getByRole("button", { name: /2\. Architecture/ }).click();
  await response.fill("Capture independently from processing.");
  await page.getByRole("button", { name: "Diagram", exact: true }).click();
  const canvas = page.getByRole("region", {
    name: "Architecture diagram",
    exact: true,
  });
  for (const name of ["Sensor task", "Bounded queue"]) {
    await canvas.getByLabel("New component label").fill(name);
    await canvas
      .getByRole("button", { name: "Add component", exact: true })
      .click();
  }
  await expect(canvas.locator(".react-flow__node")).toHaveCount(2);
  await canvas.getByText(/^Components & connections/).click();
  await canvas
    .getByLabel("From component")
    .selectOption({ label: "Sensor task" });
  await canvas
    .getByLabel("To component")
    .selectOption({ label: "Bounded queue" });
  await canvas.getByLabel("Connection label", { exact: true }).fill("samples");
  await canvas
    .getByRole("button", { name: "Add connection", exact: true })
    .click();
  await expect(canvas.locator(".react-flow__edge")).toHaveCount(1);
  await canvas.getByRole("button", { name: "Undo diagram" }).click();
  await expect(canvas.locator(".react-flow__edge")).toHaveCount(0);
  await canvas.getByRole("button", { name: "Redo diagram" }).click();
  await expect(canvas.locator(".react-flow__edge")).toHaveCount(1);
  const first = canvas.locator(".react-flow__node").first();
  await first.focus();
  await first.press("Enter");
  await first.press("ArrowRight");
  await expect(canvas.getByLabel("X position for Sensor task")).not.toHaveValue(
    "0",
  );
  const beforeDrag = await canvas
    .getByLabel("X position for Sensor task")
    .inputValue();
  const bounds = (await first.boundingBox())!;
  await page.mouse.move(
    bounds.x + bounds.width / 2,
    bounds.y + bounds.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    bounds.x + bounds.width / 2 + 45,
    bounds.y + bounds.height / 2 + 20,
    { steps: 4 },
  );
  await page.mouse.up();
  await expect(canvas.getByLabel("X position for Sensor task")).not.toHaveValue(
    beforeDrag,
  );
  await canvas.getByLabel("X position for Sensor task").fill("80");
  await canvas.getByLabel("X position for Sensor task").press("Tab");
  await page.getByLabel("Confidence").selectOption("partial");
  await page
    .getByRole("button", { name: "Self-assessment", exact: true })
    .click();
  await page.getByLabel("Reflection (optional)").fill("Measure queue depth.");
  await page.keyboard.press("Escape");
  await page
    .getByRole("button", { name: "Save checkpoint", exact: true })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: "Draft autosaved" }),
  ).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("design-architecture.png"),
    animations: "disabled",
  });
  await page.getByRole("button", { name: "Use dark appearance" }).click();
  await page.screenshot({
    path: testInfo.outputPath("design-architecture-dark.png"),
    animations: "disabled",
  });
  for (const size of [
    { width: 1024, height: 600 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(size);
    await expect(
      canvas.getByRole("button", { name: "Add component", exact: true }),
    ).toBeInViewport();
    await expect(
      page.getByRole("button", { name: "Submit response", exact: true }),
    ).toBeInViewport();
    await noDocumentOverflow(page);
    await page.screenshot({
      path: testInfo.outputPath(
        `design-canvas-${size.width}x${size.height}.png`,
      ),
      animations: "disabled",
    });
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  // A manual checkpoint restores the complete graph, not only its text projection.
  await canvas
    .getByRole("button", { name: "Delete Bounded queue", exact: true })
    .click();
  await expect(canvas.locator(".react-flow__node")).toHaveCount(1);
  await page.getByRole("button", { name: "More workspace actions" }).click();
  await page.getByRole("button", { name: "Restore saved checkpoint" }).click();
  await page
    .getByRole("button", { name: "Restore checkpoint to draft", exact: true })
    .click();
  await expect(canvas.locator(".react-flow__node")).toHaveCount(2);
  await expect(canvas.locator(".react-flow__edge")).toHaveCount(1);
  await page
    .getByRole("button", { name: "Submit response", exact: true })
    .click();
  await expect(
    page.getByText("Response submitted", { exact: true }),
  ).toBeVisible();
  const attempts = (
    await (await page.request.get("/api/progress?compact=true")).json()
  ).attempts;
  const id = attempts[0].id;
  const saved = await (await page.request.get(`/api/attempts/${id}`)).json();
  expect(saved.written_workspace.diagram.nodes).toHaveLength(2);
  expect(saved.written_workspace.diagram.edges).toHaveLength(1);
  expect(saved.reflection).toBe("Measure queue depth.");
  await page.reload();
  await page
    .getByRole("navigation", { name: "Main navigation" })
    .getByRole("button", { name: "Practice", exact: true })
    .click();
  await page
    .getByRole("navigation", { name: "Practice modes" })
    .getByRole("button", { name: "Design studio", exact: true })
    .click();
  await expect(response).toHaveValue("Bound memory and latency.");
  await page.getByRole("button", { name: /2\. Architecture/ }).click();
  await expect(response).toHaveValue("Capture independently from processing.");
  await page.getByRole("button", { name: "Diagram", exact: true }).click();
  await expect(canvas.locator(".react-flow__node")).toHaveCount(2);
  // Later edits do not rewrite an earlier submitted snapshot.
  await canvas.getByLabel("New component label").fill("Logger");
  await canvas
    .getByRole("button", { name: "Add component", exact: true })
    .click();
  await page
    .getByRole("navigation", { name: "Main navigation" })
    .getByRole("button", { name: "Progress", exact: true })
    .click();
  await page
    .getByRole("button", { name: "View attempt", exact: true })
    .first()
    .click();
  const review = page.getByRole("region", {
    name: "Submitted architecture diagram",
  });
  await expect(review.locator(".react-flow__node")).toHaveCount(2);
  await expect(
    review.getByRole("button", { name: "Add component" }),
  ).toHaveCount(0);
  await page.screenshot({
    path: testInfo.outputPath("submitted-diagram-review.png"),
    animations: "disabled",
  });
});

test("coding results resize and short windows swap results with the editor", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await openQuestion(page, "coding", "Checked alignment");

  await page.getByRole("button", { name: "Show results", exact: true }).click();
  const divider = page.getByRole("separator", { name: "Resize test results" });
  await expect(divider).toBeVisible();
  await divider.focus();
  await divider.press("Home");
  await divider.press("ArrowUp");
  await expect(divider).toHaveAttribute("aria-valuenow", "140");
  await expect(
    page.getByRole("button", { name: "Run all tests", exact: true }),
  ).toBeInViewport();
  await page.getByRole("button", { name: "Hide results", exact: true }).click();
  await expect(divider).toBeHidden();
  await page.setViewportSize({ width: 1024, height: 600 });
  await page.getByRole("button", { name: "Show results", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Back to editor", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".editor-container")).toBeHidden();
  await page
    .getByRole("button", { name: "Back to editor", exact: true })
    .click();
  await expect(page.locator(".editor-container")).toBeInViewport();
  await noDocumentOverflow(page);
});

test("embedded interview workspaces keep timer, actions, restrictions and graph replay", async ({
  page,
}, testInfo) => {
  // The native QA service is shared across tests. Give this session its own
  // question so an earlier design test's saved diagram cannot seed its draft.
  const question = JSON.parse(
    readFileSync(new URL("../../questions/sensor-pipeline.json", import.meta.url), "utf8"),
  );
  question.id = "qa-studio-interview";
  question.follow_ups.push("How would you validate the maximum queue depth?");
  const validation = await page.request.post("/api/imports/validate", {
    data: { question },
  });
  expect(validation.ok(), await validation.text()).toBe(true);
  const validated = await validation.json();
  expect(validated.valid, JSON.stringify(validated.errors)).toBe(true);
  expect((await page.request.post("/api/imports/publish", {
    data: { token: validated.token },
  })).ok()).toBe(true);
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto("/");
  await page
    .getByRole("navigation", { name: "Main navigation" })
    .getByRole("button", { name: "Practice", exact: true })
    .click();
  await page
    .getByRole("navigation", { name: "Practice modes" })
    .getByRole("button", { name: "Mock Interview", exact: true })
    .click();
  await page
    .getByRole("combobox", { name: "Question", exact: true })
    .selectOption(question.id);
  await page
    .getByRole("button", { name: "Start session", exact: true })
    .click();
  await page
    .getByRole("tablist", { name: "Interview workspace" })
    .getByRole("tab", { name: "Design studio", exact: true })
    .click();
  for (const size of [
    { width: 1280, height: 720 },
    { width: 1024, height: 600 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(size);
    await expect(
      page.getByRole("button", { name: "Pause", exact: true }),
    ).toBeInViewport();
    await expect(
      page.getByRole("button", { name: "Finish session", exact: true }),
    ).toBeInViewport();
    await expect(
      page.getByRole("button", { name: "Submit response", exact: true }),
    ).toBeInViewport();
    await expect(
      page.getByRole("button", { name: "Speak your answer", exact: true }),
    ).toBeInViewport();
    await noDocumentOverflow(page);
    const panes = page.getByRole("tablist", { name: "Practice panes" });
    if (await panes.isVisible())
      await panes.getByRole("tab", { name: "Problem", exact: true }).click();
    await page.getByRole("tab", { name: "Hints", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Help me reason" }),
    ).toHaveCount(0);
    if (await panes.isVisible())
      await panes.getByRole("tab", { name: "Workspace", exact: true }).click();
    await page.screenshot({
      path: testInfo.outputPath(`interview-${size.width}x${size.height}.png`),
      animations: "disabled",
    });
  }
  await page
    .getByRole("textbox", { name: "Written response" })
    .fill("Keep capture bounded.");
  await page.getByRole("button", { name: /2\. Architecture/ }).click();
  await page.getByRole("button", { name: "Diagram", exact: true }).click();
  const canvas = page.getByRole("region", {
    name: "Architecture diagram",
    exact: true,
  });
  await canvas.getByLabel("New component label").fill("Sample queue");
  await canvas
    .getByRole("button", { name: "Add component", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Submit response", exact: true })
    .click();
  await expect(
    page.getByText("Response submitted", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Finish session", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Finish session", exact: true })
    .click();
  await page.getByRole("tab", { name: "Session replay", exact: true }).click();
  await page
    .locator(".replay-event")
    .filter({ hasText: "Written response" })
    .last()
    .click();
  await expect(
    page
      .getByRole("region", { name: "Submitted architecture diagram" })
      .locator(".react-flow__node"),
  ).toHaveCount(1);
});

test("failed section autosave retains local recovery and restores it after reload", async ({
  page,
}) => {
  await openQuestion(page, "theory", "DMA");
  await page.route("**/api/drafts/**", (route) =>
    route.request().method() === "PUT"
      ? route.fulfill({
          status: 503,
          json: { detail: "Test storage unavailable" },
        })
      : route.continue(),
  );
  await page.getByRole("button", { name: /2\. Example/ }).click();
  await page
    .getByRole("textbox", { name: "Written response" })
    .fill("An example kept during storage failure.");
  await expect(
    page.getByRole("status").filter({ hasText: "Autosave failed" }),
  ).toBeVisible();
  await page.unroute("**/api/drafts/**");
  await page.reload();
  await page
    .getByRole("navigation", { name: "Main navigation" })
    .getByRole("button", { name: "Practice", exact: true })
    .click();
  await page
    .getByRole("navigation", { name: "Practice modes" })
    .getByRole("button", { name: "Theory notebook", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Recover local edits", exact: true })
    .click();
  await page.getByRole("button", { name: /2\. Example/ }).click();
  await expect(
    page.getByRole("textbox", { name: "Written response" }),
  ).toHaveValue("An example kept during storage failure.");
  await expect(
    page.getByRole("status").filter({ hasText: "Draft autosaved" }),
  ).toBeVisible();
});
