import { useEffect, useState } from "react";
import { ArrowRight, Check, Clock, Play, Route } from "lucide-react";
import { api, message, post, readable } from "./api";
import { native } from "./native";
type Roadmap = {
  id: string;
  title: string;
  description: string;
  total: number;
  solved: number;
  mastered: number;
  completion_percent: number;
  mastery_rule: string;
  steps: {
    question_id: string;
    title: string;
    topics: string[];
    available: boolean;
    status: string;
    order: number;
  }[];
};
export function DesktopFeature() {
  return (
    <div className="page">
      <div className="empty">
        <Route size={30} />
        <h2>Open the ForgePad desktop app</h2>
        <p>
          This workflow uses the native Rust service and your local workspace.
        </p>
        <p>
          The browser edition still supports the question bank, editor, and
          existing history.
        </p>
      </div>
    </div>
  );
}
export function RoadmapsPage({
  onPractice,
  onInterview,
}: {
  onPractice: (id: string) => void;
  onInterview: (id: string) => void;
}) {
  const [roadmaps, setRoadmaps] = useState<Roadmap[]>([]),
    [selected, setSelected] = useState(
      sessionStorage.getItem("forgepad.roadmap") ??
        "complete-firmware-interview",
    ),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    if (native)
      void api<Roadmap[]>("/roadmaps")
        .then(setRoadmaps)
        .catch((e) => setError(message(e)));
  }, []);
  if (!native) return <DesktopFeature />;
  const roadmap = roadmaps.find((r) => r.id === selected) ?? roadmaps[0];
  async function next(timed = false) {
    if (!roadmap) return;
    setBusy(true);
    try {
      await post(`/roadmaps/${roadmap.id}/activate`, {});
      if (timed) {
        const r = await post<{ id: string }>("/interviews", {
          roadmap_id: roadmap.id,
          duration_minutes: 30,
          kind: "mixed",
        });
        onInterview(r.id);
      } else {
        const next = await api<{ question: { id: string } }>(
          `/roadmaps/${roadmap.id}/next`,
        );
        onPractice(next.question.id);
      }
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="page">
      <div className="page-heading">
        <div>
          <div className="eyebrow">A PATH THROUGH FIRMWARE</div>
          <h1>Preparation roadmaps</h1>
          <p>
            Build breadth, revisit recorded gaps, and earn mastery through
            repeated evidence.
          </p>
        </div>
        <button
          className="primary"
          disabled={!roadmap || busy}
          onClick={() => void next()}
        >
          <Play size={15} />
          Continue roadmap
        </button>
      </div>
      {error && (
        <div className="error-banner" role="alert">
          {error}
        </div>
      )}
      <div className="roadmap-cards">
        {roadmaps.map((r) => (
          <button
            key={r.id}
            aria-pressed={r.id === roadmap?.id}
            className={`panel roadmap-card ${r.id === roadmap?.id ? "selected" : ""}`}
            onClick={() => {
              setSelected(r.id);
              sessionStorage.setItem("forgepad.roadmap", r.id);
            }}
          >
            <Route size={21} />
            <h2>{r.title}</h2>
            <span>
              {r.solved} / {r.total} solved · {r.mastered} mastered
            </span>
            <progress
              aria-label={`${r.title} completion`}
              max={100}
              value={r.completion_percent}
            />
          </button>
        ))}
      </div>
      {roadmap && (
        <section className="panel">
          <div className="section-header">
            <div>
              <h2>{roadmap.title}</h2>
              <p>{roadmap.description}</p>
            </div>
            <button disabled={busy} onClick={() => void next(true)}>
              <Clock size={15} />
              30-minute interview
            </button>
          </div>
          <p className="roadmap-rule">{roadmap.mastery_rule}</p>
          <div className="roadmap-steps">
            {roadmap.steps.map((step) => (
              <button
                key={step.question_id}
                disabled={!step.available}
                className={`question-row roadmap-step ${step.status}`}
                onClick={() => onPractice(step.question_id)}
              >
                <span className="step-number">
                  {step.status === "solved" || step.status === "mastered" ? (
                    <Check size={17} />
                  ) : (
                    step.order
                  )}
                </span>
                <span className="row-main">
                  <strong>{step.title ?? step.question_id}</strong>
                  <small>{step.topics?.join(" · ")}</small>
                </span>
                <span className="badge">
                  {step.available ? readable(step.status) : "Not yet available"}
                </span>
                <ArrowRight size={16} />
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
