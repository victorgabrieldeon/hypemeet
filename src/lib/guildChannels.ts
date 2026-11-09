import { useEffect, useState } from "react";
import { api, ApiError, type GuildChannels } from "./api";
import { reloadSession } from "./auth";

const POLL_MS = 15_000;

/**
 * A server's voice channels and who is in each call and room, refreshed while the page is visible (like presence.ts).
 * A failure only surfaces while there is no list yet; afterwards the last answer stays.
 */
export function useGuildChannels(guildId: string) {
  const [result, setResult] = useState<{ guildId: string; data: GuildChannels | null; error: string | null } | null>(
    null,
  );
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let inFlight = false;

    async function poll() {
      clearTimeout(timer);
      if (document.hidden || inFlight) return;
      inFlight = true;
      try {
        const data = await api.guildChannels(guildId);
        if (!cancelled) setResult({ guildId, data, error: null });
      } catch (err) {
        // Signed out elsewhere: the shell then drops the servers and offers the sign-in.
        if (err instanceof ApiError && err.status === 401) reloadSession();
        const error = (err as Error).message;
        if (!cancelled) setResult((r) => (r?.guildId === guildId && r.data ? r : { guildId, data: null, error }));
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
  }, [guildId, attempt]);

  // Another server's answer never shows under this one.
  const current = result?.guildId === guildId ? result : null;
  return {
    data: current?.data ?? null,
    error: current?.error ?? null,
    retry: () => {
      setResult(null);
      setAttempt((n) => n + 1);
    },
  };
}
