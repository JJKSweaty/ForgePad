import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrent } from "@tauri-apps/plugin-deep-link";
export const native = isTauri();
export type NavigationTarget = {
  action: "app" | "roadmap" | "question" | "practice" | "interview" | "report";
  id: string;
};
export type NativeEvent = {
  type: string;
  data?: NavigationTarget & { path?: string; detail?: string };
  detail?: string;
  job_id?: string;
  text?: string;
};
export async function nativeRequest<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  let body: unknown =
    typeof init?.body === "string" ? JSON.parse(init.body) : null;
  if (init?.body instanceof FormData) {
    const file = init.body.get("audio") ?? init.body.get("file");
    if (!(file instanceof Blob)) throw new Error("Select an audio recording.");
    if (file.size > 8 * 1024 * 1024)
      throw new Error("Audio exceeds 8 MiB. Record a shorter explanation.");
    body = {
      audio: Array.from(new Uint8Array(await file.arrayBuffer())),
      mime_type: file.type.split(";")[0],
      question_id: init.body.get("question_id") ?? undefined,
      session_id: init.body.get("session_id") ?? undefined,
      partial: init.body.get("partial") === "true",
    };
  }
  return invoke<T>("api_request", {
    method: init?.method ?? "GET",
    path,
    body,
  });
}
export async function nativeEvents(
  callback: (event: NativeEvent) => void,
  initialLinks = false,
) {
  if (!native) return () => {};
  const dispose = await listen<NativeEvent>("forgepad-event", (event) =>
    callback(event.payload),
  );
  const links = initialLinks ? await getCurrent() : null;
  for (const link of links ?? []) {
    try {
      const target = await invoke<NavigationTarget>("validate_deep_link", {
        value: link,
      });
      callback({ type: "navigate", data: target });
    } catch {
      /* invalid external links are ignored */
    }
  }
  return dispose;
}
