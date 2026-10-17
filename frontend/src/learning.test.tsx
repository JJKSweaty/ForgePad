import { useState } from "react";
import { defaultLibraryFilters } from "./libraryFilters";
import { afterEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QuestionBank as ControlledQuestionBank } from "./QuestionBank";
import { ProgressPage } from "./ProgressPage";
import { TestCasesEditor } from "./TestCasesEditor";
import { calendarDate, questionAction } from "./learning";
import type { Progress, Question } from "./api";
const { api, post } = vi.hoisted(() => ({ api: vi.fn(), post: vi.fn() }));
vi.mock("./api", async (original) => ({
  ...(await original<object>()),
  api,
  post,
}));
function QuestionBank(
  props: Omit<
    React.ComponentProps<typeof ControlledQuestionBank>,
    "filters" | "onFiltersChange"
  >,
) {
  const [filters, onFiltersChange] = useState(defaultLibraryFilters);
  return (
    <ControlledQuestionBank
      {...props}
      filters={filters}
      onFiltersChange={onFiltersChange}
    />
  );
}
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
const question = {
  id: "alignment",
  version: 2,
  title: "DMA alignment",
  description: "Handle overflowing addresses",
  topics: ["memory", "DMA"],
  type: "coding",
  language: "c",
  difficulty: "intermediate",
  duration_minutes: 30,
} as Question;
it("filters, searches, resumes the pinned draft and keeps row controls independent", async () => {
  const user = userEvent.setup(),
    open = vi.fn(),
    refresh = vi.fn().mockResolvedValue(undefined);
  render(
    <QuestionBank
      questions={[
        { ...question, progress_status: "in_progress", draft_version: 1 },
        {
          ...question,
          id: "interrupts",
          title: "Interrupt priorities",
          description: "Configure interrupt ordering",
          topics: ["interrupts"],
          progress_status: "not_started",
        },
      ]}
      onPractice={open}
      refresh={refresh}
    />,
  );
  await user.selectOptions(
    screen.getByLabelText("Progress status"),
    "in_progress",
  );
  expect(screen.getByRole("status").textContent).toBe("1 questions");
  await user.click(
    screen.getByRole("button", { name: "Bookmark DMA alignment" }),
  );
  expect(open).not.toHaveBeenCalled();
  expect(api).toHaveBeenCalledWith(
    "/questions/alignment",
    expect.objectContaining({ method: "PATCH" }),
  );
  await user.click(
    screen.getByRole("button", { name: "Actions for DMA alignment" }),
  );
  await user.click(await screen.findByRole("button", { name: "Archive" }));
  expect(open).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Open DMA alignment" }));
  expect(open).toHaveBeenCalledWith("alignment", 1);
  await user.click(screen.getByRole("button", { name: "Clear filters" }));
  await user.keyboard("/");
  expect(document.activeElement).toBe(
    screen.getByLabelText("Search questions"),
  );
  await user.type(screen.getByLabelText("Search questions"), "overflowing");
  await waitFor(() =>
    expect(screen.getByRole("status").textContent).toBe("1 questions"),
  );
  expect(
    screen.queryByRole("button", { name: "Open Interrupt priorities" }),
  ).toBeNull();
});
it("routes Resume to the saved mock interview without creating a session", async () => {
  const onSession = vi.fn();
  render(
    <QuestionBank
      questions={[
        { ...question, progress_status: "in_progress", session_id: "existing" },
      ]}
      onPractice={vi.fn()}
      onSession={onSession}
      refresh={async () => {}}
    />,
  );
  await userEvent.click(
    screen.getByRole("button", { name: "Open DMA alignment" }),
  );
  expect(onSession).toHaveBeenCalledWith("existing");
  expect(post).not.toHaveBeenCalled();
  expect(questionAction({ ...question, progress_status: "needs_review" })).toBe(
    "Practice again",
  );
});
const progress: Progress = {
  attempts: [
    {
      id: "a1",
      question_id: "alignment",
      title: "DMA alignment",
      created_at: "2026-10-16T09:08:00Z",
      question_version: 1,
      language: "c",
      type: "coding",
      result: { status: "failed" },
    },
    {
      id: "a0",
      question_id: "alignment",
      title: "DMA alignment",
      created_at: "2026-10-15T09:08:00Z",
      question_version: 1,
      result: { status: "passed" },
    },
  ],
  due_reviews: [
    {
      question_id: "alignment",
      title: "DMA alignment",
      topics: ["memory"],
      previous_result: "failed",
      reason: "Revisit the previous assessment",
      last_attempted_at: "2026-10-16T09:08:00Z",
    },
  ],
  weak_topics: [{ topic: "memory", needs_review: 1, evidence_ids: ["a1"] }],
  goals: [{ id: "g1", title: "Study bounds", status: "active" }],
  summary: {
    attempts: 2,
    passed_attempts: 1,
    completed_questions: 1,
    due_reviews: 1,
  },
};
it("fetches exact attempt evidence on demand and supports targeted practice and goal edits", async () => {
  const user = userEvent.setup(),
    browse = vi.fn(),
    practice = vi.fn(),
    refresh = vi.fn().mockResolvedValue(undefined);
  api.mockResolvedValue({
    ...progress.attempts[0],
    files: { "main.c": "// immutable submitted code" },
    result: { status: "failed", tests: [{ name: "bounds", status: "failed" }] },
  });
  render(
    <ProgressPage
      progress={progress}
      questions={[question]}
      refresh={refresh}
      onPractice={practice}
      onBrowse={browse}
      onDashboard={vi.fn()}
    />,
  );
  expect(api).not.toHaveBeenCalled();
  await user.click(
    screen.getByRole("button", { name: /memory.*1 unsuccessful/ }),
  );
  expect(browse).toHaveBeenCalledWith("memory");
  await user.click(screen.getAllByRole("button", { name: "View attempt" })[0]);
  const dialog = await screen.findByRole("dialog");
  await within(dialog).findByText("// immutable submitted code");
  expect(api).toHaveBeenCalledWith("/attempts/a1");
  expect(
    within(dialog).getByText("No AI feedback saved for this attempt."),
  ).toBeTruthy();
  await user.click(
    within(dialog).getByRole("button", { name: "Practice this version again" }),
  );
  expect(practice).toHaveBeenCalledWith("alignment", 1);
  await user.click(
    within(dialog).getByRole("button", { name: "Close dialog" }),
  );
  await user.click(
    screen.getByRole("button", { name: "Edit goal Study bounds" }),
  );
  await user.selectOptions(
    screen.getByLabelText("Linked question"),
    "alignment",
  );
  await user.click(screen.getByRole("button", { name: "Save goal" }));
  await waitFor(() =>
    expect(api).toHaveBeenCalledWith(
      "/goals/g1",
      expect.objectContaining({
        method: "PATCH",
        body: expect.stringContaining('"question_id":"alignment"'),
      }),
    ),
  );
  expect(
    screen.queryByRole("button", { name: "Reset practice data" }),
  ).toBeNull();
});
it("handles detail loading errors without discarding saved history", async () => {
  api.mockRejectedValue(new Error("Storage unavailable"));
  render(
    <ProgressPage
      progress={progress}
      questions={[question]}
      refresh={async () => {}}
      onPractice={vi.fn()}
      onBrowse={vi.fn()}
      onDashboard={vi.fn()}
    />,
  );
  await userEvent.click(
    screen.getAllByRole("button", { name: "View attempt" })[0],
  );
  expect((await screen.findByRole("alert")).textContent).toContain(
    "Storage unavailable",
  );
  expect(
    screen.getByRole("heading", { name: /Attempt history/, hidden: true }),
  ).toBeTruthy();
});
it("edits edge-case coverage while keeping every test visible", async () => {
  const change = vi.fn();
  render(
    <TestCasesEditor
      tests={[
        {
          id: "test",
          name: "Bounds",
          visibility: "hidden",
          category: "boundary",
          stdin: "0",
          expected_stdout: "0",
        },
      ]}
      onChange={change}
    />,
  );
  await userEvent.selectOptions(screen.getByLabelText("Coverage"), "negative");
  expect(change).toHaveBeenCalledWith([
    expect.objectContaining({
      id: "test",
      visibility: "public",
      category: "negative",
    }),
  ]);
});

it("filters since a calendar day in the displayed profile timezone, including midnight", () => {
  localStorage.setItem("forgepad.v2.timezone", "America/Toronto");
  const attempts = [
    ...Array.from({ length: 6 }, (_, i) => ({
      ...progress.attempts[0],
      id: `previous-${i}`,
      title: `October 16 attempt ${i}`,
      created_at: `2026-10-17T03:59:${String(54 + i).padStart(2, "0")}Z`,
    })),
    {
      ...progress.attempts[0],
      id: "midnight",
      title: "At midnight",
      created_at: "2026-10-17T04:00:00Z",
      duration_seconds: 0,
    },
    {
      ...progress.attempts[0],
      id: "after",
      title: "After midnight",
      created_at: "2026-10-17T04:00:01Z",
    },
  ];
  render(
    <ProgressPage
      progress={{ ...progress, attempts }}
      questions={[question]}
      refresh={async () => {}}
      onPractice={vi.fn()}
      onBrowse={vi.fn()}
      onDashboard={vi.fn()}
    />,
  );
  fireEvent.change(screen.getByLabelText("Attempts since"), {
    target: { value: "2026-10-17" },
  });
  expect(document.querySelectorAll(".history-table tbody tr")).toHaveLength(2);
  expect(screen.queryByText("October 16 attempt 0")).toBeNull();
  expect(screen.getByText("At midnight")).toBeTruthy();
  expect(
    screen.getByText(/Since 2026-10-17 \(inclusive\).*America\/Toronto/),
  ).toBeTruthy();
  expect(screen.getByText("Not recorded")).toBeTruthy();
  expect(screen.getByText("0 min")).toBeTruthy();
  expect(document.querySelector(".history-table time")?.textContent).toContain(
    "Oct 17, 2026",
  );
  fireEvent.change(screen.getByLabelText("Attempts since"), {
    target: { value: "2026-10-18" },
  });
  expect(screen.getByText("No attempts match these filters.")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
  expect(document.querySelectorAll(".history-table tbody tr")).toHaveLength(8);
  localStorage.removeItem("forgepad.v2.timezone");
});

it.each([
  ["2026-03-08T04:59:59Z", "2026-03-07"],
  ["2026-03-08T05:00:00Z", "2026-03-08"],
  ["2026-03-09T03:59:59Z", "2026-03-08"],
  ["2026-03-09T04:00:00Z", "2026-03-09"],
  ["2026-11-01T03:59:59Z", "2026-10-31"],
  ["2026-11-01T04:00:00Z", "2026-11-01"],
  ["2026-11-01T05:30:00Z", "2026-11-01"],
  ["2026-11-01T06:30:00Z", "2026-11-01"],
  ["2026-11-02T04:59:59Z", "2026-11-01"],
  ["2026-11-02T05:00:00Z", "2026-11-02"],
])("keeps daylight-saving calendar dates for %s", (timestamp, expected) => {
  expect(calendarDate(timestamp, "America/Toronto")).toBe(expected);
});
