import { defaultLibraryFilters } from "./libraryFilters";
import { flushDrafts } from "./drafts";
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  ChevronRight,
  CircuitBoard,
  Code2,
  LayoutDashboard,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  RefreshCw,
  Search,
  Settings,
  Sun,
  TrendingUp,
} from "lucide-react";
import { api, message } from "./api";
import { nativeEvents } from "./native";
import { modeNames, questionMode } from "./questionMode";
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
  | "settings";
const navigation = [
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { id: "practice", label: "Practice", icon: Code2 },
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
      () => localStorage.getItem("forgepad.v1.theme") ?? "light",
    ),
    [resolvedTheme, setResolvedTheme] = useState("light"),
    [sidebarHidden, setSidebarHidden] = useState(
      () => localStorage.getItem("forgepad.sidebar.hidden") === "true",
    ),
    [search, setSearch] = useState(false),
    [libraryFilters, setLibraryFilters] = useState(defaultLibraryFilters);
  const sidebarButton = useRef<HTMLButtonElement>(null);
  const sidebarInteraction = useRef(false);
  useEffect(() => {
    if (!sidebarInteraction.current) return;
    sidebarButton.current?.focus();
    sidebarInteraction.current = false;
  }, [sidebarHidden]);
  const refresh = useCallback(async () => {
    try {
      const [q, p] = await Promise.all([
        api<Question[]>("/questions"),
        api<Progress>("/progress?compact=true"),
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
    const timer = window.setInterval(() => {
      if (!document.hidden) environment();
    }, 30000);
    const focus = () => environment();
    window.addEventListener("focus", focus);
    window.addEventListener("forgepad:runner", focus);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", focus);
      window.removeEventListener("forgepad:runner", focus);
    };
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
  const navigate = useCallback(
    (target: Page, prepare?: () => void) => {
      void flushDrafts()
        .then(() => {
          prepare?.();
          setPage(target === "practice" && !prepare ? "questions" : target);
          if (["questions", "progress", "dashboard"].includes(target))
            void refresh();
          window.scrollTo({ top: 0 });
        })
        .catch((e) => setError(`Draft could not be saved: ${message(e)}`));
    },
    [refresh],
  );
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
        (event.type === "runner_changed" ||
          event.type === "run_complete" ||
          event.type === "workspace_changed") &&
        (event.type !== "workspace_changed" ||
          event.data?.path?.startsWith("/settings/"))
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
  const inPractice = [
    "questions",
    "roadmaps",
    "practice",
    "interview",
  ].includes(page);
  const activePage = inPractice ? "practice" : page;
  const selectedQuestion = questions.find(
    (question) => question.id === selected,
  );
  const practiceTabs: { id: Page; label: string }[] = [
    { id: "questions", label: "Question Library" },
    { id: "roadmaps", label: "Roadmaps" },
    { id: "interview", label: "Mock Interview" },
    ...(selected
      ? [
          {
            id: "practice" as Page,
            label: selectedQuestion
              ? modeNames[questionMode(selectedQuestion)]
              : "Question workspace",
          },
        ]
      : []),
  ];
  const title =
    page === "settings"
      ? "Settings"
      : navigation.find((n) => n.id === activePage)?.label;
  function toggleSidebar() {
    sidebarInteraction.current = true;
    const hidden = !sidebarHidden;
    setSidebarHidden(hidden);
    localStorage.setItem("forgepad.sidebar.hidden", String(hidden));
  }
  return (
    <div className={`app ${sidebarHidden ? "sidebar-hidden" : ""}`}>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <button
        className="icon-button sidebar-toggle"
        ref={sidebarButton}
        aria-label={sidebarHidden ? "Show sidebar" : "Hide sidebar"}
        aria-controls="workspace-sidebar"
        aria-expanded={!sidebarHidden}
        title={sidebarHidden ? "Show sidebar" : "Hide sidebar"}
        onClick={toggleSidebar}
      >
        {sidebarHidden ? (
          <PanelLeftOpen size={19} />
        ) : (
          <PanelLeftClose size={19} />
        )}
      </button>
      <aside className="sidebar" id="workspace-sidebar" hidden={sidebarHidden}>
        <div className="sidebar-heading">
          <button
            className="brand"
            onClick={() => navigate("dashboard")}
            aria-label="ForgePad dashboard"
          >
            <span className="brand-mark">
              <CircuitBoard size={22} />
            </span>
            <span>ForgePad</span>
          </button>
        </div>
        <nav aria-label="Main navigation">
          {navigation.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              className={`nav-item ${activePage === id ? "active" : ""}`}
              aria-current={activePage === id ? "page" : undefined}
              aria-label={label}
              onClick={() => navigate(id)}
              title={label}
            >
              <Icon size={17} />
              <span>{label}</span>
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <button
            className={`nav-item ${activePage === "settings" ? "active" : ""}`}
            aria-current={activePage === "settings" ? "page" : undefined}
            aria-label="Settings"
            onClick={() => settings()}
          >
            <Settings size={17} />
            <span>Settings</span>
          </button>
          <button
            className="icon-button appearance-toggle"
            aria-label={`Use ${resolvedTheme === "dark" ? "light" : "dark"} appearance`}
            title={`Use ${resolvedTheme === "dark" ? "light" : "dark"} appearance`}
            onClick={() =>
              setTheme(resolvedTheme === "dark" ? "light" : "dark")
            }
          >
            {resolvedTheme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
          </button>
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
              {health?.runner.available ? "Runner ready" : "Set up runner"}
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
              {inPractice && (
                <div className="practice-hub-header">
                  <div className="hub-heading">
                    <h1>Practice</h1>
                    <p>
                      Solve firmware questions, test your code, and review your
                      progress.
                    </p>
                  </div>
                  <nav className="hub-tabs" aria-label="Practice modes">
                    {practiceTabs.map((tab) => (
                      <button
                        key={tab.id}
                        aria-current={page === tab.id ? "page" : undefined}
                        className={page === tab.id ? "active" : ""}
                        onClick={() =>
                          tab.id === "practice"
                            ? practice(selected, version)
                            : navigate(tab.id)
                        }
                      >
                        {tab.label}
                      </button>
                    ))}
                  </nav>
                </div>
              )}
              <div className={inPractice ? "practice-hub-content" : undefined}>
                {page === "dashboard" && (
                  <Dashboard
                    onPractice={practice}
                    onSession={openSession}
                    onProgress={() => navigate("progress")}
                    onRoadmap={openRoadmap}
                    onSettings={() => settings("github")}
                    onBrowse={(topic = "") =>
                      navigate("questions", () =>
                        setLibraryFilters((current) => ({ ...current, topic })),
                      )
                    }
                  />
                )}
                {page === "roadmaps" && (
                  <RoadmapsPage
                    onPractice={practice}
                    onInterview={openSession}
                  />
                )}
                {page === "questions" && (
                  <QuestionBank
                    questions={questions}
                    filters={libraryFilters}
                    onFiltersChange={setLibraryFilters}
                    onSession={openSession}
                    onPractice={practice}
                    refresh={refresh}
                    onAuthor={() => settings("authoring")}
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
                          Browse the library or continue your preparation
                          roadmap.
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
                    onSettings={() => settings("audio")}
                  />
                )}
                {page === "progress" && (
                  <ProgressPage
                    onBrowse={(topic = "") =>
                      navigate("questions", () =>
                        setLibraryFilters((current) => ({ ...current, topic })),
                      )
                    }
                    onDashboard={() => navigate("dashboard")}
                    progress={progress}
                    questions={questions}
                    refresh={refresh}
                    onPractice={practice}
                  />
                )}
                {page === "settings" && (
                  <SettingsPage
                    theme={theme}
                    onTheme={setTheme}
                    onReset={refresh}
                    authoring={
                      <AuthoringPage
                        questions={questions}
                        refresh={refresh}
                        onBrowse={() => navigate("questions")}
                      />
                    }
                  />
                )}
              </div>
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
