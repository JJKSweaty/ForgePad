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
export function shortDate(value?: string, timezone?: string) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "—"
    : new Intl.DateTimeFormat(undefined, {
        timeZone: timezone,
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      }).format(date);
}

/** Canonical calendar date in the timezone used to display the timestamp. */
export function calendarDate(value: string, timezone: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)!.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}
