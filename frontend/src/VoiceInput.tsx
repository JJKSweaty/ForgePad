import { useEffect, useId, useRef, useState } from "react";
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
  const [level, setLevel] = useState(0);
  const transcriptId = useId();
  const preview = useRef<HTMLElement>(null);
  const disabledRef = useRef(disabled);
  disabledRef.current = disabled;
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
    if (status === "listening")
      preview.current?.scrollIntoView({ block: "nearest" });
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
    setPartial("");
    setLevel(0);
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
      if (!mounted.current || disabledRef.current) {
        if (mounted.current) setStatus("idle");
        return;
      }
      const capture = await startDictation({
        questionId,
        sessionId,
        onPartial: (text) => {
          if (mounted.current) setPartial(text);
        },
        onLevel: (value) => {
          if (mounted.current) setLevel(value);
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
      if (!mounted.current || disabledRef.current) {
        capture.dispose();
        if (mounted.current) setStatus("idle");
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
    <div className={`voice-input voice-${status}`}>
      <div className="voice-controls">
        <button
          type="button"
          className={status === "listening" ? "recording-button" : "secondary"}
          disabled={disabled || status === "starting" || status === "finishing"}
          onClick={() => void toggle()}
          title="Dictation is processed locally. Review your transcript before submitting."
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
              : "Listening · speak naturally"
            : "Live text · processed locally"}
        </span>
      </div>
      {(status === "listening" || status === "finishing" || partial) && (
        <section
          ref={preview}
          className="dictation-preview"
          aria-labelledby={transcriptId}
        >
          <div className="dictation-preview-heading">
            <strong id={transcriptId}>Live transcript</strong>
            <meter
              min={0}
              max={1}
              value={level}
              aria-label="Microphone level"
            />
          </div>
          <p aria-live="polite" aria-atomic="true">
            {partial ||
              (status === "finishing"
                ? "Finishing your last words…"
                : "Your words will appear here as you speak…")}
          </p>
          <small>
            Live wording may change. Completed phrases are added to your answer;
            review before submitting.
          </small>
        </section>
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
