import { lazy, Suspense, useState } from "react";
import type { Question } from "./api";
import { outlines } from "./writtenWorkspace";
import type { WrittenWorkspace } from "./writtenWorkspace";
const DesignCanvas = lazy(() => import("./DesignCanvas"));
export default function ReasoningWorkspace({
  question,
  workspace,
  onChange,
  section,
  onSectionChange,
  dictating,
  voice,
}: {
  question: Question;
  workspace: WrittenWorkspace;
  onChange: (workspace: WrittenWorkspace) => void;
  section: string;
  onSectionChange: (section: string) => void;
  dictating: boolean;
  voice?: React.ReactNode;
}) {
  const [view, setView] = useState<"notes" | "diagram">("notes");
  const outline = outlines[workspace.mode];
  const current = outline.find(([id]) => id === section) ?? outline[0];
  const text = workspace.sections[current[0]] ?? "";
  const diagram = workspace.mode === "design" && current[0] === "architecture";
  return (
    <div className={`reasoning-workspace reasoning-${workspace.mode}`}>
      <h2 className="sr-only">
        {workspace.mode === "design"
          ? "Build your approach"
          : workspace.mode === "investigation"
            ? "Follow the evidence"
            : "Work through the idea"}
      </h2>
      <div
        className="reasoning-prompts"
        role="group"
        aria-label="Answer sections"
      >
        {outline.map(([id, title], i) => (
          <button
            key={id}
            type="button"
            aria-pressed={current[0] === id}
            disabled={dictating}
            onClick={() => onSectionChange(id)}
          >
            {i + 1}. {title}
            {workspace.sections[id]?.trim() ? (
              <span className="section-filled" aria-label="has text">
                {" "}
                •
              </span>
            ) : null}
          </button>
        ))}
      </div>
      <p id="section-guidance" className="reasoning-prompt">
        {current[2]}
      </p>
      <div className="writing-toolbar">
        {diagram && (
          <div
            className="design-view-tabs"
            role="group"
            aria-label="Architecture view"
          >
            {(["notes", "diagram"] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                aria-pressed={view === tab}
                disabled={dictating}
                onClick={() => setView(tab)}
              >
                {tab === "notes" ? "Notes" : "Diagram"}
              </button>
            ))}
          </div>
        )}
        <div className="writing-tools" hidden={diagram && view === "diagram"}>
          {voice}
        </div>
      </div>
      {Object.entries(question.starter_files ?? {}).length > 0 && (
        <details className="reference-source">
          <summary>Provided source</summary>
          {Object.entries(question.starter_files).map(([name, code]) => (
            <div key={name}>
              <strong>{name}</strong>
              <pre>{code}</pre>
            </div>
          ))}
        </details>
      )}
      {diagram && view === "diagram" ? (
        <Suspense fallback={<p role="status">Opening diagram editor…</p>}>
          <DesignCanvas
            diagram={workspace.diagram ?? { nodes: [], edges: [] }}
            onChange={(next) => onChange({ ...workspace, diagram: next })}
          />
        </Suspense>
      ) : (
        <label className="reasoning-answer">
          <span className="sr-only">Your {current[1].toLowerCase()}</span>
          <textarea
            aria-label="Written response"
            aria-describedby="section-guidance"
            value={text}
            onChange={(event) =>
              onChange({
                ...workspace,
                sections: {
                  ...workspace.sections,
                  [current[0]]: event.target.value,
                },
              })
            }
            placeholder={`Write your ${current[1].toLowerCase()}…`}
          />
        </label>
      )}
      <div className="reasoning-footer">
        <span>
          {text.trim() ? text.trim().split(/\s+/).length : 0} words in{" "}
          {current[1].toLowerCase()}
        </span>
        <span>Sections save together</span>
      </div>
    </div>
  );
}
