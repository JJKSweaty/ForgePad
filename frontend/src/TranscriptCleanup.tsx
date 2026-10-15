import { useRef, useState, useEffect } from "react";
import { message, post } from "./api";

export default function TranscriptCleanup({
  text,
  questionId,
  onApply,
  disabled = false,
}: {
  text: string;
  questionId?: string;
  onApply: (text: string) => void;
  disabled?: boolean;
}) {
  const [suggestion, setSuggestion] = useState<{
    original: string;
    text: string;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);
  async function clean() {
    setBusy(true);
    setError("");
    setSuggestion(null);
    const original = text;
    try {
      const result = await post<{ text: string }>("/speech/correct", {
        text: original,
        question_id: questionId,
      });
      if (live.current) setSuggestion({ original, text: result.text });
    } catch (e) {
      if (live.current) setError(message(e));
    } finally {
      if (live.current) setBusy(false);
    }
  }
  return (
    <div className="transcript-cleanup">
      <button
        type="button"
        className="text-button"
        disabled={disabled || busy || !text.trim()}
        onClick={() => void clean()}
      >
        {busy ? "Checking wording locally…" : "Clean up transcript"}
      </button>
      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
      {suggestion && (
        <div className="cleanup-proposal">
          <strong>Suggested cleanup</strong>
          <p className="prose">{suggestion.text}</p>
          <small>
            Your original answer stays until you apply this suggestion.
          </small>
          <div className="button-row">
            <button
              type="button"
              disabled={disabled || suggestion.original !== text}
              onClick={() => {
                onApply(suggestion.text);
                setSuggestion(null);
              }}
            >
              Apply cleanup
            </button>
            <button type="button" onClick={() => setSuggestion(null)}>
              Keep original
            </button>
          </div>
          {suggestion.original !== text && (
            <p>Your answer changed. Run cleanup again for the latest text.</p>
          )}
        </div>
      )}
    </div>
  );
}
