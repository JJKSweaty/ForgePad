import type { RefObject } from "react";
export function ResultsDivider({
  container,
  height,
  onChange,
}: {
  container: RefObject<HTMLElement | null>;
  height: number;
  onChange: (height: number) => void;
}) {
  function change(next: number) {
    const available = container.current?.clientHeight || 600;
    const maximum = Math.max(120, Math.min(available * 0.5, available - 330));
    onChange(Math.round(Math.max(120, Math.min(maximum, next))));
  }
  return (
    <div
      className="results-divider"
      role="separator"
      tabIndex={0}
      aria-label="Resize test results"
      aria-orientation="horizontal"
      aria-controls="execution-output"
      aria-valuemin={120}
      aria-valuemax={Math.max(
        120,
        Math.round(
          Math.min(
            (container.current?.clientHeight || 600) * 0.5,
            (container.current?.clientHeight || 600) - 330,
          ),
        ),
      )}
      aria-valuenow={height}
      title="Drag or use Up/Down arrows to resize test results"
      onKeyDown={(event) => {
        if (!["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key))
          return;
        event.preventDefault();
        change(
          event.key === "Home"
            ? 120
            : event.key === "End"
              ? Infinity
              : height + (event.key === "ArrowUp" ? 20 : -20),
        );
      }}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.currentTarget.focus();
        event.currentTarget.setPointerCapture(event.pointerId);
        event.preventDefault();
      }}
      onPointerMove={(event) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          const bounds = container.current?.getBoundingClientRect();
          if (bounds) change(bounds.bottom - event.clientY - 60);
        }
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
