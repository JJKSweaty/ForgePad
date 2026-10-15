import { useEffect, useRef, useState } from "react";
import { api, message } from "./api";
import { native } from "./native";
type Recording = { id: string; mime_type: string; created_at: string };
export function RecordingReplay({ sessionId }: { sessionId: string }) {
  const [recordings, setRecordings] = useState<Recording[]>([]),
    [urls, setUrls] = useState<Record<string, string>>({}),
    [error, setError] = useState("");
  const resources = useRef<string[]>([]);
  useEffect(() => {
    let live = true;
    if (native)
      void api<Recording[]>(`/interviews/${sessionId}/recordings`)
        .then((r) => {
          if (live) setRecordings(r);
        })
        .catch((e) => {
          if (live) setError(message(e));
        });
    return () => {
      live = false;
      resources.current.forEach((u) => URL.revokeObjectURL(u));
      resources.current = [];
    };
  }, [sessionId]);
  async function load(id: string) {
    try {
      const r = await api<{ bytes: number[]; mime_type: string }>(
        `/interviews/${sessionId}/recordings/${id}`,
      );
      const url = URL.createObjectURL(
        new Blob([new Uint8Array(r.bytes)], { type: r.mime_type }),
      );
      resources.current.push(url);
      setUrls((old) => ({ ...old, [id]: url }));
    } catch (e) {
      setError(message(e));
    }
  }
  if (!native || !recordings.length) return null;
  return (
    <div className="modal-body">
      <h3>Local recordings</h3>
      <p>
        Recordings were retained by explicit choice. They are unavailable to the
        MCP connector.
      </p>
      {error && <p role="alert">{error}</p>}
      {recordings.map((r) => (
        <div key={r.id}>
          {urls[r.id] ? (
            <audio
              controls
              src={urls[r.id]}
              aria-label={`Explanation recorded ${new Date(r.created_at).toLocaleString()}`}
            />
          ) : (
            <button onClick={() => void load(r.id)}>
              Load recording · {new Date(r.created_at).toLocaleTimeString()}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
