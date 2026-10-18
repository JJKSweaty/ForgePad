import type { Question, Draft } from "./api";
import { questionMode } from "./questionMode";
export type WrittenMode = "theory" | "design" | "investigation";
export type DiagramNode = { id: string; label: string; x: number; y: number };
export type DiagramEdge = {
  id: string;
  source: string;
  target: string;
  label: string;
};
export type Diagram = { nodes: DiagramNode[]; edges: DiagramEdge[] };
export type WrittenWorkspace = {
  schema_version: 1;
  mode: WrittenMode;
  sections: Record<string, string>;
  confidence: "partial" | "confident" | "uncertain";
  reflection: string;
  diagram?: Diagram;
};
export const outlines: Record<
  WrittenMode,
  readonly (readonly [string, string, string])[]
> = {
  theory: [
    ["explanation", "Explanation", "Explain the idea in your own words."],
    [
      "example",
      "Example",
      "Use a concrete example to work through the behavior.",
    ],
    [
      "edge_cases",
      "Edge cases",
      "Where does this break down? What assumptions matter?",
    ],
  ],
  design: [
    [
      "requirements",
      "Requirements",
      "What must the system do? State your assumptions and constraints.",
    ],
    [
      "architecture",
      "Architecture",
      "Sketch components and connections. Describe the data flow.",
    ],
    [
      "tradeoffs",
      "Tradeoffs",
      "Compare alternatives, bottlenecks, and failure modes.",
    ],
    [
      "validation",
      "Validation",
      "How would you test reliability, performance, and recovery?",
    ],
  ],
  investigation: [
    [
      "observations",
      "Observations",
      "What do you know from the symptoms or source?",
    ],
    [
      "hypotheses",
      "Hypotheses",
      "What could explain the behavior? Prioritize likely causes.",
    ],
    [
      "experiments",
      "Experiments",
      "Which checks would distinguish those causes?",
    ],
    ["resolution", "Resolution", "Describe a fix and how you would verify it."],
  ],
};
export function createWorkspace(
  question: Question,
  answer = "",
): WrittenWorkspace | undefined {
  const mode = questionMode(question);
  if (mode === "coding") return undefined;
  return {
    schema_version: 1,
    mode,
    sections: { [outlines[mode][0][0]]: answer },
    confidence: "partial",
    reflection: "",
    ...(mode === "design" ? { diagram: { nodes: [], edges: [] } } : {}),
  };
}
export function supportedWorkspace(
  value: unknown,
  question: Question,
): value is WrittenWorkspace {
  if (!value || typeof value !== "object") return false;
  const w = value as WrittenWorkspace;
  return (
    w.schema_version === 1 &&
    w.mode === questionMode(question) &&
    !!outlines[w.mode] &&
    !!w.sections &&
    typeof w.sections === "object" &&
    Object.entries(w.sections).every(
      ([key, text]) =>
        typeof text === "string" && outlines[w.mode].some(([id]) => id === key),
    ) &&
    ["partial", "confident", "uncertain"].includes(w.confidence) &&
    typeof w.reflection === "string"
  );
}
export function projectWorkspace(workspace: WrittenWorkspace): string {
  const parts = outlines[workspace.mode]
    .map(([id, title]) => [title, workspace.sections[id] ?? ""] as const)
    .filter(([, text]) => text.trim());
  const diagram = workspace.diagram;
  if (diagram?.nodes.length) {
    const names = new Map(diagram.nodes.map((n) => [n.id, n.label]));
    let graph = `Components:\n${diagram.nodes.map((n) => `- ${n.label} (${n.id})`).join("\n")}`;
    if (diagram.edges.length)
      graph += `\nConnections:\n${diagram.edges.map((e) => `- ${names.get(e.source)} → ${names.get(e.target)}${e.label ? `: ${e.label}` : ""}`).join("\n")}`;
    parts.push(["Diagram", graph]);
  }
  if (parts.length === 1 && parts[0][0] === outlines[workspace.mode][0][1])
    return parts[0][1];
  return parts.map(([title, text]) => `${title}\n${text}`).join("\n\n");
}
export function normalizeDraft(question: Question, draft: Draft): Draft {
  if (
    draft.written_workspace &&
    !supportedWorkspace(draft.written_workspace, question)
  )
    throw new Error(
      "This draft uses an unsupported written workspace format. Export it before opening it in a newer ForgePad.",
    );
  const workspace =
    draft.written_workspace ?? createWorkspace(question, draft.answer ?? "");
  return {
    files: Object.keys(draft.files ?? {}).length
      ? draft.files
      : (question.starter_files ?? {}),
    answer: workspace ? projectWorkspace(workspace) : (draft.answer ?? ""),
    ...(workspace ? { written_workspace: workspace } : {}),
  };
}
export function workspaceError(
  workspace: WrittenWorkspace | undefined,
): string {
  if (!workspace) return "";
  if (new TextEncoder().encode(projectWorkspace(workspace)).length > 50000)
    return "Combined answer exceeds 50,000 bytes. Shorten a section before saving or submitting; your text is kept here.";
  if (new TextEncoder().encode(JSON.stringify(workspace)).length > 256 * 1024)
    return "Written workspace exceeds 256 KiB. Reduce its content before saving.";
  return "";
}

/** Keep diagram connections represented even when long notes exceed the coach's context budget. */
export function coachText(workspace: WrittenWorkspace): string {
  const full = projectWorkspace(workspace);
  if (full.length <= 5800) return full;
  const sections = outlines[workspace.mode].map(
    ([id, title]) =>
      `${title} (excerpt)\n${(workspace.sections[id] ?? "").slice(0, 850)}`,
  );
  const graph = workspace.diagram;
  if (graph?.nodes.length) {
    const names = new Map(graph.nodes.map((n) => [n.id, n.label.slice(0, 35)]));
    sections.unshift(
      `Diagram excerpt (${graph.nodes.length} components, ${graph.edges.length} connections)\nComponents: ${graph.nodes
        .slice(0, 10)
        .map((n) => n.label.slice(0, 35))
        .join(", ")}\nConnections:\n${graph.edges
        .slice(0, 10)
        .map(
          (e) =>
            `${names.get(e.source)} → ${names.get(e.target)}${e.label ? `: ${e.label.slice(0, 35)}` : ""}`,
        )
        .join("\n")}`,
    );
  }
  return sections.join("\n\n").slice(0, 5800);
}
