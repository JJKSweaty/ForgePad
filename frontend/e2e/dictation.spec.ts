import { test, expect } from "@playwright/test";

// Deterministic microphone and ASR fixtures; model quality is checked separately
// by scripts/verify_speech.py against the installed local Parakeet helper.
for (const type of ["theory", "design"]) {
  test(`${type} answers show live words before a pause and retain the final transcript`, async ({
    page,
  }) => {
    await page.addInitScript(() => {
      let port: { onmessage: ((event: { data: Float32Array }) => void) | null };
      const fixture = {
        stopped: 0,
        feed(count: number, value: number) {
          for (let i = 0; i < count; i++)
            port.onmessage?.({ data: new Float32Array(1600).fill(value) });
        },
      };
      Object.assign(window, { __dictationTest: fixture });
      Object.defineProperty(navigator, "mediaDevices", {
        configurable: true,
        value: {
          getUserMedia: async () => ({
            getTracks: () => [
              {
                stop: () => {
                  fixture.stopped++;
                },
              },
            ],
          }),
        },
      });
      Object.assign(window, {
        AudioContext: class {
          audioWorklet = { addModule: async () => {} };
          destination = {};
          createMediaStreamSource() {
            return { connect() {}, disconnect() {} };
          }
          async resume() {}
          async close() {}
        },
        AudioWorkletNode: class {
          port = { onmessage: null };
          constructor() {
            port = this.port;
          }
          connect() {}
          disconnect() {}
        },
      });
    });
    await page.route("**/api/health", async (route) => {
      const response = await route.fetch();
      await route.fulfill({
        json: { ...(await response.json()), speech: { available: true } },
      });
    });
    let previews = 0,
      finals = 0;
    await page.route("**/api/speech/transcribe", (route) => {
      const partial = route
        .request()
        .postDataBuffer()!
        .toString()
        .includes('name="partial"\r\n\r\ntrue');
      const text = partial
        ? ++previews === 1
          ? "Use a ring"
          : "Use a ring buffer for samples."
        : (++finals,
          "Use a ring buffer for samples. Do not drop 32-bit values.");
      return route.fulfill({
        json: { text, provider: "local", raw_audio_saved: false },
      });
    });
    await page.goto("/");
    await page
      .getByRole("navigation", { name: "Main navigation" })
      .getByRole("button", { name: "Practice", exact: true })
      .click();
    await page.getByLabel("Question type").selectOption(type);
    await page
      .locator(".library-row")
      .first()
      .locator(".row-open-target")
      .click();
    const answer = page.getByRole("textbox", { name: "Written response" });
    await answer.fill("My existing notes.");
    await page.getByRole("button", { name: "Speak your answer" }).click();
    await expect(
      page.getByRole("button", { name: "Stop dictation" }),
    ).toBeVisible();
    const feed = (count: number) =>
      page.evaluate((count) => {
        (
          window as unknown as {
            __dictationTest: { feed: (count: number, value: number) => void };
          }
        ).__dictationTest.feed(count, 0.006);
      }, count);
    await feed(8);
    const live = page.getByRole("region", { name: "Live transcript" });
    await expect(live.getByText("Use a ring", { exact: true })).toBeVisible();
    await expect(live).toBeInViewport();
    await expect(answer).toHaveValue("My existing notes.");
    await feed(8);
    await expect(
      live.getByText("Use a ring buffer for samples.", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Submit response", exact: true }),
    ).toBeDisabled();
    await page.getByRole("button", { name: "Stop dictation" }).click();
    await expect(answer).toHaveValue(
      "My existing notes. Use a ring buffer for samples. Do not drop 32-bit values.",
    );
    expect(finals).toBe(1);
    await expect(live).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Submit response", exact: true }),
    ).toBeEnabled();
    expect(
      await page.evaluate(
        () =>
          (window as unknown as { __dictationTest: { stopped: number } })
            .__dictationTest.stopped,
      ),
    ).toBe(1);
  });
}
