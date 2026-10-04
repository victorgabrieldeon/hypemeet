import type { LocalParticipant } from "livekit-client";
import { useEffect, useRef } from "react";
import { pttBridge, type PttState } from "../lib/ptt";
import { MenuSection, MenuToggle } from "./menus";
import { playCue } from "./sounds";

/** Keeps the mic open a beat after the key comes up, so the last word isn't clipped. */
const RELEASE_DELAY_MS = 200;

/**
 * Desktop app: holding the push-to-talk key turns the mic on, letting go turns it back off. Only
 * when it was off: with the mic already open the key does nothing, and the mic button still works.
 */
export function usePushToTalk(local: LocalParticipant, ptt: PttState | null, onError: (err: unknown) => void) {
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;
  const active = !!ptt?.enabled && !!ptt.binding;

  useEffect(() => {
    if (!pttBridge || !active) return;
    const bridge = pttBridge;
    /** We turned the mic on, so the release turns it off. */
    let opened = false;
    let releaseTimer: ReturnType<typeof setTimeout> | undefined;
    // Quick taps would otherwise race an unfinished enable against the disable.
    let queue = Promise.resolve();
    const setMic = (on: boolean) => {
      queue = queue
        .then(() => local.setMicrophoneEnabled(on))
        .then(
          () => playCue(on ? "unmute" : "mute"),
          (err) => {
            if (on) opened = false;
            onErrorRef.current(err);
          },
        );
    };

    const unsubscribe = bridge.onPress((pressed) => {
      clearTimeout(releaseTimer);
      if (pressed) {
        if (opened || local.isMicrophoneEnabled) return;
        opened = true;
        setMic(true);
      } else if (opened) {
        releaseTimer = setTimeout(() => {
          opened = false;
          setMic(false);
        }, RELEASE_DELAY_MS);
      }
    });
    bridge.listen(true);
    return () => {
      bridge.listen(false);
      unsubscribe();
      clearTimeout(releaseTimer);
      if (opened) setMic(false);
    };
  }, [local, active]);
}

/** Mic menu section: turn push-to-talk on and pick its key. */
export function PushToTalkSection({ ptt }: { ptt: PttState }) {
  const capturing = ptt.capturing;

  // While picking, keys pressed in this window are the pick: they mustn't also press the focused
  // button or close the menu. They're forwarded too, for Wayland, where the hook doesn't see them.
  useEffect(() => {
    if (!capturing || !pttBridge) return;
    const bridge = pttBridge;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.type === "keydown" && !e.repeat) bridge.captureKey(e.code);
    };
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("keyup", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("keyup", onKey, true);
    };
  }, [capturing]);

  // Closing the menu mid-pick cancels it.
  useEffect(() => () => pttBridge?.capture(false), []);

  if (!pttBridge) return null;
  const bridge = pttBridge;

  return (
    <MenuSection title="Pressione para falar">
      <MenuToggle
        label="Segurar tecla para falar"
        hint="Funciona mesmo com o jogo em foco"
        checked={ptt.enabled}
        onChange={(on) => bridge.setEnabled(on)}
      />
      <div className="flex items-center gap-2 px-2.5 py-1.5">
        <span className="min-w-0 flex-1 text-sm" aria-live="polite">
          {capturing ? (
            <span className="text-ink">Aperte uma tecla ou botão do mouse… (Esc cancela)</span>
          ) : ptt.binding ? (
            <>
              <span className="text-soft">Tecla: </span>
              <kbd className="rounded-xs bg-surface-hi px-1.5 py-0.5 font-mono text-xs text-ink">{ptt.binding}</kbd>
            </>
          ) : (
            <span className="text-soft">Nenhuma tecla escolhida</span>
          )}
        </span>
        <button
          type="button"
          onClick={() => bridge.capture(!capturing)}
          className="type-link-sm h-8 shrink-0 rounded-sm bg-surface px-2.5 text-ink transition hover:bg-surface-hi"
        >
          {capturing ? "Cancelar" : ptt.binding ? "Trocar" : "Escolher"}
        </button>
      </div>
      {ptt.error && <p className="px-2.5 pb-1 text-xs text-danger">{ptt.error}</p>}
    </MenuSection>
  );
}
