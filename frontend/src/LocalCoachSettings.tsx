import { useEffect, useState } from "react";
import { api, message, post } from "./api";

type Model = {
  id: string;
  endpoint: string;
  model: string;
  memory_mb: number;
  context_tokens: number;
  output_tokens: number;
};
export default function LocalCoachSettings() {
  const [endpoint, setEndpoint] = useState("http://127.0.0.1:11434");
  const [selected, setSelected] = useState("");
  const [models, setModels] = useState<string[]>([]);
  const [saved, setSaved] = useState<Model[]>([]);
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  useEffect(() => {
    let live = true;
    void api<{ models: Model[] }>("/settings/models")
      .then(({ models: current }) => {
        if (!live) return;
        setSaved(current);
        if (current[0]) {
          setEndpoint(current[0].endpoint);
          setSelected(current[0].model);
          setModels([current[0].model]);
        }
        setReady(true);
      })
      .catch((e) => {
        if (live) setError(message(e));
      });
    return () => {
      live = false;
    };
  }, []);
  async function discover() {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const { models: found } = await post<{ models: string[] }>(
        "/settings/models/discover",
        { endpoint },
      );
      setModels(found);
      setSelected((value) =>
        found.includes(value) ? value : (found[0] ?? ""),
      );
      if (!found.length)
        setNotice(
          "No models found. Download a model in your local AI app, then check again.",
        );
    } catch (e) {
      setError(`Couldn’t find your local AI app. ${message(e)}`);
    } finally {
      setBusy(false);
    }
  }
  async function save(disconnect = false) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const existing = saved.find(
        (m) => m.endpoint === endpoint && m.model === selected,
      );
      const next = disconnect
        ? []
        : [
            {
              ...existing,
              id: existing?.id ?? "local-coach",
              endpoint,
              model: selected,
              memory_mb: existing?.memory_mb ?? 4096,
              context_tokens: existing?.context_tokens ?? 16384,
              output_tokens: existing?.output_tokens ?? 1024,
            },
          ];
      await api("/settings/models", {
        method: "PUT",
        body: JSON.stringify({ models: next }),
      });
      setSaved(next);
      setNotice(
        disconnect
          ? "Local coach turned off."
          : "Local model saved. Coaching uses OpenRouter while it is enabled above.",
      );
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="settings-section local-coach-settings">
      <div className="settings-title-row">
        <div>
          <h3>Local model (optional)</h3>
          <p className="settings-description">
            Used for coaching and interviews when OpenRouter replies are off.
            Transcript cleanup always uses your local model.
          </p>
        </div>
        <span className="badge">{saved.length ? "Enabled" : "Optional"}</span>
      </div>
      <label>
        Local AI app address
        <input
          type="url"
          value={endpoint}
          onChange={(e) => {
            setEndpoint(e.target.value);
            setModels([]);
            setSelected("");
          }}
          placeholder="http://127.0.0.1:11434"
        />
      </label>
      <p className="settings-description">
        Start Ollama, LM Studio, or another OpenAI-compatible local server, then
        find your installed models.
      </p>
      <button
        type="button"
        disabled={busy || !ready || !endpoint.trim()}
        onClick={() => void discover()}
      >
        {busy ? "Connecting…" : "Find my models"}
      </button>
      {models.length > 0 && (
        <label>
          Model
          <select
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
          >
            {models.map((id) => (
              <option key={id} value={id}>
                {id}
              </option>
            ))}
          </select>
        </label>
      )}
      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      <div className="button-row">
        <button
          className="primary"
          disabled={busy || !ready || !selected}
          onClick={() => void save()}
        >
          Save local model
        </button>
        {saved.length > 0 && (
          <button disabled={busy} onClick={() => void save(true)}>
            Turn off
          </button>
        )}
      </div>
    </section>
  );
}
