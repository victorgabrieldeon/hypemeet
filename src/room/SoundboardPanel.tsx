import type { LocalAudioTrack } from "livekit-client";
import { Mic } from "lucide-react";
import { useState } from "react";
import { playSound, SOUNDS, stopSound, type SoundId } from "./soundboard";

interface SoundboardPanelProps {
  /** The published mic, if any; sounds only reach the room while it's on. */
  mic: LocalAudioTrack | undefined;
  micOn: boolean;
  onEnableMic: () => void;
  onError: (text: string) => void;
}

/** Popover above the dock: short sounds mixed into your mic. Clicking the one that's playing cuts it. */
export function SoundboardPanel({ mic, micOn, onEnableMic, onError }: SoundboardPanelProps) {
  const [playing, setPlaying] = useState<SoundId | null>(null);

  async function play(id: SoundId) {
    if (playing === id) {
      stopSound();
      setPlaying(null);
      return;
    }
    setPlaying(id);
    try {
      const length = await playSound(id, micOn ? mic : undefined);
      setTimeout(() => setPlaying((current) => (current === id ? null : current)), length * 1000);
    } catch (err) {
      onError(`Não deu pra mandar o som pra sala: ${(err as Error).message}`);
    }
  }

  return (
    <div
      role="dialog"
      aria-label="Soundboard"
      className="absolute bottom-full left-1/2 z-40 mb-3 flex w-[min(23rem,calc(100vw-1.5rem))] -translate-x-1/2 animate-pop flex-col gap-3 rounded-lg bg-panel p-3 shadow-float ring-1 ring-line"
    >
      <div className="flex items-baseline justify-between gap-3 px-1 pt-1">
        <h2 className="type-link">Soundboard</h2>
        {micOn && <p className="text-xs text-soft">Sai no seu microfone</p>}
      </div>

      {!micOn && (
        <div className="flex items-center gap-3 rounded-md border border-line bg-surface p-3">
          <p className="min-w-0 flex-1 text-sm">
            <span className="block font-medium">Microfone desligado</span>
            <span className="block text-xs text-soft">Só você ouve. Ligue pra galera ouvir também.</span>
          </p>
          <button
            type="button"
            onClick={onEnableMic}
            className="type-link-sm flex h-9 shrink-0 items-center gap-1.5 rounded-md bg-surface-hi px-3 text-ink transition hover:bg-blurple/25"
          >
            <Mic className="size-4" /> Ligar
          </button>
        </div>
      )}

      <div className="grid grid-cols-3 gap-2">
        {(Object.keys(SOUNDS) as SoundId[]).map((id) => {
          const { label, emoji } = SOUNDS[id];
          const active = playing === id;
          return (
            <button
              key={id}
              type="button"
              aria-pressed={active}
              onClick={() => void play(id)}
              className={`flex h-20 flex-col items-center justify-center gap-1 rounded-md px-1 text-xs font-semibold transition duration-200 ease-out-expo active:scale-95 ${active ? "bg-blurple text-ink" : "bg-surface text-soft hover:bg-surface-hi hover:text-ink"
                }`}
            >
              <span aria-hidden className={`block text-2xl leading-none transition ${active ? "scale-110" : ""}`}>
                {emoji}
              </span>
              <span className="w-full truncate text-center">{label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
