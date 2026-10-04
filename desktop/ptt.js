// Push-to-talk: a key (or mouse button) that opens the mic while held, even with a game in focus.
// Electron's globalShortcut can't do it: it only reports presses, never releases, and it swallows
// the key from the focused app. uiohook watches the raw input stream instead and leaves it alone.
// Linux: X11 only (XRecord); on Wayland it sees keys going to X11/XWayland windows, which covers
// most games but not native Wayland apps.

const IS_MAC = process.platform === "darwin";
const ESCAPE = 0x0001;

/** Display names for keys whose uiohook name isn't clear enough; the rest show as uiohook names them. */
const KEY_LABELS = {
  Space: "Espaço",
  Ctrl: "Ctrl esquerdo",
  CtrlRight: "Ctrl direito",
  Alt: IS_MAC ? "Option esquerdo" : "Alt esquerdo",
  AltRight: IS_MAC ? "Option direito" : "Alt direito",
  Shift: "Shift esquerdo",
  ShiftRight: "Shift direito",
  Meta: IS_MAC ? "Cmd esquerdo" : "Super esquerdo",
  MetaRight: IS_MAC ? "Cmd direito" : "Super direito",
  ArrowUp: "Seta ↑",
  ArrowDown: "Seta ↓",
  ArrowLeft: "Seta ←",
  ArrowRight: "Seta →",
};

/**
 * @typedef {{ key: number, label: string } | { mouse: number, label: string }} Binding
 * Mirror of PttState in src/lib/ptt.ts.
 * @typedef {{ enabled: boolean, binding: string | null, capturing: boolean, error: string | null }} PttState
 */

/** @type {typeof import("uiohook-napi") | null} */
let lib = null;
let wired = false;
/** Loaded on first use: a missing system library (libXt on Linux) must not take the app down. */
function load() {
  lib ??= require("uiohook-napi");
  return lib;
}

function describeError(error) {
  const code = error?.code ?? "";
  if (code === "UIOHOOK_ERROR_AXAPI_DISABLED") {
    return "Libere o HypeMeet em Ajustes do Sistema → Privacidade e Segurança → Acessibilidade e tente de novo.";
  }
  if (code.startsWith("UIOHOOK_ERROR_X_")) {
    return "O atalho global precisa do X11 (XWayland serve); este sistema não o oferece.";
  }
  return `Não deu pra ativar o atalho global: ${error?.message ?? error}`;
}

function keyLabel(keycode) {
  const name = Object.entries(load().UiohookKey).find(([, code]) => code === keycode)?.[0];
  return name ? (KEY_LABELS[name] ?? name) : `Tecla ${keycode}`;
}

const mouseLabel = (button) => (button === 3 ? "Botão do meio do mouse" : `Botão ${button} do mouse`);

/** KeyboardEvent.code → uiohook keycode: the names line up once the DOM's prefixes are dropped. */
function keyFromDomCode(code) {
  const name = code
    .replace(/^(Key|Digit)/, "")
    .replace(/^Control/, "Ctrl")
    .replace(/^(Ctrl|Alt|Shift|Meta)Left$/, "$1");
  return load().UiohookKey[name];
}

function validBinding(raw) {
  if (typeof raw?.label !== "string") return null;
  if (Number.isInteger(raw.key)) return { key: raw.key, label: raw.label };
  if (Number.isInteger(raw.mouse)) return { mouse: raw.mouse, label: raw.label };
  return null;
}

const sameInput = (a, b) => !!a && !!b && (a.key !== undefined ? a.key === b.key : a.mouse === b.mouse);

/**
 * The hook only runs while a room listens (with push-to-talk on) or a new key is being picked, so
 * the app isn't watching every keystroke the rest of the time.
 */
function createPushToTalk({ readConfig, writeConfig, broadcast, onPress }) {
  const saved = readConfig().pushToTalk;
  let enabled = saved?.enabled === true;
  /** @type {Binding | null} */
  let binding = validBinding(saved?.binding);
  let listening = false;
  let capturing = false;
  let running = false;
  let pressed = false;
  /** @type {string | null} */
  let error = null;
  /** The key just picked is still down: its repeats and release mustn't open the mic. */
  let held = null;

  /** @returns {PttState} */
  const state = () => ({ enabled, binding: binding?.label ?? null, capturing, error });

  function setPressed(down) {
    if (down === pressed) return;
    pressed = down;
    onPress(down);
  }

  function save() {
    writeConfig({ pushToTalk: { enabled, binding } });
  }

  function input(event, down, fromHook = true) {
    if (capturing) {
      if (!down) return;
      if (event.key === ESCAPE) return finishCapture(null);
      // Left/right clicks are how you use the menu itself.
      if (event.mouse !== undefined && event.mouse < 3) return;
      return finishCapture(event, fromHook);
    }
    if (sameInput(event, held)) {
      if (!down) held = null;
      return;
    }
    if (listening && enabled && sameInput(event, binding)) setPressed(down);
  }

  function finishCapture(event, fromHook) {
    capturing = false;
    if (event) {
      setPressed(false);
      binding = { ...event, label: event.key !== undefined ? keyLabel(event.key) : mouseLabel(event.mouse) };
      // A key the hook didn't see go down won't be seen coming up either.
      held = fromHook ? binding : null;
      save();
    }
    sync();
  }

  /** Starts or stops the hook to match what's needed, then tells the page. */
  function sync() {
    const wanted = capturing || (listening && enabled && !!binding);
    if (wanted && !running) {
      try {
        const { uIOhook } = load();
        if (!wired) {
          wired = true;
          uIOhook.on("keydown", (e) => input({ key: e.keycode }, true));
          uIOhook.on("keyup", (e) => input({ key: e.keycode }, false));
          uIOhook.on("mousedown", (e) => input({ mouse: e.button }, true));
          uIOhook.on("mouseup", (e) => input({ mouse: e.button }, false));
        }
        uIOhook.start();
        running = true;
        error = null;
      } catch (e) {
        console.error("push-to-talk hook failed:", e);
        error = describeError(e);
        capturing = false;
      }
    } else if (!wanted && running) {
      setPressed(false);
      held = null;
      try {
        lib.uIOhook.stop();
      } catch (e) {
        console.error("push-to-talk hook stop failed:", e);
      }
      running = false;
    }
    broadcast(state());
  }

  return {
    state,
    setEnabled(on) {
      enabled = on === true;
      if (!enabled) setPressed(false);
      save();
      // Turning it on without a key goes straight to picking one.
      if (enabled && !binding) capturing = true;
      sync();
    },
    capture(on) {
      capturing = on === true;
      sync();
    },
    /** Fallback for the app's own window, whose keys a Wayland session hides from the hook. */
    captureDomKey(code) {
      if (!capturing || typeof code !== "string") return;
      const key = code === "Escape" ? ESCAPE : keyFromDomCode(code);
      if (key !== undefined) input({ key }, true, false);
    },
    listen(on) {
      listening = on === true;
      if (!listening) setPressed(false);
      sync();
    },
    stop() {
      listening = false;
      capturing = false;
      sync();
    },
  };
}

module.exports = { createPushToTalk };
