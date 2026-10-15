import { useEffect, useState } from "react";
import { ArrowRight, Check, Clock, Play, Route } from "lucide-react";
import { api, message, post, readable } from "./api";
import { native } from "./native";
import { ProgressMeter } from "./ui";
import type { DashboardData } from "./dashboardData";
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
    void (
      native
        ? api<Roadmap[]>("/roadmaps")
        : api<DashboardData>("/dashboard").then((d) => d.roadmaps)
    )
      .then(setRoadmaps)
      .catch((e) => setError(message(e)));
  }, []);

  const roadmap = roadmaps.find((r) => r.id === selected) ?? roadmaps[0];
  async function next(timed = false) {
    if (!roadmap) return;
    setBusy(true);
    try {
      if (native) await post(`/roadmaps/${roadmap.id}/activate`, {});
      if (!native && !timed) {
        const step =
          roadmap.steps.find(
            (s) =>
              s.available && ["not_started", "needs_review"].includes(s.status),
          ) ??
          roadmap.steps.find((s) => s.available && s.status !== "mastered");
        if (step) onPractice(step.question_id);
        else
          setError(
            "Every available question is mastered. Choose a question to review.",
          );
      } else if (timed) {
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
          <h2>Preparation roadmaps</h2>
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
      <div className="roadmap-picker">
        <label htmlFor="roadmap-path">Learning path</label>
        <select
          id="roadmap-path"
          value={roadmap?.id ?? ""}
          onChange={(e) => {
            setSelected(e.target.value);
            sessionStorage.setItem("forgepad.roadmap", e.target.value);
          }}
        >
          {roadmaps.map((r) => (
            <option key={r.id} value={r.id}>
              {r.title}
            </option>
          ))}
        </select>
        {roadmap && (
          <div className="roadmap-picker-progress">
            <span>
              {roadmap.solved} / {roadmap.total} solved · {roadmap.mastered}{" "}
              mastered
            </span>
            <ProgressMeter
              value={roadmap.completion_percent}
              label="Learning path completion"
            />
          </div>
        )}
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
            {topicGroups(roadmap.steps).map((group, i, groups) => (
              <section className="topic-node" key={group.title}>
                <div className="topic-node-heading">
                  <span className="topic-node-marker">{i + 1}</span>
                  <div>
                    <h3>{group.title}</h3>
                    <p>
                      {i
                        ? `Recommended foundation: ${groups[i - 1].title}`
                        : "Start here · no prerequisites"}
                    </p>
                  </div>
                  <span>
                    {
                      group.steps.filter((s) =>
                        ["solved", "mastered"].includes(s.status),
                      ).length
                    }{" "}
                    / {group.steps.length} solved
                  </span>
                </div>
                <div className="topic-questions">
                  {group.steps.map((step) => (
                    <button
                      key={step.question_id}
                      disabled={!step.available}
                      className={`question-row roadmap-step ${step.status}`}
                      onClick={() => onPractice(step.question_id)}
                    >
                      <span className="step-number">
                        {["solved", "mastered"].includes(step.status) ? (
                          <Check size={15} />
                        ) : (
                          <span className="unstarted-dot" />
                        )}
                      </span>
                      <span className="row-main">
                        <strong>{step.title ?? step.question_id}</strong>
                        <small>{step.topics?.join(" · ")}</small>
                      </span>
                      <span className="step-status">
                        {step.available
                          ? readable(step.status)
                          : "Not yet available"}
                      </span>
                      <ArrowRight size={14} />
                    </button>
                  ))}
                </div>
              </section>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function topicGroups(steps: Roadmap["steps"]) {
  const definitions = [
    {
      title: "C and memory foundations",
      ids: ["volatile-atomicity", "vector-table", "little-endian-read"],
    },
    {
      title: "Bits and integer safety",
      ids: [
        "register-field",
        "popcount32",
        "saturating-add",
        "align-up",
        "reverse-bits",
      ],
    },
    {
      title: "Time and state machines",
      ids: ["timer-rollover", "sequence-window", "debounce-state"],
    },
    {
      title: "Buffers and data integrity",
      ids: ["bounded-ring", "frame-checksum", "crc8-atm", "sample-lower-bound"],
    },
    {
      title: "Peripheral interfaces",
      ids: [
        "uart-frame-recovery",
        "spi-sensor",
        "i2c-stuck-low",
        "adc-average",
      ],
    },
    {
      title: "Concurrency and system design",
      ids: [
        "dma-cache",
        "priority-inversion",
        "boot-power-loss",
        "sensor-pipeline",
        "linux-serial",
      ],
    },
  ];
  const assigned = new Set(definitions.flatMap((g) => g.ids));
  return [
    ...definitions.map((g) => ({
      title: g.title,
      steps: steps.filter((s) => g.ids.includes(s.question_id)),
    })),
    {
      title: "Additional exercises",
      steps: steps.filter((s) => !assigned.has(s.question_id)),
    },
  ].filter((g) => g.steps.length);
}
