import { FileVideo, Maximize, Minimize2, Pause, Play, Popcorn, RotateCcw, Volume1, Volume2, VolumeX } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { buttonClass, Spinner } from "../components/ui";
import { loadDevice } from "./devices";
import { positionAt, type WatchAction, type WatchControls, type WatchParty, type WatchSource, type WatchState } from "./watch";
import { loadYouTube, YT_STATE, youTubeError, youTubeThumbnail, type YTPlayer } from "./youtube";

/** What the sync loop needs from a player, YouTube or <video>. */
interface MediaHandle {
  time(): number;
  /** 0 until known. */
  duration(): number;
  /** Playing or trying to (buffering). */
  playing(): boolean;
  /** Buffering or seeking: its position means nothing right now. */
  stalled(): boolean;
  play(): Promise<void>;
  pause(): void;
  seek(seconds: number): void;
  setVolume(volume: number, muted: boolean): void;
  title(): string | undefined;
}

const TICK_MS = 400;
/** How far a player may drift before it's snapped back. YouTube seeks rebuffer, so it gets more slack. */
const TOLERANCE = { youtube: { playing: 1, paused: 0.5 }, file: { playing: 0.4, paused: 0.25 } };
/** After a corrective seek or a local click, let the player settle before judging it again. */
const SETTLE_MS = 1500;
const HOLD_MS = 2500;
/** Ticks spent "should be playing but isn't" before assuming the browser blocked autoplay. */
const STUCK_TICKS = 8;
const VOLUME_KEY = "hypemeet:watch-volume";

export const watchTitle = (source: WatchSource) =>
  source.kind === "youtube" ? (source.title ?? "Vídeo do YouTube") : source.name;

function formatTime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

function formatBytes(bytes: number): string {
  const gb = bytes / 1024 ** 3;
  return gb >= 1 ? `${gb.toFixed(1).replace(".", ",")} GB` : `${Math.round(bytes / 1024 ** 2)} MB`;
}

function loadVolume(): { volume: number; muted: boolean } {
  try {
    const saved = JSON.parse(localStorage.getItem(VOLUME_KEY) ?? "");
    if (typeof saved.volume === "number") return { volume: Math.min(1, Math.max(0, saved.volume)), muted: !!saved.muted };
  } catch {
    // first time
  }
  return { volume: 1, muted: false };
}

function youTubeHandle(player: YTPlayer): MediaHandle {
  const state = () => player.getPlayerState();
  return {
    time: () => player.getCurrentTime() ?? 0,
    duration: () => player.getDuration() ?? 0,
    playing: () => state() === YT_STATE.PLAYING || state() === YT_STATE.BUFFERING,
    stalled: () => state() === YT_STATE.BUFFERING || state() === YT_STATE.UNSTARTED,
    play: async () => player.playVideo(),
    pause: () => player.pauseVideo(),
    seek: (seconds) => player.seekTo(seconds, true),
    setVolume: (volume, muted) => {
      player.setVolume(Math.round(volume * 100));
      if (muted) player.mute();
      else player.unMute();
    },
    title: () => player.getVideoData()?.title || undefined,
  };
}

function videoHandle(video: HTMLVideoElement): MediaHandle {
  return {
    time: () => video.currentTime,
    duration: () => (Number.isFinite(video.duration) ? video.duration : 0),
    playing: () => !video.paused && !video.ended,
    stalled: () => video.seeking || video.readyState < HTMLMediaElement.HAVE_FUTURE_DATA,
    play: () => video.play(),
    pause: () => video.pause(),
    seek: (seconds) => {
      video.currentTime = seconds;
    },
    setVolume: (volume, muted) => {
      video.volume = volume;
      video.muted = muted;
    },
    title: () => undefined,
  };
}

function YouTubeMedia({
  videoId,
  start,
  onMedia,
  onError,
}: {
  videoId: string;
  /** Where to start, read once when the player is created. */
  start: () => number;
  onMedia: (media: MediaHandle | null) => void;
  onError: (text: string) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const props = useRef({ start, onMedia, onError });
  props.current = { start, onMedia, onError };

  useEffect(() => {
    let player: YTPlayer | null = null;
    let cancelled = false;
    loadYouTube()
      .then((YT) => {
        if (cancelled) return;
        // The API swaps the element for its iframe: give it one React doesn't own.
        const el = document.createElement("div");
        box.current!.replaceChildren(el);
        const created = new YT.Player(el, {
          videoId,
          width: "100%",
          height: "100%",
          playerVars: {
            // Our controls drive it, so everyone's clicks go through the shared state.
            controls: 0,
            disablekb: 1,
            fs: 0,
            iv_load_policy: 3,
            playsinline: 1,
            rel: 0,
            start: Math.floor(props.current.start()),
            origin: location.origin,
          },
          events: {
            onReady: () => !cancelled && props.current.onMedia(youTubeHandle(created)),
            onError: (event) => !cancelled && props.current.onError(youTubeError(event.data)),
          },
        });
        player = created;
      })
      .catch((err: Error) => !cancelled && props.current.onError(err.message));
    return () => {
      cancelled = true;
      player?.destroy();
      props.current.onMedia(null);
    };
  }, [videoId]);

  return <div ref={box} className="absolute inset-0 [&>iframe]:size-full" />;
}

function FileMedia({
  file,
  onMedia,
  onError,
}: {
  file: File;
  onMedia: (media: MediaHandle | null) => void;
  onError: (text: string) => void;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  const speaker = loadDevice("audiooutput");

  useEffect(() => {
    const video = ref.current!;
    const url = URL.createObjectURL(file);
    video.src = url;
    onMedia(videoHandle(video));
    return () => {
      onMedia(null);
      video.removeAttribute("src");
      video.load();
      URL.revokeObjectURL(url);
    };
  }, [file, onMedia]);

  // Same speaker as the call (picked in the mic menu).
  useEffect(() => {
    const video = ref.current!;
    if (speaker && "setSinkId" in video) void video.setSinkId(speaker).catch(() => undefined);
  }, [speaker]);

  return (
    <video
      ref={ref}
      playsInline
      preload="auto"
      className="absolute inset-0 size-full object-contain"
      onError={(e) => {
        const code = e.currentTarget.error?.code;
        if (code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED || code === MediaError.MEDIA_ERR_DECODE)
          onError("Esse formato não toca no navegador. MP4 (H.264/AAC) e WebM funcionam em todo lugar.");
        else if (code) onError("Não deu pra ler esse arquivo.");
      }}
    />
  );
}

/**
 * Keeps a player on the shared state: play/pause to match, and a seek whenever it drifts past the
 * tolerance (buffering, a late join, ads). Everyone, the host included, just follows the state.
 */
function useSync(media: MediaHandle | null, state: WatchState, hostNow: () => number, tolerance: { playing: number; paused: number }) {
  const [clock, setClock] = useState({ time: 0, duration: 0 });
  const [blocked, setBlocked] = useState(false);
  const live = useRef({ state, hostNow });
  live.current = { state, hostNow };
  // Skip ticks until `until`, unless a newer state (rev) arrives first.
  const settle = useRef({ until: 0, rev: -1 });
  const stuck = useRef(0);

  const tick = useCallback(() => {
    if (!media) return;
    const { state, hostNow } = live.current;
    const time = media.time();
    const duration = media.duration();
    setClock({ time, duration });
    if (performance.now() < settle.current.until && settle.current.rev === state.rev) return;

    let target = positionAt(state, hostNow());
    if (duration > 0) target = Math.min(target, duration);
    const shouldPlay = state.playing && !(duration > 0 && target >= duration - 0.5);
    if (shouldPlay && !media.playing()) {
      if (++stuck.current === STUCK_TICKS) setBlocked(true);
      media.play().catch((err: DOMException) => err?.name === "NotAllowedError" && setBlocked(true));
    } else {
      stuck.current = 0;
      if (!shouldPlay && media.playing()) media.pause();
    }
    if (media.stalled() || duration === 0) return;
    if (Math.abs(time - target) > (shouldPlay ? tolerance.playing : tolerance.paused)) {
      media.seek(target);
      settle.current = { until: performance.now() + SETTLE_MS, rev: state.rev };
    }
  }, [media, tolerance]);

  useEffect(() => {
    if (!media) return;
    tick();
    const id = setInterval(tick, TICK_MS);
    return () => clearInterval(id);
  }, [media, tick]);

  // A new state applies now, not on the next tick.
  useEffect(tick, [state.rev, tick]);

  return {
    ...clock,
    blocked,
    /** Called with a user gesture: the browser lets play() through. */
    resume() {
      setBlocked(false);
      stuck.current = 0;
      void media?.play().catch(() => setBlocked(true));
    },
    /** Our own click already moved the player: don't undo it before the host echoes the change. */
    hold() {
      settle.current = { until: performance.now() + HOLD_MS, rev: live.current.state.rev };
    },
  };
}

function ControlIcon({ onClick, label, children }: { onClick: () => void; label: string; children: ReactNode }) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      title={label}
      className="grid size-9 shrink-0 place-items-center rounded-full text-ink transition hover:bg-white/15"
    >
      {children}
    </button>
  );
}

function Overlay({ children }: { children: ReactNode }) {
  return (
    <div className="absolute inset-0 z-10 grid place-items-center bg-[radial-gradient(circle_at_50%_45%,rgb(88_101_242/0.3),transparent_70%)] bg-black/80 p-6 text-center">
      <div className="flex max-w-sm flex-col items-center gap-3">{children}</div>
    </div>
  );
}

interface WatchPlayerProps {
  party: WatchParty;
  watch: WatchControls;
  /** This viewer's copy of the file, for file sources. */
  file: File | null;
  onPickFile: (file: File) => void;
  onMinimize: () => void;
  onError: (text: string) => void;
  className?: string;
}

/** The shared player. Mounted for the whole session (hidden when minimized) so it never reloads. */
export function WatchPlayer({ party, watch, file, onPickFile, onMinimize, onError, className = "" }: WatchPlayerProps) {
  const { state } = party;
  const { source } = state;
  const ref = useRef<HTMLDivElement>(null);
  const [media, setMedia] = useState<MediaHandle | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [volume, setVolume] = useState(loadVolume);
  const [scrub, setScrub] = useState<number | null>(null);
  const clickTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const sync = useSync(media, state, watch.hostNow, TOLERANCE[source.kind]);

  useEffect(() => {
    media?.setVolume(volume.volume, volume.muted);
    localStorage.setItem(VOLUME_KEY, JSON.stringify(volume));
  }, [media, volume]);

  // YouTube titles need no API key when read from the host's own player.
  const needsTitle = watch.isHost && source.kind === "youtube" && !source.title;
  const loaded = sync.duration > 0;
  useEffect(() => {
    const title = needsTitle && loaded ? media?.title() : undefined;
    if (title) void watch.dispatch({ type: "title", title }).catch(() => undefined);
  }, [needsTitle, loaded, media, watch]);

  const duration = sync.duration;
  const ended = duration > 0 && positionAt(state, watch.hostNow()) >= duration - 0.5;
  const playing = state.playing && !ended;
  const shown = scrub ?? Math.min(sync.time, duration || sync.time);

  const send = (action: WatchAction) =>
    void watch.dispatch(action).catch(() => onError("Não deu pra controlar o vídeo agora. Tente de novo."));

  function toggle() {
    if (!media) return;
    sync.hold();
    if (playing) {
      media.pause();
      send({ type: "pause", position: media.time() });
    } else {
      if (ended) media.seek(0);
      void media.play().catch(() => undefined);
      send({ type: "play", ...(ended ? { position: 0 } : {}) });
    }
  }

  function seek(position: number) {
    if (!media) return;
    const clamped = Math.max(0, duration ? Math.min(position, duration) : position);
    sync.hold();
    media.seek(clamped);
    send({ type: "seek", position: clamped });
  }

  function commitScrub() {
    if (scrub === null) return;
    seek(scrub);
    setScrub(null);
  }

  const toggleFullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void ref.current?.requestFullscreen();
  };

  const silent = volume.muted || volume.volume === 0;
  const VolumeIcon = silent ? VolumeX : volume.volume < 0.5 ? Volume1 : Volume2;
  const percent = volume.muted ? 0 : Math.round(volume.volume * 100);
  const seekFill = duration ? (shown / duration) * 100 : 0;

  let overlay: ReactNode = null;
  if (source.kind === "file" && !file) {
    overlay = (
      <Overlay>
        <FileVideo className="size-10 text-blurple-hi" />
        <p className="type-link">Abra sua cópia do vídeo</p>
        <p className="text-sm break-all">
          <span className="font-semibold">{source.name}</span>
          <span className="text-soft"> · {formatBytes(source.size)}</span>
        </p>
        <p className="text-xs text-soft">Cada um toca o próprio arquivo: nada é enviado, então chega em qualidade original.</p>
        <label className={`${buttonClass({ variant: "primary" })} type-link-sm mt-1 h-11 cursor-pointer`}>
          <FileVideo className="size-4" /> Escolher arquivo
          <input
            type="file"
            accept="video/*,.mkv,.mov,.avi"
            hidden
            onChange={(e) => {
              const picked = e.target.files?.[0];
              e.target.value = "";
              if (picked) onPickFile(picked);
            }}
          />
        </label>
      </Overlay>
    );
  } else if (failure) {
    overlay = (
      <Overlay>
        <p className="type-link">{failure}</p>
        {source.kind === "file" && (
          <label className={`${buttonClass()} type-link-sm h-11 cursor-pointer`}>
            Escolher outro arquivo
            <input
              type="file"
              accept="video/*,.mkv,.mov,.avi"
              hidden
              onChange={(e) => {
                const picked = e.target.files?.[0];
                e.target.value = "";
                if (picked) {
                  setFailure(null);
                  onPickFile(picked);
                }
              }}
            />
          </label>
        )}
      </Overlay>
    );
  } else if (sync.blocked) {
    overlay = (
      <Overlay>
        <button
          onClick={sync.resume}
          className="type-link flex h-12 items-center gap-2 rounded-full bg-blurple px-6 text-ink shadow-float transition duration-200 ease-out-expo hover:brightness-110 active:scale-95"
        >
          <Play className="size-5" /> Entrar na sessão
        </button>
        <p className="text-xs text-soft">O navegador segurou o play automático.</p>
      </Overlay>
    );
  } else if (!media) {
    overlay = (
      <div className="pointer-events-none absolute inset-0 z-10 grid place-items-center text-soft">
        <Spinner className="size-7" />
      </div>
    );
  }

  return (
    <div
      ref={ref}
      tabIndex={0}
      aria-label={`Assistindo junto: ${watchTitle(source)}`}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return;
        const step = { ArrowLeft: -5, ArrowRight: 5, j: -10, l: 10 }[e.key];
        if (e.key === " " || e.key === "k") toggle();
        // Read the player, not the last tick: repeated presses must add up.
        else if (step) seek((media?.time() ?? sync.time) + step);
        else if (e.key === "f") toggleFullscreen();
        else if (e.key === "m") setVolume((v) => ({ ...v, muted: !v.muted }));
        else return;
        e.preventDefault();
      }}
      className={`group relative animate-pop overflow-hidden rounded-lg bg-black focus-visible:outline-offset-0 ${className}`}
    >
      {source.kind === "youtube" ? (
        <YouTubeMedia
          videoId={source.videoId}
          start={() => positionAt(state, watch.hostNow())}
          onMedia={setMedia}
          onError={setFailure}
        />
      ) : (
        file && <FileMedia file={file} onMedia={setMedia} onError={setFailure} />
      )}

      {/* Shields the iframe: clicks on the video go through our shared controls, not YouTube's. */}
      <div
        className="absolute inset-0"
        onClick={() => {
          clearTimeout(clickTimer.current);
          clickTimer.current = setTimeout(toggle, 220);
        }}
        onDoubleClick={() => {
          clearTimeout(clickTimer.current);
          toggleFullscreen();
        }}
      />

      <div className="pointer-events-none absolute top-2 left-2 z-20 flex max-w-[calc(100%-1rem)] flex-col items-start gap-1.5">
        <div className="type-link-sm flex max-w-full items-center gap-1.5 truncate rounded-sm bg-black/65 px-2.5 py-1 text-[13px] text-ink backdrop-blur-md">
          <Popcorn className="size-3.5 shrink-0" />
          <span className="truncate">{watchTitle(source)}</span>
        </div>
        {file && source.kind === "file" && file.size !== source.size && (
          <div className="rounded-sm bg-black/65 px-2.5 py-1 text-xs text-soft backdrop-blur-md">
            Seu arquivo é diferente do original: pode sair de sincronia.
          </div>
        )}
      </div>

      {overlay}

      <div
        className={`absolute inset-x-0 bottom-0 z-20 flex flex-col gap-1 bg-linear-to-t from-black/90 via-black/50 to-transparent px-3 pt-12 pb-2.5 transition duration-200 ${playing && !overlay ? "opacity-0 group-hover:opacity-100 focus-within:opacity-100" : ""
          }`}
      >
        <input
          type="range"
          min={0}
          max={duration || 1}
          step={0.1}
          value={shown}
          disabled={!media || !duration}
          onChange={(e) => setScrub(Number(e.target.value))}
          onPointerUp={commitScrub}
          onKeyUp={commitScrub}
          onBlur={commitScrub}
          className="range-accent w-full disabled:opacity-50"
          style={{ "--fill": `${seekFill}%` } as CSSProperties}
          aria-label="Posição do vídeo"
        />
        <div className="flex items-center gap-1">
          <ControlIcon onClick={toggle} label={playing ? "Pausar pra todo mundo" : ended ? "Ver de novo" : "Dar play pra todo mundo"}>
            {playing ? (
              <Pause className="size-5 fill-current" />
            ) : ended ? (
              <RotateCcw className="size-5" />
            ) : (
              <Play className="size-5 fill-current" />
            )}
          </ControlIcon>
          <span className="px-1 text-xs font-semibold text-ink/90 tabular-nums">
            {formatTime(shown)} <span className="text-ink/50">/ {formatTime(duration)}</span>
          </span>
          <span className="min-w-0 flex-1 truncate px-1 text-xs text-ink/65">
            {!state.playing && state.by ? `Pausado por ${state.by}` : ""}
          </span>
          <div className="flex items-center gap-1.5">
            <ControlIcon
              onClick={() => setVolume((v) => ({ muted: !v.muted, volume: v.volume || 1 }))}
              label={volume.muted ? "Ativar som (só pra você)" : "Mutar (só pra você)"}
            >
              <VolumeIcon className={`size-4 ${silent ? "text-danger" : ""}`} />
            </ControlIcon>
            <input
              type="range"
              min={0}
              max={100}
              step={5}
              value={percent}
              onChange={(e) => setVolume({ volume: Number(e.target.value) / 100, muted: false })}
              className="range-accent hidden w-20 sm:block"
              style={{ "--fill": `${percent}%` } as CSSProperties}
              aria-label="Volume do vídeo (só pra você)"
            />
          </div>
          <ControlIcon onClick={onMinimize} label="Minimizar">
            <Minimize2 className="size-4" />
          </ControlIcon>
          <ControlIcon onClick={toggleFullscreen} label="Tela cheia">
            <Maximize className="size-4" />
          </ControlIcon>
        </div>
      </div>
    </div>
  );
}

/** The session as a tile on the stage while the player is minimized; the audio keeps playing. */
export function WatchTile({ party, compact, onOpen }: { party: WatchParty; compact?: boolean; onOpen: () => void }) {
  const { source, playing } = party.state;
  return (
    <div onDoubleClick={onOpen} className="group relative size-full animate-pop overflow-hidden rounded-lg bg-black">
      {source.kind === "youtube" ? (
        <img src={youTubeThumbnail(source.videoId)} alt="" className="size-full object-cover opacity-45" />
      ) : (
        <div className="size-full bg-[radial-gradient(circle_at_50%_45%,rgb(88_101_242/0.3),transparent_70%)]" />
      )}
      <div className="absolute inset-0 grid place-items-center">
        <button
          onClick={(e) => {
            e.stopPropagation();
            onOpen();
          }}
          onDoubleClick={(e) => e.stopPropagation()}
          className={`type-link-sm flex items-center gap-2 rounded-full bg-blurple text-ink shadow-float transition duration-200 ease-out-expo hover:brightness-110 active:scale-95 ${compact ? "h-8 px-3 text-xs" : "h-11 px-5"}`}
        >
          <Popcorn className={compact ? "size-3.5" : "size-4"} /> {compact ? "Abrir" : "Voltar pro vídeo"}
        </button>
      </div>
      <div className="absolute top-2 left-2 flex max-w-[calc(100%-1rem)] items-center gap-1.5 truncate rounded-sm bg-black/65 px-2.5 py-1 text-[13px] font-semibold text-ink backdrop-blur-md">
        <Popcorn className="size-3.5 shrink-0" />
        <span className="truncate">{compact ? "Assistindo junto" : watchTitle(source)}</span>
      </div>
      {!compact && (
        <div className="absolute bottom-2 left-2 flex items-center gap-1.5 rounded-sm bg-black/65 px-2.5 py-1 text-xs text-ink/85 backdrop-blur-md">
          {playing ? <Play className="size-3 fill-current" /> : <Pause className="size-3 fill-current" />}
          {playing ? "Tocando" : "Pausado"}
        </div>
      )}
    </div>
  );
}
