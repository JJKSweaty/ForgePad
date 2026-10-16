import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AuthoringPage } from "./AuthoringPage";
const { api, post } = vi.hoisted(() => ({ api: vi.fn(), post: vi.fn() }));
vi.mock("./api", async (original) => ({
  ...(await original<object>()),
  api,
  post,
}));
vi.mock("./native", () => ({ native: true }));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
it("stages a complete manual question for editable review without publishing it", async () => {
  const user = userEvent.setup();
  api.mockResolvedValue([]);
  post.mockImplementation(async (_path, body) => ({
    id: "author-draft",
    status: "staged",
    package: body.package,
    errors: [],
  }));
  render(<AuthoringPage questions={[]} refresh={async () => {}} />);
  await user.type(
    screen.getByLabelText("Title", { exact: true }),
    "Explain DMA ownership",
  );
  await user.type(
    screen.getByLabelText("Description", { exact: true }),
    "Reason about ownership boundaries",
  );
  await user.type(
    screen.getByLabelText("Question", { exact: true }),
    "Who owns a DMA buffer before and after completion?",
  );
  await user.type(
    screen.getByLabelText("Topics", { exact: true }),
    "DMA, memory",
  );
  await user.type(
    screen.getByLabelText("What makes a good answer?"),
    "Explain transfer of ownership",
  );
  await user.type(
    screen.getByLabelText("Hints (at least one)"),
    "Track the producer and consumer",
  );
  await user.type(
    screen.getByLabelText("Three technical follow-ups (one per line)"),
    "What if DMA fails?\nWhat about caches?\nWhat about reuse?",
  );
  await user.click(screen.getByRole("button", { name: "Create draft" }));
  expect(post).toHaveBeenCalledWith(
    "/question-drafts",
    expect.objectContaining({
      workflow: "json",
      package: expect.objectContaining({
        description: "Reason about ownership boundaries",
        language: "independent",
        hints: ["Track the producer and consumer"],
        follow_ups: [
          "What if DMA fails?",
          "What about caches?",
          "What about reuse?",
        ],
      }),
    }),
  );
  expect(
    await screen.findByRole("heading", { name: "Review draft" }),
  ).toBeTruthy();
  expect(post.mock.calls.some(([path]) => path.includes("publish"))).toBe(
    false,
  );
});
