import { useEffect, useState } from "react";

// Mirror of UpdateState in desktop/updater.js.
export type UpdateState = { current: string; mode: "auto" | "manual" | null } & (
  | { status: "idle" | "checking" | "latest" }
  | { status: "available"; version: string }
  | { status: "downloading"; version: string; percent: number }
  | { status: "ready"; version: string }
  | { status: "error"; message: string }
);

interface DesktopUpdates {
  state(): Promise<UpdateState | null>;
  check(): Promise<void>;
  apply(): void;
  subscribe(listener: (state: UpdateState) => void): () => void;
}

/** Exposed by the desktop app's preload; absent in browsers and in builds older than the updater. */
const bridge = (window as Window & { desktopUpdates?: DesktopUpdates }).desktopUpdates;

/** The desktop app's update state, live; null outside the app. */
export function useAppUpdate(): { state: UpdateState | null; apply: () => void } {
  const [state, setState] = useState<UpdateState | null>(null);
  useEffect(() => {
    if (!bridge) return;
    let active = true;
    const unsubscribe = bridge.subscribe(setState);
    bridge.state().then((initial) => {
      if (active && initial) setState((current) => current ?? initial);
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);
  return { state, apply: () => bridge?.apply() };
}
