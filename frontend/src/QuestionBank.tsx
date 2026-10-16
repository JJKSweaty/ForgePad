import { useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  Bookmark,
  ChevronRight,
  Download,
  FileJson,
  MoreHorizontal,
  Plus,
  Search,
  Upload,
  X,
} from "lucide-react";
import * as Popover from "@radix-ui/react-popover";
import { api, download, message, post, readable } from "./api";
import { RecordDialog } from "./RecordDialog";
import type { Question } from "./api";
import { questionAction, questionState, stateLabels } from "./learning";

export function QuestionBank({
  questions,
  onPractice,
  refresh,
  onAuthor,
  onSession,
  initialTopic = "",
}: {
  questions: Question[];
  onPractice: (id: string, version?: number) => void;
  refresh: () => Promise<void>;
  onAuthor?: () => void;
  onSession?: (id: string) => void;
  initialTopic?: string;
}) {
  const [query, setQuery] = useState(""),
    [search, setSearch] = useState(""),
    [type, setType] = useState(""),
    [difficulty, setDifficulty] = useState(""),
    [topic, setTopic] = useState(initialTopic),
    [status, setStatus] = useState(""),
    [bookmarked, setBookmarked] = useState(false),
    [archived, setArchived] = useState(false),
    [sort, setSort] = useState("recent"),
    [importing, setImporting] = useState(false),
    [error, setError] = useState(""),
    [page, setPage] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const timer = setTimeout(() => setSearch(query.trim().toLowerCase()), 180);
    return () => clearTimeout(timer);
  }, [query]);
  useEffect(() => {
    setPage(0);
  }, [search, type, difficulty, topic, status, bookmarked, archived, sort]);
  useEffect(() => {
    const shortcut = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (
        e.key === "/" &&
        !e.ctrlKey &&
        !e.metaKey &&
        !e.altKey &&
        !target.closest("input,textarea,select,[contenteditable=true]")
      ) {
        e.preventDefault();
        input.current?.focus();
      }
    };
    window.addEventListener("keydown", shortcut);
    return () => window.removeEventListener("keydown", shortcut);
  }, []);
  const topics = useMemo(
    () => [...new Set(questions.flatMap((q) => q.topics))].sort(),
    [questions],
  );
  const filtered = useMemo(
    () =>
      questions
        .filter(
          (q) =>
            (archived || !q.archived) &&
            (!bookmarked || q.bookmarked) &&
            (!type || q.type === type) &&
            (!difficulty || q.difficulty === difficulty) &&
            (!topic || q.topics.includes(topic)) &&
            (!status || questionState(q) === status) &&
            `${q.title} ${q.description} ${q.topics.join(" ")} ${q.language}`
              .toLowerCase()
              .includes(search),
        )
        .sort((a, b) => {
          if (sort === "title") return a.title.localeCompare(b.title);
          if (sort === "duration")
            return (
              a.duration_minutes - b.duration_minutes ||
              a.title.localeCompare(b.title)
            );
          if (sort === "difficulty")
            return (
              ["beginner", "intermediate", "advanced", "expert"].indexOf(
                a.difficulty,
              ) -
                ["beginner", "intermediate", "advanced", "expert"].indexOf(
                  b.difficulty,
                ) || a.title.localeCompare(b.title)
            );
          return (
            (b.last_activity_at ?? "").localeCompare(
              a.last_activity_at ?? "",
            ) || a.title.localeCompare(b.title)
          );
        }),
    [
      questions,
      archived,
      bookmarked,
      type,
      difficulty,
      topic,
      status,
      search,
      sort,
    ],
  );
  const pages = Math.max(1, Math.ceil(filtered.length / 40)),
    current = Math.min(page, pages - 1);
  const chips: [string, () => void][] = [];
  if (query) chips.push([`Search: ${query}`, () => setQuery("")]);
  if (type) chips.push([readable(type), () => setType("")]);
  if (difficulty) chips.push([difficulty, () => setDifficulty("")]);
  if (topic) chips.push([topic, () => setTopic("")]);
  if (status)
    chips.push([
      stateLabels[status as keyof typeof stateLabels],
      () => setStatus(""),
    ]);
  if (bookmarked) chips.push(["Bookmarked", () => setBookmarked(false)]);
  if (archived) chips.push(["Including archived", () => setArchived(false)]);
  const clear = () => {
    setQuery("");
    setType("");
    setDifficulty("");
    setTopic("");
    setStatus("");
    setBookmarked(false);
    setArchived(false);
  };
  const open = (q: Question) =>
    q.session_id && onSession
      ? onSession(q.session_id)
      : onPractice(
          q.id,
          questionState(q) === "in_progress" ? q.draft_version : undefined,
        );
  async function patch(q: Question, changes: Record<string, boolean>) {
    setError("");
    try {
      await api(`/questions/${encodeURIComponent(q.id)}`, {
        method: "PATCH",
        body: JSON.stringify(changes),
      });
      await refresh();
    } catch (e) {
      setError(message(e));
    }
  }
  return (
    <div className="page library-page">
      <div className="page-heading compact-heading">
        <h2>Question Library</h2>
        <div className="button-row">
          {onAuthor && (
            <button className="primary" onClick={onAuthor}>
              <Plus size={15} />
              Add question
            </button>
          )}
          <Popover.Root>
            <Popover.Trigger
              className="icon-button"
              aria-label="Library actions"
            >
              <MoreHorizontal size={18} />
            </Popover.Trigger>
            <Popover.Portal>
              <Popover.Content
                className="action-menu"
                align="end"
                sideOffset={6}
              >
                <Popover.Close onClick={() => setImporting(true)}>
                  <Upload size={14} />
                  Import questions
                </Popover.Close>
                <Popover.Close
                  onClick={() =>
                    void api("/questions/export/all")
                      .then((d) => download("forgepad-questions.json", d))
                      .catch((e) => setError(message(e)))
                  }
                >
                  <Download size={14} />
                  Export questions
                </Popover.Close>
              </Popover.Content>
            </Popover.Portal>
          </Popover.Root>
        </div>
      </div>
      {error && (
        <div className="error-banner" role="alert">
          {error}
        </div>
      )}
      <div className="library-filters">
        <label className="search-field">
          <Search size={16} />
          <input
            ref={input}
            aria-label="Search questions"
            placeholder="Search title, topics, keywords…  /"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <div className="filters">
          <select
            aria-label="Question type"
            value={type}
            onChange={(e) => setType(e.target.value)}
          >
            <option value="">All types</option>
            {["coding", "theory", "debugging", "design", "code_review"].map(
              (x) => (
                <option key={x} value={x}>
                  {readable(x)}
                </option>
              ),
            )}
          </select>
          <select
            aria-label="Difficulty"
            value={difficulty}
            onChange={(e) => setDifficulty(e.target.value)}
          >
            <option value="">All difficulties</option>
            {["beginner", "intermediate", "advanced", "expert"].map((x) => (
              <option key={x}>{x}</option>
            ))}
          </select>
          <select
            aria-label="Topic"
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
          >
            <option value="">All topics</option>
            {topics.map((x) => (
              <option key={x}>{x}</option>
            ))}
          </select>
          <select
            aria-label="Progress status"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            <option value="">All states</option>
            {Object.entries(stateLabels).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
          <select
            aria-label="Sort questions"
            value={sort}
            onChange={(e) => setSort(e.target.value)}
          >
            {Object.entries({
              recent: "Recent activity",
              difficulty: "Difficulty",
              title: "Title",
              duration: "Duration",
            }).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={bookmarked}
              onChange={(e) => setBookmarked(e.target.checked)}
            />
            Bookmarked
          </label>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={archived}
              onChange={(e) => setArchived(e.target.checked)}
            />
            Show archived
          </label>
        </div>
      </div>
      {chips.length > 0 && (
        <div className="filter-chips">
          {chips.map(([label, remove]) => (
            <button
              key={label}
              onClick={remove}
              aria-label={`Remove filter ${label}`}
            >
              {label}
              <X size={12} />
            </button>
          ))}
          <button className="text-button" onClick={clear}>
            Clear filters
          </button>
        </div>
      )}
      <div className="list-caption">
        <span role="status">{filtered.length} questions</span>
        <span>TYPE · DIFFICULTY · TIME · STATE</span>
      </div>
      <section
        className="question-list dense-list"
        aria-label="Question Library"
      >
        {filtered.slice(current * 40, current * 40 + 40).map((q) => (
          <article
            className={`library-row ${q.archived ? "archived" : ""}`}
            key={q.id}
          >
            <button
              className="row-open-target"
              onClick={() => open(q)}
              aria-label={`Open ${q.title}`}
              title={`${questionAction(q)} ${q.title}`}
            />
            <button
              className={`bookmark-button row-control ${q.bookmarked ? "selected" : ""}`}
              aria-label={`${q.bookmarked ? "Remove bookmark from" : "Bookmark"} ${q.title}`}
              aria-pressed={!!q.bookmarked}
              onClick={() => void patch(q, { bookmarked: !q.bookmarked })}
            >
              <Bookmark
                size={16}
                fill={q.bookmarked ? "currentColor" : "none"}
              />
            </button>
            <div className="library-row-title">
              <h3>{q.title}</h3>
              <span title={q.description}>{q.topics.join(" · ")}</span>
            </div>
            <span className="row-type">{readable(q.type)}</span>
            <span className="row-difficulty">{q.difficulty}</span>
            <span className="row-duration">{q.duration_minutes} min</span>
            <span className={`question-state state-${questionState(q)}`}>
              {stateLabels[questionState(q)]}
            </span>
            <span className="row-action-label">
              {questionAction(q)}
              <ChevronRight size={13} />
            </span>
            <Popover.Root>
              <Popover.Trigger
                className="icon-button row-control"
                aria-label={`Actions for ${q.title}`}
              >
                <MoreHorizontal size={17} />
              </Popover.Trigger>
              <Popover.Portal>
                <Popover.Content
                  className="action-menu"
                  align="end"
                  sideOffset={5}
                >
                  <Popover.Close
                    onClick={() => void patch(q, { archived: !q.archived })}
                  >
                    {q.archived ? "Unarchive" : "Archive"}
                  </Popover.Close>
                </Popover.Content>
              </Popover.Portal>
            </Popover.Root>
          </article>
        ))}
        {!filtered.length && (
          <div className="compact-empty">
            <strong>No matching questions</strong>
            <p>Change a filter or add your own question.</p>
            <button onClick={clear}>Clear filters</button>
          </div>
        )}
      </section>
      {pages > 1 && (
        <nav className="pagination" aria-label="Question pages">
          <button disabled={current === 0} onClick={() => setPage(current - 1)}>
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
      {importing && (
        <ImportDialog
          onClose={() => setImporting(false)}
          onPublished={refresh}
        />
      )}
    </div>
  );
}
function ImportDialog({
  onClose,
  onPublished,
}: {
  onClose: () => void;
  onPublished: () => Promise<void>;
}) {
  const [source, setSource] = useState(""),
    [idea, setIdea] = useState(""),
    [difficulty, setDifficulty] = useState("intermediate"),
    [duration, setDuration] = useState(30),
    [language, setLanguage] = useState("c"),
    [kind, setKind] = useState("coding"),
    [prompt, setPrompt] = useState(""),
    [busy, setBusy] = useState(false),
    [errors, setErrors] = useState<string[]>([]),
    [preview, setPreview] = useState<{
      valid: boolean;
      question?: Question;
      token?: string;
      errors: string[];
    } | null>(null),
    [published, setPublished] = useState(false);
  async function validate() {
    setBusy(true);
    setErrors([]);
    setPreview(null);
    try {
      const result = await post<{
        valid: boolean;
        question?: Question;
        token?: string;
        errors: string[];
      }>("/imports/validate", { question: JSON.parse(source) });
      setPreview(result);
      setErrors(result.errors ?? []);
    } catch (e) {
      setErrors([message(e)]);
    } finally {
      setBusy(false);
    }
  }
  async function publish() {
    if (!preview?.token) return;
    setBusy(true);
    try {
      await post("/imports/publish", { token: preview.token });
      await onPublished();
      setPublished(true);
    } catch (e) {
      setErrors([message(e)]);
    } finally {
      setBusy(false);
    }
  }
  return (
    <RecordDialog title="Import a question" onClose={onClose}>
      <p>Validate the package and its reference solution before publishing.</p>
      {published ? (
        <div className="empty">
          <Check size={30} />
          <h3>Question published</h3>
          <p>It is now available in your question bank.</p>
          <button className="primary" onClick={onClose}>
            Done
          </button>
        </div>
      ) : (
        <div className="modal-body">
          <details>
            <summary>Generate an authoring prompt</summary>
            <p>
              Describe a problem, then copy the resulting prompt to your
              preferred model. No text is sent to a model here.
            </p>
            <div className="generator-options">
              <label>
                Difficulty
                <select
                  value={difficulty}
                  onChange={(e) => setDifficulty(e.target.value)}
                >
                  <option value="beginner">Easy</option>
                  <option value="intermediate">Medium</option>
                  <option value="advanced">Hard</option>
                </select>
              </label>
              <label>
                Duration
                <select
                  value={duration}
                  onChange={(e) => setDuration(Number(e.target.value))}
                >
                  {[15, 30, 45].map((n) => (
                    <option key={n} value={n}>
                      {n} minutes
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Language
                <select
                  value={language}
                  onChange={(e) => setLanguage(e.target.value)}
                >
                  <option value="c">C11</option>
                  <option value="cpp">C++17</option>
                </select>
              </label>
              <label>
                Type
                <select value={kind} onChange={(e) => setKind(e.target.value)}>
                  {["coding", "theory", "debugging", "design"].map((t) => (
                    <option key={t}>{t}</option>
                  ))}
                </select>
              </label>
            </div>
            <div className="inline-form">
              <input
                aria-label="Question idea"
                placeholder="e.g. A fixed-size ring buffer for UART bytes"
                value={idea}
                onChange={(e) => setIdea(e.target.value)}
              />
              <button
                disabled={!idea.trim() || busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    const result = await post<{ prompt: string }>(
                      "/generator-prompt",
                      {
                        idea,
                        difficulty,
                        duration_minutes: duration,
                        language,
                        type: kind,
                      },
                    );
                    setPrompt(result.prompt);
                  } catch (e) {
                    setErrors([message(e)]);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Generate prompt
              </button>
            </div>
            {prompt && (
              <>
                <textarea
                  aria-label="Generated authoring prompt"
                  rows={8}
                  value={prompt}
                  readOnly
                />
                <button
                  onClick={() =>
                    void navigator.clipboard
                      .writeText(prompt)
                      .catch((e) => setErrors([message(e)]))
                  }
                >
                  Copy prompt
                </button>
              </>
            )}
          </details>
          <div className="section-header compact-header">
            <label htmlFor="question-json">Question JSON</label>
            <div className="button-row">
              <button
                className="text-button"
                onClick={() =>
                  void api("/schema")
                    .then((schema) =>
                      download("forgepad-question-schema.json", schema),
                    )
                    .catch((e) => setErrors([message(e)]))
                }
              >
                <FileJson size={14} />
                Schema
              </button>
              <label className="file-button">
                <Upload size={14} />
                Load file
                <input
                  type="file"
                  accept=".json,application/json"
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (file) {
                      setSource(await file.text());
                      setPreview(null);
                    }
                  }}
                />
              </label>
            </div>
          </div>
          <textarea
            id="question-json"
            className="code-input"
            rows={12}
            placeholder={
              '{\n  "schema_version": "1.0",\n  "id": "your-question",\n  ...\n}'
            }
            value={source}
            onChange={(e) => {
              setSource(e.target.value);
              setPreview(null);
              setErrors([]);
            }}
          />
          {errors.length > 0 && (
            <div className="error-banner" role="alert">
              <ul>
                {errors.map((error, i) => (
                  <li key={i}>{error}</li>
                ))}
              </ul>
            </div>
          )}
          {preview?.valid && (
            <div className="validation-preview">
              <h3>
                <Check size={18} />
                Validation passed
              </h3>
              <strong>{preview.question?.title ?? "Question package"}</strong>
              <p>{preview.question?.description}</p>
              <p>
                {preview.question?.type} · {preview.question?.difficulty} ·{" "}
                {preview.question?.duration_minutes} minutes
              </p>
            </div>
          )}
          <div className="modal-actions">
            <button onClick={onClose}>Cancel</button>
            {preview?.valid && preview.token ? (
              <button
                className="primary"
                disabled={busy}
                onClick={() => void publish()}
              >
                {busy ? "Publishing…" : "Confirm and publish"}
              </button>
            ) : (
              <button
                className="primary"
                disabled={busy || !source.trim()}
                onClick={() => void validate()}
              >
                {busy ? "Validating…" : "Validate package"}
              </button>
            )}
          </div>
        </div>
      )}
    </RecordDialog>
  );
}
