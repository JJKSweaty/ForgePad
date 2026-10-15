import { useState } from "react";
type Report = {
  candidate_responses?: number;
  what_to_review?: string[];
  score?: number | null;
  dimensions?: {
    dimension: string;
    rating: number | null;
    status: string;
    reason: string;
  }[];
  test_outcomes?: {
    run_id: string;
    status: string;
    passed: number;
    total: number;
  }[];
};
export function SessionReport({ report }: { report: unknown }) {
  const [detailed, setDetailed] = useState(false);
  if (!report || typeof report !== "object")
    return <p>Evaluation is unavailable.</p>;
  const r = report as Report;
  return (
    <div>
      <span className="badge">
        {r.score == null ? "Ungraded" : `Score: ${r.score}`}
      </span>
      <p>
        {r.candidate_responses ?? 0} candidate responses recorded. Ratings
        remain ungraded where evidence is insufficient.
      </p>
      {r.test_outcomes?.map((outcome) => (
        <p key={outcome.run_id}>
          <strong>
            {outcome.passed} / {outcome.total} tests passed
          </strong>
          <br />
          {outcome.status.replaceAll("_", " ")}
        </p>
      ))}
      <p>
        Review:{" "}
        {r.what_to_review?.join(" · ") || "See the recorded rubric and replay."}
      </p>
      <button
        className="text-button"
        aria-expanded={detailed}
        onClick={() => setDetailed(!detailed)}
      >
        {detailed ? "Concise feedback" : "Detailed evidence and criteria"}
      </button>
      {detailed && (
        <>
          <dl>
            {r.dimensions?.map((d) => (
              <div key={d.dimension}>
                <dt>
                  <strong>
                    {d.dimension} · {d.status}
                  </strong>
                </dt>
                <dd style={{ margin: "6px 0 14px", fontSize: 12 }}>
                  {d.reason}
                </dd>
              </div>
            ))}
          </dl>
          <details>
            <summary>Recorded report</summary>
            <pre className="report">{JSON.stringify(report, null, 2)}</pre>
          </details>
        </>
      )}
    </div>
  );
}
