import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import VoiceInput from "./VoiceInput";
import type { startDictation as Capture } from "./dictation";

const { api, startDictation, stop, dispose } = vi.hoisted(() => ({
  api: vi.fn(),
  startDictation: vi.fn(),
  stop: vi.fn(),
  dispose: vi.fn(),
}));
vi.mock("./api", () => ({
  api,
  message: (error: Error) => error.message,
  post: vi.fn(),
}));
vi.mock("./native", () => ({ native: false }));
vi.mock("./dictation", () => ({ startDictation }));
let callbacks: Parameters<typeof Capture>[0];
beforeEach(() => {
  vi.clearAllMocks();
  api.mockResolvedValue({ speech: { available: true } });
  startDictation.mockImplementation(async (next) => {
    callbacks = next;
    return { stop, dispose };
  });
});
afterEach(cleanup);

it("shows live words before finalizing, exposes mic level, and keeps submission explicit", async () => {
  const onText = vi.fn(),
    onBusyChange = vi.fn();
  render(
    <VoiceInput
      questionId="sensor-pipeline"
      onText={onText}
      onBusyChange={onBusyChange}
    />,
  );
  await userEvent.click(
    screen.getByRole("button", { name: "Speak your answer" }),
  );
  await screen.findByRole("button", { name: "Stop dictation" });
  expect(screen.getByRole("region", { name: "Live transcript" })).toBeTruthy();
  act(() => {
    callbacks.onPartial("Use a ring");
    callbacks.onLevel?.(0.5);
  });
  expect(screen.getByText("Use a ring")).toBeTruthy();
  expect(
    screen
      .getByRole("meter", { name: "Microphone level" })
      .getAttribute("value"),
  ).toBe("0.5");
  expect(onText).not.toHaveBeenCalled();
  act(() => callbacks.onPartial("Use a ring buffer."));
  expect(screen.queryByText("Use a ring")).toBeNull();
  expect(screen.getByText("Use a ring buffer.")).toBeTruthy();
  await userEvent.click(screen.getByRole("button", { name: "Stop dictation" }));
  expect(stop).toHaveBeenCalledOnce();
  expect(onBusyChange).toHaveBeenLastCalledWith(true);
  act(() => {
    callbacks.onPartial("");
    callbacks.onFinal("Use a ring buffer.");
    callbacks.onStopped();
  });
  expect(onText).toHaveBeenCalledExactlyOnceWith("Use a ring buffer.");
  expect(onBusyChange).toHaveBeenLastCalledWith(false);
  expect(screen.queryByRole("region", { name: "Live transcript" })).toBeNull();
});

it("stops capturing when navigating away", async () => {
  const { unmount } = render(<VoiceInput onText={vi.fn()} />);
  await userEvent.click(
    screen.getByRole("button", { name: "Speak your answer" }),
  );
  await screen.findByRole("button", { name: "Stop dictation" });
  unmount();
  expect(dispose).toHaveBeenCalledOnce();
});

it("explains a blocked microphone without starting a capture", async () => {
  startDictation.mockRejectedValueOnce(
    new DOMException("Blocked", "NotAllowedError"),
  );
  render(<VoiceInput onText={vi.fn()} />);
  await userEvent.click(
    screen.getByRole("button", { name: "Speak your answer" }),
  );
  expect((await screen.findByRole("alert")).textContent).toContain(
    "Microphone access is blocked",
  );
  expect(screen.queryByRole("region", { name: "Live transcript" })).toBeNull();
});
