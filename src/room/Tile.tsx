import {
  LocalParticipant,
  Track,
  type LocalTrackPublication,
  type Participant,
  type RemoteTrackPublication,
  type TrackPublication,
} from "livekit-client";
import {
  Activity,
  Eye,
  EyeOff,
  Maximize,
  MicOff,
  Minimize,
  MonitorUp,
  MoveUpRight,
  Pencil,
  Pin,
  PinOff,
  Play,
  Volume1,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Spinner } from "../components/ui";
import { CasinoBadges, CasinoFrame, CasinoLayer, CasinoTileButton, PersonAvatar } from "./Casino";
import { FILL_CLASS, useFullscreen } from "./fullscreen";
import { useInk, type InkTool } from "./ink";
import { InkLayer } from "./InkLayer";
import { VideoView } from "./media";
import { volumeKey, watchScreen, type TileModel } from "./model";
import { useScreenPreview } from "./previews";
import { ConnectionBars, formatBitrate, useVideoStats } from "./quality";
import { ReactionLayer } from "./reactions";
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

function Pill({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <div
      title={title}
      className="type-link-sm flex max-w-full items-center gap-1.5 truncate rounded-sm bg-black/65 px-2.5 py-1 text-[13px] text-ink backdrop-blur-md"
    >
      {children}
    </div>
  );
}

const VIEWER_AVATARS = 3;
const listFormat = new Intl.ListFormat("pt-BR");

/** Who's watching a screen: an eye, the first faces stacked and the count; names on hover. */
function Viewers({ viewers, compact }: { viewers: Participant[]; compact?: boolean }) {
  const names = viewers.map((p) => (p.isLocal ? "você" : p.name || p.identity));
  const shown = compact ? [] : viewers.slice(0, VIEWER_AVATARS);
  const label = `Assistindo: ${listFormat.format(names)}`;
  return (
    <Pill title={label}>
      <Eye className="size-3.5 shrink-0" aria-label={label} />
      {shown.length > 0 && (
        <div className="flex -space-x-1.5" aria-hidden>
          {shown.map((p) => (
            <PersonAvatar key={p.identity} participant={p} size="xs" className="ring-2 ring-black/70" />
          ))}
        </div>
      )}
      <span className="tabular-nums" aria-hidden>
        {viewers.length}
      </span>
    </Pill>
  );
}

/** Live fps / bitrate / resolution of a screen; only mounted while hovered, so it only polls then. */
function ScreenStats({ track, isLocal }: { track: Track; isLocal: boolean }) {
  const stats = useVideoStats(track);
  let text;
  if (!stats) text = "Medindo…";
  // Dynacast pauses every layer of a screen nobody is watching.
  else if (stats.bitrate === 0) text = isLocal ? "Ninguém assistindo · envio pausado" : "Nada chegando";
  else
    text = [
      stats.width ? `${stats.width}×${stats.height}` : null,
      `${Math.round(stats.fps)} fps`,
      formatBitrate(stats.bitrate),
    ]
      .filter(Boolean)
      .join(" · ");
  return (
    <Pill>
      <Activity className="size-3.5 shrink-0" />
      <span className="truncate tabular-nums" title={isLocal ? "O que você está enviando" : "O que está chegando pra você"}>
        {isLocal ? "Enviando" : "Recebendo"} {text}
      </span>
    </Pill>
  );
}

function IconButton({
  onClick,
  label,
  active,
  children,
}: {
  onClick: () => void;
  label: string;
  /** Set on toggles: lit Blurple while on. */
  active?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      onDoubleClick={(e) => e.stopPropagation()}
      className={`grid size-9 place-items-center rounded-full text-ink backdrop-blur-md transition ${active ? "bg-blurple hover:brightness-110" : "bg-black/65 hover:bg-black/85"}`}
      aria-label={label}
      aria-pressed={active}
      title={label}
    >
      {children}
    </button>
  );
}

const INK_TOOLS: { tool: InkTool; icon: typeof Pencil; label: string }[] = [
  { tool: "pen", icon: Pencil, label: "Caneta" },
  { tool: "arrow", icon: MoveUpRight, label: "Seta" },
];

/** Shown while drawing on a screen: pick pen or arrow, or put the tool down. */
function InkToolbar({ tool, onChange }: { tool: InkTool; onChange: (tool: InkTool | null) => void }) {
  const ink = useInk();
  return (
    <div
      role="toolbar"
      aria-label="Desenhar na tela"
      className="flex items-center gap-0.5 rounded-full bg-black/70 p-1 backdrop-blur-md"
      onDoubleClick={(e) => e.stopPropagation()}
    >
      <span
        className="mx-1.5 size-3 shrink-0 rounded-full ring-2 ring-white/25"
        style={{ background: ink.color }}
        title="Sua cor: é assim que os outros veem seus desenhos"
      />
      <span className="hidden pr-1.5 text-xs whitespace-nowrap text-ink/70 @2xl:inline">
        Arraste pra desenhar · clique pra pingar
      </span>
      {INK_TOOLS.map(({ tool: value, icon: Icon, label }) => (
        <button
          key={value}
          type="button"
          aria-pressed={tool === value}
          aria-label={label}
          title={label}
          onClick={() => onChange(value)}
          className={`grid size-8 place-items-center rounded-full transition ${tool === value ? "bg-blurple text-ink" : "text-ink/80 hover:bg-white/15 hover:text-ink"}`}
        >
          <Icon className="size-4" />
        </button>
      ))}
      <span className="mx-0.5 h-5 w-px bg-white/15" />
      <button
        type="button"
        aria-label="Parar de desenhar"
        title="Parar de desenhar (Esc)"
        onClick={() => onChange(null)}
        className="grid size-8 place-items-center rounded-full text-ink/80 transition hover:bg-white/15 hover:text-ink"
      >
        <X className="size-4" />
      </button>
    </div>
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
  const [hovered, setHovered] = useState(false);
  const { participant } = tile;
  const isLocal = participant.isLocal;
  const name = participant.name || participant.identity;
  // Screen tiles only: the picture's aspect (to line ink up with it) and the tool in hand, if drawing.
  const [aspect, setAspect] = useState<number | null>(null);
  const [inkTool, setInkTool] = useState<InkTool | null>(null);
  const preview = useScreenPreview(tile.kind === "screen" && !isLocal ? tile.video.trackSid : null);

  useEffect(() => {
    if (!inkTool) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setInkTool(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [inkTool]);

  const fullscreen = useFullscreen(ref);

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
        <CasinoFrame tile={tile}>
          {cameraOn ? (
            <VideoView track={camera.track!} mirror={isLocal} fit="cover" />
          ) : (
            <div className="grid size-full place-items-center bg-[radial-gradient(circle_at_50%_40%,rgb(88_101_242/0.28),transparent_70%)]">
              <PersonAvatar participant={participant} size={compact ? "sm" : "lg"} />
            </div>
          )}
        </CasinoFrame>
        <div className={`${overlayBase} bottom-2 left-2 max-w-[calc(100%-1rem)]`}>
          <Pill>
            {!micOn && <MicOff className="size-3.5 shrink-0 text-danger" />}
            <span className="truncate">{isLocal ? `${name} (você)` : name}</span>
            <CasinoBadges identity={participant.identity} />
            <ConnectionBars quality={participant.connectionQuality} />
          </Pill>
        </div>
        <div className={`${overlayBase} top-2 right-2 left-2 flex-wrap justify-end ${hoverOnly}`}>
          {!isLocal && mic && <VolumeControl participant={participant} pub={mic} label={`microfone de ${name}`} />}
          <CasinoTileButton tile={tile} placement="down" />
          <IconButton onClick={onTogglePin} label={pinned ? "Desafixar" : "Fixar"}>
            {pinned ? <PinOff className="size-4" /> : <Pin className="size-4" />}
          </IconButton>
        </div>
        <CasinoLayer tile={tile} compact={compact} />
        <ReactionLayer tileId={tile.id} compact={compact} />
      </div>
    );
  }

  const { video, audio, number, viewers } = tile;
  const screenLabel = number ? `tela ${number}` : "tela";
  const title = isLocal ? `Sua ${screenLabel}` : `${number ? `Tela ${number}` : "Tela"} de ${name}`;
  // Remote screens aren't received until the listener asks for them (see useSubscriptions).
  const watching = isLocal || (video as RemoteTrackPublication).isDesired;
  const showing = watching && !!video.track;
  const tool = showing && !compact ? inkTool : null;
  return (
    <div
      ref={ref}
      onDoubleClick={onTogglePin}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className={`group @container relative size-full animate-pop overflow-hidden rounded-lg bg-black ${fullscreen.filling ? FILL_CLASS : ""}`}
    >
      <CasinoFrame tile={tile}>
        {!watching ? (
          <div className="relative grid size-full place-items-center bg-[radial-gradient(circle_at_50%_45%,rgb(88_101_242/0.3),transparent_70%)]">
            {preview && (
              <>
                <img src={preview} alt="" draggable={false} className="absolute inset-0 size-full object-contain" />
                <div className="absolute inset-0 bg-black/40 transition group-hover:bg-black/55" />
              </>
            )}
            <button
              onClick={(e) => {
                e.stopPropagation();
                watchScreen(tile, true);
              }}
              onDoubleClick={(e) => e.stopPropagation()}
              className={`type-link-sm relative flex items-center gap-2 rounded-full bg-blurple text-ink shadow-float transition duration-200 ease-out-expo hover:brightness-110 active:scale-95 ${compact ? "h-8 px-3 text-xs" : "h-11 px-5"}`}
            >
              <Play className={compact ? "size-3.5" : "size-4"} /> {compact ? "Assistir" : "Ver transmissão"}
            </button>
          </div>
        ) : video.track ? (
          <VideoView track={video.track} fit="contain" onAspect={setAspect} />
        ) : (
          <div className="grid size-full place-items-center text-soft">
            <Spinner />
          </div>
        )}
        {showing && <InkLayer screen={video.trackSid} aspect={aspect} tool={tool} />}
      </CasinoFrame>
      <div className={`${overlayBase} top-2 left-2 ${tool ? "max-w-[calc(50%-1rem)]" : "max-w-[calc(100%-1rem)]"}`}>
        <div className="flex min-w-0 flex-col items-start gap-1.5">
          <Pill>
            {!isLocal && !watching && (
              <span className="shrink-0 rounded-xs bg-danger px-1 text-[10px] leading-4 font-bold tracking-wide uppercase">
                Ao vivo
              </span>
            )}
            <MonitorUp className="size-3.5 shrink-0" />
            <span className="truncate">{title}</span>
            {audio && <Volume2 className="size-3.5 shrink-0 text-ink/75" aria-label="com áudio" />}
            <ConnectionBars quality={participant.connectionQuality} />
          </Pill>
          {viewers.length > 0 && <Viewers viewers={viewers} compact={compact} />}
          {hovered && !compact && watching && video.track && <ScreenStats track={video.track} isLocal={isLocal} />}
        </div>
      </div>
      {tool && (
        <div className={`${overlayBase} top-2 right-2`}>
          <InkToolbar tool={tool} onChange={setInkTool} />
        </div>
      )}
      {/* Spans the tile's width: let presses on the gaps through to the ink canvas underneath. */}
      <div
        className={`${overlayBase} pointer-events-none right-2 bottom-2 left-2 flex-wrap justify-end *:pointer-events-auto ${hoverOnly}`}
      >
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
        <CasinoTileButton tile={tile} />
        {!isLocal && watching && (
          <IconButton onClick={() => watchScreen(tile, false)} label="Parar de assistir">
            <EyeOff className="size-4" />
          </IconButton>
        )}
        <IconButton onClick={onTogglePin} label={pinned ? "Desafixar" : "Fixar"}>
          {pinned ? <PinOff className="size-4" /> : <Pin className="size-4" />}
        </IconButton>
        {showing && !compact && (
          <IconButton
            onClick={() => setInkTool(inkTool ? null : "pen")}
            label={inkTool ? "Parar de desenhar" : "Desenhar na tela"}
            active={!!inkTool}
          >
            <Pencil className="size-4" />
          </IconButton>
        )}
        {watching && (
          <IconButton onClick={fullscreen.toggle} label={fullscreen.active ? "Sair da tela cheia" : "Tela cheia"}>
            {fullscreen.active ? <Minimize className="size-4" /> : <Maximize className="size-4" />}
          </IconButton>
        )}
      </div>
      <CasinoLayer tile={tile} compact={compact} inkActive={!!tool} />
      <ReactionLayer tileId={tile.id} compact={compact} />
    </div>
  );
}
