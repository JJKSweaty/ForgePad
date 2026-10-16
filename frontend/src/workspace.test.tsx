import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import App from "./App";
const { api, flush } = vi.hoisted(() => ({ api: vi.fn(), flush: vi.fn() }));
vi.mock("./api", async (original) => ({ ...(await original<object>()), api }));
vi.mock("./drafts", () => ({ flushDrafts: flush }));
vi.mock("./native", () => ({
  native: true,
  nativeEvents: async () => () => {},
}));
vi.mock("./Dashboard", () => ({
  Dashboard: () => <div>Dashboard content</div>,
}));
vi.mock("./Practice", () => ({
  default: () => <div>Code workspace content</div>,
}));
vi.mock("./RoadmapsPage", () => ({
  RoadmapsPage: () => <div>Roadmap content</div>,
}));
vi.mock("./Interview", () => ({ default: () => <div>Interview content</div> }));
vi.mock("./SettingsPage", () => ({
  SettingsPage: ({ authoring }: { authoring: ReactNode }) => (
    <div>Settings content{authoring}</div>
  ),
}));
vi.mock("./AuthoringPage", () => ({
  AuthoringPage: () => <div>Question authoring content</div>,
}));
beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  flush.mockResolvedValue(undefined);
  api.mockImplementation(async (path: string) =>
    path === "/questions"
      ? [
          {
            id: "align-up",
            title: "Checked alignment for DMA buffers",
            description: "Align a buffer",
            topics: ["DMA", "Alignment"],
            type: "coding",
            difficulty: "intermediate",
            duration_minutes: 30,
            completion_status: "complete",
          },
        ]
      : path === "/progress"
        ? {
            attempts: [],
            due_reviews: [],
            weak_topics: [],
            goals: [],
            summary: {},
          }
        : {
            runner: { available: false },
            ai: { available: false },
            speech: { available: false },
          },
  );
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
it("keeps the sidebar to three destinations and nests every practice mode", async () => {
  const user = userEvent.setup();
  render(<App />);
  await screen.findByText("Dashboard content");
  const nav = screen.getByRole("navigation", { name: "Main navigation" });
  expect(
    within(nav)
      .getAllByRole("button")
      .map((b) => b.textContent),
  ).toEqual(["Dashboard", "Practice", "Progress"]);
  await user.click(within(nav).getByText("Practice"));
  await screen.findByRole("heading", { name: "Question Library" });
  const modes = screen.getByRole("navigation", { name: "Practice modes" });
  await user.click(within(modes).getByText("Roadmaps"));
  await screen.findByText("Roadmap content");
  await user.click(within(modes).getByText("Mock Interview"));
  await screen.findByText("Interview content");
  expect(
    within(nav)
      .getByText("Practice")
      .closest("button")
      ?.getAttribute("aria-current"),
  ).toBe("page");
});
it("opens authoring from the library under Settings", async () => {
  const user = userEvent.setup();
  render(<App />);
  await screen.findByText("Dashboard content");
  await user.click(screen.getByRole("button", { name: "Practice" }));
  await user.click(await screen.findByRole("button", { name: "Add question" }));
  await screen.findByText("Question authoring content");
  expect(sessionStorage.getItem("forgepad.settings.section")).toBe("authoring");
  expect(
    screen
      .getByRole("button", { name: "Settings" })
      .getAttribute("aria-current"),
  ).toBe("page");
});
it("keeps the current screen when saving a draft fails during navigation", async () => {
  const user = userEvent.setup();
  render(<App />);
  await screen.findByText("Dashboard content");
  flush.mockRejectedValueOnce(new Error("disk unavailable"));
  await user.click(screen.getByRole("button", { name: "Practice" }));
  expect(await screen.findByRole("alert")).toHaveProperty(
    "textContent",
    expect.stringContaining("disk unavailable"),
  );
  expect(screen.getByText("Dashboard content")).toBeTruthy();
});
it("hides the sidebar, keeps its toggle reachable, and remembers the choice", async () => {
  const user = userEvent.setup();
  const view = render(<App />);
  await screen.findByText("Dashboard content");
  await user.click(screen.getByRole("button", { name: "Hide sidebar" }));
  expect(
    screen.queryByRole("navigation", { name: "Main navigation" }),
  ).toBeNull();
  expect(
    screen
      .getByRole("button", { name: "Show sidebar" })
      .getAttribute("aria-expanded"),
  ).toBe("false");
  view.unmount();
  render(<App />);
  await screen.findByText("Dashboard content");
  await user.click(screen.getByRole("button", { name: "Show sidebar" }));
  expect(
    screen.getByRole("navigation", { name: "Main navigation" }),
  ).toBeTruthy();
});
