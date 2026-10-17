import {
  BadgeCheck,
  Circle,
  CircleCheck,
  CirclePlay,
  ClipboardCheck,
  LockKeyhole,
  RotateCcw,
} from "lucide-react";
import { readable } from "./api";
import { stateLabels } from "./learning";

const icons = {
  not_started: Circle,
  in_progress: CirclePlay,
  completed: CircleCheck,
  needs_review: RotateCcw,
  solved: CircleCheck,
  mastered: BadgeCheck,
  self_reviewed: ClipboardCheck,
  unavailable: LockKeyhole,
};
const labels: Record<string, string> = {
  ...stateLabels,
  solved: "Solved",
  mastered: "Mastered",
  self_reviewed: "Self reviewed",
  unavailable: "Not yet available",
};

/** Read-only progress cues: never a manual completion toggle. */
export function QuestionStatus({
  status,
  marker = false,
}: {
  status: string;
  marker?: boolean;
}) {
  const Icon = icons[status as keyof typeof icons] ?? Circle;
  return (
    <span
      className={`${marker ? "status-marker" : "status-badge"} status-${status}`}
      aria-hidden={marker || undefined}
    >
      <Icon size={marker ? 22 : 15} aria-hidden="true" />
      {!marker && (labels[status] ?? readable(status))}
    </span>
  );
}
