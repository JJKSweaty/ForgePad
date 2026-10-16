import type { Attempt, Question } from "./api";
export const stateLabels = {
  not_started: "Not started",
  in_progress: "In progress",
  completed: "Completed",
  needs_review: "Needs review",
};
export function questionState(q: Question) {
  return (
    q.progress_status ??
    (q.completion_status === "complete"
      ? "completed"
      : q.completion_status === "needs_review"
        ? "needs_review"
        : "not_started")
  );
}
export function questionAction(q: Question) {
  return {
    not_started: "Start",
    in_progress: "Resume",
    completed: "Retry",
    needs_review: "Practice again",
  }[questionState(q)];
}
export function attemptOutcome(a: Attempt) {
  return (
    a.result?.status ??
    (a.confidence ? `Self-rated: ${a.confidence}` : (a.status ?? "Recorded"))
  );
}
export function shortDate(value?: string) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "—"
    : new Intl.DateTimeFormat(undefined, {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      }).format(date);
}
