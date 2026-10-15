import type { Question } from "./api";
export type ActivityDay = {
  date: string;
  activity: number;
  solved: number;
  active_seconds: number;
  future: boolean;
};
export type ActivityEvent = {
  id: string;
  kind: string;
  question_id?: string;
  session_id?: string;
  occurred_at: string;
  title?: string;
  data?: { result?: string; meaningful?: boolean };
};
export type Roadmap = {
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
export type Continuation = {
  kind: "session" | "draft" | "question" | "empty";
  label: string;
  reason: string;
  question: Question | null;
  session: {
    id: string;
    state: string;
    remaining_seconds: number;
    paused: boolean;
  } | null;
  roadmap_id: string;
  roadmap_title: string;
};
export type DashboardData = {
  timezone: string;
  today: string;
  range_start: string;
  days: ActivityDay[];
  metrics: {
    questions_solved: number;
    practice_seconds: number;
    mock_interviews_completed: number;
    current_streak: number;
  };
  continuation: Continuation;
  roadmaps: Roadmap[];
  recent_activity: ActivityEvent[];
  due_reviews: { question_id: string; title: string; due_at: string }[];
  tracking: {
    available?: boolean;
    basis: string;
    idle_cutoff_seconds?: number;
  };
  generated_at: string;
};
export type GitHubStatus = {
  connected: boolean;
  login: string | null;
  last_sync_at: string | null;
  calendar: {
    days: { date: string; count: number }[];
    total: number;
    last_sync_at: string;
  } | null;
  error: string | null;
  publishing_available: false;
};
export type Dataset = "activity" | "solved" | "time" | "github";
export const datasets: { id: Dataset; label: string; unit: string }[] = [
  { id: "activity", label: "Practice activity", unit: "practice actions" },
  { id: "solved", label: "Problems solved", unit: "unique solves" },
  { id: "time", label: "Practice time", unit: "active minutes" },
  { id: "github", label: "GitHub contributions", unit: "GitHub contributions" },
];
export const eventLabel = (kind: string) =>
  ({
    solution_submitted: "Solution submitted",
    problem_solved: "Problem solved",
    mock_interview_completed: "Mock interview completed",
    practice_completed: "Practice completed",
    practice_started: "Practice opened",
    tests_run: "Tests run",
    review_completed: "Review completed",
  })[kind] ?? kind.replaceAll("_", " ");
export function dayLabel(date: string) {
  return new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${date}T12:00:00Z`));
}
export function monthLabel(date: string) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    timeZone: "UTC",
  }).format(new Date(`${date}T12:00:00Z`));
}
export function duration(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  return minutes >= 60
    ? `${Math.floor(minutes / 60)}h ${minutes % 60}m`
    : `${minutes}m`;
}
export function intensity(value: number, dataset: Dataset) {
  if (value <= 0) return 0;
  const boundaries =
    dataset === "time"
      ? [15, 30, 60]
      : dataset === "solved"
        ? [2, 3, 5]
        : [3, 6, 10];
  return 1 + boundaries.filter((n) => value >= n).length;
}
export function dayValue(
  day: ActivityDay,
  dataset: Dataset,
  github: Map<string, number>,
) {
  return dataset === "time"
    ? Math.floor(day.active_seconds / 60)
    : dataset === "github"
      ? (github.get(day.date) ?? 0)
      : day[dataset];
}
export function calendarMonths(days: ActivityDay[]) {
  return Array.from({ length: Math.ceil(days.length / 7) }, (_, week) => {
    const date = days[week * 7]?.date;
    const previous = days[(week - 1) * 7]?.date;
    return date && (!previous || date.slice(0, 7) !== previous.slice(0, 7))
      ? { week, label: monthLabel(date) }
      : null;
  }).filter((v): v is { week: number; label: string } => v !== null);
}
