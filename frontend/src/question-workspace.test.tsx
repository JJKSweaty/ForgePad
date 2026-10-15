import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Practice from "./Practice";
import type { Question } from "./api";

const { api, post } = vi.hoisted(() => ({ api: vi.fn(), post: vi.fn() }));
vi.mock("./api", async (original) => ({
  ...(await original<object>()),
  api,
  post,
}));
vi.mock("./native", () => ({ native: false }));
vi.mock("./usePracticeActivity", () => ({ usePracticeActivity: () => {} }));
vi.mock("./CodeEditor", () => ({
  default: () => <div data-testid="code-editor">Code editor</div>,
}));
const base: Question = {
  id: "question",
  version: 1,
  type: "design",
  title: "Sensor system",
  description: "Design a sensor",
  prompt: "Design a reliable sensor pipeline.",
  topics: ["sensors"],
  constraints: [],
  rubric: ["Explain tradeoffs"],
  hints: ["Consider backpressure"],
  follow_ups: [],
  difficulty: "intermediate",
  language: "independent",
  starter_files: {},
  duration_minutes: 30,
};
function open(question: Question) {
  api.mockImplementation(async (path: string) =>
    path.startsWith("/questions/")
      ? question
      : { files: question.starter_files, answer: "My existing draft" },
  );
  return render(
    <Practice
      questionId={question.id}
      theme="dark"
      onSaved={async () => {}}
      onBrowse={() => {}}
    />,
  );
}
beforeEach(() => {
  localStorage.clear();
  post.mockResolvedValue({ text: "How will you handle a full queue?" });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
it("opens design questions in a studio, preserves the draft, and coaches from Hints", async () => {
  const user = userEvent.setup();
  open(base);
  await screen.findByRole("heading", { name: "Build your approach" });
  expect(screen.queryByTestId("code-editor")).toBeNull();
  expect(
    (screen.getByLabelText("Written response") as HTMLTextAreaElement).value,
  ).toBe("My existing draft");
  await user.click(screen.getByRole("button", { name: "3. Tradeoffs" }));
  expect(
    screen.getByText("Compare alternatives, bottlenecks, and failure modes."),
  ).toBeTruthy();
  await user.click(screen.getByRole("tab", { name: "Hints" }));
  await user.click(screen.getByRole("button", { name: "Help me reason" }));
  await screen.findByText("How will you handle a full queue?");
  expect(post).toHaveBeenCalledWith(
    "/questions/question/coach",
    expect.objectContaining({
      answer: "My existing draft",
      question_version: 1,
    }),
  );
});
it("keeps coding in the editor with run controls", async () => {
  open({
    ...base,
    type: "coding",
    language: "c",
    starter_files: { "main.c": "int main(void) {}" },
    test_config: { tests: [] },
  });
  await screen.findByTestId("code-editor");
  expect(screen.getByRole("button", { name: "Run" })).toBeTruthy();
  expect(screen.queryByLabelText("Written response")).toBeNull();
});
it("uses theory and investigation prompts for written questions", async () => {
  const view = open({ ...base, type: "theory" });
  await screen.findByText("Theory notebook");
  expect(screen.getByRole("button", { name: "2. Example" })).toBeTruthy();
  view.unmount();
  open({ ...base, type: "debugging" });
  await screen.findByRole("heading", { name: "Follow the evidence" });
  expect(screen.getByRole("button", { name: "3. Experiments" })).toBeTruthy();
});
