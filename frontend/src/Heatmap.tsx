import { useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import * as Popover from "@radix-ui/react-popover";
import { ChevronRight, Github, RefreshCw, X } from "lucide-react";
import { api, message } from "./api";
import {
  calendarMonths,
  datasets,
  dayLabel,
  dayValue,
  eventLabel,
  intensity,
} from "./dashboardData";
import type {
  ActivityDay,
  ActivityEvent,
  Dataset,
  GitHubStatus,
} from "./dashboardData";
import { EmptyState } from "./ui";
export function Heatmap({
  days: allDays,
  timezone,
  github,
  onSettings,
  onSync,
  onPractice,
  onSession,
}: {
  days: ActivityDay[];
  timezone: string;
  github: GitHubStatus | null;
  onSettings: () => void;
  onSync: () => Promise<void>;
  onPractice: (id: string) => void;
  onSession: (id: string) => void;
}) {
  const [weeks, setWeeks] = useState(52);
  const [scrollable, setScrollable] = useState(false);
  const days = useMemo(() => allDays.slice(-weeks * 7), [allDays, weeks]);
  const [dataset, setDataset] = useState<Dataset>("activity"),
    [selected, setSelected] = useState<ActivityDay | null>(null),
    [details, setDetails] = useState<ActivityEvent[] | null>(null),
    [error, setError] = useState(""),
    [syncing, setSyncing] = useState(false),
    [hover, setHover] = useState<{
      date: string;
      value: number;
      x: number;
      y: number;
    } | null>(null),
    [focus, setFocus] = useState(
      days.reduce((last, d, i) => (d.future ? last : i), 0),
    );
  const calendarScroll = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const viewport = calendarScroll.current;
    if (!viewport) return;
    const showRecent = () => {
      viewport.scrollLeft = viewport.scrollWidth - viewport.clientWidth;
      setScrollable(viewport.scrollWidth > viewport.clientWidth);
    };
    showRecent();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(showRecent);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [weeks, dataset, github?.connected, github?.calendar]);
  const instructions = useId();
  const tooltip = useId(),
    buttons = useRef<(HTMLButtonElement | null)[]>([]),
    lastAnchor = useRef<HTMLButtonElement | null>(null),
    anchor = useRef({
      getBoundingClientRect: () => new DOMRect(),
      contextElement: undefined as HTMLElement | undefined,
    });
  const counts = useMemo(
    () => new Map(github?.calendar?.days.map((d) => [d.date, d.count]) ?? []),
    [github?.calendar],
  );
  const months = useMemo(() => calendarMonths(days), [days]);
  const values = useMemo(
    () => days.map((d) => dayValue(d, dataset, counts)),
    [days, dataset, counts],
  );
  const total = values.reduce((sum, n) => sum + n, 0),
    unit = datasets.find((d) => d.id === dataset)!.unit;
  useEffect(() => {
    if (!selected || dataset === "github") return;
    let live = true;
    setDetails(null);
    setError("");
    void api<{ events: ActivityEvent[] }>(
      `/activity/${selected.date}?timezone=${encodeURIComponent(timezone)}`,
    )
      .then((r) => {
        if (live) setDetails(r.events);
      })
      .catch((e) => {
        if (live) setError(message(e));
      });
    return () => {
      live = false;
    };
  }, [selected?.date, timezone, dataset]);
  function showTip(button: HTMLButtonElement, index: number) {
    const rect = button.getBoundingClientRect();
    setHover({
      date: days[index].date,
      value: values[index],
      x: Math.min(
        window.innerWidth - 120,
        Math.max(120, rect.left + rect.width / 2),
      ),
      y: rect.top - 8,
    });
  }
  function open(button: HTMLButtonElement, index: number) {
    lastAnchor.current = button;
    anchor.current = {
      getBoundingClientRect: () => button.getBoundingClientRect(),
      contextElement: button,
    };
    setSelected(days[index]);
    setHover(null);
  }
  function key(event: React.KeyboardEvent<HTMLButtonElement>, i: number) {
    const offset = {
      ArrowLeft: -7,
      ArrowRight: 7,
      ArrowUp: -1,
      ArrowDown: 1,
      Home: -(i % 7),
      End: 6 - (i % 7),
    }[event.key];
    if (offset === undefined) return;
    event.preventDefault();
    const target = Math.max(
      0,
      Math.min(
        days.reduce((last, d, i) => (d.future ? last : i), 0),
        i + offset,
      ),
    );
    setFocus(target);
    buttons.current[target]?.focus();
  }
  const disconnected = dataset === "github" && !github?.connected;
  return (
    <section className="activity-section" aria-labelledby="activity-title">
      <div className="section-header">
        <div>
          <h2 id="activity-title">Activity</h2>
          <p>
            {dataset === "github"
              ? `GitHub contributions in the last ${weeks} weeks`
              : `${total.toLocaleString()} ${unit} in the last ${weeks} weeks`}
          </p>
        </div>
        <div className="activity-controls">
          <label className="sr-only" htmlFor="activity-range">
            Activity range
          </label>
          <select
            id="activity-range"
            value={weeks}
            onChange={(e) => {
              const next = Number(e.target.value);
              setWeeks(next);
              setFocus(
                allDays
                  .slice(-next * 7)
                  .reduce((last, d, i) => (d.future ? last : i), 0),
              );
              setSelected(null);
              setHover(null);
            }}
          >
            <option value={13}>Last 13 weeks</option>
            <option value={52}>Last 52 weeks</option>
          </select>
          <label className="sr-only" htmlFor="activity-dataset">
            Activity dataset
          </label>
          <select
            id="activity-dataset"
            value={dataset}
            onChange={(e) => {
              setDataset(e.target.value as Dataset);
              setSelected(null);
              setHover(null);
            }}
          >
            {datasets.map((d) => (
              <option key={d.id} value={d.id}>
                {d.label}
              </option>
            ))}
          </select>
          {dataset === "github" && github?.connected && (
            <button
              className="icon-button"
              aria-label="Refresh GitHub contributions"
              disabled={syncing}
              onClick={async () => {
                setSyncing(true);
                try {
                  await onSync();
                } finally {
                  setSyncing(false);
                }
              }}
            >
              <RefreshCw size={15} className={syncing ? "spinning" : ""} />
            </button>
          )}
        </div>
      </div>
      {disconnected ? (
        <EmptyState
          compact
          title="GitHub is not connected"
          description="Connect a read-only account to view contributions. Your ForgePad practice is recorded separately."
          action={
            <button className="secondary" onClick={onSettings}>
              <Github size={15} />
              Connect in Settings
            </button>
          }
        />
      ) : dataset === "github" && !github?.calendar ? (
        <EmptyState
          compact
          title="Calendar not synchronized"
          description={
            github?.error ??
            "Use Refresh to fetch your GitHub contribution calendar."
          }
        />
      ) : (
        <Popover.Root
          open={!!selected}
          onOpenChange={(open) => {
            if (!open) setSelected(null);
          }}
        >
          <Popover.Anchor virtualRef={anchor} />
          <p id={instructions} className="muted-text calendar-instructions">
            Use arrow keys to move between days, Home / End within a week, and
            Enter or Space for details. Daily counts are also available below.
          </p>
          {scrollable && (
            <p className="calendar-scroll-hint muted-text">
              Scroll horizontally to see earlier weeks.
            </p>
          )}
          <div className="calendar-scroll" ref={calendarScroll}>
            <div
              className="calendar"
              role="group"
              aria-label={`${weeks}-week ${unit} calendar`}
              aria-describedby={instructions}
              style={
                {
                  "--calendar-weeks": weeks,
                  "--calendar-width": weeks === 52 ? "568px" : "0px",
                  "--calendar-cell-height": weeks === 52 ? "18px" : "24px",
                } as React.CSSProperties
              }
            >
              <div className="calendar-months">
                {months.map((m) => (
                  <span key={m.week} style={{ gridColumn: m.week + 1 }}>
                    {m.label}
                  </span>
                ))}
              </div>
              <div className="calendar-weekdays" aria-hidden="true">
                <span style={{ gridRow: 2 }}>Mon</span>
                <span style={{ gridRow: 4 }}>Wed</span>
                <span style={{ gridRow: 6 }}>Fri</span>
              </div>
              <div className="calendar-cells">
                {days.map((d, i) => (
                  <button
                    ref={(element) => {
                      buttons.current[i] = element;
                    }}
                    key={d.date}
                    data-date={d.date}
                    data-level={intensity(values[i], dataset)}
                    className={`calendar-cell ${selected?.date === d.date ? "selected" : ""}`}
                    disabled={d.future}
                    tabIndex={i === focus ? 0 : -1}
                    aria-label={`${dayLabel(d.date)}: ${values[i]} ${unit}${d.future ? "; future date" : ""}`}
                    aria-pressed={selected?.date === d.date}
                    aria-describedby={
                      hover?.date === d.date ? tooltip : undefined
                    }
                    onFocus={(e) => {
                      setFocus(i);
                      showTip(e.currentTarget, i);
                    }}
                    onBlur={() => setHover(null)}
                    onPointerEnter={(e) => showTip(e.currentTarget, i)}
                    onPointerLeave={() => setHover(null)}
                    onKeyDown={(e) => key(e, i)}
                    onClick={(e) => open(e.currentTarget, i)}
                  />
                ))}
              </div>
            </div>
          </div>
          <div className="calendar-footer">
            <span>
              {dataset === "github"
                ? github?.last_sync_at
                  ? `Synced ${new Date(github.last_sync_at).toLocaleString()}`
                  : "No synchronized calendar yet"
                : timezone}
            </span>
            <div className="calendar-legend" aria-label="Five activity levels">
              <span>Less</span>
              {[0, 1, 2, 3, 4].map((n) => (
                <i data-level={n} key={n} />
              ))}
              <span>More</span>
            </div>
          </div>
          <details className="activity-counts">
            <summary>Daily activity counts</summary>
            <div
              className="activity-counts-scroll"
              tabIndex={0}
              role="region"
              aria-label="Daily activity counts"
            >
              <table>
                <caption>
                  {unit} · {timezone} · last {weeks} weeks
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Date</th>
                    <th scope="col">{unit}</th>
                  </tr>
                </thead>
                <tbody>
                  {days
                    .map(
                      (d, i) =>
                        !d.future && (
                          <tr
                            key={d.date}
                            data-active={values[i] > 0 || undefined}
                          >
                            <th scope="row">
                              <time dateTime={d.date}>{dayLabel(d.date)}</time>
                            </th>
                            <td>{values[i]}</td>
                          </tr>
                        ),
                    )
                    .reverse()}
                </tbody>
              </table>
            </div>
          </details>
          {!total && (
            <p className="calendar-empty">
              {dataset === "time"
                ? "No active minutes recorded yet. Time is tracked while you work in a focused practice session."
                : "No activity recorded for this dataset yet."}
            </p>
          )}
          {github?.error && dataset === "github" && (
            <p className="inline-error" role="status">
              {github.error}{" "}
              {github.calendar ? "Showing the last synchronized calendar." : ""}
            </p>
          )}
          <Popover.Portal>
            <Popover.Content
              side="bottom"
              align="end"
              sideOffset={8}
              collisionPadding={16}
              className="activity-popover"
              onCloseAutoFocus={(e) => {
                e.preventDefault();
                lastAnchor.current?.focus();
              }}
            >
              <div className="popover-heading">
                <div>
                  <strong>{selected ? dayLabel(selected.date) : ""}</strong>
                  <p>
                    {selected ? dayValue(selected, dataset, counts) : 0} {unit}
                  </p>
                </div>
                <Popover.Close
                  className="icon-button"
                  aria-label="Close day details"
                >
                  <X size={16} />
                </Popover.Close>
              </div>
              {dataset === "github" ? (
                <p className="popover-note">GitHub contributions</p>
              ) : error ? (
                <div className="inline-error" role="alert">
                  {error}
                </div>
              ) : details === null ? (
                <p className="popover-note" role="status">
                  Loading recorded activity…
                </p>
              ) : details.length ? (
                <div className="day-events">
                  {details.map((e) => (
                    <button
                      key={e.id}
                      onClick={() => {
                        setSelected(null);
                        if (e.session_id) onSession(e.session_id);
                        else if (e.question_id) onPractice(e.question_id);
                      }}
                      disabled={!e.session_id && !e.question_id}
                    >
                      <span>
                        <strong>{e.title ?? eventLabel(e.kind)}</strong>
                        <small>
                          {eventLabel(e.kind)} ·{" "}
                          {new Intl.DateTimeFormat(undefined, {
                            hour: "numeric",
                            minute: "2-digit",
                            timeZone: timezone,
                          }).format(new Date(e.occurred_at))}
                        </small>
                      </span>
                      <ChevronRight size={14} />
                    </button>
                  ))}
                </div>
              ) : (
                <p className="popover-note">
                  No question or session events were recorded on this date.
                </p>
              )}
              <Popover.Arrow className="popover-arrow" />
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>
      )}
      {hover &&
        !disconnected &&
        createPortal(
          <div
            className="calendar-tooltip"
            role="tooltip"
            id={tooltip}
            style={{ left: hover.x, top: hover.y }}
          >
            <strong>
              {hover.value} {unit}
            </strong>
            <span>{dayLabel(hover.date)}</span>
          </div>,
          document.body,
        )}
    </section>
  );
}
