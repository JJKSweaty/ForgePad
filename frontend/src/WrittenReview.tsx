import { lazy, Suspense } from "react";
import { outlines } from "./writtenWorkspace";
import type { WrittenWorkspace } from "./writtenWorkspace";
const Canvas = lazy(() => import("./DesignCanvas"));
export function WrittenReview({ workspace }: { workspace: WrittenWorkspace }) {
  if (workspace.schema_version !== 1 || !outlines[workspace.mode])
    return (
      <p>
        This saved workspace requires a newer ForgePad. Its original data is
        included in the export.
      </p>
    );
  return (
    <section
      className="written-review"
      aria-label="Submitted written workspace"
    >
      <p>
        <strong>Self-assessment:</strong>{" "}
        {
          {
            confident: "Confident",
            partial: "Partial understanding",
            uncertain: "Uncertain",
          }[workspace.confidence]
        }
      </p>
      {workspace.reflection.trim() && (
        <section>
          <h3>Your reflection</h3>
          <p className="prose">{workspace.reflection}</p>
        </section>
      )}
      {outlines[workspace.mode].map(([id, title]) =>
        workspace.sections[id]?.trim() ? (
          <section key={id}>
            <h3>{title}</h3>
            <div className="prose">{workspace.sections[id]}</div>
          </section>
        ) : null,
      )}
      {workspace.diagram && workspace.diagram.nodes.length > 0 && (
        <div className="saved-diagram">
          <h3>Submitted diagram</h3>
          <Suspense fallback={<p>Opening saved diagram…</p>}>
            <Canvas diagram={workspace.diagram} readOnly />
          </Suspense>
        </div>
      )}
    </section>
  );
}
