import { useState } from "react";
import type { Question } from "./api";
import { modeNames, questionMode } from "./questionMode";

const outlines = {
  design: [
    [
      "Requirements",
      "What must the system do? State your assumptions and constraints.",
    ],
    [
      "Architecture",
      "Sketch components and connections in text. Describe the data flow.",
    ],
    ["Tradeoffs", "Compare alternatives, bottlenecks, and failure modes."],
    [
      "Validation",
      "How would you test reliability, performance, and recovery?",
    ],
  ],
  theory: [
    ["Explanation", "Explain the idea in your own words."],
    ["Example", "Use a concrete example to work through the behavior."],
    ["Edge cases", "Where does this break down? What assumptions matter?"],
  ],
  investigation: [
    ["Observations", "What do you know from the symptoms or source?"],
    [
      "Hypotheses",
      "What could explain the behavior? Prioritize likely causes.",
    ],
    ["Experiments", "Which checks would distinguish those causes?"],
    ["Resolution", "Describe a fix and how you would verify it."],
  ],
};

export default function ReasoningWorkspace({
  question,
  answer,
  onChange,
  voice,
}: {
  question: Question;
  answer: string;
  onChange: (answer: string) => void;
  voice?: React.ReactNode;
}) {
  const mode = questionMode(question);
  const outline = outlines[mode === "coding" ? "theory" : mode];
  const [section, setSection] = useState(0);
  return (
    <div className={`reasoning-workspace reasoning-${mode}`}>
      <header className="reasoning-header">
        <div>
          <span className="eyebrow">{modeNames[mode]}</span>
          <h2>
            {mode === "design"
              ? "Build your approach"
              : mode === "investigation"
                ? "Follow the evidence"
                : "Work through the idea"}
          </h2>
          <p>
            Write or speak your thinking. Open Hints to reason with your local
            coach.
          </p>
        </div>
      </header>
      <div
        className="reasoning-prompts"
        role="group"
        aria-label="Thinking prompts"
      >
        {outline.map(([title], i) => (
          <button
            key={title}
            type="button"
            aria-pressed={section === i}
            onClick={() => setSection(i)}
          >
            {i + 1}. {title}
          </button>
        ))}
      </div>
      <p className="reasoning-prompt">{outline[section][1]}</p>
      {Object.entries(question.starter_files ?? {}).map(([name, code]) => (
        <details className="reference-source" key={name}>
          <summary>Reference: {name}</summary>
          <pre>{code}</pre>
        </details>
      ))}
      <label className="reasoning-answer">
        <span>Your {mode === "design" ? "design" : "reasoning"}</span>
        <textarea
          aria-label="Written response"
          value={answer}
          onChange={(e) => onChange(e.target.value)}
          placeholder={
            mode === "design"
              ? "Requirements → components → data flow → tradeoffs…"
              : "Start with your explanation, then add examples and edge cases…"
          }
          rows={14}
        />
      </label>
      {voice}
      <div className="reasoning-footer">
        <span>
          {answer.trim() ? answer.trim().split(/\s+/).length : 0} words
        </span>
        <span>Saved with this question</span>
      </div>
    </div>
  );
}
