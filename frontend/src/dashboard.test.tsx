// Identified development fixture: synthetic calendar, never production activity.
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { Heatmap } from "./Heatmap";
import { PaneDivider } from "./PaneDivider";
import { calendarMonths, dayValue, intensity } from "./dashboardData";
import type { ActivityDay, GitHubStatus } from "./dashboardData";
const api = vi.hoisted(() => vi.fn());
vi.mock("./api", () => ({ api, message: (e: Error) => e.message }));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
const days: ActivityDay[] = Array.from({ length: 364 }, (_, i) => ({
  date: new Date(Date.UTC(2025, 0, 5 + i)).toISOString().slice(0, 10),
  activity: i === 360 ? 4 : 0,
  solved: i === 360 ? 1 : 0,
  active_seconds: i === 360 ? 1800 : 0,
  future: i > 360,
}));
const disconnected: GitHubStatus = {
  connected: false,
  login: null,
  last_sync_at: null,
  calendar: null,
  error: null,
  publishing_available: false,
};
function mount() {
  const onPractice = vi.fn();
  render(
    <Heatmap
      days={days}
      timezone="America/Toronto"
      github={disconnected}
      onPractice={onPractice}
      onSession={vi.fn()}
      onSettings={vi.fn()}
      onSync={vi.fn()}
    />,
  );
  return { onPractice };
}
describe("calendar semantics", () => {
  it("keeps all four datasets separate and uses five intensity levels", () => {
    const d = days[360],
      github = new Map([[d.date, 9]]);
    expect(
      ["activity", "solved", "time", "github"].map((k) =>
        dayValue(d, k as "activity", github),
      ),
    ).toEqual([4, 1, 30, 9]);
    expect([0, 1, 3, 6, 10].map((n) => intensity(n, "activity"))).toEqual([
      0, 1, 2, 3, 4,
    ]);
  });
  it("labels month and year transitions without shifting canonical local dates", () => {
    const months = calendarMonths(days);
    expect(months[0]).toEqual({ week: 0, label: "Jan" });
    expect(months.some((m) => m.label === "Dec")).toBe(true);
    const crossing = Array.from({ length: 21 }, (_, i) => ({
      ...days[0],
      date: new Date(Date.UTC(2025, 11, 21 + i)).toISOString().slice(0, 10),
    }));
    expect(calendarMonths(crossing).map((m) => m.label)).toEqual([
      "Dec",
      "Jan",
    ]);
  });
  it("renders 364 dates with one keyboard stop and excludes future dates", () => {
    mount();
    const cells =
      document.querySelectorAll<HTMLButtonElement>(".calendar-cell");
    expect(cells).toHaveLength(364);
    expect([...cells].filter((c) => c.tabIndex === 0)).toHaveLength(1);
    expect(cells[361].disabled).toBe(true);
    cells[360].focus();
    fireEvent.keyDown(cells[360], { key: "ArrowLeft" });
    expect(document.activeElement).toBe(cells[353]);
    fireEvent.keyDown(cells[353], { key: "End" });
    expect(document.activeElement).toBe(cells[356]);
  });
  it("switches metrics and provides an honest GitHub disconnected state", () => {
    mount();
    const select = screen.getByLabelText("Activity dataset");
    fireEvent.change(select, { target: { value: "solved" } });
    expect(
      screen.getByText("1 unique solves in the last 52 weeks"),
    ).toBeTruthy();
    fireEvent.change(select, { target: { value: "time" } });
    expect(
      screen.getByText("30 active minutes in the last 52 weeks"),
    ).toBeTruthy();
    fireEvent.change(select, { target: { value: "github" } });
    expect(
      screen.getByRole("button", { name: /Connect in Settings/i }),
    ).toBeTruthy();
    expect(document.querySelectorAll(".calendar-cell")).toHaveLength(0);
  });
  it("loads actual matching date records and opens their question", async () => {
    api.mockResolvedValue({
      events: [
        {
          id: "fixture",
          kind: "solution_submitted",
          question_id: "register-field",
          title: "Register field",
          occurred_at: "2025-12-31T18:00:00Z",
        },
      ],
    });
    const { onPractice } = mount();
    fireEvent.click(document.querySelectorAll(".calendar-cell")[360]);
    await waitFor(() =>
      expect(api).toHaveBeenCalledWith(
        `/activity/${days[360].date}?timezone=America%2FToronto`,
      ),
    );
    fireEvent.click(
      await screen.findByRole("button", { name: /Register field/ }),
    );
    expect(onPractice).toHaveBeenCalledWith("register-field");
  });
  it("supports bounded keyboard pane resizing", () => {
    const change = vi.fn();
    render(
      <PaneDivider
        container={{ current: null }}
        value={36}
        onChange={change}
      />,
    );
    const divider = screen.getByRole("separator");
    fireEvent.keyDown(divider, { key: "ArrowRight" });
    fireEvent.keyDown(divider, { key: "End" });
    expect(change.mock.calls).toEqual([[38], [60]]);
  });
});
