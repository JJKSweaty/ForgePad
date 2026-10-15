import type { ReactNode } from "react";
import { ArrowRight } from "lucide-react";
export function PageHeader({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="page-heading">
      <div>
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {action}
    </div>
  );
}
export function EmptyState({
  title,
  description,
  action,
  compact = false,
}: {
  title: string;
  description: string;
  action?: ReactNode;
  compact?: boolean;
}) {
  return (
    <div className={`empty-state ${compact ? "compact-empty" : ""}`}>
      <strong>{title}</strong>
      <p>{description}</p>
      {action}
    </div>
  );
}
export function ProgressMeter({
  value,
  label,
}: {
  value: number;
  label: string;
}) {
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(value)}
      className="progress-meter"
    >
      <span style={{ width: `${Math.min(100, Math.max(0, value))}%` }} />
    </div>
  );
}
export function RowAction({
  children,
  onClick,
}: {
  children: ReactNode;
  onClick: () => void;
}) {
  return (
    <button className="row-action" onClick={onClick}>
      <span>{children}</span>
      <ArrowRight size={15} />
    </button>
  );
}
