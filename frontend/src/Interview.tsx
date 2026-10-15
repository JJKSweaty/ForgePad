import { flushDrafts } from "./drafts";
import { usePracticeActivity } from "./usePracticeActivity";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import {
  ChevronRight,
  Clock,
  Download,
  Mic,
  Pause,
  Play,
  Send,
  Square,
  X,
} from "lucide-react";
import { api, download, message, post, readable } from "./api";
import type { Health, Question, Session } from "./api";
import { native, nativeEvents } from "./native";
import VoiceInput from "./VoiceInput";
import TranscriptCleanup from "./TranscriptCleanup";
import { questionMode, modeNames } from "./questionMode";
import { SessionReport } from "./SessionReport";
import { InterviewReplay } from "./InterviewReplay";
const Practice = lazy(() => import("./Practice"));
const stages = [
  "INTRODUCTION",
  "QUESTION",
  "CLARIFICATION",
  "SOLVING",
  "FOLLOW_UP",
  "REVIEW",
  "COMPLETE",
];
export default function Interview({
  questions,
  health,
  theme,
  onSettings,
}: {
  questions: Question[];
  health: Health | null;
  theme: string;
  onSettings?: () => void;
}) {
  const [workspace, setWorkspace] = useState<
      "conversation" | "code" | "replay"
    >("conversation"),
    [sessions, setSessions] = useState<Session[]>([]),
    [session, setSession] = useState<Session | null>(null),
    [questionId, setQuestionId] = useState(""),
    [duration, setDuration] = useState(30),
    [kind, setKind] = useState("mixed"),
    [personality, setPersonality] = useState("neutral"),
    [text, setText] = useState(""),
    [busy, setBusy] = useState(false),
    [dictating, setDictating] = useState(false),
    [error, setError] = useState(""),
    [remaining, setRemaining] = useState(0),
    [finishConfirm, setFinishConfirm] = useState(false);
  usePracticeActivity(
    session?.question_id,
    session?.id,
    workspace !== "code" && session?.state !== "COMPLETE" && !session?.paused,
  );
  const view =
    session?.state === "COMPLETE" && workspace === "code"
      ? "replay"
      : workspace;
  const transcript = useRef<HTMLDivElement | null>(null),
    clockAnchor = useRef({ at: Date.now(), remaining: 0 }),
    live = useRef(true);
  useEffect(() => {
    let disposed = false;
    let stop: (() => void) | undefined;
    void nativeEvents((event) => {
      if (event.type === "inference_unavailable")
        setError(
          event.data?.detail ??
            "The interviewer could not reply. Check your AI connection in Settings.",
        );
      if (
        ["session_updated", "session_started", "navigate"].includes(event.type)
      ) {
        const id = event.data?.id ?? sessionStorage.getItem("forgepad.session");
        if (id)
          void api<Session>(`/interviews/${id}`)
            .then((s) => {
              if (!disposed) setSession(s);
            })
            .catch((e) => setError(message(e)));
      }
    }).then((fn) => {
      if (disposed) fn();
      else stop = fn;
    });
    const saved = sessionStorage.getItem("forgepad.session");
    if (saved)
      void api<Session>(`/interviews/${saved}`)
        .then(setSession)
        .catch((e) => setError(message(e)));
    return () => {
      disposed = true;
      stop?.();
    };
  }, []);
  useEffect(() => {
    live.current = true;
    void api<Session[]>("/interviews")
      .then(setSessions)
      .catch((e) => setError(message(e)));
    return () => {
      live.current = false;
    };
  }, []);
  useEffect(() => {
    if (!session) return;
    clockAnchor.current = {
      at: Date.now(),
      remaining: session.remaining_seconds,
    };
    setRemaining(session.remaining_seconds);
    if (session.paused || session.state === "COMPLETE") return;
    const timer = setInterval(
      () =>
        setRemaining(
          Math.max(
            0,
            clockAnchor.current.remaining -
              Math.floor((Date.now() - clockAnchor.current.at) / 1000),
          ),
        ),
      1000,
    );
    return () => clearInterval(timer);
  }, [session]);
  useEffect(() => {
    if (!session || session.paused || session.state === "COMPLETE") return;
    const refreshSession = () =>
      void api<Session>(`/interviews/${session.id}`)
        .then(setSession)
        .catch((e) => setError(message(e)));
    if (native) {
      const deadline = setTimeout(
        refreshSession,
        (session.remaining_seconds + 0.1) * 1000,
      );
      return () => clearTimeout(deadline);
    }
    const timer = setInterval(refreshSession, 15000);
    return () => clearInterval(timer);
  }, [
    session?.id,
    session?.paused,
    session?.state,
    session?.remaining_seconds,
  ]);
  useEffect(() => {
    transcript.current?.scrollTo({
      top: transcript.current.scrollHeight,
      behavior: "smooth",
    });
  }, [session?.transcript.length]);
  function switchWorkspace(target: typeof workspace) {
    void flushDrafts()
      .then(() => setWorkspace(target))
      .catch((e) => setError(message(e)));
  }
  async function event(type: string, content?: string) {
    if (!session) return;
    setBusy(true);
    setError("");
    try {
      await flushDrafts();
      setSession(
        await post<Session>(`/interviews/${session.id}/events`, {
          type,
          content,
        }),
      );
      if (type === "message") setText("");
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="page interview-page">
      <div className="page-heading">
        <div>
          <h2>Mock interview</h2>
          <p>
            Explain your decisions, handle follow-ups, and review the session.
          </p>
        </div>
        {session && (
          <button
            className="secondary"
            onClick={() => download(`interview-${session.id}.json`, session)}
          >
            <Download size={15} />
            Export transcript
          </button>
        )}
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
      {!session ? (
        <div className="interview-setup">
          <section className="panel">
            <div className="section-header">
              <div>
                <h2>Set up your session</h2>
                <p>A clear structure, with time to think.</p>
              </div>
              <Clock size={20} />
            </div>
            <form
              className="setup-form"
              onSubmit={async (e) => {
                e.preventDefault();
                setBusy(true);
                setError("");
                try {
                  const s = await post<Session>("/interviews", {
                    question_id: questionId || undefined,
                    duration_minutes: duration,
                    kind,
                    personality,
                  });
                  setSession(s);
                  setSessions((previous) => [s, ...previous]);
                } catch (err) {
                  setError(message(err));
                } finally {
                  setBusy(false);
                }
              }}
            >
              <label>
                Question
                <select
                  value={questionId}
                  onChange={(e) => setQuestionId(e.target.value)}
                >
                  <option value="">Choose automatically</option>
                  {questions
                    .filter((q) => !q.archived)
                    .map((q) => (
                      <option key={q.id} value={q.id}>
                        {q.title}
                      </option>
                    ))}
                </select>
              </label>
              <div className="two-columns">
                <label>
                  Session type
                  <select
                    value={kind}
                    onChange={(e) => setKind(e.target.value)}
                  >
                    {["mixed", "coding", "theory", "design"].map((k) => (
                      <option key={k}>{k}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Duration
                  <select
                    value={duration}
                    onChange={(e) => setDuration(Number(e.target.value))}
                  >
                    {[15, 30, 45, 60, 90].map((n) => (
                      <option key={n} value={n}>
                        {n} minutes
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <label>
                Interviewer tone
                <select
                  value={personality}
                  onChange={(e) => setPersonality(e.target.value)}
                >
                  {["neutral", "supportive", "challenging"].map((p) => (
                    <option key={p}>{p}</option>
                  ))}
                </select>
              </label>
              <div className="notice">
                <strong>
                  {health?.ai.available
                    ? "AI interviewer configured"
                    : "Guided interview mode"}
                </strong>
                <p>
                  {health?.ai.available
                    ? "Replies use the provider you configured in Settings → Interview & AI."
                    : "Sessions use the question’s prepared prompts and follow-ups. Free-form AI responses are unavailable."}
                </p>
                {onSettings && (
                  <button
                    type="button"
                    className="text-button"
                    onClick={onSettings}
                  >
                    Configure AI & voice <ChevronRight size={14} />
                  </button>
                )}
              </div>
              <button
                className="primary"
                disabled={busy || questions.length === 0}
              >
                <Play size={15} />
                {busy ? "Starting…" : "Start session"}
              </button>
            </form>
          </section>
          <section className="panel">
            <div className="section-header">
              <div>
                <h2>Previous sessions</h2>
                <p>Resume a rehearsal or review its transcript.</p>
              </div>
            </div>
            {sessions.map((s) => (
              <button
                className="question-row"
                key={s.id}
                onClick={() =>
                  void api<Session>(`/interviews/${s.id}`)
                    .then(setSession)
                    .catch((e) => setError(message(e)))
                }
              >
                <span className="row-main">
                  <strong>
                    {questions.find((q) => q.id === s.question_id)?.title ??
                      "Interview session"}
                  </strong>
                  <small>{new Date(s.started_at).toLocaleString()}</small>
                </span>
                <span className="badge">{readable(s.state.toLowerCase())}</span>
                <ChevronRight size={15} />
              </button>
            ))}
            {!sessions.length && (
              <div className="empty">
                <Mic size={28} />
                <h3>No sessions yet</h3>
                <p>Start a rehearsal to create a transcript.</p>
              </div>
            )}
          </section>
        </div>
      ) : (
        <>
          <div className="session-bar">
            <div className="timer">
              <Clock size={18} />
              <strong>
                {Math.floor(remaining / 60)
                  .toString()
                  .padStart(2, "0")}
                :{(Math.floor(remaining) % 60).toString().padStart(2, "0")}
              </strong>
              <span>
                {session.paused
                  ? "Paused"
                  : session.state === "COMPLETE"
                    ? "Complete"
                    : remaining === 0
                      ? "Time elapsed"
                      : "remaining"}
              </span>
            </div>
            <div className="button-row">
              {session.state !== "COMPLETE" && (
                <>
                  <button
                    disabled={busy}
                    onClick={() =>
                      void event(session.paused ? "resume" : "pause")
                    }
                  >
                    {session.paused ? <Play size={14} /> : <Pause size={14} />}
                    {session.paused ? "Resume" : "Pause"}
                  </button>
                  <button
                    disabled={busy}
                    onClick={() => setFinishConfirm(true)}
                  >
                    <Square size={13} />
                    Finish session
                  </button>
                </>
              )}
              <button
                onClick={() => {
                  void flushDrafts()
                    .then(() => {
                      setSession(null);
                      return api<Session[]>("/interviews");
                    })
                    .then(setSessions)
                    .catch((e) => setError(message(e)));
                }}
              >
                All sessions
              </button>
            </div>
          </div>
          <ol className="session-stages" aria-label="Interview stages">
            {stages.map((stage, i) => (
              <li
                key={stage}
                className={
                  stage === session.state
                    ? "active"
                    : i < stages.indexOf(session.state)
                      ? "done"
                      : ""
                }
              >
                <span>{i + 1}</span>
                {readable(stage.toLowerCase())}
              </li>
            ))}
          </ol>
          <div
            className="tabs interview-tabs"
            role="tablist"
            aria-label="Interview workspace"
          >
            {(["conversation", "code", "replay"] as const).map((t) => (
              <button
                key={t}
                role="tab"
                aria-selected={view === t}
                className={view === t ? "active" : ""}
                disabled={t === "code" && session.state === "COMPLETE"}
                onClick={() => switchWorkspace(t)}
              >
                {t === "code"
                  ? modeNames[
                      questionMode(
                        questions.find((q) => q.id === session.question_id) ?? {
                          type: "theory",
                        },
                      )
                    ]
                  : t === "replay"
                    ? "Session replay"
                    : "Conversation"}
              </button>
            ))}
          </div>
          {view === "code" && session.state !== "COMPLETE" && (
            <Suspense fallback={<p>Opening editor…</p>}>
              <Practice
                key={session.id}
                questionId={session.question_id}
                theme={theme}
                sessionId={session.id}
                onSaved={async () => {}}
                onBrowse={() => switchWorkspace("conversation")}
              />
            </Suspense>
          )}
          {view === "replay" && <InterviewReplay sessionId={session.id} />}
          <div
            className="session-grid"
            style={{ display: view === "conversation" ? "" : "none" }}
          >
            <section className="panel conversation">
              <div className="section-header">
                <h2>Conversation</h2>
                <span className="badge">
                  {session.paused
                    ? "Paused"
                    : readable(session.state.toLowerCase())}
                </span>
              </div>
              <div className="transcript" ref={transcript}>
                {session.transcript.map((entry, i) => (
                  <article
                    key={i}
                    className={`message ${entry.role === "candidate" ? "user" : "interviewer"}`}
                  >
                    <div className="message-label">
                      {entry.role === "candidate"
                        ? "YOU"
                        : entry.role.toUpperCase()}
                      <time>
                        {new Date(entry.created_at).toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </time>
                    </div>
                    <div className="prose">{entry.content}</div>
                  </article>
                ))}
              </div>
              {session.state !== "COMPLETE" && (
                <form
                  className="message-form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void event("message", text);
                  }}
                >
                  <textarea
                    aria-label="Interview response"
                    disabled={session.paused || busy}
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    rows={3}
                    placeholder={
                      session.paused
                        ? "Resume the session to respond."
                        : "Explain your reasoning or ask a clarification…"
                    }
                  />
                  <div className="message-actions">
                    <VoiceInput
                      questionId={session.question_id}
                      sessionId={session.id}
                      disabled={busy || session.paused}
                      onBusyChange={setDictating}
                      onText={(part) =>
                        setText(
                          (previous) =>
                            `${previous}${previous ? " " : ""}${part}`,
                        )
                      }
                    />
                    <button
                      className="primary"
                      disabled={
                        busy || dictating || session.paused || !text.trim()
                      }
                    >
                      <Send size={14} />
                      Send response
                    </button>
                  </div>
                  <TranscriptCleanup
                    text={text}
                    questionId={session.question_id}
                    onApply={setText}
                    disabled={busy || dictating || session.paused}
                  />
                  <small>
                    Live dictation stays editable. Review your answer, then send
                    it.
                  </small>
                </form>
              )}
            </section>
            <aside className="session-details">
              <section className="panel">
                <div className="section-header">
                  <h2>Current problem</h2>
                </div>
                <div className="modal-body">
                  <h3>
                    {questions.find((q) => q.id === session.question_id)
                      ?.title ?? session.question_id}
                  </h3>
                  <p className="muted-text">
                    {
                      questions.find((q) => q.id === session.question_id)
                        ?.description
                    }
                  </p>
                  <button
                    className="secondary"
                    onClick={() => switchWorkspace("code")}
                    disabled={session.state === "COMPLETE"}
                  >
                    Open question workspace <ChevronRight size={14} />
                  </button>
                  <p className="small muted-text">
                    Your question opens in its own workspace. Responses and test
                    runs are saved for review.
                  </p>
                </div>
              </section>
              <section className="panel">
                <div className="modal-body">
                  <h3>Session controls</h3>
                  <p>Move forward when you have finished the current stage.</p>
                  <button
                    className="primary"
                    disabled={
                      busy || session.paused || session.state === "COMPLETE"
                    }
                    onClick={() => void event("advance")}
                  >
                    Next stage <ChevronRight size={15} />
                  </button>
                </div>
              </section>
              {!!session.report && (
                <section className="panel">
                  <div className="section-header">
                    <h2>Session review</h2>
                  </div>
                  <div className="modal-body">
                    <SessionReport report={session.report} />
                  </div>
                </section>
              )}
            </aside>
          </div>
        </>
      )}
      {finishConfirm && (
        <div className="modal-backdrop">
          <section
            className="modal small-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="finish-title"
          >
            <div className="modal-body">
              <h2 id="finish-title">Finish this session?</h2>
              <p>Your transcript will be retained for review.</p>
              <div className="modal-actions">
                <button onClick={() => setFinishConfirm(false)}>
                  Keep going
                </button>
                <button
                  className="primary"
                  onClick={() => {
                    setFinishConfirm(false);
                    void event("finish");
                  }}
                >
                  Finish session
                </button>
              </div>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
