import { useCallback, useEffect, useState } from "react";
import { Copy, Link2, Shield, Unplug } from "lucide-react";
import { api, message, post, readable } from "./api";
import { native } from "./native";
import { DesktopFeature } from "./RoadmapsPage";
type Integration = {
  enabled: boolean;
  connector_status: string;
  executable_path: string | null;
  command: string | null;
  arguments: string[];
  local_mcp_url: string | null;
  setup_instructions: string;
  coach_instructions: string;
  privacy: string;
  last_successful_tool_call?: { tool: string; created_at: string };
  permissions: Record<string, boolean>;
};
export function SettingsPage() {
  const [integration, setIntegration] = useState<Integration | null>(null),
    [logs, setLogs] = useState<unknown>(null),
    [models, setModels] = useState("[]"),
    [diagnostics, setDiagnostics] = useState<unknown>(null),
    [audio, setAudio] = useState("external_assistant"),
    [speech, setSpeech] = useState({ endpoint: "", model: "parakeet" }),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [apiKey, setApiKey] = useState("");
  const [retainAudio, setRetainAudio] = useState(false);
  const [runner, setRunner] = useState({
    image: "forgepad-runner:local",
    docker_context: "",
  });
  useEffect(() => {
    if (native)
      void api<{ config: typeof runner }>("/settings/runner")
        .then((r) => setRunner(r.config))
        .catch((e) => setError(message(e)));
  }, []);
  const load = useCallback(async () => {
    const [i, m, a, s] = await Promise.all([
      api<Integration>("/integrations/heyclicky"),
      api<{ models: unknown; diagnostics: unknown }>("/settings/models"),
      api<{ mode: string; record_audio: boolean }>("/settings/audio"),
      api<{ endpoint: string; model: string }>("/settings/speech"),
    ]);
    setIntegration(i);
    setModels(JSON.stringify(m.models, null, 2));
    setDiagnostics(m.diagnostics);
    setAudio(a.mode);
    setRetainAudio(a.record_audio);
    setSpeech({ endpoint: s.endpoint, model: s.model });
  }, []);
  useEffect(() => {
    if (native) void load().catch((e) => setError(message(e)));
  }, [load]);
  if (!native) return <DesktopFeature />;
  async function action(fn: () => Promise<unknown>, success: string) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await fn();
      setNotice(success);
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  async function copy(value: string, label: string) {
    await action(
      () => navigator.clipboard.writeText(value),
      `${label} copied.`,
    );
  }
  return (
    <div className="page">
      <div className="page-heading">
        <div>
          <div className="eyebrow">LOCAL WORKSPACE</div>
          <h1>Settings</h1>
          <p>
            Integrations, inference, and explicit control over interview audio.
          </p>
        </div>
      </div>
      {error && (
        <div className="error-banner" role="alert">
          {error}
        </div>
      )}
      {notice && (
        <div className="notice" role="status">
          {notice}
        </div>
      )}
      <section className="panel settings-panel">
        <div className="section-header">
          <div>
            <div className="eyebrow">INTEGRATIONS</div>
            <h2>
              <Link2 size={18} />
              HeyClicky
            </h2>
            <p>Preferred transport: Command on this Mac · MCP over stdio</p>
          </div>
          <span className={`badge ${integration?.enabled ? "success" : ""}`}>
            {readable(integration?.connector_status ?? "loading")}
          </span>
        </div>
        {integration && (
          <div className="setup-form">
            <div className="notice">
              <Shield size={17} />
              <p>{integration.privacy}</p>
            </div>
            <dl className="integration-details">
              <dt>Local executable</dt>
              <dd>
                <code>
                  {integration.executable_path ??
                    "Connector executable is missing. Run the native preparation build."}
                </code>
              </dd>
              <dt>Command and arguments</dt>
              <dd>
                <code>
                  {integration.command ??
                    "Available after the connector has been built."}
                </code>
              </dd>
              <dt>Authentication</dt>
              <dd>
                Private Unix socket for stdio. Keychain API key for optional
                loopback HTTP.
              </dd>
              <dt>Local MCP URL</dt>
              <dd>{integration.local_mcp_url ?? "Disabled"}</dd>
              <dt>Last confirmed tool call</dt>
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
                      await post("/integrations/heyclicky/disconnect", {});
                      setApiKey("");
                      await load();
                    }, "Access revoked. Reconnect from HeyClicky after enabling again.")
                  }
                >
                  <Unplug size={15} />
                  Disconnect / revoke access
                </button>
              ) : (
                <button
                  className="primary"
                  disabled={busy || !integration.executable_path}
                  onClick={() =>
                    void action(async () => {
                      await post("/integrations/heyclicky/connect", {});
                      await load();
                    }, "Local integration enabled. Add the generated command in HeyClicky.")
                  }
                >
                  <Link2 size={15} />
                  Enable HeyClicky integration
                </button>
              )}
              <button
                disabled={!integration.command}
                onClick={() =>
                  void copy(
                    `${integration.setup_instructions}\n\nCommand:\n${integration.command}`,
                    "HeyClicky configuration",
                  )
                }
              >
                <Copy size={14} />
                Copy HeyClicky configuration
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
                  }, "Service self-check passed. Verify tool discovery in HeyClicky.")
                }
              >
                Test service connection
              </button>
              <button
                onClick={() =>
                  void action(async () => {
                    setLogs(await api("/integrations/heyclicky/logs"));
                    setIntegration(
                      await api<Integration>("/integrations/heyclicky"),
                    );
                  }, "Integration log refreshed.")
                }
              >
                View integration logs
              </button>
            </div>
            <details>
              <summary>Setup instructions and Firmware Coach</summary>
              <p>{integration.setup_instructions}</p>
              <p>
                Use the installed app’s fields; a service self-check does not
                establish HeyClicky compatibility.
              </p>
              <pre className="report">{integration.coach_instructions}</pre>
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
              <summary>Connector permissions</summary>
              <div className="permission-grid">
                {Object.entries(integration.permissions).map(([k, v]) => (
                  <div key={k}>
                    <span>{readable(k)}</span>
                    <span className="badge">{v ? "Allowed" : "Denied"}</span>
                  </div>
                ))}
              </div>
            </details>
            <details>
              <summary>Optional loopback Streamable HTTP</summary>
              <p>
                The endpoint starts only when enabled. Test loopback URL support
                in your installed HeyClicky version. This uses an API key, not
                browser OAuth.
              </p>
              <button
                disabled={busy || !integration.enabled}
                onClick={() =>
                  void action(async () => {
                    const r = await post<{ api_key: string }>(
                      "/integrations/heyclicky/http",
                      {},
                    );
                    setApiKey(r.api_key);
                    setIntegration(
                      await api<Integration>("/integrations/heyclicky"),
                    );
                  }, "Loopback endpoint started. Copy its URL and API key into the connector.")
                }
              >
                Enable local MCP URL
              </button>
              {integration.local_mcp_url && (
                <button
                  onClick={() =>
                    void copy(integration.local_mcp_url!, "Local MCP URL")
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
            </details>
            {!!logs && (
              <pre className="report">{JSON.stringify(logs, null, 2)}</pre>
            )}
          </div>
        )}
      </section>
      <section className="panel settings-panel">
        <div className="section-header">
          <div>
            <h2>Isolated C/C++ runner</h2>
            <p>
              Compilation and execution use a Linux Docker VM. The host never
              executes candidate binaries.
            </p>
          </div>
        </div>
        <div className="setup-form">
          <div className="two-columns">
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
                placeholder="Use Docker's active context"
                onChange={(e) =>
                  setRunner({ ...runner, docker_context: e.target.value })
                }
              />
            </label>
          </div>
          <p className="small muted-text">
            Select an existing Docker context if the desktop default differs
            from your terminal. For the dedicated ForgePad Colima profile, use
            its context name. ForgePad does not change Docker's global context.
          </p>
          <button
            disabled={busy}
            onClick={() =>
              void action(async () => {
                await api("/settings/runner", {
                  method: "PUT",
                  body: JSON.stringify(runner),
                });
                const h = await api<{
                  runner: { available: boolean; detail: string };
                }>("/health");
                if (!h.runner.available) throw new Error(h.runner.detail);
              }, "Sandbox runner verified. Refresh the workspace status.")
            }
          >
            Save and test runner
          </button>
        </div>
      </section>
      <div className="progress-grid">
        <section className="panel settings-panel">
          <div className="section-header">
            <div>
              <h2>Local model manager</h2>
              <p>llama.cpp compatible endpoints · one active inference lane</p>
            </div>
          </div>
          <div className="setup-form">
            <p className="small muted-text">
              Models stay in persistent local runtimes. ForgePad checks the
              configured memory estimate, bounds context, streams responses, and
              prioritizes interviews. An empty list disables AI.
            </p>
            <details>
              <summary>Configuration example (not active)</summary>
              <pre>
                {JSON.stringify(
                  [
                    {
                      id: "local-small",
                      endpoint: "http://127.0.0.1:8080",
                      model: "your-loaded-model",
                      memory_mb: 4096,
                      context_tokens: 16384,
                      output_tokens: 4096,
                    },
                  ],
                  null,
                  2,
                )}
              </pre>
              <p>
                Use your actual server/model and measured peak memory. Run
                llama-server with Metal acceleration on Apple Silicon.
              </p>
            </details>
            <label>
              Provider fallback order
              <textarea
                className="code-input"
                rows={10}
                value={models}
                onChange={(e) => setModels(e.target.value)}
              />
            </label>
            <div className="button-row">
              <button
                disabled={busy}
                onClick={() =>
                  void action(async () => {
                    await api("/settings/models", {
                      method: "PUT",
                      body: JSON.stringify({ models: JSON.parse(models) }),
                    });
                  }, "Local model configuration saved.")
                }
              >
                Save model configuration
              </button>
              <button
                disabled={busy}
                onClick={() =>
                  void action(async () => {
                    const job = await post<{ id: string }>(
                      "/models/benchmark",
                      {},
                    );
                    setNotice(
                      `Benchmark queued: ${job.id}. Inspect its results in Question studio jobs.`,
                    );
                  }, "Benchmark queued.")
                }
              >
                Benchmark configured models
              </button>
              <button
                onClick={() =>
                  void action(async () => {
                    const m = await api<{ diagnostics: unknown }>(
                      "/settings/models",
                    );
                    setDiagnostics(m.diagnostics);
                  }, "Diagnostics refreshed.")
                }
              >
                Refresh diagnostics
              </button>
            </div>
            {!!diagnostics && (
              <details>
                <summary>Inference diagnostics</summary>
                <pre className="report">
                  {JSON.stringify(diagnostics, null, 2)}
                </pre>
              </details>
            )}
          </div>
        </section>
        <section className="panel settings-panel">
          <div className="section-header">
            <div>
              <h2>Audio ownership</h2>
              <p>No global ForgePad wake-word listener</p>
            </div>
          </div>
          <div className="setup-form">
            <label>
              Audio mode
              <select
                value={audio}
                onChange={(e) => {
                  const mode = e.target.value;
                  void action(async () => {
                    await api("/settings/audio", {
                      method: "PUT",
                      body: JSON.stringify({ mode, record_audio: retainAudio }),
                    });
                    setAudio(mode);
                  }, "Audio mode updated.");
                }}
              >
                <option value="external_assistant">
                  External Assistant · HeyClicky commands
                </option>
                <option value="interview">
                  Interview · ForgePad transcription
                </option>
                <option value="silent">Silent · no ForgePad capture</option>
                <option value="text_practice">
                  Text Practice · voice not required
                </option>
              </select>
            </label>
            <label className="approval-check">
              <input
                type="checkbox"
                checked={retainAudio}
                onChange={(e) => {
                  const enabled = e.target.checked;
                  void action(
                    async () => {
                      await api("/settings/audio", {
                        method: "PUT",
                        body: JSON.stringify({
                          mode: audio,
                          record_audio: enabled,
                        }),
                      });
                      setRetainAudio(enabled);
                    },
                    enabled
                      ? "Compressed recordings will be kept locally for replay."
                      : "Audio will be discarded after transcription.",
                  );
                }}
              />
              Keep compressed interview recordings on this Mac for replay
            </label>

            <div className="notice">
              <p>
                {audio === "interview"
                  ? "ForgePad captures only after you press Microphone during an active interview. Pause HeyClicky capture yourself if needed; the apps do not share audio streams."
                  : "ForgePad does not capture audio in this mode. HeyClicky manages its own microphone independently."}
              </p>
            </div>
            <label>
              Local speech endpoint
              <input
                type="url"
                value={speech.endpoint}
                onChange={(e) =>
                  setSpeech({ ...speech, endpoint: e.target.value })
                }
                placeholder="Local runtime URL (optional)"
              />
            </label>
            <label>
              Speech model
              <input
                value={speech.model}
                onChange={(e) =>
                  setSpeech({ ...speech, model: e.target.value })
                }
              />
            </label>
            <p className="small muted-text">
              Use a Parakeet-compatible local runtime exposing
              /v1/audio/transcriptions. Model availability and streaming depend
              on the runtime. Recordings are discarded after transcription
              unless local retention is enabled. Retained audio is excluded from
              JSON exports.
            </p>
            <button
              disabled={busy}
              onClick={() =>
                void action(
                  () =>
                    api("/settings/speech", {
                      method: "PUT",
                      body: JSON.stringify(speech),
                    }),
                  "Local speech configuration saved.",
                )
              }
            >
              Save speech configuration
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}
