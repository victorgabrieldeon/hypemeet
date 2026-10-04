import {
  LocalParticipant,
  Track,
  type LocalTrackPublication,
  type Participant,
  type RemoteTrackPublication,
  type TrackPublication,
} from "livekit-client";
import {
  EyeOff,
  Maximize,
  MicOff,
  MonitorUp,
  Pin,
  PinOff,
  Play,
  Volume1,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import { useRef, type CSSProperties, type ReactNode } from "react";
import { Avatar, Spinner } from "../components/ui";
import { VideoView } from "./media";
import { volumeKey, watchScreen, type TileModel } from "./model";
import { MAX_VOLUME, useVolumes } from "./volume";

function VolumeControl({ participant, pub, label }: { participant: Participant; pub: TrackPublication; label: string }) {
  const volumes = useVolumes();
  const key = volumeKey(participant, pub);
  const { volume, muted } = volumes.get(key);
  const silent = muted || volume === 0;
  const Icon = silent ? VolumeX : volume < 0.5 ? Volume1 : Volume2;
  const percent = Math.round(volume * 100);
  return (
    <div
      className="flex items-center gap-2 rounded-full bg-black/70 py-1 pr-3.5 pl-1 backdrop-blur-md"
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      <button
        className={`grid size-8 place-items-center rounded-full transition hover:bg-white/15 ${silent ? "text-danger" : "text-ink"}`}
        onClick={() => volumes.set(key, { muted: !muted, ...(volume === 0 ? { volume: 1 } : {}) })}
        aria-label={muted ? `Ativar som: ${label}` : `Mutar: ${label}`}
        title={muted ? "Ativar som (só pra você)" : "Mutar (só pra você)"}
      >
        <Icon className="size-4" />
      </button>
      <input
        type="range"
        min={0}
        max={MAX_VOLUME * 100}
        step={5}
        value={muted ? 0 : percent}
        onChange={(e) => volumes.set(key, { volume: Number(e.target.value) / 100, muted: false })}
        className="range-accent w-24 sm:w-28"
        style={{ "--fill": `${((muted ? 0 : percent) / (MAX_VOLUME * 100)) * 100}%` } as CSSProperties}
        aria-label={`Volume: ${label}`}
      />
      <span
        className={`w-10 text-right text-xs font-semibold tabular-nums ${percent > 100 && !muted ? "text-blurple-hi" : "text-ink/75"}`}
      >
        {muted ? "mudo" : `${percent}%`}
      </span>
    </div>
  );
}

function Pill({ children }: { children: ReactNode }) {
  return (
    <div className="type-link-sm flex max-w-full items-center gap-1.5 truncate rounded-sm bg-black/65 px-2.5 py-1 text-[13px] text-ink backdrop-blur-md">
      {children}
    </div>
  );
}

function IconButton({ onClick, label, children }: { onClick: () => void; label: string; children: ReactNode }) {
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      onDoubleClick={(e) => e.stopPropagation()}
      className="grid size-9 place-items-center rounded-full bg-black/65 text-ink backdrop-blur-md transition hover:bg-black/85"
      aria-label={label}
      title={label}
    >
      {children}
    </button>
  );
}

interface TileProps {
  tile: TileModel;
  pinned: boolean;
  compact?: boolean;
  onTogglePin: () => void;
}

export function Tile({ tile, pinned, compact, onTogglePin }: TileProps) {
  const ref = useRef<HTMLDivElement>(null);
  const { participant } = tile;
  const isLocal = participant.isLocal;
  const name = participant.name || participant.identity;

  const toggleFullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void ref.current?.requestFullscreen();
  };

  const overlayBase = "absolute flex items-center gap-2 transition";
  const hoverOnly = compact ? "hidden" : "opacity-0 group-hover:opacity-100 focus-within:opacity-100";

  if (tile.kind === "camera") {
    const camera = participant.getTrackPublication(Track.Source.Camera);
    const mic = participant.getTrackPublication(Track.Source.Microphone);
    const cameraOn = camera?.track && !camera.isMuted;
    const micOn = mic && !mic.isMuted;
    return (
      <div
        ref={ref}
        onDoubleClick={onTogglePin}
        className={`group relative size-full animate-pop overflow-hidden rounded-lg border-2 bg-surface transition-[border-color,box-shadow] duration-200 ${participant.isSpeaking && micOn
          ? "border-blurple shadow-[0_0_28px_-4px_rgb(88_101_242/0.7)]"
          : "border-line"
          }`}
      >
        {cameraOn ? (
          <VideoView track={camera.track!} mirror={isLocal} fit="cover" />
        ) : (
          <div className="grid size-full place-items-center bg-[radial-gradient(circle_at_50%_40%,rgb(88_101_242/0.28),transparent_70%)]">
            <Avatar name={name} size={compact ? "sm" : "lg"} />
          </div>
        )}
        <div className={`${overlayBase} bottom-2 left-2 max-w-[calc(100%-1rem)]`}>
          <Pill>
            {!micOn && <MicOff className="size-3.5 shrink-0 text-danger" />}
            <span className="truncate">{isLocal ? `${name} (você)` : name}</span>
          </Pill>
        </div>
        <div className={`${overlayBase} top-2 right-2 left-2 flex-wrap justify-end ${hoverOnly}`}>
          {!isLocal && mic && <VolumeControl participant={participant} pub={mic} label={`microfone de ${name}`} />}
          <IconButton onClick={onTogglePin} label={pinned ? "Desafixar" : "Fixar"}>
            {pinned ? <PinOff className="size-4" /> : <Pin className="size-4" />}
          </IconButton>
        </div>
      </div>
    );
  }

  const { video, audio, number } = tile;
  const screenLabel = number ? `tela ${number}` : "tela";
  const title = isLocal ? `Sua ${screenLabel}` : `${number ? `Tela ${number}` : "Tela"} de ${name}`;
  // Remote screens aren't received until the listener asks for them (see useSubscriptions).
  const watching = isLocal || (video as RemoteTrackPublication).isDesired;
  return (
    <div
      ref={ref}
      onDoubleClick={onTogglePin}
      className="group relative size-full animate-pop overflow-hidden rounded-lg bg-black"
    >
      {!watching ? (
        <div className="grid size-full place-items-center bg-[radial-gradient(circle_at_50%_45%,rgb(88_101_242/0.3),transparent_70%)]">
          <button
            onClick={(e) => {
              e.stopPropagation();
              watchScreen(tile, true);
            }}
            onDoubleClick={(e) => e.stopPropagation()}
            className={`type-link-sm flex items-center gap-2 rounded-full bg-blurple text-ink shadow-float transition duration-200 ease-out-expo hover:brightness-110 active:scale-95 ${compact ? "h-8 px-3 text-xs" : "h-11 px-5"}`}
          >
            <Play className={compact ? "size-3.5" : "size-4"} /> {compact ? "Assistir" : "Ver transmissão"}
          </button>
        </div>
      ) : video.track ? (
        <VideoView track={video.track} fit="contain" />
      ) : (
        <div className="grid size-full place-items-center text-soft">
          <Spinner />
        </div>
      )}
      <div className={`${overlayBase} top-2 left-2 max-w-[calc(100%-1rem)]`}>
        <Pill>
          <MonitorUp className="size-3.5 shrink-0" />
          <span className="truncate">{title}</span>
          {audio && <Volume2 className="size-3.5 shrink-0 text-ink/75" aria-label="com áudio" />}
        </Pill>
      </div>
      <div className={`${overlayBase} right-2 bottom-2 left-2 flex-wrap justify-end ${hoverOnly}`}>
        {!isLocal && watching && audio && (
          <VolumeControl participant={participant} pub={audio} label={`${screenLabel} de ${name}`} />
        )}
        {participant instanceof LocalParticipant && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              // Paired audio is dropped by useScreenAudioCleanup.
              const track = (video as LocalTrackPublication).track;
              if (track) void participant.unpublishTrack(track);
            }}
            className="type-link-sm flex h-9 items-center gap-1.5 rounded-full bg-danger px-3.5 text-ink transition hover:brightness-110"
          >
            <X className="size-4" /> Parar
          </button>
        )}
        {!isLocal && watching && (
          <IconButton onClick={() => watchScreen(tile, false)} label="Parar de assistir">
            <EyeOff className="size-4" />
          </IconButton>
        )}
        <IconButton onClick={onTogglePin} label={pinned ? "Desafixar" : "Fixar"}>
          {pinned ? <PinOff className="size-4" /> : <Pin className="size-4" />}
        </IconButton>
        {watching && (
          <IconButton onClick={toggleFullscreen} label="Tela cheia">
            <Maximize className="size-4" />
          </IconButton>
        )}
      </div>
    </div>
  );
}
