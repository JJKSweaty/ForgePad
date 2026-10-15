import { useEffect } from "react";
import { post } from "./api";
import { native } from "./native";
export function usePracticeActivity(
  questionId: string | undefined,
  sessionId?: string,
  enabled = true,
) {
  useEffect(() => {
    if (!native || !questionId || !enabled) return;
    let visit: string | undefined,
      closed = false,
      interacted = false,
      chain = Promise.resolve();
    const windowId =
      sessionStorage.getItem("forgepad.v2.window") ?? crypto.randomUUID();
    sessionStorage.setItem("forgepad.v2.window", windowId);
    const input = () => {
      interacted = true;
    };
    const beat = (close = false) => {
      const active =
        document.visibilityState === "visible" && document.hasFocus();
      const changed = interacted;
      interacted = false;
      chain = chain
        .catch(() => {})
        .then(async () => {
          if (visit)
            await post("/activity/heartbeat", {
              visit_id: visit,
              focused: active,
              interacted: changed,
              close,
            });
        })
        .catch(() => {
          /* Recording outages do not interrupt the editor. */
        });
    };
    const visibility = () => beat();
    void post<{ id: string }>("/activity/start", {
      question_id: questionId,
      session_id: sessionId,
      window_id: windowId,
    })
      .then((v) => {
        visit = v.id;
        if (closed) beat(true);
      })
      .catch(() => {});
    window.addEventListener("keydown", input, { passive: true });
    window.addEventListener("pointerdown", input, { passive: true });
    window.addEventListener("wheel", input, { passive: true });
    window.addEventListener("blur", visibility);
    document.addEventListener("visibilitychange", visibility);
    const timer = setInterval(() => beat(), 15000);
    return () => {
      closed = true;
      clearInterval(timer);
      window.removeEventListener("keydown", input);
      window.removeEventListener("pointerdown", input);
      window.removeEventListener("wheel", input);
      window.removeEventListener("blur", visibility);
      document.removeEventListener("visibilitychange", visibility);
      beat(true);
    };
  }, [questionId, sessionId, enabled]);
}
