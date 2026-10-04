import type { LocalParticipant, LocalTrackPublication } from "livekit-client";
import { Gamepad2, MonitorUp, Square, Type, Volume2, VolumeX, type LucideIcon } from "lucide-react";
import { useReducer, useState } from "react";
import { Button, Spinner } from "../components/ui";
import { changeScreenMode, screenModeOf, type ScreenMode, type ScreenPrefs, type TileModel } from "./model";

type ScreenTile = Extract<TileModel, { kind: "screen" }>;

const MODES: { mode: ScreenMode; icon: LucideIcon; label: string; hint: string }[] = [
  { mode: "motion", icon: Gamepad2, label: "Jogo", hint: "60 fps — prioriza fluidez (jogos, vídeo)" },
  { mode: "detail", icon: Type, label: "Nitidez", hint: "Prioriza nitidez (texto, código, slides)" },
];

const SURFACES: Record<string, string> = { monitor: "Tela inteira", window: "Janela", browser: "Aba" };

function ModeSwitch({
  value,
  onChange,
  label,
  disabled,
}: {
  value: ScreenMode;
  onChange: (mode: ScreenMode) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="grid grid-cols-2 gap-0.5 rounded-md bg-canvas p-0.5">
      {MODES.map(({ mode, icon: Icon, label: text, hint }) => (
        <button
          key={mode}
          type="button"
          role="radio"
          aria-checked={value === mode}
          title={hint}
          disabled={disabled}
          onClick={() => value !== mode && onChange(mode)}
          className={`flex h-8 items-center justify-center gap-1.5 rounded-sm text-xs font-semibold transition disabled:opacity-60 ${value === mode ? "bg-blurple text-ink" : "text-soft hover:bg-surface-hi hover:text-ink"
            }`}
        >
          <Icon className="size-3.5" />
          {text}
        </button>
      ))}
    </div>
  );
}

interface ScreenPanelProps {
  /** The local participant's live screens, in start order. */
  screens: ScreenTile[];
  prefs: ScreenPrefs;
  onPrefsChange: (prefs: ScreenPrefs) => void;
  starting: boolean;
  onStart: () => void;
  onError: (text: string) => void;
}

/** Popover above the dock: every screen you're sending, live controls for each, and a new-share setup. */
export function ScreenPanel({ screens, prefs, onPrefsChange, starting, onStart, onError }: ScreenPanelProps) {
  // Mode lives on the capture track (no LiveKit event fires when it changes), so re-render by hand.
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  const [pending, setPending] = useState<string | null>(null);

  async function run(key: string, action: () => Promise<unknown>, failure: string) {
    setPending(key);
    try {
      await action();
    } catch (err) {
      onError(`${failure}: ${(err as Error).message}`);
    } finally {
      setPending(null);
      rerender();
    }
  }

  const stop = (screen: ScreenTile) => {
    const track = (screen.video as LocalTrackPublication).track;
    // Paired audio is dropped by useScreenAudioCleanup.
    return track ? (screen.participant as LocalParticipant).unpublishTrack(track) : Promise.resolve();
  };

  return (
    <div
      role="dialog"
      aria-label="Transmissões"
      className="absolute bottom-full left-1/2 z-40 mb-3 flex w-[min(23rem,calc(100vw-1.5rem))] -translate-x-1/2 animate-pop flex-col gap-3 rounded-lg bg-panel p-3 shadow-float ring-1 ring-line"
    >
      <div className="flex items-center justify-between px-1 pt-1">
        <h2 className="type-link">Transmissões</h2>
        {screens.length > 1 && (
          <button
            type="button"
            onClick={() => void run("all", () => Promise.all(screens.map(stop)), "Não deu pra parar")}
            disabled={pending !== null}
            className="type-link-sm rounded-sm px-2 py-1 text-danger transition hover:bg-danger/15 disabled:opacity-50"
          >
            Parar todas
          </button>
        )}
      </div>

      {screens.length > 0 && (
        <ul className="flex flex-col gap-2">
          {screens.map((screen, i) => {
            const pub = screen.video as LocalTrackPublication;
            const audio = screen.audio as LocalTrackPublication | undefined;
            const surface = SURFACES[pub.track?.mediaStreamTrack.getSettings().displaySurface ?? ""];
            const busyHere = pending?.startsWith(screen.id) || pending === "all";
            return (
              <li key={screen.id} className="flex flex-col gap-2.5 rounded-md border border-line bg-surface p-3">
                <div className="flex items-center gap-2.5">
                  <span className="size-2 shrink-0 rounded-full bg-danger shadow-[0_0_8px_rgb(240_56_76/0.9)]" />
                  <p className="min-w-0 flex-1 truncate text-sm">
                    <span className="font-semibold">Tela {i + 1}</span>
                    {surface && <span className="text-soft"> · {surface}</span>}
                  </p>
                  <button
                    type="button"
                    disabled={busyHere}
                    onClick={() => void run(`${screen.id}:stop`, () => stop(screen), "Não deu pra parar")}
                    className="type-link-sm flex h-8 items-center gap-1.5 rounded-sm bg-danger/15 px-2.5 text-danger transition hover:bg-danger hover:text-ink disabled:opacity-50"
                  >
                    {pending === `${screen.id}:stop` ? (
                      <Spinner className="size-3.5" />
                    ) : (
                      <Square className="size-3 fill-current" />
                    )}
                    Parar
                  </button>
                </div>
                <div className="grid grid-cols-[1fr_auto] gap-2">
                  <ModeSwitch
                    label={`Modo da tela ${i + 1}`}
                    value={screenModeOf(pub)}
                    disabled={busyHere}
                    onChange={(mode) =>
                      void run(`${screen.id}:mode`, () => changeScreenMode(pub, mode), "Não deu pra trocar o modo")
                    }
                  />
                  {audio ? (
                    <button
                      type="button"
                      aria-pressed={!audio.isMuted}
                      disabled={busyHere}
                      onClick={() =>
                        void run(
                          `${screen.id}:audio`,
                          () => (audio.isMuted ? audio.unmute() : audio.mute()),
                          "Não deu pra mudar o som",
                        )
                      }
                      className={`flex h-9 items-center gap-1.5 rounded-md px-3 text-xs font-semibold transition disabled:opacity-60 ${audio.isMuted
                          ? "bg-danger/15 text-danger hover:bg-danger/25"
                          : "bg-surface-hi text-ink hover:bg-blurple/25"
                        }`}
                    >
                      {audio.isMuted ? <VolumeX className="size-4" /> : <Volume2 className="size-4" />}
                      {audio.isMuted ? "Mudo" : "Com som"}
                    </button>
                  ) : (
                    <span
                      title="Essa tela foi compartilhada sem áudio. Pra ter som, comece uma nova marcando “Compartilhar áudio” no seletor."
                      className="flex h-9 cursor-help items-center gap-1.5 rounded-md px-3 text-xs font-semibold text-soft"
                    >
                      <VolumeX className="size-4" /> Sem som
                    </span>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <div className="flex flex-col gap-3 rounded-md border border-line bg-surface p-3">
        <p className="type-label px-0.5 pt-1 text-soft">{screens.length > 0 ? "Nova transmissão" : "Transmitir tela"}</p>
        <ModeSwitch
          label="Modo da nova transmissão"
          value={prefs.mode}
          onChange={(mode) => onPrefsChange({ ...prefs, mode })}
        />
        <label className="flex cursor-pointer items-center justify-between gap-3">
          <span className="text-sm">
            <span className="block font-medium">Transmitir com som</span>
            <span className="block text-xs text-soft">No Linux/macOS, só compartilhando uma aba.</span>
          </span>
          <button
            type="button"
            role="switch"
            aria-checked={prefs.audio}
            onClick={() => onPrefsChange({ ...prefs, audio: !prefs.audio })}
            className={`relative h-6 w-10 shrink-0 rounded-full transition ${prefs.audio ? "bg-blurple" : "bg-surface-hi"}`}
          >
            <span
              className={`absolute top-1 left-1 size-4 rounded-full bg-ink shadow transition-transform duration-200 ease-out-expo ${prefs.audio ? "translate-x-4" : ""
                }`}
            />
          </button>
        </label>
        <Button variant="primary" className="type-link-sm h-11" disabled={starting} onClick={onStart}>
          {starting ? <Spinner className="size-4" /> : <MonitorUp className="size-4" />}
          {screens.length > 0 ? "Adicionar outra tela" : "Escolher tela"}
        </Button>
      </div>
    </div>
  );
}
