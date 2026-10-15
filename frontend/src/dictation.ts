import { api } from "./api";
import captureWorkletUrl from "./dictation.worklet.js?url&no-inline";

export function normalizeTranscript(text: string) {
  return text
    .trim()
    .replace(/\s+/g, " ")
    .replace(/\s+([,.;!?])/g, "$1");
}

export function wav(samples: Float32Array): Blob {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const string = (at: number, text: string) =>
    [...text].forEach((c, i) => view.setUint8(at + i, c.charCodeAt(0)));
  string(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  string(8, "WAVE");
  string(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, 16000, true);
  view.setUint32(28, 32000, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  string(36, "data");
  view.setUint32(40, samples.length * 2, true);
  samples.forEach((value, i) =>
    view.setInt16(
      44 + i * 2,
      Math.round(Math.max(-1, Math.min(1, value)) * 32767),
      true,
    ),
  );
  return new Blob([buffer], { type: "audio/wav" });
}

// Remove boundary repeats only for deliberately overlapping audio windows.
export function trimAudioOverlap(previous: string, next: string) {
  const old = previous.split(/\s+/),
    words = next.split(/\s+/);
  const key = (word: string) =>
    word.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
  for (let count = Math.min(8, old.length, words.length); count >= 2; count--) {
    if (
      old.slice(-count).map(key).join(" ") ===
      words.slice(0, count).map(key).join(" ")
    )
      return words.slice(count).join(" ");
  }
  return next;
}

type Callbacks = {
  questionId?: string;
  sessionId?: string;
  onPartial: (text: string) => void;
  onFinal: (text: string) => void;
  onActivity: (active: boolean) => void;
  onError: (error: unknown) => void;
  onStopped: () => void;
};

// One request in flight; previews are replaceable, completed utterances stay ordered.
// Each request is a complete WAV file, so there are no undecodable MediaRecorder fragments.
export async function startDictation(callbacks: Callbacks) {
  if (!navigator.mediaDevices?.getUserMedia || !window.AudioWorkletNode)
    throw new Error(
      "Live dictation is unavailable in this browser. Open ForgePad desktop or use a browser with microphone and AudioWorklet support.",
    );
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
  });
  let context: AudioContext;
  try {
    context = new AudioContext();
  } catch (error) {
    stream.getTracks().forEach((track) => track.stop());
    throw error;
  }
  let source: MediaStreamAudioSourceNode | undefined;
  let node: AudioWorkletNode | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let notified = false,
    overlapping = false,
    lastFinal = "";
  let stopped = false,
    disposed = false,
    inFlight = false;
  let frames: Float32Array[] = [],
    length = 0,
    voiced = 0,
    silence = 0,
    previewAt = 0,
    sequence = 0;
  const finals: {
    samples: Float32Array;
    sequence: number;
    overlapping: boolean;
  }[] = [];
  const snapshot = () => {
    const samples = new Float32Array(length);
    let at = 0;
    frames.forEach((frame) => {
      samples.set(frame, at);
      at += frame.length;
    });
    return samples;
  };
  const reset = () => {
    frames = [];
    length = 0;
    voiced = 0;
    silence = 0;
    previewAt = 0;
    sequence++;
  };
  const release = () => {
    stream.getTracks().forEach((track) => track.stop());
    source?.disconnect();
    node?.disconnect();
    if (node) node.port.onmessage = null;
    if (timer) clearTimeout(timer);
    void context.close();
  };
  const settle = () => {
    if (stopped && !inFlight && !finals.length && !disposed && !notified) {
      notified = true;
      callbacks.onPartial("");
      callbacks.onStopped();
    }
  };
  const pump = async (preview?: {
    samples: Float32Array;
    sequence: number;
  }) => {
    if (disposed || inFlight) return;
    const final = finals.shift();
    const item = final ?? preview;
    if (!item) {
      settle();
      return;
    }
    inFlight = true;
    try {
      const form = new FormData();
      form.append("file", wav(item.samples), "dictation.wav");
      if (callbacks.questionId)
        form.append("question_id", callbacks.questionId);
      if (callbacks.sessionId) form.append("session_id", callbacks.sessionId);
      form.append("partial", final ? "false" : "true");
      const result = await api<{ text: string }>("/speech/transcribe", {
        method: "POST",
        body: form,
      });
      if (!disposed) {
        const text = normalizeTranscript(result.text);
        if (final) {
          callbacks.onPartial("");
          if (text) {
            const fresh = final.overlapping
              ? trimAudioOverlap(lastFinal, text)
              : text;
            if (fresh) callbacks.onFinal(fresh);
            lastFinal = text;
          }
        } else if (item.sequence === sequence) callbacks.onPartial(text);
      }
    } catch (error) {
      if (!disposed) {
        callbacks.onError(error);
        stop(false);
        finals.length = 0;
      }
    } finally {
      inFlight = false;
      if (finals.length) void pump();
      else settle();
    }
  };
  const finish = (carry = false) => {
    const tail = carry ? snapshot().slice(-6400) : null;
    if (voiced >= 0.2) {
      if (finals.length >= 3) {
        callbacks.onError(
          new Error(
            "Transcription is falling behind. Stop and let the local engine catch up.",
          ),
        );
        stop(false);
        return;
      }
      finals.push({ samples: snapshot(), sequence, overlapping });
    }
    reset();
    overlapping = carry;
    if (tail) {
      frames = [tail];
      length = tail.length;
    }
    void pump();
  };
  function stop(flush = true) {
    if (stopped) return;
    stopped = true;
    release();
    callbacks.onActivity(false);
    if (flush) finish();
    settle();
  }
  try {
    await context.audioWorklet.addModule(captureWorkletUrl);
    source = context.createMediaStreamSource(stream);
    node = new AudioWorkletNode(context, "forgepad-dictation");
    node.port.onmessage = (event: MessageEvent<Float32Array>) => {
      if (stopped || disposed) return;
      const samples = event.data;
      const active =
        Math.sqrt(
          samples.reduce((sum, value) => sum + value * value, 0) /
            samples.length,
        ) > 0.012;
      callbacks.onActivity(active);
      const seconds = samples.length / 16000;
      if (active) {
        voiced += seconds;
        silence = 0;
      } else silence += seconds;
      if (!frames.length && !active) return;
      frames.push(samples);
      length += samples.length;
      if ((silence >= 0.7 && voiced >= 0.2) || length >= 16000 * 12)
        finish(length >= 16000 * 12);
      else if (
        voiced >= 0.4 &&
        length - previewAt >= 16000 * 2.5 &&
        !inFlight &&
        !finals.length
      ) {
        previewAt = length;
        void pump({ samples: snapshot(), sequence });
      }
    };
    source.connect(node);
    node.connect(context.destination);
    await context.resume();
    timer = setTimeout(() => stop(), 5 * 60 * 1000);
    stream.getTracks().forEach((track) => {
      track.onended = () => stop();
    });
    return {
      stop: () => stop(),
      dispose: () => {
        disposed = true;
        stop(false);
        finals.length = 0;
      },
    };
  } catch (error) {
    release();
    throw error;
  }
}
