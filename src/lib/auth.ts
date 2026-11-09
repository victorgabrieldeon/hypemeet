import { useSyncExternalStore } from "react";
import { api, type Session } from "./api";

// The Discord session on this site (an HttpOnly cookie the page can't read): asked once per page load (and again
// after a 401), shared by every component through a tiny external store.

const RETRY_MS = 5_000;

const listeners = new Set<() => void>();
let current: Session | null = null;
let loading: Promise<void> | null = null;
let retry: ReturnType<typeof setTimeout> | undefined;

function set(session: Session) {
  current = session;
  listeners.forEach((l) => l());
}

/** Asks the server again, e.g. after a 401 showed the session is gone. A failure keeps what we know and retries. */
export function reloadSession() {
  clearTimeout(retry);
  // A network hiccup or a 500 isn't "no Discord login here".
  loading = api.session().then(set, () => void (retry = setTimeout(reloadSession, RETRY_MS)));
}

function load() {
  if (!loading) reloadSession();
}

function subscribe(listener: () => void) {
  load();
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Null while the first answer is on its way. */
export function useSession(): Session | null {
  return useSyncExternalStore(subscribe, () => current);
}

/** Goes to Discord's consent screen and comes back here (full page navigation). */
export function signIn(next = location.pathname + location.search) {
  location.href = api.loginUrl(next);
}

export async function signOut() {
  try {
    await api.logout();
    set({ user: null, login: current?.login ?? false });
  } catch {
    // The cookie may still be good: show what the server says, not a sign-out that didn't happen.
    reloadSession();
  }
}
