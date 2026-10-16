import type { RefObject } from "react";
export function PaneDivider({
  container,
  value,
  onChange,
}: {
  container: RefObject<HTMLDivElement | null>;
  value: number;
  onChange: (value: number) => void;
}) {
  const change = (next: number) => onChange(Math.max(25, Math.min(60, next)));
  return (
    <div
      role="separator"
      aria-label="Resize problem pane"
      aria-orientation="vertical"
      aria-valuemin={25}
      aria-valuemax={60}
      aria-valuenow={Math.round(value)}
      aria-valuetext={`${Math.round(value)}% problem, ${100 - Math.round(value)}% editor`}
      aria-controls="problem-panel"
      title="Drag to resize. Use Left/Right arrows, Home, or End when focused."
      tabIndex={0}
      className="pane-divider"
      onKeyDown={(event) => {
        if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
          event.preventDefault();
          change(
            event.key === "Home"
              ? 25
              : event.key === "End"
                ? 60
                : value + (event.key === "ArrowRight" ? 2 : -2),
          );
        }
      }}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.currentTarget.focus();
        event.currentTarget.setPointerCapture(event.pointerId);
        event.preventDefault();
      }}
      onPointerMove={(event) => {
        if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
        const rect = container.current?.getBoundingClientRect();
        if (rect) change(((event.clientX - rect.left) / rect.width) * 100);
      }}
      onPointerUp={(event) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId))
          event.currentTarget.releasePointerCapture(event.pointerId);
      }}
      onPointerCancel={(event) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId))
          event.currentTarget.releasePointerCapture(event.pointerId);
      }}
    />
  );
}
