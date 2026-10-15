import { lazy, Suspense, useEffect, useRef, useState } from "react";
import type * as monaco from "monaco-editor/esm/vs/editor/editor.api";
import { native } from "./native";
import {
  Check,
  ChevronLeft,
  Download,
  Expand,
  FileCode2,
  Play,
  Plus,
  RotateCcw,
  Save,
  Square,
  X,
} from "lucide-react";
import { api, download, message, post, readable } from "./api";
import type { Draft, Question, Run } from "./api";
const Editor = lazy(() => import("./CodeEditor"));
type Checkpoint = { at: string; files: Record<string, string>; answer: string };
export default function Practice({
  questionId,
  theme,
  onSaved,
  onBrowse,
  sessionId,
}: {
  questionId: string;
  theme: string;
  onSaved: () => Promise<void>;
  onBrowse: () => void;
  sessionId?: string;
}) {
  const [question, setQuestion] = useState<Question | null>(null),
    [files, setFiles] = useState<Record<string, string>>({}),
    [answer, setAnswer] = useState(""),
    [activeFile, setActiveFile] = useState(""),
    [error, setError] = useState(""),
    [saveStatus, setSaveStatus] = useState("Loading draft"),
    [run, setRun] = useState<Run | null>(null),
    [busy, setBusy] = useState(false),
    [fontSize, setFontSize] = useState(14),
    [focus, setFocus] = useState(false),
    [tab, setTab] = useState<"problem" | "hints" | "rubric">("problem"),
    [confidence, setConfidence] = useState("partial"),
    [reflection, setReflection] = useState(""),
    [showCheckpoint, setShowCheckpoint] = useState(false),
    [resetConfirm, setResetConfirm] = useState(false),
    [checkpoint, setCheckpoint] = useState<Checkpoint | null>(() => {
      try {
        return JSON.parse(
          localStorage.getItem(`forgepad.v1.checkpoint.${questionId}`) ??
            "null",
        );
      } catch {
        return null;
      }
    });
  const ready = useRef(false),
    draft = useRef<Draft>({ files: {}, answer: "" }),
    editor = useRef<monaco.editor.IStandaloneCodeEditor | null>(null),
    saveSequence = useRef(0),
    saveQueue = useRef(Promise.resolve());
  useEffect(() => {
    let live = true;
    Promise.all([
      api<Question>(
        `/questions/${encodeURIComponent(questionId)}${sessionId ? `?session_id=${encodeURIComponent(sessionId)}` : ""}`,
      ),
      api<Draft>(
        `/drafts/${encodeURIComponent(questionId)}${sessionId ? `?session_id=${encodeURIComponent(sessionId)}` : ""}`,
      ),
    ])
      .then(([q, d]) => {
        if (!live) return;
        const next = {
          files: Object.keys(d.files ?? {}).length
            ? d.files
            : (q.starter_files ?? {}),
          answer: d.answer ?? "",
        };
        setQuestion(q);
        setFiles(next.files);
        setAnswer(next.answer);
        setActiveFile(Object.keys(next.files)[0] ?? "");
        draft.current = next;
        ready.current = true;
        setSaveStatus("All changes saved");
      })
      .catch((e) => {
        if (live) setError(message(e));
      });
    return () => {
      live = false;
      if (ready.current)
        void api(`/drafts/${encodeURIComponent(questionId)}`, {
          method: "PUT",
          body: JSON.stringify({ ...draft.current, session_id: sessionId }),
          keepalive: true,
        }).catch(() => {
          /* draft remains in local recovery */
        });
    };
  }, [questionId]);
  async function save(next: Draft = draft.current) {
    const seq = ++saveSequence.current;
    setSaveStatus("Saving…");
    const request = saveQueue.current
      .catch(() => {})
      .then(async () => {
        await api(`/drafts/${encodeURIComponent(questionId)}`, {
          method: "PUT",
          body: JSON.stringify({ ...next, session_id: sessionId }),
        });
      });
    saveQueue.current = request;
    try {
      await request;
      if (seq === saveSequence.current) setSaveStatus("All changes saved");
    } catch (e) {
      if (seq === saveSequence.current) {
        setSaveStatus("Save failed · local recovery kept");
        setError(message(e));
      }
      throw e;
    }
  }
  useEffect(() => {
    draft.current = { files, answer };
    if (!ready.current) return;
    localStorage.setItem(
      `forgepad.v1.recovery.${questionId}`,
      JSON.stringify(draft.current),
    );
    setSaveStatus("Unsaved changes");
    const timer = setTimeout(() => {
      void save(draft.current).catch(() => {});
    }, 650);
    return () => clearTimeout(timer);
  }, [files, answer, questionId]);
  useEffect(() => {
    if (!run || !["queued", "running"].includes(run.status)) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const result = await api<Run>(`/runs/${run.id}`);
        if (cancelled) return;
        setRun(result);
        if (["queued", "running"].includes(result.status))
          timer = setTimeout(() => void poll(), 700);
        else void onSaved();
      } catch (e) {
        if (!cancelled) {
          setError(message(e));
          timer = setTimeout(() => void poll(), 1800);
        }
      }
    };
    timer = setTimeout(() => void poll(), 500);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [run?.id, run?.status, onSaved]);
  const running = busy || (!!run && ["queued", "running"].includes(run.status));
  const coding = !!question && ["coding", "debugging"].includes(question.type);
  async function execute(mode: "run" | "submit") {
    setError("");
    setBusy(true);
    try {
      await save();
      setRun(
        await post<Run>("/runs", {
          question_id: questionId,
          files: draft.current.files,
          mode,
          session_id: sessionId,
        }),
      );
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  async function saveCheckpoint() {
    try {
      if (native)
        await post("/events", {
          kind: "code_snapshot",
          question_id: questionId,
          session_id: sessionId,
          data: draft.current,
        });
      await save();
      const cp = { ...draft.current, at: new Date().toISOString() };
      localStorage.setItem(
        `forgepad.v1.checkpoint.${questionId}`,
        JSON.stringify(cp),
      );
      setCheckpoint(cp);
      setSaveStatus("Checkpoint saved");
    } catch (e) {
      setError(message(e));
    }
  }
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        void saveCheckpoint();
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && coding && !running) {
        e.preventDefault();
        void execute(e.shiftKey ? "submit" : "run");
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [coding, running]);
  if (!question)
    return (
      <div className="page">
        {error ? (
          <div className="error-banner" role="alert">
            {error}
            <button onClick={onBrowse}>Back to questions</button>
          </div>
        ) : (
          <div className="empty">Loading problem and draft…</div>
        )}
      </div>
    );
  return (
    <div className={`practice-page ${focus ? "editor-focus" : ""}`}>
      <div className="practice-heading">
        <button
          className="icon-button"
          aria-label="Back to question bank"
          onClick={onBrowse}
        >
          <ChevronLeft size={19} />
        </button>
        <div>
          <h1>{question.title}</h1>
          <div className="button-row">
            <span className={`badge ${question.difficulty}`}>
              {question.difficulty}
            </span>
            <span className="muted-text">
              {readable(question.type)} · {question.duration_minutes} min · v
              {question.version}
            </span>
          </div>
        </div>
        <div className="practice-actions">
          <span className="save-status" aria-live="polite">
            {saveStatus}
          </span>
          <button
            className="secondary"
            title="Save checkpoint (Ctrl/Cmd+S)"
            onClick={() => void saveCheckpoint()}
          >
            <Save size={15} />
            <span>Save checkpoint</span>
          </button>
        </div>
      </div>
      {error && (
        <div className="error-banner" role="alert">
          {error}
          <button
            className="icon-button"
            aria-label="Dismiss error"
            onClick={() => setError("")}
          >
            <X size={15} />
          </button>
        </div>
      )}
      <div className="practice-layout">
        <section className="problem-pane">
          <div className="tabs" role="tablist" aria-label="Question details">
            {(["problem", "hints", "rubric"] as const).map((t) => (
              <button
                role="tab"
                aria-selected={tab === t}
                key={t}
                className={tab === t ? "active" : ""}
                onClick={() => setTab(t)}
              >
                {t === "problem"
                  ? "Problem"
                  : t === "hints"
                    ? "Hints"
                    : "Review criteria"}
              </button>
            ))}
          </div>
          <div className="problem-content">
            {tab === "problem" ? (
              <>
                <div className="eyebrow">{question.topics.join(" / ")}</div>
                <h2>{question.title}</h2>
                <div className="prose">{question.prompt}</div>
                {question.constraints?.length > 0 && (
                  <>
                    <h3>Constraints</h3>
                    <ul>
                      {question.constraints.map((c, i) => (
                        <li key={i}>{c}</li>
                      ))}
                    </ul>
                  </>
                )}
                {(question.test_config?.tests?.length ?? 0) > 0 && (
                  <>
                    <h3>Public examples</h3>
                    {question.test_config?.tests.map((t) => (
                      <details key={t.id}>
                        <summary>{t.name}</summary>
                        <div className="example">
                          <span>{t.fixture ? "TEST FIXTURE" : "INPUT"}</span>
                          <pre>
                            {t.fixture || t.stdin || "(no standard input)"}
                          </pre>
                          <span>EXPECTED OUTPUT</span>
                          <pre>{t.expected_stdout || "(empty)"}</pre>
                        </div>
                      </details>
                    ))}
                  </>
                )}
                {question.source && (
                  <div className="source-note">
                    Source:{" "}
                    {question.source.url ? (
                      <a
                        href={question.source.url}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {question.source.name}
                      </a>
                    ) : (
                      question.source.name
                    )}{" "}
                    · {question.source.license}
                  </div>
                )}
              </>
            ) : tab === "hints" ? (
              <>
                <h2>Hints</h2>
                <p className="muted-text">Open one when you need a nudge.</p>
                {question.hints?.map((hint, i) => (
                  <details
                    key={i}
                    onToggle={(e) => {
                      if (native && e.currentTarget.open)
                        void post("/events", {
                          kind: "hint_request",
                          question_id: questionId,
                          session_id: sessionId,
                          data: { hint_index: i },
                        }).catch((e) => setError(message(e)));
                    }}
                  >
                    <summary>Hint {i + 1}</summary>
                    <p>{hint}</p>
                  </details>
                ))}
                {!question.hints?.length && (
                  <p>No hints provided for this question.</p>
                )}
              </>
            ) : (
              <>
                <h2>Review criteria</h2>
                <ul>
                  {question.rubric?.map((criterion, i) => (
                    <li key={i}>{criterion}</li>
                  ))}
                </ul>
                <p className="muted-text">
                  Use these criteria to reflect on correctness, tradeoffs, and
                  clarity.
                </p>
              </>
            )}
          </div>
        </section>
        <section className="work-pane">
          {coding ? (
            <>
              <div className="editor-toolbar">
                <div
                  className="file-tabs"
                  role="tablist"
                  aria-label="Source files"
                >
                  {Object.keys(files).map((file) => (
                    <button
                      role="tab"
                      aria-selected={file === activeFile}
                      className={activeFile === file ? "active" : ""}
                      key={file}
                      onClick={() => setActiveFile(file)}
                    >
                      <FileCode2 size={14} />
                      {file}
                    </button>
                  ))}
                  <button
                    className="icon-button"
                    title="Add file"
                    aria-label="Add source file"
                    onClick={() => {
                      const name = window.prompt(
                        "Filename (C/C++ source or header, no directories)",
                      );
                      if (!name) return;
                      if (
                        !/^[\w.-]+\.(c|cpp|cc|h|hpp)$/.test(name) ||
                        name.includes("..")
                      ) {
                        setError(
                          "Use a flat filename ending in .c, .cpp, .cc, .h, or .hpp.",
                        );
                        return;
                      }
                      if (name in files) {
                        setActiveFile(name);
                        return;
                      }
                      setFiles({ ...files, [name]: "" });
                      setActiveFile(name);
                    }}
                  >
                    <Plus size={14} />
                  </button>
                </div>
                <div className="button-row">
                  <select
                    aria-label="Editor font size"
                    value={fontSize}
                    onChange={(e) => setFontSize(Number(e.target.value))}
                  >
                    {[12, 14, 16, 18, 20].map((n) => (
                      <option key={n} value={n}>
                        {n}px
                      </option>
                    ))}
                  </select>
                  <button
                    className="icon-button"
                    aria-label={focus ? "Exit editor focus" : "Focus editor"}
                    title="Toggle editor focus"
                    onClick={() => setFocus(!focus)}
                  >
                    <Expand size={15} />
                  </button>
                </div>
              </div>
              <div className="editor-container">
                {activeFile ? (
                  <Suspense
                    fallback={
                      <div className="empty">Opening local editor…</div>
                    }
                  >
                    {" "}
                    <Editor
                      path={`${questionId}/${activeFile}`}
                      language={question.language === "c" ? "c" : "cpp"}
                      theme={theme === "dark" ? "vs-dark" : "light"}
                      value={files[activeFile] ?? ""}
                      onChange={(value) =>
                        setFiles((previous) => ({
                          ...previous,
                          [activeFile]: value ?? "",
                        }))
                      }
                      onMount={(instance) => {
                        editor.current = instance;
                      }}
                      options={{
                        fontSize,
                        minimap: { enabled: false },
                        scrollBeyondLastLine: false,
                        automaticLayout: true,
                        padding: { top: 18 },
                        tabSize: 4,
                        insertSpaces: true,
                        wordWrap: "on",
                        fontFamily:
                          '"SFMono-Regular", Consolas, "Liberation Mono", monospace',
                        accessibilitySupport: "on",
                      }}
                    />
                  </Suspense>
                ) : (
                  <div className="empty">Add a source file to begin.</div>
                )}
              </div>
              <div className="editor-bottom">
                <span>
                  {question.language === "cpp" ? "C++17" : "C11"} · UTF-8
                </span>
                <div className="button-row">
                  <button
                    className="text-button"
                    onClick={() => {
                      setFiles((previous) =>
                        Object.fromEntries(
                          Object.entries(previous).map(([name, code]) => [
                            name,
                            code
                              .split("\n")
                              .map((line) => line.trimEnd())
                              .join("\n")
                              .replace(/\n*$/, "\n"),
                          ]),
                        ),
                      );
                      setSaveStatus("Whitespace normalized");
                    }}
                  >
                    Format whitespace
                  </button>
                  <button
                    className="text-button"
                    onClick={() => setResetConfirm(true)}
                  >
                    <RotateCcw size={12} />
                    Reset
                  </button>
                  <button
                    className="text-button"
                    disabled={!checkpoint}
                    onClick={() => setShowCheckpoint(true)}
                  >
                    Restore checkpoint
                  </button>
                </div>
              </div>
            </>
          ) : (
            <div className="written-response">
              <div className="section-header">
                <div>
                  <h2>Your response</h2>
                  <p>Explain assumptions, reasoning, and tradeoffs.</p>
                </div>
              </div>
              <textarea
                aria-label="Written response"
                value={answer}
                onChange={(e) => setAnswer(e.target.value)}
                placeholder="Start with what you know, then work through the details…"
                rows={18}
              />
              <div className="response-meta">
                <label>
                  Confidence
                  <select
                    value={confidence}
                    onChange={(e) => setConfidence(e.target.value)}
                  >
                    <option value="confident">Confident</option>
                    <option value="partial">Partial understanding</option>
                    <option value="uncertain">Uncertain</option>
                  </select>
                </label>
                <label>
                  Reflection (optional)
                  <textarea
                    rows={3}
                    value={reflection}
                    onChange={(e) => setReflection(e.target.value)}
                    placeholder="What would you revisit?"
                  />
                </label>
              </div>
            </div>
          )}
          <div className="run-toolbar">
            <span className="muted-text">
              {coding
                ? "Run checks public tests. Submit includes hidden tests."
                : "Written responses are recorded for self-review."}
            </span>
            <div className="button-row">
              {running && run ? (
                <button
                  className="secondary"
                  onClick={() =>
                    void api(`/runs/${run.id}`, { method: "DELETE" })
                      .then(() => setRun({ ...run, status: "cancelled" }))
                      .catch((e) => setError(message(e)))
                  }
                >
                  <Square size={13} />
                  Cancel
                </button>
              ) : null}
              {coding ? (
                <>
                  <button
                    disabled={running || !Object.keys(files).length}
                    onClick={() => void execute("run")}
                  >
                    <Play size={14} />
                    Run
                  </button>
                  <button
                    className="primary"
                    disabled={running || !Object.keys(files).length}
                    onClick={() => void execute("submit")}
                  >
                    {running ? "Running…" : "Submit"}
                  </button>
                </>
              ) : (
                <button
                  className="primary"
                  disabled={busy || !answer.trim()}
                  onClick={async () => {
                    setBusy(true);
                    setError("");
                    try {
                      await save();
                      await post("/attempts", {
                        question_id: questionId,
                        answer,
                        confidence,
                        reflection,
                      });
                      setSaveStatus("Response submitted");
                      await onSaved();
                    } catch (e) {
                      setError(message(e));
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  <Check size={15} />
                  {busy ? "Saving…" : "Submit response"}
                </button>
              )}
            </div>
          </div>
          {coding && (
            <section
              className="output-panel"
              aria-label="Execution output"
              aria-live="polite"
            >
              <div className="section-header">
                <h2>Test results</h2>
                {run && (
                  <span
                    className={`badge ${run.result?.status === "passed" ? "success" : ""}`}
                  >
                    {readable(run.result?.status ?? run.status)}
                  </span>
                )}
              </div>
              {!run ? (
                <div className="output-empty">
                  <span className="terminal-prompt">›_</span>
                  <p>Run your code to inspect test results.</p>
                  <small>
                    Ctrl / ⌘ + Enter to run · Shift + Ctrl / ⌘ + Enter to submit
                  </small>
                </div>
              ) : run.result ? (
                <>
                  <div className="result-summary">
                    <strong>
                      {run.result.passed} / {run.result.total} tests passed
                    </strong>
                    {run.result.elapsed_ms !== undefined && (
                      <span>{run.result.elapsed_ms} ms</span>
                    )}
                  </div>
                  {run.result.compiler_output && (
                    <pre className="compiler-output">
                      {run.result.compiler_output}
                    </pre>
                  )}
                  {run.result.tests?.map((test) => (
                    <details className="test-result" key={test.id}>
                      <summary>
                        <span
                          className={`test-dot ${test.status === "passed" ? "passed" : "failed"}`}
                        />
                        <strong>{test.name || test.id}</strong>
                        <span className="muted-text">{test.visibility}</span>
                        <span className="badge">{readable(test.status)}</span>
                      </summary>
                      {test.stdout && (
                        <>
                          <h4>Output</h4>
                          <pre>{test.stdout}</pre>
                        </>
                      )}
                      {test.expected_stdout !== undefined && (
                        <>
                          <h4>Expected output</h4>
                          <pre>{test.expected_stdout}</pre>
                        </>
                      )}
                      {test.stderr && (
                        <>
                          <h4>Diagnostics</h4>
                          <pre>{test.stderr}</pre>
                        </>
                      )}
                      {test.visibility === "hidden" && (
                        <p className="muted-text">
                          Hidden test inputs and expected outputs are withheld.
                        </p>
                      )}
                    </details>
                  ))}
                </>
              ) : (
                <div className="empty">
                  {run.status === "cancelled"
                    ? "Run cancelled."
                    : "Waiting for the isolated runner…"}
                </div>
              )}
            </section>
          )}
        </section>
      </div>
      {(resetConfirm || showCheckpoint) && (
        <div className="modal-backdrop">
          <section
            className="modal small-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="restore-title"
          >
            <div className="modal-body">
              <h2 id="restore-title">
                {resetConfirm
                  ? "Reset to starter files?"
                  : "Restore saved checkpoint?"}
              </h2>
              <p>
                {resetConfirm
                  ? "Your current draft will be replaced with the question’s starter files."
                  : `Your current draft will be replaced by the checkpoint from ${checkpoint ? new Date(checkpoint.at).toLocaleString() : ""}.`}
              </p>
              <div className="modal-actions">
                <button
                  onClick={() => {
                    setResetConfirm(false);
                    setShowCheckpoint(false);
                  }}
                >
                  Cancel
                </button>
                <button
                  className="primary"
                  onClick={() => {
                    const next = resetConfirm
                      ? { files: question.starter_files, answer: "" }
                      : checkpoint!;
                    setFiles(next.files);
                    setAnswer(next.answer);
                    setActiveFile(Object.keys(next.files)[0] ?? "");
                    setResetConfirm(false);
                    setShowCheckpoint(false);
                  }}
                >
                  Replace draft
                </button>
              </div>
            </div>
          </section>
        </div>
      )}
      <div className="practice-footer">
        <button
          className="text-button"
          onClick={() => download(`${questionId}-draft.json`, draft.current)}
        >
          <Download size={13} />
          Export draft
        </button>
        <span>
          Drafts save after 650 ms · Checkpoints are kept in this browser
        </span>
      </div>
    </div>
  );
}
