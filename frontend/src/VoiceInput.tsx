import { useEffect, useRef, useState } from "react";
import { Mic, Square } from "lucide-react";
import { api, message, post } from "./api";
import { native } from "./native";
import { startDictation } from "./dictation";

export default function VoiceInput({
  questionId,
  sessionId,
  disabled = false,
  onText,
  onBusyChange,
}: {
  questionId?: string;
  sessionId?: string;
  disabled?: boolean;
  onText: (text: string) => void;
  onBusyChange?: (busy: boolean) => void;
}) {
  const [status, setStatus] = useState<
    "idle" | "starting" | "listening" | "finishing"
  >("idle");
  const [partial, setPartial] = useState("");
  const [active, setActive] = useState(false);
  const [error, setError] = useState("");
  const [blocked, setBlocked] = useState(false);
  const controller = useRef<Awaited<ReturnType<typeof startDictation>> | null>(
    null,
  );
  const onTextRef = useRef(onText);
  const onBusyChangeRef = useRef(onBusyChange);
  const mounted = useRef(true);
  const starting = useRef(false);
  const owner = useRef(Symbol("dictation"));
  onTextRef.current = onText;
  onBusyChangeRef.current = onBusyChange;
  useEffect(() => {
    onBusyChangeRef.current?.(status !== "idle");
  }, [status]);
  useEffect(() => {
    mounted.current = true;
    const anotherCapture = (event: Event) => {
      if (
        (event as CustomEvent).detail !== owner.current &&
        controller.current
      ) {
        setStatus("finishing");
        controller.current.stop();
      }
    };
    window.addEventListener("forgepad:voice-start", anotherCapture);
    return () => {
      mounted.current = false;
      controller.current?.dispose();
      onBusyChangeRef.current?.(false);
      window.removeEventListener("forgepad:voice-start", anotherCapture);
    };
  }, []);
  useEffect(() => {
    if (disabled) controller.current?.stop();
  }, [disabled]);
  async function toggle() {
    if (controller.current) {
      setStatus("finishing");
      controller.current.stop();
      return;
    }
    if (starting.current) return;
    starting.current = true;
    setStatus("starting");
    setError("");
    setBlocked(false);
    try {
      if (native) {
        const config = await api<{ mode: string }>("/settings/audio");
        if (config.mode !== "interview")
          throw new Error(
            "Voice answers are off. In Settings → Interview & AI, choose Interview audio, then try again.",
          );
        const speech = await api<{ available: boolean; detail?: string }>(
          "/speech/status",
        );
        if (!speech.available)
          throw new Error(
            speech.detail ??
              "Download Parakeet Ultra in Settings → Interview & AI to use voice answers.",
          );
      } else {
        const health = await api<{
          speech: { available: boolean; detail?: string };
        }>("/health");
        if (!health.speech.available)
          throw new Error(
            health.speech.detail ??
              "Configure a local speech model before using dictation.",
          );
      }
      if (!mounted.current) return;
      const capture = await startDictation({
        questionId,
        sessionId,
        onPartial: (text) => {
          if (mounted.current) setPartial(text);
        },
        onActivity: (value) => {
          if (mounted.current) setActive(value);
        },
        onFinal: (text) => {
          if (mounted.current) onTextRef.current(text);
        },
        onError: (e) => {
          if (mounted.current) setError(message(e));
        },
        onStopped: () => {
          controller.current = null;
          if (mounted.current) setStatus("idle");
        },
      });
      if (!mounted.current) {
        capture.dispose();
        return;
      }
      controller.current = capture;
      window.dispatchEvent(
        new CustomEvent("forgepad:voice-start", { detail: owner.current }),
      );
      setStatus("listening");
    } catch (e) {
      if (mounted.current) {
        const permission =
          e instanceof DOMException &&
          ["NotAllowedError", "PermissionDeniedError"].includes(e.name);
        setBlocked(permission);
        setStatus("idle");
        setError(
          permission
            ? "Microphone access is blocked. Allow ForgePad in macOS System Settings → Privacy & Security → Microphone. In a browser, also allow the microphone for this site, then retry."
            : message(e),
        );
      }
    } finally {
      starting.current = false;
    }
  }
  return (
    <div className="voice-input">
      <div className="voice-controls">
        <button
          type="button"
          className={status === "listening" ? "recording-button" : "secondary"}
          disabled={disabled || status === "starting" || status === "finishing"}
          onClick={() => void toggle()}
          aria-pressed={status === "listening"}
        >
          {status === "listening" ? <Square size={14} /> : <Mic size={15} />}
          {status === "starting"
            ? "Opening microphone…"
            : status === "finishing"
              ? "Finishing transcript…"
              : status === "listening"
                ? "Stop dictation"
                : "Speak your answer"}
        </button>
        <span role="status">
          {status === "listening"
            ? active
              ? "Listening · voice detected"
              : "Listening · pause to finish a thought"
            : "Live text · processed locally"}
        </span>
      </div>
      {partial && (
        <p className="dictation-preview" aria-live="polite">
          {partial}
          <span> Still listening…</span>
        </p>
      )}
      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
      {blocked && native && (
        <button
          type="button"
          onClick={() =>
            void post("/permissions/microphone/settings", {}).catch((e) =>
              setError(message(e)),
            )
          }
        >
          Open microphone settings
        </button>
      )}
    </div>
  );
}
