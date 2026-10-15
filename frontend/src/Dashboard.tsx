import { useCallback, useEffect, useState } from "react";
import {
  ArrowRight,
  BookOpen,
  Clock,
  Code2,
  Play,
  RotateCcw,
} from "lucide-react";
import { api, message, post } from "./api";
import { native, nativeEvents } from "./native";
import { duration, eventLabel } from "./dashboardData";
import type {
  Continuation,
  DashboardData,
  GitHubStatus,
} from "./dashboardData";
import { Heatmap } from "./Heatmap";
import { EmptyState, PageHeader, ProgressMeter } from "./ui";
export function Dashboard({
  onPractice,
  onSession,
  onRoadmap,
  onSettings,
}: {
  onPractice: (id: string, version?: number) => void;
  onSession: (id: string) => void;
  onRoadmap: (id: string) => void;
  onSettings: () => void;
}) {
  const [data, setData] = useState<DashboardData | null>(null),
    [github, setGithub] = useState<GitHubStatus | null>(null),
    [error, setError] = useState(""),
    [continuing, setContinuing] = useState(false),
    [timezone, setTimezone] = useState(
      () =>
        localStorage.getItem("forgepad.v2.timezone") ??
        Intl.DateTimeFormat().resolvedOptions().timeZone,
    );
  const load = useCallback(async () => {
    const d = await api<DashboardData>(
      `/dashboard?timezone=${encodeURIComponent(timezone)}`,
    );
    setData(d);
  }, [timezone]);
  useEffect(() => {
    let live = true;
    void load().catch((e) => {
      if (live) setError(message(e));
    });
    void api<GitHubStatus>("/integrations/github")
      .then((g) => {
        if (live) setGithub(g);
      })
      .catch(() => {
        /* GitHub is optional; local rendering never waits on it. */
      });
    let dispose: (() => void) | undefined;
    void nativeEvents((event) => {
      if (
        [
          "workspace_changed",
          "run_complete",
          "session_updated",
          "activity_changed",
        ].includes(event.type)
      )
        void load().catch((e) => setError(message(e)));
      if (event.type === "github_changed")
        void api<GitHubStatus>("/integrations/github")
          .then(setGithub)
          .catch((e) => setError(message(e)));
    }).then((fn) => {
      if (live) dispose = fn;
      else fn();
    });
    return () => {
      live = false;
      dispose?.();
    };
  }, [load]);
  useEffect(() => {
    if (!native) return;
    void api<{ timezone: string | null }>("/settings/profile")
      .then((p) => {
        if (p.timezone) {
          localStorage.setItem("forgepad.v2.timezone", p.timezone);
          setTimezone(p.timezone);
        }
      })
      .catch(() => {});
  }, []);
  const navigate = (next: Continuation) => {
    if (next.kind === "session" && next.session) onSession(next.session.id);
    else if (next.question)
      onPractice(
        next.question.id,
        next.kind === "draft" ? next.question.version : undefined,
      );
  };
  async function continuePractice() {
    setContinuing(true);
    setError("");
    try {
      const fresh = await api<DashboardData>(
        `/dashboard?timezone=${encodeURIComponent(timezone)}`,
      );
      setData(fresh);
      navigate(fresh.continuation);
    } catch (e) {
      setError(message(e));
    } finally {
      setContinuing(false);
    }
  }
  async function continueRoadmap(id: string) {
    setContinuing(true);
    try {
      if (native) {
        await post(`/roadmaps/${id}/activate`, {});
        const next = await api<{ question: { id: string } }>(
          `/roadmaps/${id}/next`,
        );
        onPractice(next.question.id);
      } else onRoadmap(id);
    } catch (e) {
      setError(message(e));
    } finally {
      setContinuing(false);
    }
  }
  async function syncGithub() {
    try {
      setGithub(await post<GitHubStatus>("/integrations/github/refresh", {}));
    } catch (e) {
      setError(message(e));
    }
  }
  if (!data)
    return (
      <div className="page dashboard-page">
        <PageHeader title="Dashboard" />
        {error ? (
          <div className="error-banner" role="alert">
            {error}
            <button
              onClick={() => void load().catch((e) => setError(message(e)))}
            >
              Retry
            </button>
          </div>
        ) : (
          <div className="dashboard-loading" role="status">
            Loading your preparation record…
          </div>
        )}
      </div>
    );
  const c = data.continuation,
    q = c.question,
    m = data.metrics;
  return (
    <div className="page dashboard-page">
      <PageHeader
        title="Dashboard"
        description={new Intl.DateTimeFormat(undefined, {
          weekday: "long",
          month: "long",
          day: "numeric",
          timeZone: timezone,
        }).format(new Date())}
      />
      {error && (
        <div className="error-banner" role="alert">
          {error}
        </div>
      )}
      <section className="continue-practice" aria-labelledby="continue-title">
        <div className="continue-icon">
          <Code2 size={22} />
        </div>
        <div className="continue-copy">
          <div className="section-kicker">
            {c.kind === "session"
              ? "SESSION IN PROGRESS"
              : c.kind === "draft"
                ? "PICK UP WHERE YOU LEFT OFF"
                : "UP NEXT"}
            <span>{c.roadmap_title}</span>
          </div>
          <h2 id="continue-title">
            {q?.title ?? "Choose your first question"}
          </h2>
          <p>{c.reason}</p>
          {q && (
            <div className="continue-meta">
              <span>{q.topics.slice(0, 2).join(" · ")}</span>
              <span className={`difficulty-label ${q.difficulty}`}>
                {q.difficulty}
              </span>
              <span>
                <Clock size={12} />
                {q.duration_minutes} min
              </span>
              {c.session && (
                <span>
                  {c.session.paused
                    ? "Paused"
                    : `${Math.ceil(c.session.remaining_seconds / 60)} min remaining`}
                </span>
              )}
            </div>
          )}
        </div>
        <button
          className="primary"
          disabled={continuing || !q}
          onClick={() => void continuePractice()}
        >
          <Play size={14} />
          {continuing ? "Opening…" : c.label}
        </button>
      </section>
      <section className="metric-strip" aria-label="Preparation overview">
        <Metric
          label="Questions solved"
          value={m.questions_solved.toLocaleString()}
          note="Unique passing submissions"
        />
        <Metric
          label="Practice time"
          value={duration(m.practice_seconds)}
          note={
            data.tracking.available === false
              ? "Available in the desktop app"
              : "Focused time · idle gaps excluded"
          }
        />
        <Metric
          label="Mock interviews"
          value={m.mock_interviews_completed.toLocaleString()}
          note="Completed sessions"
        />
        <Metric
          label="Current streak"
          value={`${m.current_streak} ${m.current_streak === 1 ? "day" : "days"}`}
          note="Recorded practice consistency"
        />
      </section>
      <Heatmap
        days={data.days}
        timezone={timezone}
        github={github}
        onSettings={onSettings}
        onSync={syncGithub}
        onPractice={onPractice}
        onSession={onSession}
      />
      <section className="dashboard-roadmaps" aria-labelledby="roadmaps-title">
        <div className="section-header">
          <div>
            <h2 id="roadmaps-title">Your roadmaps</h2>
            <p>One question bank. Progress carries across every path.</p>
          </div>
          <button
            className="text-button"
            onClick={() => onRoadmap(c.roadmap_id)}
          >
            All roadmaps <ArrowRight size={14} />
          </button>
        </div>
        <div className="dashboard-roadmap-grid">
          {data.roadmaps
            .filter((r) => r.id !== "crushing-firmware-interview")
            .map((r) => (
              <article key={r.id} className="roadmap-summary">
                <div className="roadmap-summary-heading">
                  <BookOpen size={17} />
                  <h3>{r.title}</h3>
                </div>
                <div className="roadmap-count">
                  <strong>{r.solved}</strong>
                  <span>/ {r.total} solved</span>
                  <small>{r.mastered} mastered</small>
                </div>
                <ProgressMeter
                  value={r.completion_percent}
                  label={`${r.title} completion`}
                />
                <div className="roadmap-summary-footer">
                  <span>{Math.round(r.completion_percent)}% complete</span>
                  <button
                    className="text-button"
                    disabled={continuing}
                    onClick={() => void continueRoadmap(r.id)}
                  >
                    Continue <ArrowRight size={14} />
                  </button>
                </div>
              </article>
            ))}
        </div>
      </section>
      <div className="dashboard-bottom">
        <section aria-labelledby="recent-title">
          <div className="section-header">
            <h2 id="recent-title">Recent activity</h2>
          </div>
          {data.recent_activity.length ? (
            <div className="compact-records">
              {data.recent_activity.slice(0, 5).map((e) => (
                <button
                  className="record-row"
                  key={e.id}
                  onClick={() => {
                    if (e.session_id) onSession(e.session_id);
                    else if (e.question_id) onPractice(e.question_id);
                  }}
                >
                  <span className="record-symbol">
                    <Code2 size={15} />
                  </span>
                  <span className="row-main">
                    <strong>{e.title ?? eventLabel(e.kind)}</strong>
                    <small>{eventLabel(e.kind)}</small>
                  </span>
                  <time>
                    {new Intl.DateTimeFormat(undefined, {
                      month: "short",
                      day: "numeric",
                      timeZone: timezone,
                    }).format(new Date(e.occurred_at))}
                  </time>
                  <ArrowRight size={13} />
                </button>
              ))}
            </div>
          ) : (
            <EmptyState
              compact
              title="No practice recorded yet"
              description="Your submissions and completed interviews will appear here."
            />
          )}
        </section>
        <section aria-labelledby="reviews-title">
          <div className="section-header">
            <h2 id="reviews-title">Upcoming reviews</h2>
            <span className="subtle-count">{data.due_reviews.length} due</span>
          </div>
          {data.due_reviews.length ? (
            <div className="compact-records">
              {data.due_reviews.slice(0, 5).map((r) => (
                <button
                  className="record-row"
                  key={r.question_id}
                  onClick={() => onPractice(r.question_id)}
                >
                  <span className="record-symbol">
                    <RotateCcw size={15} />
                  </span>
                  <span className="row-main">
                    <strong>{r.title}</strong>
                    <small>Scheduled from your last attempt</small>
                  </span>
                  <ArrowRight size={13} />
                </button>
              ))}
            </div>
          ) : (
            <EmptyState
              compact
              title="No reviews due"
              description="Review dates are scheduled from your recorded attempts."
            />
          )}
        </section>
      </div>
    </div>
  );
}
function Metric({
  label,
  value,
  note,
}: {
  label: string;
  value: string;
  note: string;
}) {
  return (
    <div className="dashboard-metric">
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{note}</small>
    </div>
  );
}
