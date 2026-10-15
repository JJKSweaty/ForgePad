import { useEffect, useRef, useState } from "react";
import { Send, Sparkles } from "lucide-react";
import { message, post } from "./api";
import type { Question } from "./api";

type Turn = { role: "user" | "assistant"; content: string };
export default function QuestionCoach({
  question,
  sessionId,
  answer,
  files,
  voice,
}: {
  question: Question;
  sessionId?: string;
  answer: string;
  files: Record<string, string>;
  voice?: React.ReactNode;
}) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);
  async function ask(content: string) {
    if (busy || !content.trim()) return;
    setBusy(true);
    setError("");
    try {
      const result = await post<{ text: string }>(
        `/questions/${encodeURIComponent(question.id)}/coach`,
        {
          question_version: question.version,
          session_id: sessionId,
          message: content,
          answer: answer.slice(0, 16000),
          files,
          history: turns.slice(-6),
        },
      );
      if (!live.current) return;
      setTurns((previous) => [
        ...previous,
        { role: "user", content },
        { role: "assistant", content: result.text },
      ]);
      setText("");
    } catch (e) {
      if (live.current) setError(message(e));
    } finally {
      if (live.current) setBusy(false);
    }
  }
  return (
    <section className="question-coach" aria-label="Local reasoning coach">
      <div className="coach-heading">
        <Sparkles size={18} />
        <div>
          <h3>Think it through</h3>
          <p>Your local model helps you find the next step.</p>
        </div>
        <span className="badge">On device</span>
      </div>
      {!turns.length && (
        <button
          type="button"
          disabled={busy}
          onClick={() =>
            void ask(
              "Help me reason about the next step in my answer. Ask one focused question instead of giving the solution.",
            )
          }
        >
          Help me reason
        </button>
      )}
      <div className="coach-turns" aria-live="polite">
        {turns.map((turn, i) => (
          <article className={`coach-turn ${turn.role}`} key={i}>
            <strong>{turn.role === "user" ? "You" : "Local coach"}</strong>
            <p className="prose">{turn.content}</p>
          </article>
        ))}
        {busy && <p role="status">Thinking…</p>}
      </div>
      {error && (
        <p role="alert" className="inline-error">
          {error}
        </p>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void ask(text);
        }}
      >
        <label className="sr-only" htmlFor={`coach-${question.id}`}>
          Ask the local coach
        </label>
        <textarea
          id={`coach-${question.id}`}
          rows={3}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="What part feels unclear?"
          maxLength={4000}
          disabled={busy}
        />
        {voice}
        <button className="secondary" disabled={busy || !text.trim()}>
          <Send size={14} /> Ask coach
        </button>
      </form>
      <small>
        Suggestions guide your thinking. Test results and self-review stay
        separate.
      </small>
    </section>
  );
}
