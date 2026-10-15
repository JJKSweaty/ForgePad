import { useCallback, useEffect, useState } from "react";
import {
  ArrowLeft,
  Check,
  FileJson,
  Plus,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import { api, download, message, post, readable } from "./api";
import type { Question } from "./api";
import { native } from "./native";
import { DesktopFeature } from "./RoadmapsPage";
type Draft = {
  generation_job?: Job;
  id: string;
  status: string;
  idea?: string;
  package: Record<string, unknown> | null;
  errors: string[];
  extraction?: unknown;
  validation?: unknown;
};
type Job = {
  id: string;
  status: string;
  kind: string;
  error?: string;
  result?: unknown;
};
function differences(
  before: unknown,
  after: unknown,
  path = "",
): { path: string; before: unknown; after: unknown }[] {
  if (JSON.stringify(before) === JSON.stringify(after)) return [];
  if (
    before &&
    after &&
    typeof before === "object" &&
    typeof after === "object" &&
    !Array.isArray(before) &&
    !Array.isArray(after)
  ) {
    const b = before as Record<string, unknown>,
      a = after as Record<string, unknown>;
    return [...new Set([...Object.keys(b), ...Object.keys(a)])].flatMap((key) =>
      differences(b[key], a[key], `${path}/${key}`),
    );
  }
  return [{ path: path || "/", before, after }];
}
export function AuthoringPage({
  questions,
  refresh,
  onBrowse,
}: {
  onBrowse?: () => void;
  questions: Question[];
  refresh: () => Promise<void>;
}) {
  const [form, setForm] = useState({
    title: "",
    prompt: "",
    topics: "",
    rubric: "",
    type: "theory",
    difficulty: "intermediate",
    duration: 15,
  });
  const [workflow, setWorkflow] = useState("form"),
    [input, setInput] = useState(""),
    [drafts, setDrafts] = useState<Draft[]>([]),
    [selected, setSelected] = useState<Draft | null>(null),
    [source, setSource] = useState(""),
    [job, setJob] = useState<Job | null>(null),
    [auditId, setAuditId] = useState(""),
    [audit, setAudit] = useState<unknown>(null),
    [original, setOriginal] = useState<unknown>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [approved, setApproved] = useState(false),
    [mutation, setMutation] = useState(false),
    [useAI, setUseAI] = useState(false);
  const load = useCallback(async () => {
    setDrafts(await api<Draft[]>("/question-drafts"));
  }, []);
  useEffect(() => {
    if (native) void load().catch((e) => setError(message(e)));
  }, [load]);
  useEffect(() => {
    if (!job || !["queued", "running"].includes(job.status)) return;
    let live = true;
    const timer = setInterval(() => {
      void api<Job>(`/jobs/${job.id}`)
        .then(async (next) => {
          if (!live) return;
          setJob(next);
          if (!["queued", "running"].includes(next.status)) {
            await load();
            if (selected) {
              const d = await api<Draft>(`/question-drafts/${selected.id}`);
              if (live) {
                setSelected(d);
                setSource(JSON.stringify(d.package, null, 2) ?? "");
              }
            }
            if (next.kind === "audit" && next.result) setAudit(next.result);
            if (next.error) setError(next.error);
          }
        })
        .catch((e) => {
          if (live) setError(message(e));
        });
    }, 750);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [job?.id, job?.status, selected?.id, load]);
  if (!native) return <DesktopFeature />;
  async function choose(d: Draft) {
    setSelected(d);
    setSource(d.package ? JSON.stringify(d.package, null, 2) : "");
    setApproved(false);
    setOriginal(null);
    const id = d.package?.id;
    if (typeof id === "string" && questions.some((q) => q.id === id)) {
      try {
        setOriginal(await api(`/questions/${id}/export`));
      } catch (e) {
        setError(message(e));
      }
    }
  }
  async function stage() {
    setBusy(true);
    setError("");
    try {
      const d = await post<Draft>(
        "/question-drafts",
        workflow === "form"
          ? {
              workflow: "json",
              package: {
                schema_version: "1.0",
                id: `${
                  form.title
                    .toLowerCase()
                    .replace(/[^a-z0-9]+/g, "-")
                    .slice(0, 55)
                    .replace(/^-|-$/g, "") || "question"
                }-${crypto.randomUUID().slice(0, 8)}`,
                version: 1,
                title: form.title.trim(),
                description: form.prompt.trim().slice(0, 1800),
                type: form.type,
                difficulty: form.difficulty,
                duration_minutes: form.duration,
                language: "independent",
                prompt: form.prompt.trim(),
                topics: form.topics
                  .split(",")
                  .map((s) => s.trim())
                  .filter(Boolean),
                constraints: [],
                starter_files: {},
                test_config: null,
                reference_solution: {},
                rubric: form.rubric
                  .split("\n")
                  .map((s) => s.trim())
                  .filter(Boolean),
                follow_ups: [],
                hints: [],
                source: {
                  name: "Personal question",
                  url: "",
                  license: "All rights reserved",
                },
              },
            }
          : workflow === "json"
            ? { workflow, package: JSON.parse(input) }
            : { workflow, idea: input },
      );
      await choose(d);
      if (d.generation_job) setJob(d.generation_job);
      await load();
      setInput("");
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  async function save() {
    if (!selected) return;
    const d = await api<Draft>(`/question-drafts/${selected.id}`, {
      method: "PUT",
      body: JSON.stringify({ package: JSON.parse(source) }),
    });
    setSelected(d);
    setApproved(false);
    await load();
    return d;
  }
  async function validate() {
    setBusy(true);
    setError("");
    try {
      const d = await save();
      if (d) setJob(await post<Job>(`/question-drafts/${d.id}/validate`, {}));
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  async function publish() {
    if (!selected || !approved) return;
    setBusy(true);
    try {
      await post(`/question-drafts/${selected.id}/publish`, { approved: true });
      await choose(await api<Draft>(`/question-drafts/${selected.id}`));
      await load();
      await refresh();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  let changes: ReturnType<typeof differences> = [];
  try {
    changes = differences(original, source ? JSON.parse(source) : null);
  } catch {
    /* parsing errors appear on save */
  }
  const pending = !!job && ["queued", "running"].includes(job.status),
    unchanged =
      selected && JSON.stringify(selected.package, null, 2) === source;
  return (
    <div className="page">
      {onBrowse && (
        <button className="text-button authoring-back" onClick={onBrowse}>
          <ArrowLeft size={14} />
          Back to questions
        </button>
      )}
      <div className="page-heading">
        <div>
          <h2>Add and manage questions</h2>
          <p>
            Create a question, review your draft, then publish it to your
            library.
          </p>
        </div>
        <button
          className="secondary"
          onClick={() =>
            void api("/schema")
              .then((s) => download("forgepad-question-1.0.schema.json", s))
              .catch((e) => setError(message(e)))
          }
        >
          <FileJson size={16} />
          Export schema
        </button>
      </div>
      {error && (
        <div className="error-banner" role="alert">
          {error}
        </div>
      )}
      {job && (
        <div className="notice" role="status">
          <strong>
            {readable(job.kind)} · {readable(job.status)}
          </strong>
          {pending && (
            <button
              className="text-button"
              onClick={() =>
                void api(`/jobs/${job.id}`, { method: "DELETE" }).catch((e) =>
                  setError(message(e)),
                )
              }
            >
              Cancel job
            </button>
          )}
          {job.error && <p>{job.error}</p>}
        </div>
      )}
      <div className="studio-grid">
        <aside>
          <section className="panel">
            <div className="section-header">
              <h2>New draft</h2>
              <Plus size={17} />
            </div>
            <div className="setup-form">
              <label>
                Create from
                <select
                  value={workflow}
                  onChange={(e) => setWorkflow(e.target.value)}
                >
                  <option value="form">Write a question</option>
                  <option value="json">
                    Import a coding or question package
                  </option>
                  <option value="idea">Generate from an idea</option>
                  <option value="extract">
                    Extract existing question text
                  </option>
                </select>
              </label>
              {workflow === "form" ? (
                <div className="question-create-form">
                  <label>
                    Title
                    <input
                      value={form.title}
                      maxLength={200}
                      onChange={(e) =>
                        setForm({ ...form, title: e.target.value })
                      }
                      placeholder="e.g. Explain interrupt priorities"
                    />
                  </label>
                  <div className="two-columns">
                    <label>
                      Type
                      <select
                        value={form.type}
                        onChange={(e) =>
                          setForm({ ...form, type: e.target.value })
                        }
                      >
                        <option value="theory">Theory</option>
                        <option value="design">System design</option>
                      </select>
                    </label>
                    <label>
                      Difficulty
                      <select
                        value={form.difficulty}
                        onChange={(e) =>
                          setForm({ ...form, difficulty: e.target.value })
                        }
                      >
                        {["beginner", "intermediate", "advanced", "expert"].map(
                          (d) => (
                            <option key={d}>{d}</option>
                          ),
                        )}
                      </select>
                    </label>
                  </div>
                  <label>
                    Question
                    <textarea
                      rows={6}
                      value={form.prompt}
                      onChange={(e) =>
                        setForm({ ...form, prompt: e.target.value })
                      }
                      placeholder="Describe the problem and what a good answer should cover."
                    />
                  </label>
                  <label>
                    Topics
                    <input
                      value={form.topics}
                      onChange={(e) =>
                        setForm({ ...form, topics: e.target.value })
                      }
                      placeholder="Interrupts, RTOS (comma separated)"
                    />
                  </label>
                  <label>
                    What makes a good answer?
                    <textarea
                      rows={4}
                      value={form.rubric}
                      onChange={(e) =>
                        setForm({ ...form, rubric: e.target.value })
                      }
                      placeholder="One evaluation criterion per line"
                    />
                  </label>
                  <label>
                    Time in minutes
                    <input
                      type="number"
                      min={1}
                      max={240}
                      value={form.duration}
                      onChange={(e) =>
                        setForm({ ...form, duration: Number(e.target.value) })
                      }
                    />
                  </label>
                </div>
              ) : (
                <textarea
                  aria-label="Question JSON or idea"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  rows={8}
                  placeholder={
                    workflow === "json"
                      ? "Paste a complete question package"
                      : "Paste an idea or the original question text"
                  }
                />
              )}
              <p className="small muted-text">
                Ideas are saved even with AI disabled. Extracted fields require
                your review before tests are authored.
              </p>
              <button
                className="primary"
                disabled={
                  busy ||
                  (workflow === "form"
                    ? !form.title.trim() ||
                      !form.prompt.trim() ||
                      !form.topics.trim() ||
                      !form.rubric.trim()
                    : !input.trim())
                }
                onClick={() => void stage()}
              >
                Create draft
              </button>
            </div>
          </section>
          <section className="panel">
            <div className="section-header">
              <h2>Saved drafts</h2>
              <button
                className="icon-button"
                aria-label="Refresh drafts"
                onClick={() => void load().catch((e) => setError(message(e)))}
              >
                <RefreshCw size={15} />
              </button>
            </div>
            {drafts.map((d) => (
              <button
                key={d.id}
                className={`question-row ${selected?.id === d.id ? "selected" : ""}`}
                onClick={() => void choose(d)}
              >
                <span className="row-main">
                  <strong>
                    {String(
                      d.package?.title ?? d.idea ?? "Invalid package",
                    ).slice(0, 65)}
                  </strong>
                  <small>{readable(d.status)}</small>
                </span>
              </button>
            ))}
            {!drafts.length && (
              <div className="empty">No unpublished drafts yet.</div>
            )}
          </section>
        </aside>
        <section className="panel">
          <div className="section-header">
            <div>
              <h2>{selected ? "Review draft" : "Draft workspace"}</h2>
              <p>
                {selected
                  ? `${selected.id} · ${readable(selected.status)}`
                  : "Select a draft to review and publish it."}
              </p>
            </div>
            <ShieldCheck size={20} />
          </div>
          {selected ? (
            <div className="setup-form">
              {!!selected.extraction && (
                <div>
                  <h3>Extracted information</h3>
                  <p>
                    Resolve the listed ambiguities, then build the package
                    below. No tests are generated from unreviewed extraction.
                  </p>
                  <pre className="report">
                    {JSON.stringify(selected.extraction, null, 2)}
                  </pre>
                </div>
              )}
              {!selected.package && (
                <div className="notice">
                  <strong>Saved idea</strong>
                  <p>{selected.idea}</p>
                  <button
                    disabled={pending}
                    onClick={() =>
                      void post<Job>(
                        `/question-drafts/${selected.id}/generate`,
                        {},
                      )
                        .then(setJob)
                        .catch((e) => setError(message(e)))
                    }
                  >
                    Generate using configured local model
                  </button>
                </div>
              )}
              <label>
                Authoring package · includes protected material
                <textarea
                  className="code-input"
                  rows={19}
                  value={source}
                  onChange={(e) => {
                    setSource(e.target.value);
                    setApproved(false);
                  }}
                  readOnly={selected.status === "published" || pending}
                  spellCheck={false}
                />
              </label>
              {selected.errors?.length > 0 && (
                <div className="error-banner">
                  <ul>
                    {selected.errors.map((e, i) => (
                      <li key={i}>{e}</li>
                    ))}
                  </ul>
                </div>
              )}
              {!!selected.validation && (
                <details>
                  <summary>Validation evidence and audit</summary>
                  <pre className="report">
                    {JSON.stringify(selected.validation, null, 2)}
                  </pre>
                </details>
              )}
              <details>
                <summary>
                  {original
                    ? "Revision diff from published package"
                    : "New package review"}{" "}
                  · {changes.length} changed field(s)
                </summary>
                {changes.map((c, i) => (
                  <div className="package-diff" key={i}>
                    <strong>{c.path}</strong>
                    <div className="two-columns">
                      <pre>{JSON.stringify(c.before, null, 2) ?? "(new)"}</pre>
                      <pre>
                        {JSON.stringify(c.after, null, 2) ?? "(removed)"}
                      </pre>
                    </div>
                  </div>
                ))}
              </details>
              {selected.status !== "published" && (
                <>
                  <div className="button-row">
                    <button
                      disabled={busy || pending || !source.trim()}
                      onClick={() => void validate()}
                    >
                      <ShieldCheck size={15} />
                      Save and validate
                    </button>
                  </div>
                  {selected.status === "validated" && unchanged && (
                    <>
                      <label className="approval-check">
                        <input
                          type="checkbox"
                          checked={approved}
                          onChange={(e) => setApproved(e.target.checked)}
                        />
                        I reviewed the package, reference execution,
                        test-quality report, and revision diff.
                      </label>
                      <button
                        className="primary"
                        disabled={!approved || busy || pending}
                        onClick={() => void publish()}
                      >
                        <Check size={15} />
                        Approve and publish revision
                      </button>
                    </>
                  )}
                </>
              )}
              {selected.status === "published" && (
                <div className="notice">
                  Published. Historical attempts keep their original revision
                  and tests.
                </div>
              )}
            </div>
          ) : (
            <div className="empty">
              Start with a question on the left. Your draft stays private until
              you publish it.
            </div>
          )}
        </section>
      </div>
      <details className="panel audit-panel">
        <summary>Advanced: audit an existing question</summary>
        <div className="section-header">
          <div>
            <h2>Audit a published question</h2>
            <p>
              Deterministic checks run first. Every recommendation requires
              author review.
            </p>
          </div>
        </div>
        <div className="setup-form">
          <div className="inline-form">
            <select
              aria-label="Question to audit"
              value={auditId}
              onChange={(e) => setAuditId(e.target.value)}
            >
              <option value="">Select question</option>
              {questions.map((q) => (
                <option key={q.id} value={q.id}>
                  {q.title} · v{q.version}
                </option>
              ))}
            </select>
            <button
              disabled={!auditId || pending}
              onClick={() =>
                void post<Job>(`/questions/${auditId}/audit`, {
                  mutation,
                  use_ai: useAI,
                })
                  .then(setJob)
                  .catch((e) => setError(message(e)))
              }
            >
              Audit question
            </button>
            <button
              disabled={!auditId || busy}
              onClick={async () => {
                setBusy(true);
                try {
                  const q = await api<Record<string, unknown>>(
                    `/questions/${auditId}/export`,
                  );
                  q.version = Number(q.version) + 1;
                  const d = await post<Draft>("/question-drafts", {
                    workflow: "json",
                    package: q,
                  });
                  await choose(d);
                  await load();
                } catch (e) {
                  setError(message(e));
                } finally {
                  setBusy(false);
                }
              }}
            >
              Draft next revision
            </button>
          </div>
          <div className="button-row">
            <label className="approval-check">
              <input
                type="checkbox"
                checked={mutation}
                onChange={(e) => setMutation(e.target.checked)}
              />
              Bounded mutation tests (up to 3)
            </label>
            <label className="approval-check">
              <input
                type="checkbox"
                checked={useAI}
                onChange={(e) => setUseAI(e.target.checked)}
              />
              Request local model interpretation
            </label>
          </div>
          {!!audit && (
            <pre className="report">{JSON.stringify(audit, null, 2)}</pre>
          )}
        </div>
      </details>
    </div>
  );
}
