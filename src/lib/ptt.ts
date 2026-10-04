import { useEffect, useState } from "react";

// Mirror of PttState in desktop/ptt.js.
export interface PttState {
  enabled: boolean;
  /** Display name of the key or mouse button; null until one is picked. */
  binding: string | null;
  /** Waiting for the next key/button press to become the binding. */
  capturing: boolean;
  error: string | null;
}

interface DesktopPtt {
  state(): Promise<PttState | null>;
  setEnabled(on: boolean): void;
  capture(on: boolean): void;
  /** KeyboardEvent.code of a key pressed in the app's own window while capturing. */
  captureKey(code: string): void;
  /** On while a room is open: main runs the global hook and reports the key. */
  listen(on: boolean): void;
  subscribe(listener: (state: PttState) => void): () => void;
  onPress(listener: (pressed: boolean) => void): () => void;
}

/** Exposed by the desktop app's preload; absent in browsers and in builds older than push-to-talk. */
export const pttBridge = (window as Window & { desktopPtt?: DesktopPtt }).desktopPtt;

/** The desktop app's push-to-talk settings, live; null outside the app. */
export function usePttState(): PttState | null {
  const [state, setState] = useState<PttState | null>(null);
  useEffect(() => {
    if (!pttBridge) return;
    let active = true;
    const unsubscribe = pttBridge.subscribe(setState);
    pttBridge.state().then((initial) => {
      if (active && initial) setState((current) => current ?? initial);
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);
  return state;
}
