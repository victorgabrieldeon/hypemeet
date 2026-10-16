import { useEffect, useState, type RefObject } from "react";

/** For the element while it fills the page (see useFullscreen). */
export const FILL_CLASS = "fixed! inset-0 z-70 rounded-none! border-0!";

/**
 * "Tela cheia" for a tile or the watch player. Uses the browser's fullscreen where the page may;
 * where it can't (the Discord Activity's iframe doesn't allow it) the element fills the page instead,
 * which with Discord's own full-screen view of the Activity covers the whole screen. Esc leaves either.
 */
export function useFullscreen(ref: RefObject<HTMLElement | null>) {
  const [native, setNative] = useState(false);
  const [filling, setFilling] = useState(false);

  useEffect(() => {
    const onChange = () => setNative(!!ref.current && document.fullscreenElement === ref.current);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, [ref]);

  useEffect(() => {
    if (!filling) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setFilling(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [filling]);

  const toggle = () => {
    if (filling) return setFilling(false);
    if (document.fullscreenElement) return void document.exitFullscreen();
    const el = ref.current;
    if (!el || !document.fullscreenEnabled) return setFilling(true);
    el.requestFullscreen().catch(() => setFilling(true));
  };

  return { active: native || filling, filling, toggle };
}
