import { expect, it } from "vitest";
import fixture from "../../backend/tests/fixtures/written-workspace.json";
import { projectWorkspace, normalizeDraft } from "./writtenWorkspace";
import type { WrittenWorkspace } from "./writtenWorkspace";
import type { Question } from "./api";
it("uses the same readable diagram projection as native and Python storage", () => {
  expect(projectWorkspace(fixture as WrittenWorkspace)).toBe(
    "Requirements\nBound memory and latency.\n\nArchitecture\nSeparate capture from processing.\n\nTradeoffs\nBackpressure versus loss.\n\nValidation\nExercise overflow recovery.\n\nDiagram\nComponents:\n- Sensor (sensor)\n- Bounded queue (queue)\nConnections:\n- Sensor → Bounded queue: samples",
  );
});
it("imports an old answer without splitting it or changing whitespace", () => {
  const question = { type: "theory", starter_files: {} } as Question;
  const draft = normalizeDraft(question, {
    files: {},
    answer: "  Old\nanswer  ",
  });
  expect(draft.answer).toBe("  Old\nanswer  ");
  expect(draft.written_workspace?.sections).toEqual({
    explanation: "  Old\nanswer  ",
  });
});

it("keeps diagram connections in bounded coach context even after long notes", async () => {
  const { coachText } = await import("./writtenWorkspace");
  const workspace = structuredClone(fixture) as WrittenWorkspace;
  workspace.sections.requirements = "Long requirement. ".repeat(500);
  const context = coachText(workspace);
  expect(context.length).toBeLessThanOrEqual(5800);
  expect(context).toContain("Sensor → Bounded queue: samples");
  expect(context).toContain("excerpt");
});
