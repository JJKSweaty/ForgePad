import { useCallback, useEffect, useState, type ReactNode } from "react";
import {
  Check,
  Copy,
  Download,
  Github,
  Link2,
  RefreshCw,
  Trash2,
  Unplug,
} from "lucide-react";
import { api, download, message, post, readable } from "./api";
import { native } from "./native";
import LocalCoachSettings from "./LocalCoachSettings";
import type { GitHubStatus } from "./dashboardData";
import { PageHeader } from "./ui";
import {
  InterviewAISettings,
  SpeechModels,
  BuiltinSpeechModels,
} from "./InterviewAISettings";
type Integration = {
  enabled: boolean;
  connector_status: string;
  executable_path: string | null;
  command: string | null;
  local_mcp_url: string | null;
  setup_instructions: string;
  coach_instructions: string;
  privacy: string;
  last_successful_tool_call?: { tool: string; created_at: string };
  permissions: Record<string, boolean>;
};
const sections = [
  ["general", "General"],
  ["audio", "Interview & AI"],
  ["github", "Connections"],
  ["compiler", "Workspace & data"],
  ["authoring", "Question authoring"],
] as const;
type Section = (typeof sections)[number][0];
const sectionAliases: Record<string, Section> = {
  models: "audio",
  integrations: "github",
  storage: "compiler",
};
export function SettingsPage({
  authoring,
  theme = "dark",
  onTheme = () => {},
}: {
  authoring?: ReactNode;
  theme?: string;
  onTheme?: (theme: string) => void;
}) {
  const [section, setSection] = useState<Section>(() => {
      const s = sessionStorage.getItem("forgepad.settings.section");
      return s && sectionAliases[s]
        ? sectionAliases[s]
        : sections.some(([id]) => id === s)
          ? (s as Section)
          : "general";
    }),
    [integration, setIntegration] = useState<Integration | null>(null),
    [mode, setMode] = useState("external_assistant"),
    [retain, setRetain] = useState(false),
    [speech, setSpeech] = useState({
      engine: "builtin",
      endpoint: "",
      model: "ultra",
    }),
    [runner, setRunner] = useState({
      image: "forgepad-runner:local",
      docker_context: "",
      scratch_directory: "",
    }),
    [timezone, setTimezone] = useState(
      () =>
        localStorage.getItem("forgepad.v2.timezone") ??
        Intl.DateTimeFormat().resolvedOptions().timeZone,
    ),
    [github, setGithub] = useState<GitHubStatus | null>(null),
    [token, setToken] = useState(""),
    [logs, setLogs] = useState<unknown>(null),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [apiKey, setApiKey] = useState("");
  const loadIntegration = useCallback(
    async () =>
      setIntegration(await api<Integration>("/integrations/heyclicky")),
    [],
  );
  useEffect(() => {
    if (!native) {
      void api<GitHubStatus>("/integrations/github")
        .then(setGithub)
        .catch(() => {});
      return;
    }
    void Promise.all([
      loadIntegration(),
      api<{ mode: string; record_audio: boolean }>("/settings/audio").then(
        (a) => {
          setMode(a.mode);
          setRetain(a.record_audio);
        },
      ),
      api<typeof speech>("/settings/speech").then((s) =>
        setSpeech({
          engine: s.engine ?? "endpoint",
          endpoint: s.endpoint,
          model: s.model,
        }),
      ),
      api<{ config: typeof runner }>("/settings/runner").then((r) =>
        setRunner(r.config),
      ),
      api<GitHubStatus>("/integrations/github").then(setGithub),
      api<{ timezone: string | null }>("/settings/profile").then((p) => {
        if (p.timezone) setTimezone(p.timezone);
      }),
    ]).catch((e) => setError(message(e)));
  }, [loadIntegration]);
  async function action(fn: () => Promise<unknown>, success: string) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await fn();
      if (success) setNotice(success);
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  const copy = (value: string, label: string) =>
    action(() => navigator.clipboard.writeText(value), `${label} copied.`);
  async function saveAudio(nextMode = mode, nextRetain = retain) {
    await api("/settings/audio", {
      method: "PUT",
      body: JSON.stringify({ mode: nextMode, record_audio: nextRetain }),
    });
    setMode(nextMode);
    setRetain(nextRetain);
  }
  const nativeOnly = !native && ["audio", "github"].includes(section);
  return (
    <div className="page settings-page">
      <PageHeader
        title="Settings"
        description="Make ForgePad work the way you do."
      />
      <div className="settings-layout">
        <nav className="settings-navigation" aria-label="Settings sections">
          {sections.map(([id, label]) => (
            <button
              key={id}
              aria-current={section === id ? "page" : undefined}
              className={section === id ? "active" : ""}
              onClick={() => {
                setSection(id);
                sessionStorage.setItem("forgepad.settings.section", id);
                setError("");
                setNotice("");
              }}
            >
              {label}
            </button>
          ))}
        </nav>
        <div className="settings-content">
          {error && (
            <div className="error-banner" role="alert">
              {error}
            </div>
          )}
          {notice && (
            <div className="notice settings-feedback" role="status">
              <Check size={15} />
              {notice}
            </div>
          )}
          {nativeOnly ? (
            <div className="settings-section">
              <h2>{sections.find(([id]) => id === section)?.[1]}</h2>
              <p>
                Open the native ForgePad app to configure this optional
                integration. Your browser question library and practice history
                remain available.
              </p>
            </div>
          ) : (
            <>
              {section === "authoring" && authoring}
              {section === "general" && (
                <section className="settings-section">
                  <h2>General</h2>
                  <p className="settings-description">
                    Appearance and local activity dates.
                  </p>
                  <div className="setting-row">
                    <div>
                      <strong>Appearance</strong>
                      <p>Use a comfortable contrast for your workspace.</p>
                    </div>
                    <div
                      className="segmented-control"
                      role="group"
                      aria-label="Appearance"
                    >
                      {["light", "dark", "system"].map((t) => (
                        <button
                          key={t}
                          aria-pressed={theme === t}
                          onClick={() => onTheme(t)}
                        >
                          {readable(t)}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="setting-row setting-row-stacked">
                    <div>
                      <strong>Activity timezone</strong>
                      <p>
                        Daily practice, streaks, and date boundaries use this
                        timezone. Original timestamps stay in UTC.
                      </p>
                    </div>
                    <form
                      className="inline-form"
                      onSubmit={(e) => {
                        e.preventDefault();
                        void action(async () => {
                          if (native)
                            await api("/settings/profile", {
                              method: "PUT",
                              body: JSON.stringify({ timezone }),
                            });
                          else
                            new Intl.DateTimeFormat(undefined, {
                              timeZone: timezone,
                            });
                          localStorage.setItem(
                            "forgepad.v2.timezone",
                            timezone,
                          );
                        }, "Activity timezone saved.");
                      }}
                    >
                      <input
                        aria-label="Activity timezone"
                        value={timezone}
                        onChange={(e) => setTimezone(e.target.value)}
                        spellCheck={false}
                      />
                      <button disabled={busy} type="submit">
                        Save timezone
                      </button>
                    </form>
                  </div>
                </section>
              )}
              {section === "audio" && <InterviewAISettings />}
              {section === "audio" && (
                <section className="settings-section">
                  <h3>Voice & transcription</h3>
                  <p className="settings-description">
                    Your voice is transcribed on this Mac. Choose how your
                    interviewer responds.
                  </p>
                  <label className="setting-row">
                    <span>
                      <strong>Voice answers</strong>
                      <p>
                        Dictate in practice, hints, and interviews. Review the
                        live text before sending.
                      </p>
                    </span>
                    <input
                      type="checkbox"
                      role="switch"
                      aria-label="Voice answers"
                      checked={mode === "interview"}
                      onChange={(e) =>
                        void action(
                          () =>
                            saveAudio(
                              e.target.checked ? "interview" : "text_practice",
                            ),
                          "Voice preference saved.",
                        )
                      }
                    />
                  </label>
                  <p className="privacy-note">
                    {mode === "interview"
                      ? "Press Speak your answer in practice, hints, or an interview to start local dictation. Stop releases the microphone. HeyClicky controls its microphone independently."
                      : "ForgePad does not capture in this mode. HeyClicky controls its own microphone independently."}
                  </p>
                  <label className="approval-check">
                    <input
                      type="checkbox"
                      checked={retain}
                      onChange={(e) =>
                        void action(
                          () => saveAudio(mode, e.target.checked),
                          "Recording preference saved.",
                        )
                      }
                    />
                    Keep interview recordings on this Mac for replay
                  </label>
                  <p className="small muted-text">
                    Retention is off by default. Recordings are unavailable to
                    MCP and excluded from JSON exports.
                  </p>
                  <div className="settings-divider" />
                  <h3>Speech recognition</h3>
                  <p className="settings-description">
                    Choose a model for private, on-device transcription.
                  </p>
                  <div
                    className="segmented-control"
                    role="group"
                    aria-label="Speech engine"
                  >
                    <button
                      aria-pressed={speech.engine === "builtin"}
                      onClick={() =>
                        setSpeech({
                          ...speech,
                          engine: "builtin",
                          model: "ultra",
                        })
                      }
                    >
                      Built-in Parakeet
                    </button>
                    <button
                      aria-pressed={speech.engine === "endpoint"}
                      onClick={() =>
                        setSpeech({
                          ...speech,
                          engine: "endpoint",
                          model: "parakeet",
                        })
                      }
                    >
                      Custom engine
                    </button>
                  </div>
                  {speech.engine === "builtin" ? (
                    <BuiltinSpeechModels
                      selected={speech.model}
                      onSelect={(model) => setSpeech({ ...speech, model })}
                    />
                  ) : (
                    <div className="custom-speech-engine">
                      <label>
                        Loopback endpoint
                        <input
                          value={speech.endpoint}
                          onChange={(e) =>
                            setSpeech({ ...speech, endpoint: e.target.value })
                          }
                          placeholder="http://127.0.0.1:8080"
                        />
                      </label>
                      <SpeechModels
                        endpoint={speech.endpoint}
                        selected={speech.model}
                        onSelect={(model) => setSpeech({ ...speech, model })}
                      />
                      <label>
                        Model ID
                        <input
                          value={speech.model}
                          onChange={(e) =>
                            setSpeech({ ...speech, model: e.target.value })
                          }
                        />
                      </label>
                      <p>
                        Use a Parakeet-compatible runtime with a transcription
                        endpoint. Push-to-talk and activity detection run
                        separately from the editor; no global wake-word listener
                        is started.
                      </p>
                    </div>
                  )}
                  <button
                    className="primary"
                    disabled={busy}
                    onClick={() =>
                      void action(
                        () =>
                          api("/settings/speech", {
                            method: "PUT",
                            body: JSON.stringify(speech),
                          }),
                        "Speech configuration saved.",
                      )
                    }
                  >
                    Save speech configuration
                  </button>
                </section>
              )}
              {section === "audio" && <LocalCoachSettings />}
              {section === "compiler" && native && (
                <section className="settings-section">
                  <h2>Compiler</h2>
                  <p className="settings-description">
                    C/C++ code runs inside a restricted Linux Docker VM.
                  </p>
                  <label>
                    Runner image
                    <input
                      value={runner.image}
                      onChange={(e) =>
                        setRunner({ ...runner, image: e.target.value })
                      }
                    />
                  </label>
                  <label>
                    Docker context
                    <input
                      value={runner.docker_context}
                      onChange={(e) =>
                        setRunner({ ...runner, docker_context: e.target.value })
                      }
                      placeholder="Use Docker's active context"
                    />
                  </label>
                  <label>
                    Shared scratch directory (optional)
                    <input
                      value={runner.scratch_directory ?? ""}
                      onChange={(e) =>
                        setRunner({
                          ...runner,
                          scratch_directory: e.target.value,
                        })
                      }
                      placeholder="Default: workspace runner directory"
                    />
                  </label>
                  <p>
                    For a VM with restricted file sharing, choose a writable
                    directory shared with that VM. It contains only temporary
                    compiler jobs.
                  </p>
                  <p>
                    Choose an existing context if the desktop environment
                    differs from your terminal. ForgePad does not change
                    Docker’s global context.
                  </p>
                  <button
                    className="primary"
                    disabled={busy}
                    onClick={() =>
                      void action(async () => {
                        await api("/settings/runner", {
                          method: "PUT",
                          body: JSON.stringify(runner),
                        });
                        const result = await post<{
                          status: string;
                          compiler_output?: string;
                        }>("/settings/runner/verify", {});
                        if (result.status !== "passed")
                          throw new Error(
                            result.compiler_output ??
                              "Sandbox preflight did not pass.",
                          );
                      }, "Runner configuration saved and sandbox verified.")
                    }
                  >
                    Save and test runner
                  </button>
                </section>
              )}
              {section === "github" && (
                <section className="settings-section">
                  <div className="settings-title-row">
                    <div>
                      <h2>GitHub</h2>
                      <p className="settings-description">
                        A read-only contribution calendar. Optional for all
                        local practice.
                      </p>
                    </div>
                    <Github size={21} />
                  </div>
                  {github?.connected ? (
                    <>
                      <div className="setting-row">
                        <div>
                          <strong>{github.login}</strong>
                          <p>
                            {github.last_sync_at
                              ? `Last synchronized ${new Date(github.last_sync_at).toLocaleString()}`
                              : "No calendar synchronized yet"}
                          </p>
                        </div>
                        <span className="badge success">Connected</span>
                      </div>
                      <div className="button-row">
                        <button
                          disabled={busy}
                          onClick={() =>
                            void action(async () => {
                              const g = await post<GitHubStatus>(
                                "/integrations/github/refresh",
                                {},
                              );
                              setGithub(g);
                              if (g.error) throw new Error(g.error);
                            }, "Contribution calendar synchronized.")
                          }
                        >
                          <RefreshCw size={14} />
                          Refresh calendar
                        </button>
                        <button
                          disabled={busy}
                          onClick={() =>
                            void action(
                              async () =>
                                setGithub(
                                  await post(
                                    "/integrations/github/disconnect",
                                    {},
                                  ),
                                ),
                              "GitHub disconnected and local calendar cache removed.",
                            )
                          }
                        >
                          <Unplug size={14} />
                          Disconnect
                        </button>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="settings-empty">
                        <strong>GitHub is not connected</strong>
                        <p>
                          ForgePad activity and GitHub contributions are
                          separate datasets.
                        </p>
                      </div>
                      <label>
                        Personal access token
                        <input
                          type="password"
                          autoComplete="off"
                          spellCheck={false}
                          value={token}
                          onChange={(e) => setToken(e.target.value)}
                          placeholder="Stored in macOS Keychain"
                        />
                      </label>
                      <p>
                        Use the minimum account access needed for a contribution
                        calendar. Repository write permissions are not required.
                        ForgePad only reads your account identity and
                        contribution dates/counts.
                      </p>
                      <button
                        className="primary"
                        disabled={busy || !token.trim()}
                        onClick={() =>
                          void action(async () => {
                            const g = await post<GitHubStatus>(
                              "/integrations/github/connect",
                              { token },
                            );
                            setToken("");
                            setGithub(g);
                            if (g.error) throw new Error(g.error);
                          }, "GitHub connected and calendar synchronized.")
                        }
                      >
                        <Github size={15} />
                        Connect read-only account
                      </button>
                    </>
                  )}
                  {github?.error && (
                    <p className="inline-error">
                      {github.error}{" "}
                      {github.calendar
                        ? "The last synchronized calendar is still available."
                        : ""}
                    </p>
                  )}
                  <div className="settings-divider" />
                  <h3>Solution publishing</h3>
                  <p>
                    Publishing is not enabled. Connecting a calendar never
                    publishes solutions, questions, notes, or interview
                    transcripts.
                  </p>
                </section>
              )}
              {section === "github" && integration && (
                <details className="settings-section advanced-settings">
                  <summary>HeyClicky voice commands & MCP</summary>
                  <div className="settings-title-row">
                    <div>
                      <h2>HeyClicky</h2>
                      <p className="settings-description">
                        MCP over a local command is the preferred connection.
                      </p>
                    </div>
                    <span
                      className={`badge ${integration.enabled ? "success" : ""}`}
                    >
                      {readable(integration.connector_status)}
                    </span>
                  </div>
                  <div className="privacy-note">{integration.privacy}</div>
                  <dl className="integration-details">
                    <dt>Executable</dt>
                    <dd>
                      <code>
                        {integration.executable_path ??
                          "Build the native connector to generate its installed path."}
                      </code>
                    </dd>
                    <dt>Command</dt>
                    <dd>
                      <code>
                        {integration.command ??
                          "Not available until the connector has been built."}
                      </code>
                    </dd>
                    <dt>Local MCP URL</dt>
                    <dd>{integration.local_mcp_url ?? "Disabled"}</dd>
                    <dt>Last confirmed call</dt>
                    <dd>
                      {integration.last_successful_tool_call
                        ? `${integration.last_successful_tool_call.tool} · ${new Date(integration.last_successful_tool_call.created_at).toLocaleString()}`
                        : "No external tool call recorded"}
                    </dd>
                  </dl>
                  <div className="button-row">
                    {integration.enabled ? (
                      <button
                        disabled={busy}
                        onClick={() =>
                          void action(async () => {
                            await post(
                              "/integrations/heyclicky/disconnect",
                              {},
                            );
                            setApiKey("");
                            await loadIntegration();
                          }, "Connector access revoked.")
                        }
                      >
                        <Unplug size={14} />
                        Disconnect
                      </button>
                    ) : (
                      <button
                        className="primary"
                        disabled={busy || !integration.executable_path}
                        onClick={() =>
                          void action(async () => {
                            await post("/integrations/heyclicky/connect", {});
                            await loadIntegration();
                          }, "Local connector enabled. Add its command in HeyClicky.")
                        }
                      >
                        <Link2 size={14} />
                        Enable connector
                      </button>
                    )}
                    <button
                      disabled={!integration.command}
                      onClick={() =>
                        void copy(
                          `${integration.setup_instructions}\n\nCommand:\n${integration.command}`,
                          "Setup configuration",
                        )
                      }
                    >
                      <Copy size={14} />
                      Copy configuration
                    </button>
                    <button
                      disabled={busy || !integration.enabled}
                      onClick={() =>
                        void action(async () => {
                          const r = await post<{ detail: string }>(
                            "/integrations/heyclicky/test",
                            {},
                          );
                          setNotice(r.detail);
                        }, "")
                      }
                    >
                      Test connection
                    </button>
                    <button
                      onClick={() =>
                        void action(async () => {
                          setLogs(await api("/integrations/heyclicky/logs"));
                          await loadIntegration();
                        }, "")
                      }
                    >
                      View logs
                    </button>
                  </div>
                  <details>
                    <summary>Setup instructions & Firmware Coach</summary>
                    <p>{integration.setup_instructions}</p>
                    <pre>{integration.coach_instructions}</pre>
                    <button
                      onClick={() =>
                        void copy(
                          integration.coach_instructions,
                          "Firmware Coach instructions",
                        )
                      }
                    >
                      Copy agent instructions
                    </button>
                  </details>
                  <details>
                    <summary>Permissions</summary>
                    <p>
                      ForgePad grants the connected assistant access to public
                      questions, your working drafts, public test runs, and
                      session controls. Reconnect the ForgePad connector in
                      HeyClicky after an update to refresh its tools.
                    </p>
                    <div className="permission-grid">
                      {Object.entries(integration.permissions).map(
                        ([key, allowed]) => (
                          <div key={key}>
                            <span>{readable(key)}</span>
                            <span>
                              {allowed && integration.enabled
                                ? "Allowed"
                                : "Unavailable"}
                            </span>
                          </div>
                        ),
                      )}
                    </div>
                    <p>
                      For HeyClicky’s voice and app controls, check macOS
                      Privacy & Security → Microphone, Device Control and Data
                      Access (Accessibility), and Screen & System Audio
                      Recording. These are separate from the ForgePad connector.
                    </p>
                    <button
                      type="button"
                      onClick={() =>
                        void action(
                          () => post("/permissions/heyclicky/settings", {}),
                          "",
                        )
                      }
                    >
                      Open macOS permissions
                    </button>
                  </details>
                  <details>
                    <summary>Optional loopback HTTP transport</summary>
                    <p>
                      API-key authentication, stored in macOS Keychain. This is
                      separate from OAuth. Check that your installed HeyClicky
                      accepts a loopback URL.
                    </p>
                    <div className="button-row">
                      <button
                        disabled={busy || !integration.enabled}
                        onClick={() =>
                          void action(async () => {
                            const r = await post<{ api_key: string }>(
                              "/integrations/heyclicky/http",
                              {},
                            );
                            setApiKey(r.api_key);
                            await loadIntegration();
                          }, "Loopback MCP endpoint started.")
                        }
                      >
                        Enable local URL
                      </button>
                      {integration.local_mcp_url && (
                        <button
                          onClick={() =>
                            void copy(integration.local_mcp_url!, "MCP URL")
                          }
                        >
                          Copy URL
                        </button>
                      )}
                      {apiKey && (
                        <button onClick={() => void copy(apiKey, "API key")}>
                          Copy API key
                        </button>
                      )}
                    </div>
                  </details>
                  {logs !== null && (
                    <details open>
                      <summary>Integration log</summary>
                      <pre className="report">
                        {JSON.stringify(logs, null, 2)}
                      </pre>
                    </details>
                  )}
                </details>
              )}
              {section === "compiler" && (
                <section className="settings-section">
                  <h2>Storage</h2>
                  <p className="settings-description">
                    Question revisions and practice history are saved by your
                    workspace service.
                  </p>
                  <div className="setting-row">
                    <div>
                      <strong>Export workspace</strong>
                      <p>
                        Includes authored question packages, protected grading
                        material, source drafts, and recorded history. Retained
                        audio stays on this Mac.
                      </p>
                    </div>
                    <button
                      disabled={busy}
                      onClick={() =>
                        void action(
                          async () =>
                            download(
                              "forgepad-workspace.json",
                              await api("/data/export"),
                            ),
                          "Workspace export prepared.",
                        )
                      }
                    >
                      <Download size={15} />
                      Export JSON
                    </button>
                  </div>
                  <p>
                    Destructive practice resets remain in Progress, behind the
                    existing confirmation. Published question revisions are
                    preserved.
                  </p>
                </section>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
