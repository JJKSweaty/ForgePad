import { useRef, useState } from "react";
import { Download, Plus, Pencil, Trash2, ArrowRight } from "lucide-react";
import { api, download, message, post, readable } from "./api";
import type { Attempt, Goal, Progress, Question } from "./api";
import { attemptOutcome, calendarDate, shortDate } from "./learning";
import { useLearningTimezone } from "./useLearningTimezone";
import { RecordDialog } from "./RecordDialog";

export function ProgressPage({
  progress,
  questions,
  refresh,
  onPractice,
  onBrowse,
  onDashboard,
}: {
  progress: Progress;
  questions: Question[];
  refresh: () => Promise<void>;
  onPractice: (id: string, version?: number) => void;
  onBrowse: (topic?: string) => void;
  onDashboard: () => void;
}) {
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [goal, setGoal] = useState(""),
    [goalStatuses, setGoalStatuses] = useState<Record<string, string>>({}),
    [editing, setEditing] = useState<Partial<Goal> | null>(null),
    [selected, setSelected] = useState<Attempt | null>(null),
    [loading, setLoading] = useState(false),
    [detailError, setDetailError] = useState(""),
    [query, setQuery] = useState(""),
    [result, setResult] = useState(""),
    [type, setType] = useState(""),
    [after, setAfter] = useState(""),
    [page, setPage] = useState(0);
  const timezone = useLearningTimezone();
  const detailRequest = useRef(0);
  const title = (id: string) => questions.find((q) => q.id === id)?.title ?? id;
  const attemptType = (a: Attempt) =>
    a.type ??
    questions.find((q) => q.id === a.question_id)?.type ??
    a.language ??
    "";
  const history = progress.attempts.filter(
    (a) =>
      (a.question_title ?? a.title ?? title(a.question_id))
        .toLowerCase()
        .includes(query.toLowerCase()) &&
      (!result ||
        (result === "passed"
          ? a.result?.status === "passed"
          : result === "self"
            ? !!a.confidence
            : !!a.result && a.result.status !== "passed")) &&
      (!type || attemptType(a) === type) &&
      (!after || calendarDate(a.created_at, timezone) >= after),
  );
  const pages = Math.max(1, Math.ceil(history.length / 30)),
    current = Math.min(page, pages - 1);
  async function action(fn: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    try {
      await fn();
      await refresh();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  async function changeGoal(g: Goal, status: string) {
    setGoalStatuses((current) => ({ ...current, [g.id]: status }));
    await action(() =>
      api(`/goals/${g.id}`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      }),
    );
    setGoalStatuses((current) => {
      const next = { ...current };
      delete next[g.id];
      return next;
    });
  }
  async function inspect(a: Attempt) {
    const request = ++detailRequest.current;
    setSelected(a);
    setDetailError("");
    setLoading(true);
    setError("");
    try {
      const detail = await api<Attempt>(
        `/attempts/${encodeURIComponent(a.id)}`,
      );
      if (detailRequest.current === request) setSelected(detail);
    } catch (e) {
      if (detailRequest.current === request) setDetailError(message(e));
    } finally {
      if (detailRequest.current === request) setLoading(false);
    }
  }
  const summary = progress.summary;
  return (
    <div className="page learning-page">
      <div className="page-heading compact-heading">
        <h1>Progress</h1>
        <div className="button-row">
          <button className="text-button" onClick={onDashboard}>
            Activity overview <ArrowRight size={14} />
          </button>
          <button
            className="secondary"
            onClick={() =>
              void action(async () =>
                download("forgepad-progress.json", await api("/progress")),
              )
            }
            disabled={busy}
          >
            <Download size={14} />
            Export
          </button>
        </div>
      </div>
      {error && (
        <div className="error-banner" role="alert">
          {error}
        </div>
      )}
      <section
        className="metric-strip learning-summary"
        aria-label="Learning summary"
      >
        {[
          ["Submitted attempts", summary.attempts ?? progress.attempts.length],
          ["Passed attempts", summary.passed_attempts ?? "Not available"],
          [
            "Questions completed",
            summary.completed_questions ?? "Not available",
          ],
          ["Reviews due", summary.due_reviews ?? progress.due_reviews.length],
        ].map(([label, value]) => (
          <div className="metric" key={label}>
            <strong>{value}</strong>
            <span>{label}</span>
          </div>
        ))}
      </section>
      <p className="muted-text compact-note">
        Attempts, passes and completed questions are all-time totals. Completed
        questions are unique questions with passing tests or a confident self
        assessment. Reviews due counts questions whose latest scheduled review
        is due now; viewing an old attempt is separate.
      </p>
      {!progress.attempts.length && (
        <div className="compact-empty">
          <strong>Build your learning record</strong>
          <p>
            Submit a solution or save a written assessment to record your first
            attempt.
          </p>
          <button className="primary" onClick={() => onBrowse()}>
            Start Practice
          </button>
        </div>
      )}
      <section
        className="learning-section"
        aria-labelledby="review-queue-title"
      >
        <div className="section-header">
          <h2 id="review-queue-title">
            Review queue <small>{progress.due_reviews.length} due</small>
          </h2>
        </div>
        {progress.due_reviews.map((r, i) => {
          const id = typeof r === "string" ? r : (r.question_id ?? r.id ?? "");
          return (
            <div className="review-row" key={`${id}-${i}`}>
              <div>
                <strong>
                  {typeof r === "string"
                    ? title(id)
                    : (r.title ?? r.question_title ?? title(id))}
                </strong>
                <small>
                  {typeof r !== "string" && (
                    <>
                      {r.topics?.join(" · ")} ·{" "}
                      {readable(r.previous_result ?? "Recorded")} ·{" "}
                      {shortDate(r.last_attempted_at, timezone)}
                    </>
                  )}
                </small>
                <p>
                  {typeof r !== "string" && (r.reason ?? "Scheduled review")}
                </p>
              </div>
              <button onClick={() => onPractice(id)}>Practice again</button>
            </div>
          );
        })}
        {!progress.due_reviews.length && (
          <p className="muted-text compact-note">
            No reviews due
            {progress.attempts.length
              ? ". Your next review follows the saved assessment schedule."
              : " yet."}
          </p>
        )}
      </section>
      <section className="learning-section">
        <div className="section-header">
          <h2>Topics to revisit</h2>
        </div>
        <div className="topic-evidence-list">
          {progress.weak_topics.map((t) => {
            const topic = typeof t === "string" ? t : t.topic;
            const count =
              typeof t === "string" ? 0 : (t.needs_review ?? t.count ?? 0);
            return (
              <button
                key={topic}
                className="topic-evidence"
                onClick={() => onBrowse(topic)}
              >
                <strong>{topic}</strong>
                <small>
                  {count
                    ? `${count} unsuccessful or uncertain assessment${count === 1 ? "" : "s"}`
                    : "Recorded review evidence"}
                </small>
                <ArrowRight size={14} />
              </button>
            );
          })}
          {!progress.weak_topics.length && (
            <p className="muted-text compact-note">
              No learning gaps established from recorded assessments.{" "}
              <button className="text-button" onClick={() => onBrowse()}>
                Browse questions
              </button>
            </p>
          )}
        </div>
      </section>
      <section className="learning-section">
        <div className="section-header">
          <h2>Practice goals</h2>
        </div>
        <div className="compact-goals">
          {progress.goals.map((g) => (
            <div
              className={`goal-row ${(goalStatuses[g.id] ?? g.status) === "complete" ? "done" : ""}`}
              key={g.id}
            >
              <label>
                <input
                  type="checkbox"
                  checked={(goalStatuses[g.id] ?? g.status) === "complete"}
                  disabled={busy}
                  onChange={(e) =>
                    void changeGoal(g, e.target.checked ? "complete" : "active")
                  }
                />
                <span>{g.title}</span>
              </label>
              {(g.question_id || g.topic) && (
                <button
                  className="text-button goal-link"
                  onClick={() =>
                    g.question_id
                      ? onPractice(g.question_id)
                      : onBrowse(g.topic)
                  }
                >
                  {g.question_id ? title(g.question_id) : g.topic}
                  <ArrowRight size={12} />
                </button>
              )}
              <button
                className="icon-button"
                aria-label={`Edit goal ${g.title}`}
                onClick={() => setEditing({ ...g })}
              >
                <Pencil size={14} />
              </button>
              <button
                className="icon-button"
                disabled={busy}
                aria-label={`Delete goal ${g.title}`}
                onClick={() =>
                  void action(() => api(`/goals/${g.id}`, { method: "DELETE" }))
                }
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
        <form
          className="inline-form goal-create"
          onSubmit={(e) => {
            e.preventDefault();
            void action(async () => {
              await post("/goals", { title: goal.trim() });
              setGoal("");
            });
          }}
        >
          <input
            aria-label="New practice goal"
            placeholder="Add a specific practice goal…"
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            maxLength={500}
          />
          <button disabled={busy || !goal.trim()} aria-label="Add goal">
            <Plus size={16} />
          </button>
        </form>
      </section>
      <section className="learning-section">
        <div className="section-header">
          <h2>
            Attempt history <small>{history.length} results</small>
          </h2>
        </div>
        {progress.attempts.length > 0 && (
          <div className="history-filters filters">
            <input
              aria-label="Filter history by question"
              placeholder="Question…"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setPage(0);
              }}
            />
            <select
              aria-label="Filter attempt result"
              value={result}
              onChange={(e) => {
                setResult(e.target.value);
                setPage(0);
              }}
            >
              <option value="">All results</option>
              <option value="passed">Passed tests</option>
              <option value="failed">Unsuccessful tests</option>
              <option value="self">Self assessment</option>
            </select>
            <select
              aria-label="Filter attempt type"
              value={type}
              onChange={(e) => {
                setType(e.target.value);
                setPage(0);
              }}
            >
              <option value="">All types</option>
              {[...new Set(progress.attempts.map(attemptType))]
                .filter(Boolean)
                .map((t) => (
                  <option key={t} value={t}>
                    {readable(t)}
                  </option>
                ))}
            </select>
            <select
              aria-label="Attempt date range"
              value={after ? "since" : "all"}
              onChange={(e) => {
                setAfter(
                  e.target.value === "since"
                    ? calendarDate(new Date().toISOString(), timezone)
                    : "",
                );
                setPage(0);
              }}
            >
              <option value="all">All dates</option>
              <option value="since">Since date</option>
            </select>
            {after && (
              <label>
                Since{" "}
                <input
                  type="date"
                  aria-label="Attempts since"
                  value={after}
                  onChange={(e) => {
                    setAfter(e.target.value);
                    setPage(0);
                  }}
                />
              </label>
            )}
            {(query || result || type || after) && (
              <button
                onClick={() => {
                  setQuery("");
                  setResult("");
                  setType("");
                  setAfter("");
                  setPage(0);
                }}
              >
                Clear filters
              </button>
            )}
          </div>
        )}
        <p className="muted-text compact-note" role="status">
          {history.length} of {progress.attempts.length} attempts ·{" "}
          {after ? `Since ${after} (inclusive)` : "All dates"} · {timezone}
        </p>
        <p className="history-scroll-hint">
          Scroll horizontally for all attempt details.
        </p>
        <div
          className="table-scroll"
          role="region"
          aria-label="Attempt history details"
          tabIndex={0}
        >
          <table className="history-table">
            <thead>
              <tr>
                <th>Question</th>
                <th>Outcome</th>
                <th>Type / language</th>
                <th>Duration</th>
                <th>Submitted</th>
                <th>
                  <span className="sr-only">Attempt details</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {history.slice(current * 30, current * 30 + 30).map((a) => (
                <tr key={a.id}>
                  <td>
                    <strong>
                      {a.question_title ?? a.title ?? title(a.question_id)}
                    </strong>
                    <small>Version {a.question_version ?? "—"}</small>
                  </td>
                  <td>{readable(attemptOutcome(a))}</td>
                  <td>
                    {readable(
                      a.language && a.language !== "independent"
                        ? a.language
                        : attemptType(a),
                    )}
                  </td>
                  <td>
                    {a.duration_seconds != null
                      ? `${Math.round(a.duration_seconds / 60)} min`
                      : "Not recorded"}
                  </td>
                  <td>
                    <time dateTime={a.created_at}>
                      {shortDate(a.created_at, timezone)}
                    </time>
                  </td>
                  <td>
                    <button
                      className="text-button"
                      onClick={() => void inspect(a)}
                    >
                      View attempt
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!history.length && (
          <p className="muted-text compact-note">
            {progress.attempts.length
              ? "No attempts match these filters."
              : "Submitted work is preserved here with its question version."}
          </p>
        )}
        {pages > 1 && (
          <nav className="pagination" aria-label="Attempt pages">
            <button
              disabled={current === 0}
              onClick={() => setPage(current - 1)}
            >
              Previous
            </button>
            <span>
              {current + 1} / {pages}
            </span>
            <button
              disabled={current + 1 === pages}
              onClick={() => setPage(current + 1)}
            >
              Next
            </button>
          </nav>
        )}
      </section>
      {selected && (
        <RecordDialog
          title={
            selected.question_title ??
            selected.title ??
            title(selected.question_id)
          }
          onClose={() => {
            ++detailRequest.current;
            setSelected(null);
            setLoading(false);
          }}
        >
          <p>
            Version {selected.question_version} ·{" "}
            {shortDate(selected.created_at, timezone)}
          </p>
          {loading ? (
            <p role="status">Loading submitted work…</p>
          ) : detailError ? (
            <div role="alert">
              {detailError}
              <button onClick={() => void inspect(selected)}>
                Retry loading attempt
              </button>
            </div>
          ) : (
            <>
              {selected.confidence && (
                <p>
                  <strong>Self assessment:</strong> {selected.confidence}
                </p>
              )}
              {selected.answer && (
                <>
                  <h3>Submitted answer</h3>
                  <div className="prose">{selected.answer}</div>
                </>
              )}
              {selected.reflection && (
                <>
                  <h3>Your reflection</h3>
                  <p>{selected.reflection}</p>
                </>
              )}
              {Object.entries(selected.files ?? {}).map(([name, code]) => (
                <details key={name} open>
                  <summary>{name}</summary>
                  <pre>{code}</pre>
                </details>
              ))}
              {selected.result && (
                <>
                  <h3>Deterministic test results</h3>
                  <AttemptResults result={selected.result} />
                </>
              )}
              <h3>AI feedback</h3>
              {selected.ai_feedback ? (
                <pre>
                  {typeof selected.ai_feedback === "string"
                    ? selected.ai_feedback
                    : JSON.stringify(selected.ai_feedback, null, 2)}
                </pre>
              ) : (
                <p className="muted-text">
                  No AI feedback saved for this attempt.
                </p>
              )}
              <h3>Other submitted attempts</h3>
              <div className="previous-attempts">
                {progress.attempts
                  .filter(
                    (a) =>
                      a.question_id === selected.question_id &&
                      a.id !== selected.id,
                  )
                  .map((a) => (
                    <button key={a.id} onClick={() => void inspect(a)}>
                      v{a.question_version} ·{" "}
                      {shortDate(a.created_at, timezone)} ·{" "}
                      {readable(attemptOutcome(a))}
                    </button>
                  ))}
              </div>
              <div className="modal-actions">
                <button
                  onClick={() =>
                    download(`attempt-${selected.id}.json`, selected)
                  }
                >
                  <Download size={14} />
                  Export attempt
                </button>
                <button
                  className="primary"
                  onClick={() =>
                    onPractice(selected.question_id, selected.question_version)
                  }
                >
                  Practice this version again
                </button>
              </div>
            </>
          )}
        </RecordDialog>
      )}
      {editing && (
        <RecordDialog
          error={error}
          title="Edit practice goal"
          onClose={() => setEditing(null)}
        >
          <form
            className="goal-editor"
            onSubmit={(e) => {
              e.preventDefault();
              void action(async () => {
                await api(`/goals/${editing.id}`, {
                  method: "PATCH",
                  body: JSON.stringify({
                    title: editing.title?.trim(),
                    question_id: editing.question_id || null,
                    topic: editing.topic || null,
                  }),
                });
                setEditing(null);
              });
            }}
          >
            <label>
              Goal
              <input
                value={editing.title ?? ""}
                onChange={(e) =>
                  setEditing({ ...editing, title: e.target.value })
                }
                maxLength={500}
              />
            </label>
            <label>
              Linked question
              <select
                value={editing.question_id ?? ""}
                onChange={(e) =>
                  setEditing({ ...editing, question_id: e.target.value })
                }
              >
                <option value="">No question</option>
                {questions.map((q) => (
                  <option key={q.id} value={q.id}>
                    {q.title}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Linked topic
              <select
                value={editing.topic ?? ""}
                onChange={(e) =>
                  setEditing({ ...editing, topic: e.target.value })
                }
              >
                <option value="">No topic</option>
                {[...new Set(questions.flatMap((q) => q.topics))]
                  .sort()
                  .map((t) => (
                    <option key={t}>{t}</option>
                  ))}
              </select>
            </label>
            <button
              className="primary"
              disabled={busy || !editing.title?.trim()}
            >
              Save goal
            </button>
          </form>
        </RecordDialog>
      )}
    </div>
  );
}

function AttemptResults({
  result,
}: {
  result: NonNullable<Attempt["result"]>;
}) {
  return (
    <div className="saved-test-results">
      <p>
        <strong>{readable(result.status ?? "Recorded")}</strong>
        {typeof result.passed === "number" &&
          typeof result.total === "number" &&
          ` · ${result.passed} / ${result.total} tests passed`}
      </p>
      {!!result.compiler_output && (
        <details open>
          <summary>Compiler diagnostics</summary>
          <pre>{result.compiler_output}</pre>
        </details>
      )}
      {!!result.tests?.length && (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Test</th>
                <th>Visibility</th>
                <th>Result</th>
              </tr>
            </thead>
            <tbody>
              {result.tests.map((test, index) => (
                <tr key={test.id ?? index}>
                  <td>
                    {test.name ?? test.id}
                    {(test.stdout || test.stderr || test.expected_stdout) && (
                      <details>
                        <summary>Output</summary>
                        {test.stdout && (
                          <>
                            <small>Standard output</small>
                            <pre>{test.stdout}</pre>
                          </>
                        )}
                        {test.expected_stdout && (
                          <>
                            <small>Expected output</small>
                            <pre>{test.expected_stdout}</pre>
                          </>
                        )}
                        {test.stderr && (
                          <>
                            <small>Standard error</small>
                            <pre>{test.stderr}</pre>
                          </>
                        )}
                      </details>
                    )}
                  </td>
                  <td>Visible</td>
                  <td>{readable(test.status)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
