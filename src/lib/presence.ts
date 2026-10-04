import { useEffect, useState } from "react";
import { api, type Presence } from "./api";

const POLL_MS = 15_000;

/** Who is in each of these rooms, refreshed while the page is visible. Failures keep the last answer. */
export function usePresence(codes: string[]): Presence {
  const [presence, setPresence] = useState<Presence>({});
  const key = codes.join(",");

  useEffect(() => {
    if (!key) return setPresence({});
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let inFlight = false;

    async function poll() {
      clearTimeout(timer);
      if (document.hidden || inFlight) return;
      inFlight = true;
      try {
        const next = await api.presence(key.split(","));
        if (!cancelled) setPresence(next);
      } catch {
        // Presence is a nicety: a LiveKit hiccup must not surface as an error on the home page.
      }
      inFlight = false;
      if (!cancelled) timer = setTimeout(poll, POLL_MS);
    }

    poll();
    document.addEventListener("visibilitychange", poll);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", poll);
    };
  }, [key]);

  return presence;
}
