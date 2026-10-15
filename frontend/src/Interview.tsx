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
import { watchSpeechActivity } from "./speechActivity";
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
}: {
  questions: Question[];
  health: Health | null;
  theme: string;
}) {
  const [voiceActive, setVoiceActive] = useState(false);
  const startingMic = useRef(false);
  const vadStop = useRef<(() => void) | null>(null),
    recordingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [audioMode, setAudioMode] = useState("external_assistant");
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
    [error, setError] = useState(""),
    [remaining, setRemaining] = useState(0),
    [recording, setRecording] = useState(false),
    [transcribing, setTranscribing] = useState(false),
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
  const recorder = useRef<MediaRecorder | null>(null),
    stream = useRef<MediaStream | null>(null),
    transcript = useRef<HTMLDivElement | null>(null),
    clockAnchor = useRef({ at: Date.now(), remaining: 0 }),
    live = useRef(true);
  useEffect(() => {
    if (native)
      void api<{ mode: string }>("/settings/audio")
        .then((c) => setAudioMode(c.mode))
        .catch((e) => setError(message(e)));
    let disposed = false;
    let stop: (() => void) | undefined;
    void nativeEvents((event) => {
      if (event.type === "audio_mode")
        void api<{ mode: string }>("/settings/audio").then((c) =>
          setAudioMode(c.mode),
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
      recorder.current?.state === "recording" && recorder.current.stop();
      stream.current?.getTracks().forEach((track) => track.stop());
      vadStop.current?.();
      if (recordingTimer.current) clearTimeout(recordingTimer.current);
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
    const timer = setInterval(
      () =>
        void api<Session>(`/interviews/${session.id}`)
          .then(setSession)
          .catch((e) => setError(message(e))),
      15000,
    );
    return () => clearInterval(timer);
  }, [session?.id, session?.paused, session?.state]);
  useEffect(() => {
    transcript.current?.scrollTo({
      top: transcript.current.scrollHeight,
      behavior: "smooth",
    });
  }, [session?.transcript.length]);
  async function event(type: string, content?: string) {
    if (!session) return;
    setBusy(true);
    setError("");
    try {
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
  async function microphone() {
    if (native && audioMode !== "interview") {
      setError(
        "Switch audio mode to Interview in Settings to let ForgePad capture your explanation.",
      );
      return;
    }
    if (recording) {
      recorder.current?.stop();
      return;
    }
    if (startingMic.current) return;
    startingMic.current = true;
    setError("");
    try {
      const media = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!live.current) {
        media.getTracks().forEach((t) => t.stop());
        return;
      }
      stream.current = media;
      const rec = new MediaRecorder(media);
      try {
        vadStop.current = await watchSpeechActivity(media, (active) => {
          if (live.current) setVoiceActive(active);
        });
      } catch {
        /* Push-to-talk remains usable if AudioWorklet is unavailable. */
      }
      if (!live.current) {
        vadStop.current?.();
        media.getTracks().forEach((t) => t.stop());
        return;
      }
      recorder.current = rec;
      const chunks: BlobPart[] = [];
      rec.ondataavailable = (e) => {
        if (e.data.size) chunks.push(e.data);
      };
      rec.onstop = async () => {
        vadStop.current?.();
        vadStop.current = null;
        if (recordingTimer.current) clearTimeout(recordingTimer.current);
        setVoiceActive(false);
        media.getTracks().forEach((track) => track.stop());
        if (!live.current) return;
        setRecording(false);
        setTranscribing(true);
        try {
          const form = new FormData();
          form.append(
            "file",
            new Blob(chunks, { type: rec.mimeType }),
            "recording.webm",
          );
          const result = await api<{ text: string }>("/speech/transcribe", {
            method: "POST",
            body: form,
          });
          if (live.current)
            setText(
              (previous) => `${previous}${previous ? " " : ""}${result.text}`,
            );
        } catch (e) {
          if (live.current) setError(message(e));
        } finally {
          if (live.current) setTranscribing(false);
        }
      };
      rec.start();
      recordingTimer.current = setTimeout(() => {
        if (rec.state === "recording") rec.stop();
      }, 60000);
      setRecording(true);
    } catch (e) {
      stream.current?.getTracks().forEach((track) => track.stop());
      setError(message(e));
    } finally {
      startingMic.current = false;
    }
  }
  return (
    <div className="page interview-page">
      <div className="page-heading">
        <div>
          <div className="eyebrow">STRUCTURED REHEARSAL</div>
          <h1>Interview</h1>
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
                    ? "Local model available"
                    : "Guided interview mode"}
                </strong>
                <p>
                  {health?.ai.available
                    ? "Your configured local model is available."
                    : "Sessions use the question’s prepared prompts and follow-ups. Free-form AI responses are unavailable."}
                </p>
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
                  setSession(null);
                  void api<Session[]>("/interviews")
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
                onClick={() => setWorkspace(t)}
              >
                {t === "code"
                  ? "Code workspace"
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
                onBrowse={() => setWorkspace("conversation")}
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
                    <button
                      type="button"
                      className={recording ? "danger" : "secondary"}
                      disabled={
                        !health?.speech.available ||
                        transcribing ||
                        session.paused ||
                        (native && audioMode !== "interview")
                      }
                      title={
                        health?.speech.available
                          ? "Record locally; click again to stop"
                          : "Configure local speech transcription to enable microphone"
                      }
                      onClick={() => void microphone()}
                    >
                      <Mic size={15} />
                      {recording
                        ? voiceActive
                          ? "Voice detected · stop"
                          : "Recording · stop"
                        : transcribing
                          ? "Transcribing…"
                          : "Microphone"}
                    </button>
                    <button
                      className="primary"
                      disabled={
                        busy || session.paused || !text.trim() || recording
                      }
                    >
                      <Send size={14} />
                      Send response
                    </button>
                  </div>
                  <small>
                    Microphone starts only when pressed in Interview audio mode.
                    Stop to transcribe; review text before sending.
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
                    onClick={() => setWorkspace("code")}
                    disabled={session.state === "COMPLETE"}
                  >
                    Open interview editor <ChevronRight size={14} />
                  </button>
                  <p className="small muted-text">
                    Code changes and test runs in the interview editor are saved
                    to Session replay.
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
