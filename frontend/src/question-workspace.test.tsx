import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
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
  default: ({
    value,
    onChange,
    path,
    revealPosition,
  }: {
    value: string;
    onChange: (value: string) => void;
    path: string;
    revealPosition?: { lineNumber: number; column: number };
  }) => (
    <div data-testid="code-editor">
      <textarea
        aria-label="Code editor"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
      <span data-testid="editor-location">
        {path}:{revealPosition?.lineNumber}:{revealPosition?.column}
      </span>
    </div>
  ),
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
  expect(screen.getByRole("button", { name: "Run all tests" })).toBeTruthy();
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

const coding: Question = {
  ...base,
  type: "coding",
  language: "c",
  starter_files: {
    "main.c": '#include "buffer.h"\nint main(void) { return 0; }',
    "buffer.h": "int buffer_size;",
  },
};

it("resizes with the keyboard and remembers the divider and collapsed problem panel", async () => {
  const user = userEvent.setup();
  const view = open(coding);
  const divider = await screen.findByRole("separator", {
    name: "Resize problem pane",
  });
  divider.focus();
  await user.keyboard("{End}");
  expect(divider.getAttribute("aria-valuenow")).toBe("60");
  await user.keyboard("{ArrowLeft}");
  expect(divider.getAttribute("aria-valuenow")).toBe("58");
  await user.click(screen.getByRole("button", { name: "Hide problem" }));
  expect(screen.queryByRole("region", { name: "Problem panel" })).toBeNull();
  view.unmount();
  open(coding);
  await user.click(await screen.findByRole("button", { name: "Show problem" }));
  expect(screen.getByRole("separator").getAttribute("aria-valuenow")).toBe(
    "58",
  );
  const problem = screen.getByRole("tab", { name: "Problem" });
  problem.focus();
  await user.keyboard("{ArrowRight}");
  expect(
    screen.getByRole("tab", { name: "Hints" }).getAttribute("aria-selected"),
  ).toBe("true");
});

it("autosaves edits separately from checkpoints and restores or resets the draft explicitly", async () => {
  const user = userEvent.setup();
  open(coding);
  const source = await screen.findByRole("textbox", { name: "Code editor" });
  await user.clear(source);
  await user.type(source, "int checkpoint_value;");
  await user.click(screen.getByRole("button", { name: "Save checkpoint" }));
  await screen.findByText(/^Checkpoint saved:/);
  await user.clear(source);
  await user.type(source, "int later_value;");
  await screen.findByText("Draft autosaved");
  expect(api).toHaveBeenCalledWith(
    "/drafts/question",
    expect.objectContaining({ body: expect.stringContaining("later_value") }),
  );
  await user.click(
    screen.getByRole("button", { name: "Restore saved checkpoint" }),
  );
  await user.keyboard("{Escape}");
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(document.activeElement).toBe(
    screen.getByRole("button", { name: "Restore saved checkpoint" }),
  );
  await user.click(
    screen.getByRole("button", { name: "Restore saved checkpoint" }),
  );
  await user.click(
    within(screen.getByRole("dialog")).getByRole("button", {
      name: "Restore checkpoint to draft",
    }),
  );
  expect((source as HTMLTextAreaElement).value).toBe("int checkpoint_value;");
  await user.click(
    screen.getByRole("button", { name: "Reset to starter files" }),
  );
  await user.click(
    within(screen.getByRole("dialog")).getByRole("button", {
      name: "Reset draft to starter files",
    }),
  );
  expect((source as HTMLTextAreaElement).value).toBe(
    coding.starter_files["main.c"],
  );
  expect(
    screen
      .getByRole("button", { name: "Restore saved checkpoint" })
      .hasAttribute("disabled"),
  ).toBe(false);
});

it("runs every visible test, links diagnostics across files, and marks results stale after edits", async () => {
  const user = userEvent.setup();
  open(coding);
  await screen.findByTestId("code-editor");
  post.mockResolvedValue({
    id: "run-1",
    status: "complete",
    result: {
      status: "compile_error",
      passed: 0,
      total: 1,
      compiler_output: "/workspace/buffer.h:1:5: error: expected semicolon",
      tests: [
        {
          id: "secret",
          name: "Hidden case",
          visibility: "hidden",
          status: "failed",
          stderr: "secret diagnostic",
        },
      ],
    },
  });
  await user.click(screen.getByRole("button", { name: "Run all tests" }));
  const diagnostic = await screen.findByRole("button", {
    name: /buffer.h:1:5.*expected semicolon/,
  });
  expect(post).toHaveBeenCalledWith(
    "/runs",
    expect.objectContaining({ mode: "run", files: coding.starter_files }),
  );
  expect(screen.getByText("secret diagnostic")).toBeTruthy();
  await user.click(diagnostic);
  expect(
    screen.getByRole("tab", { name: "buffer.h" }).getAttribute("aria-selected"),
  ).toBe("true");
  expect(screen.getByTestId("editor-location").textContent).toContain(
    "buffer.h:1:5",
  );
  await user.type(screen.getByRole("textbox", { name: "Code editor" }), " ");
  expect(screen.getByText(/Code changed since these results/)).toBeTruthy();
  expect(diagnostic.hasAttribute("disabled")).toBe(true);
});

it("shows queued progress, sends submit mode, and cancels the active execution", async () => {
  const user = userEvent.setup();
  open(coding);
  await screen.findByTestId("code-editor");
  post.mockResolvedValue({ id: "queued-run", status: "queued" });
  await user.keyboard("{Control>}{Shift>}{Enter}{/Shift}{/Control}");
  await screen.findByRole("progressbar", {
    name: "Test execution in progress",
  });
  expect(post).toHaveBeenCalledWith(
    "/runs",
    expect.objectContaining({ mode: "submit" }),
  );
  expect(
    screen
      .getByRole("button", { name: "Run all tests" })
      .hasAttribute("disabled"),
  ).toBe(true);
  await user.click(screen.getByRole("button", { name: "Cancel execution" }));
  await screen.findByText("Run cancelled.");
  expect(api).toHaveBeenCalledWith("/runs/queued-run", { method: "DELETE" });
});

it("keeps code editable and displays execution failures beside the editor", async () => {
  const user = userEvent.setup();
  open(coding);
  const source = await screen.findByRole("textbox", { name: "Code editor" });
  post.mockRejectedValueOnce(new Error("Runner unavailable"));
  await user.click(screen.getByRole("button", { name: "Run all tests" }));
  const output = screen.getByRole("region", { name: "Execution output" });
  expect(await within(output).findByRole("alert")).toHaveProperty(
    "textContent",
    "Runner unavailable",
  );
  expect((source as HTMLTextAreaElement).value).toBe(
    coding.starter_files["main.c"],
  );
  expect(screen.queryByRole("progressbar")).toBeNull();
});

it("reports autosave failure and keeps the current draft in local recovery", async () => {
  const user = userEvent.setup();
  open(coding);
  const source = await screen.findByRole("textbox", { name: "Code editor" });
  api.mockRejectedValue(new Error("Disk unavailable"));
  await user.type(source, " // kept locally");
  await screen.findByText("Autosave failed · local recovery kept");
  await waitFor(() =>
    expect(localStorage.getItem("forgepad.v1.recovery.question")).toContain(
      "kept locally",
    ),
  );
});

it("describes a runner failure without reporting a misleading zero-test pass count", async () => {
  const user = userEvent.setup();
  open(coding);
  await screen.findByTestId("code-editor");
  post.mockResolvedValue({
    id: "unavailable-run",
    status: "complete",
    result: {
      status: "unavailable",
      passed: 0,
      total: 0,
      tests: [],
      compiler_output: "Start the runner.",
    },
  });
  await user.click(screen.getByRole("button", { name: "Run all tests" }));
  await screen.findByText("Runner unavailable · no tests ran");
  expect(screen.queryByText("0 / 0 tests passed")).toBeNull();
});

it("identifies OpenRouter coaching and its data flow before asking", async () => {
  const user = userEvent.setup();
  open({ ...base, coach_provider: "openrouter", coach_model: "test/model" });
  await screen.findByRole("heading", { name: "Build your approach" });
  await user.click(screen.getByRole("tab", { name: "Hints" }));
  const coach = screen.getByRole("region", { name: "Reasoning coach" });
  expect(within(coach).getByText("OpenRouter")).toBeTruthy();
  expect(within(coach).getByText(/Model: test\/model/)).toBeTruthy();
  expect(
    within(coach).getByText(
      /answer, code and recent coach messages are sent to OpenRouter/,
    ),
  ).toBeTruthy();
  expect(within(coach).queryByText("On device")).toBeNull();
  await user.click(
    within(coach).getByRole("button", { name: "Help me reason" }),
  );
  await within(coach).findByText("How will you handle a full queue?");
});
