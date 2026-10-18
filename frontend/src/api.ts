import type { WrittenWorkspace } from "./writtenWorkspace";
import { native, nativeRequest } from "./native";
export type Question = {
  id: string;
  version: number;
  title: string;
  description: string;
  type: string;
  difficulty: string;
  topics: string[];
  duration_minutes: number;
  language: string;
  prompt: string;
  constraints: string[];
  starter_files: Record<string, string>;
  rubric: string[];
  follow_ups: string[];
  hints: string[];
  bookmarked?: boolean;
  archived?: boolean;
  completion_status?: string;
  progress_status?:
    "not_started" | "in_progress" | "completed" | "needs_review";
  has_completed?: boolean;
  attempt_count?: number;
  last_activity_at?: string;
  draft_version?: number;
  session_id?: string;
  latest_result?: string;
  coaching_available?: boolean;
  coach_provider?: "openrouter" | "local";
  coach_model?: string;
  has_tests?: boolean;
  test_config?: {
    mode?: string;
    tests: {
      id: string;
      name: string;
      stdin?: string;
      expected_stdout?: string;
      fixture?: string | null;
    }[];
  };
  source?: { name: string; url: string; license: string };
};
export type Draft = {
  question_version?: number;
  written_workspace?: WrittenWorkspace | null;
  files: Record<string, string>;
  answer: string;
  updated_at?: string;
};
export type Run = {
  id: string;
  status: string;
  attempt_id?: number;
  result?: {
    status: string;
    compiler_output?: string;
    passed: number;
    total: number;
    elapsed_ms?: number;
    tests: {
      id: string;
      name: string;
      visibility: string;
      status: string;
      stdout?: string;
      stderr?: string;
      expected_stdout?: string;
      elapsed_ms?: number;
    }[];
  };
};
export type Attempt = {
  written_workspace?: WrittenWorkspace | null;
  id: string;
  question_id: string;
  question_title?: string;
  title?: string;
  created_at: string;
  status?: string;
  result?: Partial<NonNullable<Run["result"]>>;
  confidence?: string;
  answer?: string;
  files?: Record<string, string>;
  reflection?: string;
  question_version?: number;
  type?: string;
  language?: string;
  completion_status?: string;
  assessment_basis?: string;
  review_due_at?: string;
  duration_seconds?: number;
  ai_feedback?: unknown;
};
export type Goal = {
  id: string;
  title: string;
  status: string;
  question_id?: string;
  topic?: string;
};
export type Progress = {
  attempts: Attempt[];
  due_reviews: (
    | {
        id?: string;
        question_id?: string;
        title?: string;
        question_title?: string;
        topics?: string[];
        previous_result?: string;
        last_attempted_at?: string;
        reason?: string;
        due_at?: string;
      }
    | string
  )[];
  weak_topics: (
    | {
        topic: string;
        count?: number;
        needs_review?: number;
        evidence_ids?: string[];
      }
    | string
  )[];
  goals: Goal[];
  summary: Record<string, number>;
};
export type Session = {
  id: string;
  question_id: string;
  state: string;
  duration_minutes: number;
  started_at: string;
  remaining_seconds: number;
  paused: boolean;
  transcript: { role: string; content: string; created_at: string }[];
  follow_up_index: number;
  report?: unknown;
};
export type Health = {
  status: string;
  hosting?: string;
  storage?: string;
  runner: { available: boolean; detail?: string };
  ai: { available: boolean; detail?: string };
  speech: { available: boolean; detail?: string };
};
export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  if (native) return nativeRequest<T>(path, init);
  const response = await fetch(`/api${path}`, {
    ...init,
    headers: {
      ...(init?.body instanceof FormData
        ? {}
        : { "Content-Type": "application/json" }),
      ...init?.headers,
    },
  });
  if (!response.ok) {
    let detail = `Request failed (${response.status})`;
    try {
      const body = await response.json();
      detail =
        typeof body.detail === "string"
          ? body.detail
          : JSON.stringify(body.detail ?? body);
    } catch {
      /* non-JSON server response */
    }
    throw new Error(detail);
  }
  if (response.status === 204) return undefined as T;
  return response.json();
}
export const post = <T>(path: string, body: unknown) =>
  api<T>(path, { method: "POST", body: JSON.stringify(body) });
export function download(name: string, data: unknown) {
  const link = document.createElement("a");
  link.href = URL.createObjectURL(
    new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
  );
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}
export const readable = (value: string) =>
  value.replaceAll("_", " ").replaceAll("-", " ");
export const message = (error: unknown) =>
  error instanceof Error ? error.message : String(error);
