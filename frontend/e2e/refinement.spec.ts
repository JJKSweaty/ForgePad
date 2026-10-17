import { test, expect } from "@playwright/test";

// Synthetic display states on real question packages; never changes saved progress.
test("question progress is distinct, readable and usable across themes and screen sizes", async ({
  page,
}, testInfo) => {
  await page.route("**/api/questions", async (route) => {
    const response = await route.fetch();
    const questions = await response.json();
    const states = ["completed", "in_progress", "needs_review", "not_started"];
    await route.fulfill({
      json: questions.slice(0, 4).map((q: object, i: number) => ({
        ...q,
        progress_status: states[i],
        has_completed: i === 0 || i === 2,
        last_activity_at: `2026-10-17T12:0${4 - i}:00Z`,
      })),
    });
  });
  await page.goto("/");
  await page
    .getByRole("navigation", { name: "Main navigation" })
    .getByRole("button", { name: "Practice", exact: true })
    .click();
  await expect(page.locator(".library-row")).toHaveCount(4);
  for (const theme of ["light", "dark"]) {
    if (theme === "dark")
      await page.getByRole("button", { name: "Use dark appearance" }).click();
    for (const width of [1440, 960, 760, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      for (const [state, label] of Object.entries({
        completed: "Completed",
        in_progress: "In progress",
        needs_review: "Needs review",
        not_started: "Not started",
      })) {
        const row = page.locator(`.library-row[data-progress="${state}"]`);
        await expect(row.locator(".status-badge")).toHaveText(label);
        await expect(row.locator(".status-marker svg")).toBeVisible();
        await expect(row.locator(".bookmark-button")).toBeVisible();
        expect((await row.boundingBox())!.height).toBeGreaterThanOrEqual(90);
      }
      await expect(
        page.locator('[data-progress="needs_review"] .completion-history'),
      ).toHaveText("Previously completed");
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      const styles = await page.locator(".status-badge").evaluateAll((badges) =>
        badges.map((badge) => {
          const s = getComputedStyle(badge);
          const luminance = (color: string) =>
            color
              .match(/[\d.]+/g)!
              .slice(0, 3)
              .map((n) => Number(n) / 255)
              .map((c) =>
                c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4,
              )
              .reduce((sum, c, i) => sum + c * [0.2126, 0.7152, 0.0722][i], 0);
          const a = luminance(s.color),
            b = luminance(s.backgroundColor);
          return {
            font: parseFloat(s.fontSize),
            contrast: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05),
          };
        }),
      );
      for (const style of styles) {
        expect(style.font).toBeGreaterThanOrEqual(12);
        expect(style.contrast).toBeGreaterThanOrEqual(4.5);
      }
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({
        path: testInfo.outputPath(`library-${theme}-${width}.png`),
        fullPage: true,
        animations: "disabled",
      });
    }
  }
  await page.getByLabel("Progress status").selectOption("completed");
  await expect(page.locator(".library-row")).toHaveCount(1);
  await page.locator(".bookmark-button").click();
  await expect(
    page.getByRole("heading", { name: "Question Library" }),
  ).toBeVisible();
});

test("daily activity uses normal row headers, aligned counts, and bounded readable space", async ({
  page,
}, testInfo) => {
  await page.route("**/api/dashboard?**", async (route) => {
    const response = await route.fetch();
    const data = await response.json();
    const last = data.days
      .filter((day: { future: boolean }) => !day.future)
      .at(-2)?.date;
    await route.fulfill({
      json: {
        ...data,
        days: data.days.map((day: { date: string }) => ({
          ...day,
          activity: day.date === last ? 16 : 0,
        })),
      },
    });
  });
  await page.goto("/");
  await page.getByLabel("Activity range").selectOption("13");
  await page.getByText("Daily activity counts", { exact: true }).click();
  const counts = page.locator(".activity-counts");
  for (const theme of ["light", "dark"]) {
    if (theme === "dark")
      await page.getByRole("button", { name: "Use dark appearance" }).click();
    for (const width of [1440, 760, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      expect((await counts.boundingBox())!.width).toBeLessThanOrEqual(640);
      const rowStyles = await counts
        .locator("tbody th")
        .first()
        .evaluate((cell) => {
          const style = getComputedStyle(cell);
          return {
            transform: style.textTransform,
            spacing: style.letterSpacing,
            background: style.backgroundColor,
          };
        });
      expect(rowStyles.transform).toBe("none");
      expect(["normal", "0px"]).toContain(rowStyles.spacing);
      expect(rowStyles.background).toBe("rgba(0, 0, 0, 0)");
      await expect(counts.locator("tbody td").first()).toHaveCSS(
        "text-align",
        "right",
      );
      await expect(counts.locator("tr[data-active] td")).toContainText("16");
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({
        path: testInfo.outputPath(`dashboard-${theme}-${width}.png`),
        fullPage: true,
        animations: "disabled",
      });
      await counts.screenshot({
        path: testInfo.outputPath(`activity-${theme}-${width}.png`),
      });
    }
  }
});

test("Progress and Roadmaps retain clear spacing and status cues without page overflow", async ({
  page,
}, testInfo) => {
  const questionResponse = await page.request.get("/api/questions");
  const [q] = await questionResponse.json();
  await page.route("**/api/progress?compact=true", (route) =>
    route.fulfill({
      json: {
        attempts: [
          {
            id: "recent",
            question_id: q.id,
            title: q.title,
            created_at: "2026-10-17T14:00:00Z",
            question_version: 1,
            type: q.type,
            result: { status: "wrong_answer" },
          },
          {
            id: "earlier",
            question_id: q.id,
            title: q.title,
            created_at: "2026-10-16T14:00:00Z",
            question_version: 1,
            type: q.type,
            result: { status: "passed" },
          },
        ],
        due_reviews: [
          {
            question_id: q.id,
            title: q.title,
            previous_result: "wrong_answer",
            last_attempted_at: "2026-10-17T14:00:00Z",
            reason: "Revisit the previous assessment",
          },
        ],
        weak_topics: [{ topic: q.topics[0], needs_review: 1 }],
        goals: [],
        summary: {
          attempts: 2,
          passed_attempts: 1,
          completed_questions: 1,
          due_reviews: 1,
        },
      },
    }),
  );
  await page.goto("/");
  const nav = page.getByRole("navigation", { name: "Main navigation" });
  await nav.getByRole("button", { name: "Progress", exact: true }).click();
  for (const theme of ["light", "dark"]) {
    if (theme === "dark")
      await page.getByRole("button", { name: "Use dark appearance" }).click();
    for (const width of [1440, 760, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      await expect(page.locator(".history-table tbody tr")).toHaveCount(2);
      const overflow = await page.evaluate(() => ({
        viewport: innerWidth,
        width: document.documentElement.scrollWidth,
        elements: [...document.querySelectorAll("main *")]
          .filter((e) => e.getBoundingClientRect().right > innerWidth + 1)
          .map((e) => ({
            tag: e.tagName,
            class: e.className,
            right: e.getBoundingClientRect().right,
            width: e.getBoundingClientRect().width,
          }))
          .slice(0, 20),
      }));
      expect(overflow.width, JSON.stringify(overflow)).toBeLessThanOrEqual(
        overflow.viewport,
      );
      const history = page.getByRole("region", {
        name: "Attempt history details",
      });
      await history.scrollIntoViewIfNeeded();
      await history.screenshot({
        path: testInfo.outputPath(`history-${theme}-${width}.png`),
        animations: "disabled",
      });
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({
        path: testInfo.outputPath(`progress-${theme}-${width}.png`),
        fullPage: true,
        animations: "disabled",
      });
    }
  }
  await nav.getByRole("button", { name: "Practice", exact: true }).click();
  await page
    .getByRole("navigation", { name: "Practice modes" })
    .getByRole("button", { name: "Roadmaps", exact: true })
    .click();
  await expect(page.locator(".roadmap-step").first()).toBeVisible();
  await expect(page.locator(".roadmap-step .status-badge").first()).toHaveText(
    "Not started",
  );
  for (const width of [1440, 760, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page
      .locator(".topic-node")
      .first()
      .screenshot({ path: testInfo.outputPath(`roadmap-dark-${width}.png`) });
  }
});

test("activity fills the workspace and the sidebar control stays in one place", async ({
  page,
}, testInfo) => {
  await page.goto("/");
  await expect(page.getByLabel("Activity range")).toHaveValue("52");
  for (const width of [2400, 1440, 760, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const weeks of ["52", "13"]) {
      await page.getByLabel("Activity range").selectOption(weeks);
      const control = page.locator(".app > .sidebar-toggle");
      for (const hidden of [false, true]) {
        const before = (await control.boundingBox())!;
        await expect(control).toHaveAttribute("aria-expanded", String(!hidden));
        expect(before.x).toBeLessThan(24);
        expect(before.y).toBeLessThan(24);
        const calendar = (await page.locator(".calendar").boundingBox())!;
        const scroll = (await page.locator(".calendar-scroll").boundingBox())!;
        expect(calendar.width).toBeGreaterThanOrEqual(scroll.width - 5);
        if (width >= 760)
          expect(calendar.width).toBeLessThanOrEqual(scroll.width + 5);
        expect(calendar.height).toBeLessThan(225);
        await expect
          .poll(() =>
            page
              .locator(".calendar-cell")
              .last()
              .evaluate((cell) => {
                const day = cell.getBoundingClientRect();
                const viewport = cell
                  .closest(".calendar-scroll")!
                  .getBoundingClientRect();
                return (
                  day.right <= viewport.right + 1 &&
                  day.left >= viewport.left - 1
                );
              }),
          )
          .toBe(true);
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        ).toBe(true);
        if (weeks === "52")
          await page.screenshot({
            path: testInfo.outputPath(
              `activity-width-${width}-${hidden ? "hidden" : "open"}.png`,
            ),
            fullPage: true,
            animations: "disabled",
          });
        await control.click();
        const after = (await control.boundingBox())!;
        expect(after.x).toBe(before.x);
        expect(after.y).toBe(before.y);
        await expect(control).toBeFocused();
      }
    }
  }
});
