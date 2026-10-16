import { PaneDivider } from "./PaneDivider";
import { usePracticeActivity } from "./usePracticeActivity";
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import type * as monaco from "monaco-editor/esm/vs/editor/editor.api";
import { parseDiagnostics } from "./editorSupport";
import { native, nativeEvents } from "./native";
import ReasoningWorkspace from "./ReasoningWorkspace";
import QuestionCoach from "./QuestionCoach";
import { questionMode, modeNames } from "./questionMode";
import VoiceInput from "./VoiceInput";
import TranscriptCleanup from "./TranscriptCleanup";
import {
  Check,
  ChevronLeft,
  Download,
  FileCode2,
  Play,
  PanelLeftClose,
  PanelLeftOpen,
  LoaderCircle,
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
function navigateTabs(event: ReactKeyboardEvent<HTMLDivElement>) {
  if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
  const tabs = [
    ...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]'),
  ];
  const index = tabs.indexOf(event.target as HTMLButtonElement);
  if (index < 0) return;
  event.preventDefault();
  const next =
    event.key === "Home"
      ? 0
      : event.key === "End"
        ? tabs.length - 1
        : (index + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) %
          tabs.length;
  tabs[next]?.focus();
  tabs[next]?.click();
}
export default function Practice({
  questionId,
  questionVersion,
  theme,
  onSaved,
  onBrowse,
  sessionId,
}: {
  questionId: string;
  questionVersion?: number;
  theme: string;
  onSaved: () => Promise<void>;
  onBrowse: () => void;
  sessionId?: string;
}) {
  usePracticeActivity(questionId, sessionId);
  const layout = useRef<HTMLDivElement>(null);
  const dialogTrigger = useRef<HTMLButtonElement | null>(null);
  const [paneWidth, setPaneWidth] = useState(() =>
    Math.max(
      25,
      Math.min(60, Number(localStorage.getItem("forgepad.pane.width")) || 36),
    ),
  );
  const resizePane = (value: number) => {
    setPaneWidth(value);
    localStorage.setItem("forgepad.pane.width", String(value));
  };
  const [question, setQuestion] = useState<Question | null>(null),
    [files, setFiles] = useState<Record<string, string>>({}),
    [answer, setAnswer] = useState(""),
    [activeFile, setActiveFile] = useState(""),
    [error, setError] = useState(""),
    [saveStatus, setSaveStatus] = useState("Loading draft"),
    [run, setRun] = useState<Run | null>(null),
    [busy, setBusy] = useState(false),
    [runMode, setRunMode] = useState<"run" | "submit">("run"),
    [runFiles, setRunFiles] = useState<Record<string, string> | null>(null),
    [executionError, setExecutionError] = useState(""),
    [editorLocation, setEditorLocation] = useState<
      { file: string; lineNumber: number; column: number } | undefined
    >(),
    [checkpointSaving, setCheckpointSaving] = useState(false),
    [dictating, setDictating] = useState(false),
    [fontSize, setFontSize] = useState(
      () => Number(localStorage.getItem("forgepad.editor.fontSize")) || 14,
    ),
    [problemCollapsed, setProblemCollapsed] = useState(
      () => localStorage.getItem("forgepad.problem.collapsed") === "true",
    ),
    [tab, setTab] = useState<"problem" | "hints" | "rubric">("problem"),
    [confidence, setConfidence] = useState("partial"),
    [reflection, setReflection] = useState(""),
    [showCheckpoint, setShowCheckpoint] = useState(false),
    [resetConfirm, setResetConfirm] = useState(false),
    [externalDraft, setExternalDraft] = useState<Draft | null>(null),
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
    loadedVersion = useRef<number | undefined>(questionVersion),
    saveSequence = useRef(0),
    savedAt = useRef<string | null>(null),
    savedContent = useRef(""),
    saveQueue = useRef(Promise.resolve());
  useEffect(() => {
    let live = true;
    Promise.all([
      api<Question>(
        `/questions/${encodeURIComponent(questionId)}${sessionId ? `?session_id=${encodeURIComponent(sessionId)}` : questionVersion ? `?version=${questionVersion}` : ""}`,
      ),
      api<Draft>(
        `/drafts/${encodeURIComponent(questionId)}${sessionId ? `?session_id=${encodeURIComponent(sessionId)}` : questionVersion ? `?version=${questionVersion}` : ""}`,
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
        loadedVersion.current = q.version;
        setQuestion(q);
        setFiles(next.files);
        setAnswer(next.answer);
        setActiveFile(
          Object.keys(next.files).find((name) => /\.(c|cpp|cc)$/.test(name)) ??
            Object.keys(next.files)[0] ??
            "",
        );
        draft.current = next;
        savedAt.current = d.updated_at ?? null;
        savedContent.current = JSON.stringify(next);
        ready.current = true;
        setSaveStatus("Draft autosaved");
      })
      .catch((e) => {
        if (live) setError(message(e));
      });
    return () => {
      live = false;
      if (ready.current) {
        const finalDraft = {
          ...draft.current,
          session_id: sessionId,
          question_version: loadedVersion.current,
          ...(native ? { updated_at: savedAt.current } : {}),
        };
        saveQueue.current = saveQueue.current
          .catch(() => {})
          .then(async () => {
            await api(`/drafts/${encodeURIComponent(questionId)}`, {
              method: "PUT",
              body: JSON.stringify({
                ...finalDraft,
                ...(native ? { updated_at: savedAt.current } : {}),
              }),
              keepalive: true,
            });
          })
          .catch(() => {
            /* Local recovery remains available. */
          });
      }
    };
  }, [questionId, questionVersion, sessionId]);
  async function save(next: Draft = draft.current) {
    const seq = ++saveSequence.current;
    setSaveStatus("Autosaving draft…");
    const request = saveQueue.current
      .catch(() => {})
      .then(async () => {
        const result = await api<Draft>(
          `/drafts/${encodeURIComponent(questionId)}`,
          {
            method: "PUT",
            body: JSON.stringify({
              ...next,
              session_id: sessionId,
              question_version: question?.version,
              ...(native ? { updated_at: savedAt.current } : {}),
            }),
          },
        );
        savedAt.current = result.updated_at ?? null;
        savedContent.current = JSON.stringify(next);
      });
    saveQueue.current = request;
    try {
      await request;
      if (seq === saveSequence.current)
        setSaveStatus(
          JSON.stringify(draft.current) === savedContent.current
            ? "Draft autosaved"
            : "Draft changed · autosave pending",
        );
    } catch (e) {
      if (seq === saveSequence.current) {
        setSaveStatus("Autosave failed · local recovery kept");
        setError(message(e));
      }
      throw e;
    }
  }
  useEffect(() => {
    const flush = (event: Event) => {
      if (ready.current)
        (event as CustomEvent<Promise<unknown>[]>).detail.push(save());
    };
    window.addEventListener("forgepad:flush", flush);
    return () => window.removeEventListener("forgepad:flush", flush);
  }, [question?.version, sessionId]);
  useEffect(() => {
    if (!native) return;
    let live = true;
    let stop: (() => void) | undefined;
    void nativeEvents((event) => {
      if (
        event.type !== "draft_updated" ||
        (event.data as { question_id?: string })?.question_id !== questionId
      )
        return;
      void saveQueue.current
        .catch(() => {})
        .then(async () => {
          const latest = await api<Draft>(
            `/drafts/${encodeURIComponent(questionId)}?version=${loadedVersion.current}`,
          );
          if (!live) return;
          if (JSON.stringify(draft.current) === savedContent.current) {
            savedAt.current = latest.updated_at ?? null;
            const next = { files: latest.files, answer: latest.answer };
            savedContent.current = JSON.stringify(next);
            draft.current = next;
            setFiles(next.files);
            setAnswer(next.answer);
            setActiveFile((previous) =>
              previous in next.files
                ? previous
                : (Object.keys(next.files).find((name) =>
                    /\.(c|cpp|cc)$/.test(name),
                  ) ??
                  Object.keys(next.files)[0] ??
                  ""),
            );
          } else setExternalDraft(latest);
        })
        .catch((e) => {
          if (live) setError(message(e));
        });
    }).then((fn) => {
      if (live) stop = fn;
      else fn();
    });
    return () => {
      live = false;
      stop?.();
    };
  }, [questionId]);
  useEffect(() => {
    draft.current = { files, answer };
    if (!ready.current) return;
    localStorage.setItem(
      `forgepad.v1.recovery.${questionId}`,
      JSON.stringify(draft.current),
    );
    if (JSON.stringify(draft.current) === savedContent.current) return;
    setSaveStatus("Draft changed · autosave pending");
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
        setExecutionError("");
        if (["queued", "running"].includes(result.status))
          timer = setTimeout(() => void poll(), 700);
        else void onSaved();
      } catch (e) {
        if (!cancelled) {
          setExecutionError(
            `Could not refresh test results: ${message(e)}. Retrying…`,
          );
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
  const mode = question ? questionMode(question) : "coding";
  const coding = mode === "coding";
  const resultsStale =
    runFiles !== null &&
    (Object.keys(files).length !== Object.keys(runFiles).length ||
      Object.entries(files).some(([file, code]) => code !== runFiles[file]));
  const diagnostics = useMemo(
    () =>
      parseDiagnostics(
        [
          run?.result?.compiler_output ?? "",
          ...(run?.result?.tests?.map((test) => test.stderr ?? "") ?? []),
        ].join("\n"),
        runFiles ?? {},
      ),
    [run?.result, runFiles],
  );
  const activeDiagnostics = useMemo(
    () =>
      resultsStale
        ? []
        : diagnostics.filter((item) => item.file === activeFile),
    [diagnostics, activeFile, resultsStale],
  );
  const executionStatus = busy
    ? `Saving draft before ${runMode === "run" ? "running all tests" : "submitting all tests"}…`
    : run?.status === "queued"
      ? "Queued · waiting for the isolated runner…"
      : "Compiling and running all tests…";
  async function execute(mode: "run" | "submit") {
    if (running || !Object.keys(draft.current.files).length) return;
    setError("");
    setExecutionError("");
    setRunMode(mode);
    setRun(null);
    const snapshot = draft.current;
    setRunFiles(snapshot.files);
    setBusy(true);
    try {
      await save(snapshot);
      setRun(
        await post<Run>("/runs", {
          question_id: questionId,
          files: snapshot.files,
          question_version: question?.version,
          mode,
          session_id: sessionId,
        }),
      );
    } catch (e) {
      setExecutionError(message(e));
    } finally {
      setBusy(false);
    }
  }
  async function saveCheckpoint() {
    if (!ready.current || checkpointSaving) return;
    const snapshot = draft.current;
    setCheckpointSaving(true);
    try {
      if (native)
        await post("/events", {
          kind: "code_snapshot",
          question_id: questionId,
          session_id: sessionId,
          data: snapshot,
        });
      await save(snapshot);
      const cp = { ...snapshot, at: new Date().toISOString() };
      localStorage.setItem(
        `forgepad.v1.checkpoint.${questionId}`,
        JSON.stringify(cp),
      );
      setCheckpoint(cp);
    } catch (e) {
      setError(message(e));
    } finally {
      setCheckpointSaving(false);
    }
  }
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void saveCheckpoint();
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && coding && !running) {
        e.preventDefault();
        if (!resetConfirm && !showCheckpoint)
          void execute(e.shiftKey ? "submit" : "run");
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  });
  if (!question)
    return (
      <div className="page">
        {error ? (
          <div className="error-banner" role="alert">
            {error}
            <button onClick={onBrowse}>Back to Question Library</button>
          </div>
        ) : (
          <div className="empty">Loading problem and draft…</div>
        )}
      </div>
    );
  return (
    <div
      className={`practice-page ${problemCollapsed ? "problem-collapsed" : ""}`}
    >
      <div className="practice-heading">
        <button
          className="icon-button"
          aria-label="Back to Question Library"
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
              {modeNames[mode]} · {question.duration_minutes} min · v
              {question.version}
            </span>
          </div>
        </div>
        <div className="practice-actions">
          <button
            className="secondary"
            aria-expanded={!problemCollapsed}
            aria-controls="problem-panel"
            onClick={() => {
              const collapsed = !problemCollapsed;
              setProblemCollapsed(collapsed);
              localStorage.setItem(
                "forgepad.problem.collapsed",
                String(collapsed),
              );
            }}
          >
            {problemCollapsed ? (
              <PanelLeftOpen size={15} />
            ) : (
              <PanelLeftClose size={15} />
            )}
            {problemCollapsed ? "Show problem" : "Hide problem"}
          </button>
          <button
            className="secondary"
            title="Save a manual restore point on this device (Ctrl/Cmd+S)"
            disabled={checkpointSaving}
            onClick={() => void saveCheckpoint()}
          >
            <Save size={15} />
            <span>
              {checkpointSaving ? "Saving checkpoint…" : "Save checkpoint"}
            </span>
          </button>
        </div>
      </div>
      <div className="draft-saving-info">
        <span className="save-status" role="status">
          {saveStatus}
        </span>
        <span>
          Drafts autosave as you type. Checkpoints keep a manual restore point
          on this device.
        </span>
        <span className="checkpoint-status" role="status">
          {checkpoint
            ? `Checkpoint saved: ${new Date(checkpoint.at).toLocaleString()}`
            : "No checkpoint saved yet."}
        </span>
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
      {externalDraft && (
        <div className="notice" role="status">
          <p>
            HeyClicky saved a newer draft. Your edits are kept in local
            recovery.
          </p>
          <div className="button-row">
            <button
              onClick={() => {
                savedAt.current = externalDraft.updated_at ?? null;
                localStorage.setItem(
                  `forgepad.v1.conflict.${questionId}`,
                  JSON.stringify(draft.current),
                );
                setFiles(externalDraft.files);
                setAnswer(externalDraft.answer);
                setActiveFile((previous) =>
                  previous in externalDraft.files
                    ? previous
                    : (Object.keys(externalDraft.files).find((name) =>
                        /\.(c|cpp|cc)$/.test(name),
                      ) ??
                      Object.keys(externalDraft.files)[0] ??
                      ""),
                );
                setExternalDraft(null);
                setError("");
              }}
            >
              Load HeyClicky draft
            </button>
            <button
              onClick={() => {
                savedAt.current = externalDraft.updated_at ?? null;
                setExternalDraft(null);
                void save().catch(() => {});
              }}
            >
              Keep my edits
            </button>
          </div>
        </div>
      )}
      <div
        className="practice-layout"
        ref={layout}
        style={{
          gridTemplateColumns: problemCollapsed
            ? "minmax(0, 1fr)"
            : `minmax(220px, ${paneWidth}%) 12px minmax(0, 1fr)`,
        }}
      >
        <section
          className="problem-pane"
          id="problem-panel"
          aria-label="Problem panel"
          hidden={problemCollapsed}
        >
          <div
            className="tabs"
            role="tablist"
            aria-label="Question details"
            onKeyDown={navigateTabs}
          >
            {(["problem", "hints", "rubric"] as const).map((t) => (
              <button
                role="tab"
                aria-selected={tab === t}
                id={`problem-tab-${t}`}
                aria-controls="problem-tab-content"
                tabIndex={tab === t ? 0 : -1}
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
          <div
            className="problem-content"
            id="problem-tab-content"
            role="tabpanel"
            aria-labelledby={`problem-tab-${tab}`}
            tabIndex={0}
          >
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
                    <h3>
                      Visible test cases ({question.test_config?.tests.length})
                    </h3>
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
                {question.coaching_available === false ? (
                  <p className="muted-text">
                    Coaching is available in practice. Use the interviewer for
                    clarifications during a strict interview.
                  </p>
                ) : (
                  <QuestionCoach
                    question={question}
                    sessionId={sessionId}
                    answer={answer}
                    files={files}
                  />
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
        {!problemCollapsed && (
          <PaneDivider
            container={layout}
            value={paneWidth}
            onChange={resizePane}
          />
        )}
        <section className="work-pane">
          {coding ? (
            <>
              <div className="editor-toolbar">
                <div
                  className="file-tabs"
                  role="tablist"
                  aria-label="Source files"
                  onKeyDown={navigateTabs}
                >
                  {Object.keys(files).map((file, index) => (
                    <button
                      role="tab"
                      aria-selected={file === activeFile}
                      tabIndex={file === activeFile ? 0 : -1}
                      id={`source-file-${index}`}
                      aria-controls="source-editor"
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
                  <button
                    className="text-button autocomplete-trigger"
                    aria-label="Autocomplete"
                    title="Show code suggestions (Ctrl+Space). Use arrows to choose, Tab to accept, and Escape to close."
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => {
                      editor.current?.focus();
                      editor.current?.trigger(
                        "toolbar",
                        "editor.action.triggerSuggest",
                        {},
                      );
                    }}
                  >
                    Autocomplete
                    <kbd>Ctrl Space</kbd>
                  </button>
                  <select
                    aria-label="Editor font size"
                    value={fontSize}
                    onChange={(e) => {
                      const size = Number(e.target.value);
                      setFontSize(size);
                      localStorage.setItem(
                        "forgepad.editor.fontSize",
                        String(size),
                      );
                    }}
                  >
                    {[12, 14, 16, 18, 20].map((n) => (
                      <option key={n} value={n}>
                        {n}px
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div
                className="editor-container"
                id="source-editor"
                role="tabpanel"
                aria-labelledby={
                  activeFile
                    ? `source-file-${Object.keys(files).indexOf(activeFile)}`
                    : undefined
                }
              >
                {activeFile ? (
                  <Suspense
                    fallback={
                      <div className="empty">Opening local editor…</div>
                    }
                  >
                    {" "}
                    <Editor
                      path={`${questionId}/v${question.version}/${sessionId ?? "practice"}/${activeFile}`}
                      language={question.language === "c" ? "c" : "cpp"}
                      theme={theme === "dark" ? "vs-dark" : "light"}
                      value={files[activeFile] ?? ""}
                      workspaceFiles={files}
                      diagnostics={activeDiagnostics}
                      revealPosition={
                        editorLocation?.file === activeFile
                          ? editorLocation
                          : undefined
                      }
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
                        tabSize: 4,
                        insertSpaces: true,
                        wordWrap: "off",
                        lineHeight: Math.round(fontSize * 1.6),
                        accessibilitySupport: "auto",
                        ariaLabel: `${activeFile} code editor. Autocomplete: Control+Space. Toggle Tab key focus mode: Control+M.`,
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
                <span className="autocomplete-status">
                  Suggestions on · type to complete
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
                    }}
                  >
                    Format whitespace
                  </button>
                  <button
                    className="text-button"
                    onClick={(event) => {
                      dialogTrigger.current = event.currentTarget;
                      setResetConfirm(true);
                    }}
                  >
                    <RotateCcw size={12} />
                    Reset to starter files
                  </button>
                  <button
                    className="text-button"
                    disabled={!checkpoint}
                    title={
                      checkpoint
                        ? `Replace draft with checkpoint from ${new Date(checkpoint.at).toLocaleString()}`
                        : "Save a checkpoint first"
                    }
                    onClick={(event) => {
                      dialogTrigger.current = event.currentTarget;
                      setShowCheckpoint(true);
                    }}
                  >
                    Restore saved checkpoint
                  </button>
                </div>
              </div>
            </>
          ) : (
            <div className="written-response">
              <ReasoningWorkspace
                question={question}
                answer={answer}
                onChange={setAnswer}
                voice={
                  <>
                    <VoiceInput
                      questionId={questionId}
                      sessionId={sessionId}
                      onBusyChange={setDictating}
                      onText={(text) =>
                        setAnswer(
                          (previous) =>
                            `${previous}${previous ? " " : ""}${text}`,
                        )
                      }
                    />
                    <TranscriptCleanup
                      text={answer}
                      questionId={questionId}
                      onApply={setAnswer}
                      disabled={dictating || busy}
                    />
                  </>
                }
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
            {coding && (
              <p className="execution-help" id="execution-help">
                Run checks every visible test. Submit checks the same suite and
                saves an attempt.
              </p>
            )}
            <div className="button-row">
              {run && ["queued", "running"].includes(run.status) ? (
                <button
                  className="secondary"
                  onClick={() =>
                    void api(`/runs/${run.id}`, { method: "DELETE" })
                      .then(() => {
                        setRun({ ...run, status: "cancelled" });
                        setExecutionError("");
                      })
                      .catch((e) => setExecutionError(message(e)))
                  }
                >
                  <Square size={13} />
                  Cancel execution
                </button>
              ) : null}
              {coding ? (
                <>
                  <button
                    disabled={running || !Object.keys(files).length}
                    title="Compile and run all tests (Ctrl/Cmd+Enter)"
                    aria-describedby="execution-help"
                    onClick={() => void execute("run")}
                  >
                    <Play size={14} />
                    Run all tests
                  </button>
                  <button
                    className="primary"
                    disabled={running || !Object.keys(files).length}
                    title="Submit all tests (Shift+Ctrl/Cmd+Enter)"
                    aria-describedby="execution-help"
                    onClick={() => void execute("submit")}
                  >
                    Submit all tests
                  </button>
                </>
              ) : (
                <button
                  className="primary"
                  disabled={busy || dictating || !answer.trim()}
                  onClick={async () => {
                    setBusy(true);
                    setError("");
                    try {
                      await save();
                      await post("/attempts", {
                        question_id: questionId,
                        session_id: sessionId,
                        question_version: question.version,
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
              aria-busy={running}
            >
              <div className="section-header">
                <h2>Output &amp; test results</h2>
                {run && (
                  <span
                    role="status"
                    className={`badge ${run.result?.status === "passed" ? "success" : ""}`}
                  >
                    {readable(run.result?.status ?? run.status)}
                  </span>
                )}
              </div>
              {executionError && (
                <p className="execution-error" role="alert">
                  {executionError}
                </p>
              )}
              {running ? (
                <div className="execution-progress">
                  <p role="status">
                    <LoaderCircle size={16} className="spinning" />
                    {executionStatus}
                  </p>
                  <div
                    className="execution-progress-track"
                    role="progressbar"
                    aria-label="Test execution in progress"
                  >
                    <span />
                  </div>
                </div>
              ) : !run ? (
                <div className="output-empty">
                  <span className="terminal-prompt">›_</span>
                  <p>
                    {executionError
                      ? "Execution could not start. Your code is still in the editor."
                      : "Run all tests to see output and compiler diagnostics here."}
                  </p>
                  <small>
                    Ctrl / ⌘ + Enter: all tests · Shift + Ctrl / ⌘ + Enter:
                    submit all tests
                  </small>
                </div>
              ) : run.result ? (
                <>
                  <p className="result-context" role="status">
                    {runMode === "run"
                      ? "Complete test run"
                      : "Full test submission"}
                    {run.attempt_id ? " · Attempt recorded" : ""}
                    {resultsStale
                      ? " · Code changed since these results. Run again to update."
                      : ""}
                  </p>
                  <div className="result-summary">
                    <strong role="status">
                      {run.result.total > 0
                        ? `${run.result.passed} / ${run.result.total} tests passed`
                        : ["compilation_error", "compile_error"].includes(
                              run.result.status,
                            )
                          ? "Compilation failed · no tests ran"
                          : run.result.status === "unavailable"
                            ? "Runner unavailable · no tests ran"
                            : run.result.status === "unsupported"
                              ? "No executable tests for this question"
                              : run.result.status === "cancelled"
                                ? "Execution cancelled"
                                : "No test results returned"}
                    </strong>
                    {run.result.elapsed_ms !== undefined && (
                      <span>{run.result.elapsed_ms} ms</span>
                    )}
                  </div>
                  {diagnostics.length > 0 && (
                    <div
                      className="editor-diagnostics"
                      aria-label="Source diagnostics"
                    >
                      <h3>Source diagnostics</h3>
                      <ul>
                        {diagnostics.map((item, index) => (
                          <li key={index}>
                            <button
                              disabled={resultsStale}
                              title={
                                resultsStale
                                  ? "Run tests again to update source locations"
                                  : `Go to ${item.file}, line ${item.line}, column ${item.column}`
                              }
                              onClick={() => {
                                setActiveFile(item.file);
                                setEditorLocation({
                                  file: item.file,
                                  lineNumber: item.line,
                                  column: item.column,
                                });
                              }}
                            >
                              <span
                                className={`diagnostic-severity ${item.severity}`}
                              >
                                {item.severity}
                              </span>
                              <code>
                                {item.file}:{item.line}:{item.column}
                              </code>
                              <span>{item.message}</span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {run.result.compiler_output && (
                    <pre
                      className="compiler-output"
                      tabIndex={0}
                      aria-label="Compiler output"
                    >
                      {run.result.compiler_output}
                    </pre>
                  )}
                  {run.result.tests?.map((test) => (
                    <details
                      className="test-result"
                      key={test.id}
                      open={test.status !== "passed"}
                    >
                      <summary>
                        <span
                          className={`test-dot ${test.status === "passed" ? "passed" : "failed"}`}
                        />
                        <strong>{test.name || test.id}</strong>
                        <span className="muted-text">Visible</span>
                        <span className="badge">{readable(test.status)}</span>
                      </summary>
                      {
                        <>
                          <h4>Output</h4>
                          <pre tabIndex={0}>{test.stdout || "(empty)"}</pre>
                        </>
                      }
                      {test.expected_stdout !== undefined && (
                        <>
                          <h4>Expected output</h4>
                          <pre tabIndex={0}>
                            {test.expected_stdout || "(empty)"}
                          </pre>
                        </>
                      )}
                      {test.stderr && (
                        <>
                          <h4>Diagnostics</h4>
                          <pre tabIndex={0}>{test.stderr}</pre>
                        </>
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
      <Dialog.Root
        open={resetConfirm || showCheckpoint}
        onOpenChange={(open) => {
          if (!open) {
            setResetConfirm(false);
            setShowCheckpoint(false);
          }
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="dialog-overlay" />
          <Dialog.Content
            className="modal small-modal restore-dialog"
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              dialogTrigger.current?.focus();
            }}
          >
            <div className="modal-body">
              <Dialog.Title>
                {resetConfirm
                  ? "Reset to starter files?"
                  : "Restore saved checkpoint?"}
              </Dialog.Title>
              <Dialog.Description>
                {resetConfirm
                  ? "Replace all files in your current draft with the question’s starter files. This replacement will autosave. Your saved checkpoint will be kept."
                  : `Replace your current draft with the checkpoint from ${checkpoint ? new Date(checkpoint.at).toLocaleString() : ""}. This replacement will autosave.`}
              </Dialog.Description>
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
                  {resetConfirm
                    ? "Reset draft to starter files"
                    : "Restore checkpoint to draft"}
                </button>
              </div>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
      <div className="practice-footer">
        <button
          className="text-button"
          onClick={() => download(`${questionId}-draft.json`, draft.current)}
        >
          <Download size={13} />
          Export draft
        </button>
      </div>
    </div>
  );
}
