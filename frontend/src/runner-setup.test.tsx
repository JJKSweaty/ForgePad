import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import RunnerSetup from "./RunnerSetup";
const { api, post } = vi.hoisted(() => ({ api: vi.fn(), post: vi.fn() }));
vi.mock("./api", async (original) => ({
  ...(await original<object>()),
  api,
  post,
}));
const config = { image: "local", docker_context: "", scratch_directory: "" };
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
it("shows progress, prevents duplicate setup, and confirms actual compiler readiness", async () => {
  const user = userEvent.setup();
  api.mockResolvedValue({ config });
  let finish!: (value: unknown) => void;
  post.mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const update = vi.fn();
  render(<RunnerSetup config={config} onConfig={update} />);
  await user.click(
    screen.getByRole("button", { name: "Set up / repair runner" }),
  );
  expect(
    (
      screen.getByRole("button", {
        name: "Preparing compiler…",
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
  finish({ available: true });
  await screen.findByText(/Runner ready/);
  expect(update).toHaveBeenCalledWith(config);
});
it("keeps a failed setup actionable and does not claim readiness", async () => {
  const user = userEvent.setup();
  api.mockResolvedValue({});
  post.mockRejectedValue(new Error("Install Docker Desktop"));
  render(<RunnerSetup config={config} onConfig={() => {}} />);
  await user.click(
    screen.getByRole("button", { name: "Set up / repair runner" }),
  );
  expect(await screen.findByRole("alert")).toHaveProperty(
    "textContent",
    "Install Docker Desktop",
  );
  expect(screen.queryByText(/Runner ready/)).toBeNull();
  expect(
    (
      screen.getByRole("button", {
        name: "Set up / repair runner",
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(false);
});
