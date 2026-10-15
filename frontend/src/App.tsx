import { flushDrafts } from "./drafts";
import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import {
  BookOpen,
  ChevronRight,
  CircuitBoard,
  Code2,
  FilePenLine,
  LayoutDashboard,
  Mic,
  Moon,
  PanelLeftClose,
  RefreshCw,
  Route,
  Search,
  Settings,
  Sun,
  TrendingUp,
} from "lucide-react";
import { api, message } from "./api";
import { nativeEvents } from "./native";
import type { Health, Progress, Question } from "./api";
import { Dashboard } from "./Dashboard";
import { CommandPalette } from "./CommandPalette";
const Practice = lazy(() => import("./Practice"));
const Interview = lazy(() => import("./Interview"));
const QuestionBank = lazy(() =>
  import("./QuestionBank").then((m) => ({ default: m.QuestionBank })),
);
const ProgressPage = lazy(() =>
  import("./ProgressPage").then((m) => ({ default: m.ProgressPage })),
);
const RoadmapsPage = lazy(() =>
  import("./RoadmapsPage").then((m) => ({ default: m.RoadmapsPage })),
);
const AuthoringPage = lazy(() =>
  import("./AuthoringPage").then((m) => ({ default: m.AuthoringPage })),
);
const SettingsPage = lazy(() =>
  import("./SettingsPage").then((m) => ({ default: m.SettingsPage })),
);
export type Page =
  | "dashboard"
  | "questions"
  | "practice"
  | "interview"
  | "progress"
  | "roadmaps"
  | "authoring"
  | "settings";
const navigation = [
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { id: "roadmaps", label: "Roadmaps", icon: Route },
  { id: "practice", label: "Practice", icon: Code2 },
  { id: "questions", label: "Question Library", icon: BookOpen },
  { id: "interview", label: "Mock Interview", icon: Mic },
  { id: "progress", label: "Progress", icon: TrendingUp },
] as const;
const emptyProgress: Progress = {
  attempts: [],
  due_reviews: [],
  weak_topics: [],
  goals: [],
  summary: {},
};
export default function App() {
  const [page, setPage] = useState<Page>("dashboard"),
    [questions, setQuestions] = useState<Question[]>([]),
    [progress, setProgress] = useState<Progress>(emptyProgress),
    [health, setHealth] = useState<Health | null>(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true),
    [selected, setSelected] = useState(
      () => localStorage.getItem("forgepad.v1.question") ?? "",
    ),
    [version, setVersion] = useState<number | undefined>(),
    [theme, setTheme] = useState(
      () => localStorage.getItem("forgepad.v1.theme") ?? "dark",
    ),
    [resolvedTheme, setResolvedTheme] = useState("dark"),
    [compact, setCompact] = useState(false),
    [search, setSearch] = useState(false);
  const refresh = useCallback(async () => {
    try {
      const [q, p] = await Promise.all([
        api<Question[]>("/questions"),
        api<Progress>("/progress"),
      ]);
      setQuestions(q);
      setProgress(p);
      setError("");
    } catch (e) {
      setError(message(e));
    } finally {
      setLoading(false);
    }
  }, []);
  const environment = useCallback(
    () =>
      void api<Health>("/health")
        .then(setHealth)
        .catch((e) => setError(message(e))),
    [],
  );
  useEffect(() => {
    void refresh();
    environment();
  }, [refresh, environment]);
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const value =
        theme === "system" ? (media.matches ? "dark" : "light") : theme;
      document.documentElement.dataset.theme = value;
      setResolvedTheme(value);
    };
    apply();
    localStorage.setItem("forgepad.v1.theme", theme);
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [theme]);
  const navigate = useCallback((target: Page, prepare?: () => void) => {
    void flushDrafts()
      .then(() => {
        prepare?.();
        setPage(target);
        window.scrollTo({ top: 0 });
      })
      .catch((e) => setError(`Draft could not be saved: ${message(e)}`));
  }, []);
  const practice = useCallback(
    (id: string, revision?: number) => {
      navigate("practice", () => {
        setSelected(id);
        setVersion(revision);
        localStorage.setItem("forgepad.v1.question", id);
      });
    },
    [navigate],
  );
  const openSession = useCallback(
    (id: string) => {
      sessionStorage.setItem("forgepad.session", id);
      navigate("interview");
    },
    [navigate],
  );
  const openRoadmap = useCallback(
    (id: string) => {
      sessionStorage.setItem("forgepad.roadmap", id);
      navigate("roadmaps");
    },
    [navigate],
  );
  function settings(section = "general") {
    sessionStorage.setItem("forgepad.settings.section", section);
    navigate("settings");
  }
  useEffect(() => {
    let live = true;
    let stop: (() => void) | undefined;
    void nativeEvents((event) => {
      if (!live) return;
      if (
        event.type === "workspace_changed" &&
        event.data?.path?.startsWith("/settings/")
      )
        environment();
      if (event.type === "navigate" && event.data) {
        const t = event.data;
        if (t.action === "question" || t.action === "practice") practice(t.id);
        else if (t.action === "roadmap") openRoadmap(t.id);
        else if (t.action === "interview" || t.action === "report")
          openSession(t.id);
        else navigate("dashboard");
      }
      if (
        ["workspace_changed", "run_complete", "session_started"].includes(
          event.type,
        )
      )
        void refresh();
    }, true)
      .then((fn) => {
        if (live) stop = fn;
        else fn();
      })
      .catch((e) => setError(message(e)));
    return () => {
      live = false;
      stop?.();
    };
  }, [refresh, environment, practice, navigate, openRoadmap, openSession]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearch((v) => !v);
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  const title =
    page === "authoring"
      ? "Question Studio"
      : page === "settings"
        ? "Settings"
        : navigation.find((n) => n.id === page)?.label;
  return (
    <div className={`app ${compact ? "compact" : ""}`}>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <aside className="sidebar">
        <button
          className="brand"
          onClick={() => navigate("dashboard")}
          aria-label="ForgePad dashboard"
        >
          <span className="brand-mark">
            <CircuitBoard size={22} />
          </span>
          <span>
            ForgePad<small>Firmware practice</small>
          </span>
        </button>
        <div className="workspace-label">WORKSPACE</div>
        <nav aria-label="Main navigation">
          {navigation.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              className={`nav-item ${page === id ? "active" : ""}`}
              aria-current={page === id ? "page" : undefined}
              onClick={() => navigate(id)}
              title={compact ? label : undefined}
            >
              <Icon size={17} />
              <span>{label}</span>
            </button>
          ))}
        </nav>
        <div className="workspace-label authoring-label">AUTHORING</div>
        <button
          className={`nav-item ${page === "authoring" ? "active" : ""}`}
          aria-current={page === "authoring" ? "page" : undefined}
          onClick={() => navigate("authoring")}
        >
          <FilePenLine size={17} />
          <span>Question Studio</span>
        </button>
        <div className="sidebar-bottom">
          <button
            className={`nav-item ${page === "settings" ? "active" : ""}`}
            aria-current={page === "settings" ? "page" : undefined}
            onClick={() => settings()}
          >
            <Settings size={17} />
            <span>Settings</span>
          </button>
          <div className="local-card">
            <span className="status-dot" />
            <span>
              {health?.hosting === "cloud"
                ? "Cloud workspace"
                : "Local workspace"}
              <small>
                {health?.storage === "supabase"
                  ? "Supabase persistence"
                  : "Saved on this Mac"}
              </small>
            </span>
          </div>
          <div className="sidebar-tools">
            <button
              className="icon-button"
              aria-label={`Use ${resolvedTheme === "dark" ? "light" : "dark"} appearance`}
              onClick={() =>
                setTheme(resolvedTheme === "dark" ? "light" : "dark")
              }
            >
              {resolvedTheme === "dark" ? (
                <Sun size={16} />
              ) : (
                <Moon size={16} />
              )}
            </button>
            <span className="version">ForgePad 0.2</span>
            <button
              className="icon-button"
              aria-label="Toggle sidebar"
              onClick={() => setCompact((v) => !v)}
            >
              <PanelLeftClose size={16} />
            </button>
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumbs">
            <span>Workspace</span>
            <ChevronRight size={13} />
            <strong>{title}</strong>
          </div>
          <div className="topbar-actions">
            <button className="search-trigger" onClick={() => setSearch(true)}>
              <Search size={14} />
              <span>Search</span>
              <kbd>⌘ K</kbd>
            </button>
            <button
              className="runner-status"
              onClick={() => settings("compiler")}
            >
              <span
                className={`status-dot ${health?.runner.available ? "" : "muted"}`}
              />
              {health?.runner.available ? "Runner ready" : "Runner unavailable"}
            </button>
            <button
              className="icon-button"
              aria-label="Refresh workspace"
              onClick={() => {
                void refresh();
                environment();
              }}
            >
              <RefreshCw size={14} />
            </button>
          </div>
        </header>
        <main id="main" tabIndex={-1}>
          {error && (
            <div className="error-banner" role="alert">
              {error}
              <button onClick={() => void refresh()}>Retry</button>
            </div>
          )}
          {loading ? (
            <div className="page dashboard-loading" role="status">
              Opening workspace…
            </div>
          ) : (
            <Suspense
              fallback={
                <div className="page dashboard-loading" role="status">
                  Opening {title?.toLowerCase()}…
                </div>
              }
            >
              {page === "dashboard" && (
                <Dashboard
                  onPractice={practice}
                  onSession={openSession}
                  onRoadmap={openRoadmap}
                  onSettings={() => settings("github")}
                />
              )}
              {page === "roadmaps" && (
                <RoadmapsPage onPractice={practice} onInterview={openSession} />
              )}
              {page === "authoring" && (
                <AuthoringPage questions={questions} refresh={refresh} />
              )}
              {page === "questions" && (
                <QuestionBank
                  questions={questions}
                  onPractice={practice}
                  refresh={refresh}
                />
              )}
              {page === "practice" &&
                (selected ? (
                  <Practice
                    key={`${selected}:${version ?? "latest"}`}
                    questionId={selected}
                    questionVersion={version}
                    theme={resolvedTheme}
                    onSaved={refresh}
                    onBrowse={() => navigate("questions")}
                  />
                ) : (
                  <div className="page">
                    <h1>Practice</h1>
                    <div className="empty-state">
                      <strong>Choose a question to begin</strong>
                      <p>
                        Browse the library or continue your preparation roadmap.
                      </p>
                      <button
                        className="primary"
                        onClick={() => navigate("roadmaps")}
                      >
                        Open roadmaps <ChevronRight size={14} />
                      </button>
                    </div>
                  </div>
                ))}
              {page === "interview" && (
                <Interview
                  questions={questions}
                  health={health}
                  theme={resolvedTheme}
                />
              )}
              {page === "progress" && (
                <ProgressPage
                  progress={progress}
                  questions={questions}
                  refresh={refresh}
                  onPractice={practice}
                />
              )}
              {page === "settings" && (
                <SettingsPage theme={theme} onTheme={setTheme} />
              )}
            </Suspense>
          )}
        </main>
      </div>
      <CommandPalette
        open={search}
        onOpenChange={setSearch}
        questions={questions}
        onPractice={practice}
        onNavigate={navigate}
      />
    </div>
  );
}
