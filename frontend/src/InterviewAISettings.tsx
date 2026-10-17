import { useEffect, useState } from "react";
import { Check, Cpu, KeyRound, RefreshCw, Unplug } from "lucide-react";
import { api, message, post } from "./api";
type Router = { enabled: boolean; model: string; connected: boolean };
export function InterviewAISettings() {
  const [config, setConfig] = useState<Router>({
    enabled: false,
    model: "",
    connected: false,
  });
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  useEffect(() => {
    let live = true;
    void api<Router>("/settings/openrouter")
      .then((r) => {
        if (live) setConfig(r);
      })
      .catch((e) => {
        if (live) setError(message(e));
      });
    return () => {
      live = false;
    };
  }, []);
  async function save(disconnect = false) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      setConfig(
        await api<Router>(
          "/settings/openrouter",
          disconnect
            ? { method: "DELETE" }
            : {
                method: "PUT",
                body: JSON.stringify({ ...config, api_key: key }),
              },
        ),
      );
      setKey("");
      setNotice(disconnect ? "OpenRouter disconnected." : "AI settings saved.");
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="settings-section interview-ai-settings">
      <div className="settings-title-row">
        <div>
          <h3>Reasoning coach &amp; interviewer</h3>
          <p className="settings-description">
            Use the same OpenRouter key and model for practice coaching and
            interview replies.
          </p>
        </div>
        <span className="badge">
          {config.enabled && config.connected ? "Connected" : "Optional"}
        </span>
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <label className="setting-row">
          <span>
            <strong>AI replies</strong>
            <p>
              When you ask the coach, send your question, answer, code and
              recent coach messages to OpenRouter. Interviews send your
              transcript, problem statement and recent test results. Audio stays
              on this Mac.
            </p>
          </span>
          <input
            type="checkbox"
            role="switch"
            aria-label="Enable OpenRouter replies"
            checked={config.enabled}
            onChange={(e) =>
              setConfig({ ...config, enabled: e.target.checked })
            }
          />
        </label>
        <div className="two-columns">
          <label>
            <span>
              <KeyRound size={14} /> API key
            </span>
            <input
              type="password"
              autoComplete="off"
              spellCheck={false}
              placeholder={
                config.connected
                  ? "Saved in macOS Keychain"
                  : "Paste your OpenRouter key"
              }
              value={key}
              onChange={(e) => setKey(e.target.value)}
            />
          </label>
          <label>
            Model ID
            <input
              placeholder="provider/model"
              value={config.model}
              onChange={(e) => setConfig({ ...config, model: e.target.value })}
              spellCheck={false}
            />
          </label>
        </div>
        <p className="settings-description">
          Choose a model from{" "}
          <a
            href="https://openrouter.ai/models"
            target="_blank"
            rel="noreferrer"
          >
            OpenRouter’s catalog
          </a>
          . Usage is billed to your OpenRouter account.
        </p>
        {error && (
          <div className="error-banner" role="alert">
            {error}
          </div>
        )}
        {notice && (
          <p className="success" role="status">
            <Check size={14} />
            {notice}
          </p>
        )}
        <div className="button-row">
          <button className="primary" disabled={busy}>
            {busy ? "Saving…" : "Save AI settings"}
          </button>
          {config.connected && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void save(true)}
            >
              <Unplug size={14} />
              Disconnect
            </button>
          )}
        </div>
      </form>
    </section>
  );
}

export function SpeechModels({
  endpoint,
  selected,
  onSelect,
}: {
  endpoint: string;
  selected: string;
  onSelect: (model: string) => void;
}) {
  const [models, setModels] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [checked, setChecked] = useState(false);
  useEffect(() => {
    setModels([]);
    setChecked(false);
    setError("");
  }, [endpoint]);
  async function discover() {
    setBusy(true);
    setError("");
    setChecked(false);
    try {
      const result = await post<{ models: string[] }>(
        "/settings/speech/models",
        { endpoint },
      );
      setModels(result.models);
      setChecked(true);
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="speech-model-picker">
      <div className="settings-title-row">
        <div>
          <strong>Available speech models</strong>
          <p>
            Discover models from your local engine, including Parakeet Ultra
            when installed.
          </p>
        </div>
        <button
          type="button"
          disabled={!endpoint.trim() || busy}
          onClick={() => void discover()}
        >
          <RefreshCw size={14} className={busy ? "spinning" : ""} />
          {busy ? "Checking…" : "Find models"}
        </button>
      </div>
      {error && (
        <p role="alert" className="inline-error">
          Couldn’t connect. Check that your local speech engine is running.{" "}
          {error}
        </p>
      )}
      {checked && !models.length && (
        <p role="status">The engine has no installed models.</p>
      )}
      <div className="speech-model-list">
        {models.map((model) => (
          <button
            type="button"
            key={model}
            aria-pressed={selected === model}
            onClick={() => onSelect(model)}
          >
            <Cpu size={20} />
            <span>
              <strong>
                {/ultra/i.test(model)
                  ? "Parakeet Ultra"
                  : /parakeet.*v3/i.test(model)
                    ? "Parakeet V3"
                    : model}
              </strong>
              <small>{model}</small>
            </span>
            {selected === model && <Check size={18} />}
          </button>
        ))}
      </div>
      <details className="speech-help">
        <summary>Set up a local speech engine</summary>
        <p>
          Run a local OpenAI-compatible transcription server, enter its address
          above, then select Find models.{" "}
          <a
            href="https://github.com/FluidInference/FluidAudio"
            target="_blank"
            rel="noreferrer"
          >
            FluidAudio
          </a>{" "}
          supports Parakeet Ultra on Apple Silicon. Install and download models
          through your speech engine; ForgePad only lists models the engine
          reports.
        </p>
      </details>
    </div>
  );
}

type SpeechCatalog = {
  runtime_available: boolean;
  models: {
    id: string;
    name: string;
    description: string;
    installed: boolean;
    job_id?: string;
  }[];
};
export function BuiltinSpeechModels({
  selected,
  onSelect,
}: {
  selected: string;
  onSelect: (model: string) => void;
}) {
  const [catalog, setCatalog] = useState<SpeechCatalog | null>(null);
  const [job, setJob] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true;
    void api<SpeechCatalog>("/speech/catalog")
      .then((c) => {
        if (live) {
          setCatalog(c);
          setJob(c.models.find((m) => m.job_id)?.job_id ?? null);
        }
      })
      .catch((e) => {
        if (live) setError(message(e));
      });
    return () => {
      live = false;
    };
  }, []);
  useEffect(() => {
    if (!job) return;
    let live = true;
    const check = async () => {
      try {
        const result = await api<{ status: string; error?: string }>(
          `/jobs/${job}`,
        );
        if (!live || ["queued", "running"].includes(result.status)) return;
        setJob(null);
        if (result.status !== "complete")
          setError(result.error ?? "Download was cancelled. You can retry.");
        const c = await api<SpeechCatalog>("/speech/catalog");
        if (live) setCatalog(c);
      } catch (e) {
        if (live) {
          setJob(null);
          setError(message(e));
        }
      }
    };
    const timer = setInterval(() => void check(), 1500);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [job]);
  async function install(model: string) {
    setBusy(true);
    setError("");
    try {
      const next = await post<{ id: string }>("/speech/download", { model });
      setJob(next.id);
      setCatalog((c) =>
        c
          ? {
              ...c,
              models: c.models.map((m) =>
                m.id === model ? { ...m, job_id: next.id } : m,
              ),
            }
          : c,
      );
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="builtin-speech-models">
      <p className="settings-description">
        Download once, then transcribe on this Mac with Parakeet. Model files
        come from Fluid Inference on Hugging Face.
      </p>
      {catalog && !catalog.runtime_available && (
        <div className="notice">
          <strong>Speech helper needs to be built</strong>
          <p>
            Run <code>npm run speech:prepare</code> in the project, then reopen
            this page. Packaged apps include the helper.
          </p>
        </div>
      )}
      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
      {!catalog && !error && <p role="status">Checking speech models…</p>}
      <div className="builtin-model-list">
        {catalog?.models.map((model) => (
          <div
            className={`builtin-model-row ${selected === model.id ? "selected" : ""}`}
            key={model.id}
          >
            <span className="speech-model-icon">
              <Cpu size={22} />
            </span>
            <span className="speech-model-copy">
              <strong>{model.name}</strong>
              <small>{model.description}</small>
            </span>
            {model.installed ? (
              <button
                type="button"
                aria-pressed={selected === model.id}
                onClick={() => onSelect(model.id)}
              >
                {selected === model.id ? (
                  <>
                    <Check size={16} />
                    Selected
                  </>
                ) : (
                  "Use model"
                )}
              </button>
            ) : (
              <button
                type="button"
                disabled={busy || !!job || !catalog.runtime_available}
                onClick={() => void install(model.id)}
              >
                {job && model.job_id === job ? "Downloading…" : "Download"}
              </button>
            )}
          </div>
        ))}
      </div>
      {job && (
        <div className="download-status" role="status">
          <RefreshCw size={14} className="spinning" />
          <span>
            Downloading and preparing a speech model. This may take a few
            minutes.
          </span>
          <button
            type="button"
            onClick={() =>
              void api(`/jobs/${job}`, { method: "DELETE" }).catch((e) =>
                setError(message(e)),
              )
            }
          >
            Cancel
          </button>
        </div>
      )}
      <p className="small muted-text">
        Save speech settings below to apply your selection. Requires Apple
        Silicon and macOS 14 or later.
      </p>
    </div>
  );
}
