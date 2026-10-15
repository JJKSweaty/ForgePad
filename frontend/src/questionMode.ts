import type { Question } from "./api";

export function questionMode(question: Pick<Question, "type" | "test_config">) {
  if (question.test_config || question.type === "coding") return "coding";
  if (question.type === "design") return "design";
  if (question.type === "debugging" || question.type === "code_review")
    return "investigation";
  return "theory";
}

export const modeNames = {
  coding: "Code workspace",
  design: "Design studio",
  investigation: "Investigation",
  theory: "Theory notebook",
};
