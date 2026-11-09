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
  Mic,
  MicOff,
  Minimize,
  MonitorUp,
  MoveUpRight,
  Pencil,
  PictureInPicture2,
  Pin,
  PinOff,
  Play,
  VideoOff,
  Volume1,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Avatar, personTagClass, scrimClass, Spinner } from "../components/ui";
import { personStyle } from "../lib/color";
import { inDiscord } from "../lib/discord";
import { FILL_CLASS, useFullscreen } from "./fullscreen";
import { castOwnerOf } from "./cast";
import { useInk, type InkTool } from "./ink";
import { InkLayer } from "./InkLayer";
import { VideoView } from "./media";
import { discordAvatar, nameOf, volumeKey, watchScreen, type TileModel } from "./model";
import { closePip, floatableTrack, openPip, pipSupported, usePipTile } from "./pip";
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
      className={`${scrimClass} h-9 pr-3 pl-0.5`}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      <button
        // Filled when silent: danger as icon colour on the scrim drops below 3:1 over a bright frame.
        className={`grid size-7.5 place-items-center rounded-full transition ${silent ? "bg-danger text-on-accent hover:brightness-110" : "text-ink hover:bg-surface-hi"}`}
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
      <span className="w-10 text-right font-mono text-xs text-ink tabular-nums">{muted ? "mudo" : `${percent}%`}</span>
    </div>
  );
}

/** Chip sizes over a screen; a bit smaller on narrow tiles. */
const CHIP = "h-7.5 gap-1.5 px-3 text-[13px] font-bold @max-xs:h-6 @max-xs:px-2.5 @max-xs:text-xs";

function Pill({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <div title={title} className={`${scrimClass} ${CHIP} max-w-full truncate`}>
      {children}
    </div>
  );
}

const VIEWER_AVATARS = 3;
const listFormat = new Intl.ListFormat("pt-BR");

/** Who's watching a screen: an eye, the first faces stacked (not when compact) and the count; names on hover. */
function Viewers({ viewers, compact }: { viewers: Participant[]; compact?: boolean }) {
  const names = viewers.map((p) => (p.isLocal ? "você" : nameOf(p)));
  const shown = compact ? [] : viewers.slice(0, VIEWER_AVATARS);
  const label = `Assistindo: ${listFormat.format(names)}`;
  return (
    <Pill title={label}>
      <Eye className="size-4 shrink-0" aria-label={label} />
      {shown.length > 0 && (
        <div className="flex -space-x-1.5" aria-hidden>
          {shown.map((p) => (
            <Avatar
              key={p.identity}
              name={nameOf(p)}
              seed={p.identity}
              image={discordAvatar(p)}
              size="xs"
              className="ring-2 ring-surface"
            />
          ))}
        </div>
      )}
      <span className="font-mono tabular-nums" aria-hidden>
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
    text = `${isLocal ? "Enviando" : "Recebendo"} ${[
      stats.width ? `${stats.width}×${stats.height}` : null,
      `${Math.round(stats.fps)} fps`,
      formatBitrate(stats.bitrate),
    ]
      .filter(Boolean)
      .join(" · ")}`;
  return (
    <Pill>
      <Activity className="size-4 shrink-0" />
      <span className="truncate tabular-nums" title={isLocal ? "O que você está enviando" : "O que está chegando pra você"}>
        {text}
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
  /** Set on toggles: lit grape while on. */
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
      className={`grid size-9 place-items-center rounded-full transition duration-200 ease-out-expo hover:-translate-y-px active:translate-y-px ${active ? "border-[1.5px] border-accent-hi bg-accent text-on-accent hover:bg-accent-hi" : "scrim text-ink hover:bg-surface-hi"}`}
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
      className="scrim flex items-center gap-0.5 rounded-full p-1"
      onDoubleClick={(e) => e.stopPropagation()}
    >
      <span
        className="mx-1.5 size-3 shrink-0 rounded-full ring-2 ring-white/25"
        style={{ background: ink.color }}
        title="Sua cor: é assim que os outros veem seus desenhos"
      />
      <span className="hidden pr-1.5 text-xs font-bold whitespace-nowrap text-ink @2xl:inline">
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
          className={`grid size-8 place-items-center rounded-full transition ${tool === value ? "bg-accent text-on-accent" : "text-soft hover:bg-surface-hi hover:text-ink"}`}
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
        className="grid size-8 place-items-center rounded-full text-soft transition hover:bg-surface-hi hover:text-ink"
      >
        <X className="size-4" />
      </button>
    </div>
  );
}

/** "Janela flutuante": someone else's screen or camera in the browser's picture-in-picture window (see pip.ts). */
export function PipButton({ tile }: { tile: TileModel }) {
  const floating = usePipTile() === tile.id;
  const track = pipSupported ? floatableTrack(tile) : undefined;
  if (!track) return null;
  return (
    <IconButton
      onClick={() => (floating ? closePip() : void openPip(tile.id, track))}
      label={floating ? "Fechar janela flutuante" : "Janela flutuante"}
      active={floating}
    >
      <PictureInPicture2 className="size-4" />
    </IconButton>
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
  const name = nameOf(participant);
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
    const { camera } = tile;
    const mic = participant.getTrackPublication(Track.Source.Microphone);
    const cameraOn = camera?.track && !camera.isMuted;
    const micOn = mic && !mic.isMuted;
    const badge = "grid size-6.5 shrink-0 place-items-center rounded-full";
    return (
      <div
        ref={ref}
        onDoubleClick={onTogglePin}
        style={personStyle(participant.identity)}
        // person-frame and person-speaking both set the border: never on together.
        className={`group @container relative size-full animate-pop overflow-hidden bg-surface transition-[border-color,box-shadow] duration-200 ${pinned ? "rounded-lg" : "rounded-md"} ${participant.isSpeaking && micOn ? "person-speaking border-2" : "person-frame shadow-sticker"}`}
      >
        {cameraOn ? (
          <VideoView track={camera.track!} mirror={isLocal} fit="cover" />
        ) : (
          // pb-4: centred in the space above the name tag, so it clears it on short tiles.
          <div className="grid size-full place-items-center bg-[color-mix(in_srgb,var(--p)_5%,var(--color-surface))] pb-4">
            <Avatar
              name={name}
              seed={participant.identity}
              image={discordAvatar(participant)}
              className="@max-[12rem]:size-9 @max-[12rem]:text-sm @sm:size-24 @sm:text-3xl"
            />
          </div>
        )}
        <div className={`${overlayBase} top-2 left-2 max-w-[calc(100%-1rem)]`}>
          <ConnectionBars quality={participant.connectionQuality} />
          {!cameraOn && (
            <span className="flex min-w-0 items-center gap-1.5 text-xs font-bold text-soft" title="Câmera desligada">
              <VideoOff className="size-3.5 shrink-0" />
              <span className="sr-only truncate @min-[12rem]:not-sr-only">câmera desligada</span>
            </span>
          )}
        </div>
        <div className={`${overlayBase} right-2 bottom-2 left-2 justify-between`}>
          <span className={personTagClass}>
            <span className="truncate">{name}</span>
            {isLocal && <span className="shrink-0 font-sans text-xs font-medium">(você)</span>}
          </span>
          <span className="flex shrink-0 gap-1">
            {participant.isScreenShareEnabled && (
              <span role="img" aria-label="Compartilhando tela" title="Compartilhando tela" className={`${badge} scrim text-ink`}>
                <MonitorUp className="size-3.5" />
              </span>
            )}
            {/* In the Activity the voice is Discord's: a mic badge on everyone would just be noise. */}
            {!inDiscord &&
              (micOn ? (
                <span role="img" aria-label="Microfone ligado" title="Microfone ligado" className={`${badge} scrim text-ink`}>
                  <Mic className="size-3.5" />
                </span>
              ) : (
                <span
                  role="img"
                  aria-label="Microfone desligado"
                  title="Microfone desligado"
                  className={`${badge} bg-danger text-on-accent`}
                >
                  <MicOff className="size-3.5" strokeWidth={2.6} />
                </span>
              ))}
          </span>
        </div>
        {/* Spans the tile's width: let the top-left chips underneath keep their tooltips. */}
        <div
          className={`${overlayBase} pointer-events-none top-2 right-2 left-2 flex-wrap justify-end *:pointer-events-auto ${hoverOnly}`}
        >
          {!isLocal && mic && <VolumeControl participant={participant} pub={mic} label={`microfone de ${name}`} />}
          <IconButton onClick={onTogglePin} label={pinned ? "Desafixar" : "Fixar"}>
            {pinned ? <PinOff className="size-4" /> : <Pin className="size-4" />}
          </IconButton>
          <PipButton tile={tile} />
        </div>
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
  // The sharer's filled tag: top-left beside "Ao vivo" on roomy tiles, alone at the bottom on narrow ones.
  const nameTag = (
    <span className={`person-tag flex max-w-full min-w-0 items-center truncate rounded-full ${CHIP}`}>
      <MonitorUp className="size-4 shrink-0" />
      <span className="truncate">{title}</span>
      {audio && <Volume2 className="size-3.5 shrink-0" aria-label="com áudio" />}
    </span>
  );
  return (
    <div
      ref={ref}
      onDoubleClick={onTogglePin}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      // A transmitter's screen wears its owner's colour, like its "Tela de …" name.
      style={personStyle(castOwnerOf(participant) ?? participant.identity)}
      // In native fullscreen too: the tile's rim and corners would frame the picture.
      className={`group @container relative size-full animate-pop overflow-hidden border-2 border-line bg-canvas shadow-float ${pinned ? "rounded-lg" : "rounded-md"} ${fullscreen.active ? FILL_CLASS : ""}`}
    >
      {!watching ? (
        <div className="relative grid size-full place-items-center bg-[color-mix(in_srgb,var(--p)_5%,var(--color-surface))]">
          {preview && (
            <>
              <img src={preview} alt="" draggable={false} className="absolute inset-0 size-full object-contain" />
              <div className="absolute inset-0 bg-canvas/40 transition group-hover:bg-canvas/55" />
            </>
          )}
          <button
            onClick={(e) => {
              e.stopPropagation();
              watchScreen(tile, true);
            }}
            onDoubleClick={(e) => e.stopPropagation()}
            className="type-link-sm relative flex h-11 items-center gap-2 rounded-full border-2 border-accent-hi bg-accent px-5 text-on-accent shadow-sticker transition duration-200 ease-out-expo hover:-translate-y-px hover:bg-accent-hi active:translate-y-px active:shadow-none @max-xs:h-7 @max-xs:gap-1.5 @max-xs:px-3 @max-xs:text-xs"
          >
            <Play className="size-4 @max-xs:size-3.5" />
            <span className="@max-xs:hidden">Ver transmissão</span>
            <span className="hidden @max-xs:inline">Assistir</span>
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
      <div className={`${overlayBase} top-2 left-2 ${tool ? "max-w-[calc(50%-1rem)]" : "max-w-[calc(100%-1rem)]"}`}>
        <div className="flex min-w-0 flex-col items-start gap-1.5">
          <div className="flex max-w-full min-w-0 items-center gap-1.5">
            <div className="hidden min-w-0 @xs:flex">{nameTag}</div>
            {/* Not on narrow tiles: it shows exactly when the Assistir button does, and they're crowded. */}
            {!isLocal && !watching && (
              <span
                className={`flex shrink-0 items-center rounded-full border-[1.5px] border-[color-mix(in_srgb,var(--color-danger)_55%,white)] bg-danger text-on-accent @max-xs:hidden ${CHIP}`}
              >
                <span className="size-[7px] animate-pulse rounded-full bg-current motion-reduce:animate-none" />
                Ao vivo
              </span>
            )}
            <ConnectionBars quality={participant.connectionQuality} />
            {viewers.length > 0 && (
              <div className="min-w-0 @xs:hidden">
                <Viewers viewers={viewers} compact />
              </div>
            )}
          </div>
          <div className="hidden max-w-full min-w-0 flex-wrap items-start gap-1.5 @xs:flex">
            {viewers.length > 0 && <Viewers viewers={viewers} />}
            {hovered && !compact && watching && video.track && <ScreenStats track={video.track} isLocal={isLocal} />}
          </div>
        </div>
      </div>
      <div className={`${overlayBase} bottom-2 left-2 max-w-[calc(100%-1rem)] @xs:hidden`}>{nameTag}</div>
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
            className="type-link-sm flex h-9 items-center gap-1.5 rounded-full border-[1.5px] border-[color-mix(in_srgb,var(--color-danger)_55%,white)] bg-danger px-3.5 text-on-accent transition duration-200 ease-out-expo hover:-translate-y-px hover:brightness-110 active:translate-y-px"
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
        {showing && !compact && (
          <IconButton
            onClick={() => setInkTool(inkTool ? null : "pen")}
            label={inkTool ? "Parar de desenhar" : "Desenhar na tela"}
            active={!!inkTool}
          >
            <Pencil className="size-4" />
          </IconButton>
        )}
        <PipButton tile={tile} />
        {watching && (
          <IconButton onClick={fullscreen.toggle} label={fullscreen.active ? "Sair da tela cheia" : "Tela cheia"}>
            {fullscreen.active ? <Minimize className="size-4" /> : <Maximize className="size-4" />}
          </IconButton>
        )}
      </div>
      <ReactionLayer tileId={tile.id} compact={compact} />
    </div>
  );
}
