import { useEffect, useState } from "react";
import { api } from "./api";
import { native } from "./native";

/** Use the same profile timezone for the dashboard and attempt history. */
export function useLearningTimezone() {
  const [timezone, setTimezone] = useState(
    () =>
      localStorage.getItem("forgepad.v2.timezone") ??
      Intl.DateTimeFormat().resolvedOptions().timeZone,
  );
  useEffect(() => {
    if (!native) return;
    let live = true;
    void api<{ timezone: string | null }>("/settings/profile")
      .then((profile) => {
        if (live && profile.timezone) {
          localStorage.setItem("forgepad.v2.timezone", profile.timezone);
          setTimezone(profile.timezone);
        }
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);
  return timezone;
}
