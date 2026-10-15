import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  startDictation,
  normalizeTranscript,
  trimAudioOverlap,
  wav,
} from "./dictation";
const { api } = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock("./api", () => ({ api }));
let node: {
  port: { onmessage: ((event: { data: Float32Array }) => void) | null };
  connect: () => void;
  disconnect: () => void;
};
const stopTrack = vi.fn();
beforeEach(() => {
  stopTrack.mockClear();
  api.mockReset();
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: {
      getUserMedia: vi
        .fn()
        .mockResolvedValue({ getTracks: () => [{ stop: stopTrack }] }),
    },
  });
  vi.stubGlobal(
    "AudioContext",
    class {
      audioWorklet = { addModule: async () => {} };
      destination = {};
      createMediaStreamSource() {
        return { connect() {}, disconnect() {} };
      }
      resume = async () => {};
      close = async () => {};
    },
  );
  vi.stubGlobal(
    "AudioWorkletNode",
    class {
      port = { onmessage: null };
      connect() {}
      disconnect() {}
      constructor() {
        node = this;
      }
    },
  );
});
afterEach(() => {
  vi.clearAllMocks();
});
function feed(count: number, value = 0.1) {
  for (let i = 0; i < count; i++)
    node.port.onmessage?.({ data: new Float32Array(1600).fill(value) });
}
function callbacks() {
  return {
    questionId: "sensor-pipeline",
    onFinal: vi.fn(),
    onPartial: vi.fn(),
    onActivity: vi.fn(),
    onError: vi.fn(),
    onStopped: vi.fn(),
  };
}
it("replaces a stale preview and commits each completed phrase once, in order", async () => {
  let resolvePreview!: (result: { text: string }) => void;
  api
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolvePreview = resolve;
        }),
    )
    .mockResolvedValueOnce({ text: "Use a bounded queue." })
    .mockResolvedValueOnce({ text: "Then test overflow." });
  const events = callbacks();
  const capture = await startDictation(events);
  feed(25);
  expect(api).toHaveBeenCalledTimes(1);
  feed(8, 0); // Completes first phrase while its preview is pending.
  feed(6);
  feed(8, 0); // A second phrase queues behind it.
  resolvePreview({ text: "Use a bound" });
  await vi.waitFor(() => expect(events.onFinal).toHaveBeenCalledTimes(2));
  expect(events.onPartial).not.toHaveBeenCalledWith("Use a bound");
  expect(events.onFinal.mock.calls.map(([text]) => text)).toEqual([
    "Use a bounded queue.",
    "Then test overflow.",
  ]);
  capture.stop();
  expect(stopTrack).toHaveBeenCalledOnce();
  expect(events.onStopped).toHaveBeenCalledOnce();
});
it("releases capture on dispose and ignores an in-flight result after navigation", async () => {
  let resolve!: (result: { text: string }) => void;
  api.mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const events = callbacks();
  const capture = await startDictation(events);
  feed(25);
  capture.dispose();
  resolve({ text: "Do not insert this" });
  await new Promise((done) => setTimeout(done, 0));
  expect(stopTrack).toHaveBeenCalledOnce();
  expect(events.onFinal).not.toHaveBeenCalled();
  expect(events.onPartial).not.toHaveBeenCalled();
});
it("sends complete bounded WAV audio and preserves technical numbers and negation", async () => {
  const blob = wav(new Float32Array([0, 0.5, -0.5]));
  expect(blob.type).toBe("audio/wav");
  expect(blob.size).toBe(50);
  expect(normalizeTranscript("  Do not use  32 bytes , use 64.  ")).toBe(
    "Do not use 32 bytes, use 64.",
  );
  expect(
    trimAudioOverlap("Use a bounded queue", "bounded queue for samples."),
  ).toBe("for samples.");
  expect(trimAudioOverlap("Do not", "not use 64 bytes")).toBe(
    "not use 64 bytes",
  );
});
