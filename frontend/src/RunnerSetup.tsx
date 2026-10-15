import { useState } from "react";
import { Check, RefreshCw } from "lucide-react";
import { api, message, post } from "./api";

type Config = {
  image: string;
  docker_context: string;
  scratch_directory: string;
};
export default function RunnerSetup({
  config,
  onConfig,
}: {
  config: Config;
  onConfig: (value: Config) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  async function verify(setup: boolean) {
    setBusy(true);
    setError("");
    setStatus("");
    try {
      await api("/settings/runner", {
        method: "PUT",
        body: JSON.stringify(config),
      });
      const result = await post<{
        available?: boolean;
        status?: string;
        compiler_output?: string;
      }>(`/settings/runner/${setup ? "setup" : "verify"}`, {});
      if (!result.available && result.status !== "passed")
        throw new Error(
          result.compiler_output ||
            "Compiler check failed. Try repairing the runner.",
        );
      const saved = await api<{ config: Config }>("/settings/runner");
      onConfig(saved.config);
      setStatus("Runner ready — compile and execution verified.");
      window.dispatchEvent(new Event("forgepad:runner"));
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="settings-section" aria-label="Coding runner">
      <h2>Coding runner</h2>
      <p>
        ForgePad reconnects automatically when you run code. First-time setup
        needs Docker Desktop, or Docker and Colima.
      </p>
      <button
        className="primary"
        disabled={busy}
        onClick={() => void verify(true)}
      >
        <RefreshCw size={15} className={busy ? "spinning" : ""} />
        {busy ? "Preparing compiler…" : "Set up / repair runner"}
      </button>
      {busy && (
        <p role="status">
          Starting the compiler. The first download can take a few minutes.
        </p>
      )}
      {status && (
        <p role="status" className="success-text">
          <Check size={15} /> {status}
        </p>
      )}
      {error && (
        <p role="alert" className="error-banner">
          {error}
        </p>
      )}
      <details className="advanced-settings">
        <summary>Connection settings</summary>
        <label>
          Docker connection
          <input
            value={config.docker_context}
            onChange={(e) =>
              onConfig({ ...config, docker_context: e.target.value })
            }
            placeholder="Automatic"
          />
        </label>
        <label>
          Compiler image
          <input
            value={config.image}
            onChange={(e) => onConfig({ ...config, image: e.target.value })}
          />
        </label>
        <label>
          Shared temporary folder
          <input
            value={config.scratch_directory}
            onChange={(e) =>
              onConfig({ ...config, scratch_directory: e.target.value })
            }
            placeholder="Managed by ForgePad"
          />
        </label>
        <button disabled={busy} onClick={() => void verify(false)}>
          Save and check connection
        </button>
      </details>
    </section>
  );
}
