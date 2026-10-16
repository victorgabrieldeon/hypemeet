import { EyeOff, FileVideo, Maximize, Minimize, Minimize2, Pause, Play, Popcorn, RotateCcw, Volume1, Volume2, VolumeX } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { buttonClass, Spinner } from "../components/ui";
import { loadDevice } from "./devices";
import { FILL_CLASS, useFullscreen } from "./fullscreen";
import { positionAt, type WatchAction, type WatchControls, type WatchParty, type WatchSource, type WatchState } from "./watch";
import { loadYouTube, YT_STATE, youTubeError, youTubeThumbnail, type YTPlayer } from "./youtube";

/** What the sync loop needs from a player, YouTube or <video>. */
interface MediaHandle {
  time(): number;
  /** 0 until known. Meaningless for a live. */
  duration(): number;
  /** Playing or trying to (buffering). */
  playing(): boolean;
  /** Loading, buffering or seeking: its position means nothing right now. */
  busy(): boolean;
  /** Settled in play or pause; only then can a jump in its position be read as the viewer seeking. */
  stable(): boolean;
  live(): boolean;
  rate(): number;
  play(): Promise<void>;
  pause(): void;
  seek(seconds: number): void;
  setRate(rate: number): void;
  setVolume(volume: number, muted: boolean): void;
  title(): string | undefined;
}

const TICK_MS = 400;
/** How far a player may drift before it's snapped back. YouTube seeks rebuffer, so it gets more slack. */
const TOLERANCE = {
  youtube: { playing: 1, paused: 0.5 },
  file: { playing: 0.4, paused: 0.25 },
  // Each viewer's live edge sits a little apart; chasing every second would rebuffer forever.
  live: { playing: 3, paused: 1 },
};
/** After a corrective seek or a local click, let the player settle before judging it again. */
const SETTLE_MS = 1500;
const HOLD_MS = 2500;
/** Our own commands come back as player events for a moment; don't mistake them for the viewer's. */
const ECHO_MS = 1500;
/** A jump this big between two settled samples, that we didn't cause, is the viewer seeking in YouTube's bar. */
const SEEK_JUMP = 2;
/** Corrective seeks that keep missing (a live edge out of reach, an ad) give up instead of looping. */
const SEEK_BURST = 3;
const SEEK_WINDOW_MS = 20_000;
/** Ticks spent "should be playing but isn't" before assuming the browser blocked autoplay. */
const STUCK_TICKS = 8;
const VOLUME_KEY = "hypemeet:watch-volume";

export const watchTitle = (source: WatchSource) =>
  source.kind === "youtube" ? (source.title ?? (source.live ? "Live do YouTube" : "Vídeo do YouTube")) : source.name;

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

/** "Pausado por Bia · 1,5×" */
function statusText(state: WatchState): string {
  const parts = [];
  if (!state.playing && state.by) parts.push(`Pausado por ${state.by}`);
  if (state.rate !== 1) parts.push(`${String(state.rate).replace(".", ",")}×`);
  return parts.join(" · ");
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
    busy: () => state() === YT_STATE.BUFFERING || state() === YT_STATE.UNSTARTED,
    stable: () => state() === YT_STATE.PLAYING || state() === YT_STATE.PAUSED,
    live: () => !!player.getVideoData()?.isLive,
    rate: () => player.getPlaybackRate() ?? 1,
    play: async () => player.playVideo(),
    pause: () => player.pauseVideo(),
    seek: (seconds) => player.seekTo(seconds, true),
    setRate: (rate) => player.setPlaybackRate(rate),
    // YouTube's own volume control is per viewer already.
    setVolume: () => undefined,
    title: () => player.getVideoData()?.title || undefined,
  };
}

function videoHandle(video: HTMLVideoElement): MediaHandle {
  const busy = () => video.seeking || video.readyState < HTMLMediaElement.HAVE_FUTURE_DATA;
  return {
    time: () => video.currentTime,
    duration: () => (Number.isFinite(video.duration) ? video.duration : 0),
    playing: () => !video.paused && !video.ended,
    busy,
    stable: () => !busy(),
    live: () => false,
    rate: () => video.playbackRate,
    play: () => video.play(),
    pause: () => video.pause(),
    seek: (seconds) => {
      video.currentTime = seconds;
    },
    setRate: (rate) => {
      video.playbackRate = rate;
    },
    setVolume: (volume, muted) => {
      video.volume = volume;
      video.muted = muted;
    },
    title: () => undefined,
  };
}

interface YouTubeMediaProps {
  videoId: string;
  /** Where to start, read once when the player is created; undefined for a live (it opens at the edge). */
  start: () => number | undefined;
  onMedia: (media: MediaHandle | null) => void;
  onError: (text: string) => void;
  onState: (state: number) => void;
  onRate: (rate: number) => void;
}

/** YouTube's own player, controls and all; what viewers do in it is picked up by useSync. */
function YouTubeMedia({ videoId, ...callbacks }: YouTubeMediaProps) {
  const box = useRef<HTMLDivElement>(null);
  const props = useRef(callbacks);
  props.current = callbacks;

  useEffect(() => {
    let player: YTPlayer | null = null;
    let cancelled = false;
    loadYouTube()
      .then((YT) => {
        if (cancelled) return;
        // The API swaps the element for its iframe: give it one React doesn't own.
        const el = document.createElement("div");
        box.current!.replaceChildren(el);
        const start = props.current.start();
        const created = new YT.Player(el, {
          videoId,
          width: "100%",
          height: "100%",
          playerVars: {
            playsinline: 1,
            rel: 0,
            iv_load_policy: 3,
            // Our button fullscreens the whole player; YouTube's needs a permission the desktop app only gives the server.
            fs: 0,
            origin: location.origin,
            ...(start && start >= 1 ? { start: Math.floor(start) } : {}),
          },
          events: {
            onReady: () => !cancelled && props.current.onMedia(youTubeHandle(created)),
            onError: (event) => !cancelled && props.current.onError(youTubeError(event.data)),
            onStateChange: (event) => !cancelled && props.current.onState(event.data),
            onPlaybackRateChange: (event) => !cancelled && props.current.onRate(event.data),
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

interface SyncOptions {
  tolerance: { playing: number; paused: number };
  /** The viewer can drive the player directly (YouTube's own controls): turn what they do into actions. */
  native: boolean;
  onUser: (action: WatchAction) => void;
}

/**
 * Keeps a player on the shared state: play/pause/speed to match, and a seek whenever it drifts past
 * the tolerance (buffering, a late join, ads). Everyone, the host included, just follows the state.
 * With native controls it also works the other way: a play, pause, seek or speed change the viewer
 * makes in the player itself, told apart from our own commands, becomes an action for everyone.
 */
function useSync(media: MediaHandle | null, state: WatchState, hostNow: () => number, options: SyncOptions) {
  const [clock, setClock] = useState({ time: 0, duration: 0, live: false });
  const [blocked, setBlocked] = useState(false);
  const live = useRef({ state, hostNow, options });
  live.current = { state, hostNow, options };
  // Skip ticks until `until`, unless a newer state (rev) arrives first.
  const settle = useRef({ until: 0, rev: -1 });
  const stuck = useRef(0);
  /** When we last told the player to do each thing, to recognise the echo. */
  const ours = useRef({ play: 0, pause: 0, seek: 0, rate: 0 });
  const seeks = useRef<{ at: number; rev: number }[]>([]);
  /** Last settled reading, to spot jumps. Null = take a fresh baseline. */
  const sample = useRef<{ time: number; at: number; playing: boolean } | null>(null);
  /** Play/pause the viewer asked for in the player, until the host's answer (a new rev) arrives. */
  const intent = useRef<{ playing: boolean; rev: number } | null>(null);

  useEffect(() => {
    sample.current = null;
  }, [media]);

  const hold = useCallback(() => {
    settle.current = { until: performance.now() + HOLD_MS, rev: live.current.state.rev };
  }, []);

  const user = useCallback(
    (action: WatchAction) => {
      hold();
      if (action.type === "play" || action.type === "pause")
        intent.current = { playing: action.type === "play", rev: live.current.state.rev };
      live.current.options.onUser(action);
    },
    [hold],
  );

  const tick = useCallback(() => {
    if (!media) return;
    const { state, hostNow, options } = live.current;
    const now = performance.now();
    const time = media.time();
    const duration = media.duration();
    const isLive = media.live();
    setClock({ time, duration, live: isLive });

    if (options.native && media.stable()) {
      const prev = sample.current;
      if (prev && now - ours.current.seek > ECHO_MS) {
        const expected = prev.time + (prev.playing ? ((now - prev.at) / 1000) * media.rate() : 0);
        if (Math.abs(time - expected) > SEEK_JUMP) user({ type: "seek", position: time });
      }
      sample.current = { time, at: now, playing: media.playing() };
    } else if (sample.current) {
      // Loading or buffering: no progress is expected until it settles again.
      sample.current = { ...sample.current, at: now, playing: false };
    }

    if (now < settle.current.until && settle.current.rev === state.rev) return;

    let target = positionAt(state, hostNow());
    if (!isLive && duration > 0) target = Math.min(target, duration);
    const shouldPlay = state.playing && !(!isLive && duration > 0 && target >= duration - 0.5);
    if (Math.abs(media.rate() - state.rate) > 0.01) {
      ours.current.rate = now;
      media.setRate(state.rate);
    }
    if (shouldPlay && !media.playing()) {
      if (++stuck.current === STUCK_TICKS) setBlocked(true);
      ours.current.play = now;
      media.play().catch((err: DOMException) => err?.name === "NotAllowedError" && setBlocked(true));
    } else {
      stuck.current = 0;
      if (media.playing()) setBlocked(false);
      // A viewer's own play passes through buffering before onPlayerState sees it: let it get there.
      if (!shouldPlay && media.playing() && !(options.native && media.busy())) {
        ours.current.pause = now;
        media.pause();
      }
    }

    // A live has no shared position until the host's player reports where it joined the stream.
    if (isLive && !(state.source.kind === "youtube" && state.source.live)) return;
    if (media.busy() || (!isLive && duration === 0)) return;
    const tolerance = isLive ? TOLERANCE.live : options.tolerance;
    if (Math.abs(time - target) <= (shouldPlay ? tolerance.playing : tolerance.paused)) return;
    seeks.current = seeks.current.filter((s) => s.rev === state.rev && now - s.at < SEEK_WINDOW_MS);
    if (seeks.current.length >= SEEK_BURST) return;
    seeks.current.push({ at: now, rev: state.rev });
    ours.current.seek = now;
    sample.current = null;
    media.seek(target);
    settle.current = { until: now + SETTLE_MS, rev: state.rev };
  }, [media, user]);

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
    hold,
    /** YouTube state changes: a play or pause we didn't ask for came from the viewer. */
    onPlayerState(playerState: number) {
      if (!media || !live.current.options.native) return;
      const now = performance.now();
      const { state } = live.current;
      const shared = intent.current?.rev === state.rev ? intent.current.playing : state.playing;
      if (playerState === YT_STATE.PLAYING) {
        setBlocked(false);
        // No position: a player that just joined a paused session (or a live, opened at its edge) isn't
        // at the shared spot yet, so resume from where it was paused. Seeks are reported on their own.
        if (!shared && now - ours.current.play > ECHO_MS && now - ours.current.seek > ECHO_MS) user({ type: "play" });
      } else if (playerState === YT_STATE.PAUSED) {
        if (shared && now - ours.current.pause > ECHO_MS) user({ type: "pause", position: media.time() });
      }
    },
    onPlayerRate(rate: number) {
      if (!media || !live.current.options.native) return;
      if (Math.abs(rate - live.current.state.rate) > 0.01 && performance.now() - ours.current.rate > ECHO_MS)
        user({ type: "rate", rate, position: media.time() });
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

function LiveBadge() {
  return (
    <span className="shrink-0 rounded-xs bg-danger px-1.5 py-0.5 text-[10px] leading-none font-bold tracking-wider text-ink">
      AO VIVO
    </span>
  );
}

function FilePicker({ label, primary, onPick }: { label: string; primary?: boolean; onPick: (file: File) => void }) {
  return (
    <label className={`${buttonClass({ variant: primary ? "primary" : "ghost" })} type-link-sm mt-1 h-11 cursor-pointer`}>
      <FileVideo className="size-4" /> {label}
      <input
        type="file"
        accept="video/*,.mkv,.mov,.avi"
        hidden
        onChange={(e) => {
          const picked = e.target.files?.[0];
          e.target.value = "";
          if (picked) onPick(picked);
        }}
      />
    </label>
  );
}

interface WatchPlayerProps {
  party: WatchParty;
  watch: WatchControls;
  /** This viewer's copy of the file, for file sources. */
  file: File | null;
  onPickFile: (file: File) => void;
  onMinimize: () => void;
  /** Stop following the session, just for this viewer. */
  onLeave: () => void;
  onError: (text: string) => void;
  className?: string;
}

/**
 * The shared player. Mounted for the whole session (hidden when minimized) so it never reloads.
 * YouTube shows its own player and controls under a slim header; a local file gets ours.
 */
export function WatchPlayer({
  party,
  watch,
  file,
  onPickFile,
  onMinimize,
  onLeave,
  onError,
  className = "",
}: WatchPlayerProps) {
  const { state } = party;
  const { source } = state;
  const isYouTube = source.kind === "youtube";
  const ref = useRef<HTMLDivElement>(null);
  const [media, setMedia] = useState<MediaHandle | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [volume, setVolume] = useState(loadVolume);
  const [scrub, setScrub] = useState<number | null>(null);
  const clickTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const send = (action: WatchAction) =>
    void watch.dispatch(action).catch(() => onError("Não deu pra controlar o vídeo agora. Tente de novo."));
  const sync = useSync(media, state, watch.hostNow, {
    tolerance: TOLERANCE[source.kind],
    native: isYouTube,
    onUser: send,
  });

  useEffect(() => {
    media?.setVolume(volume.volume, volume.muted);
    localStorage.setItem(VOLUME_KEY, JSON.stringify(volume));
  }, [media, volume]);

  // What only a loaded player knows (no API key needed). Any viewer reports it (the host may not be
  // following); the host keeps the first answer.
  const metaSent = useRef("");
  useEffect(() => {
    if (!media || source.kind !== "youtube") return;
    const title = source.title ? undefined : media.title();
    // A fresh player opens a live at the edge: that's where everyone meets.
    const goLive = sync.live && !source.live && media.stable() && media.playing();
    const key = `${title ?? ""}|${goLive}`;
    if ((!title && !goLive) || metaSent.current === key) return;
    metaSent.current = key;
    watch
      .dispatch({ type: "meta", ...(title ? { title } : {}), ...(goLive ? { live: true, position: media.time() } : {}) })
      .catch(() => {
        metaSent.current = "";
      });
  });

  const live = sync.live || (source.kind === "youtube" && !!source.live);
  const duration = sync.duration;
  const ended = !live && duration > 0 && positionAt(state, watch.hostNow()) >= duration - 0.5;
  const playing = state.playing && !ended;
  const shown = scrub ?? Math.min(sync.time, duration || sync.time);
  const status = statusText(state);

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

  const fullscreen = useFullscreen(ref);
  const toggleFullscreen = fullscreen.toggle;
  const fullscreenLabel = fullscreen.active ? "Sair da tela cheia" : "Tela cheia";
  const FullscreenIcon = fullscreen.active ? Minimize : Maximize;

  if (isYouTube) {
    return (
      <div ref={ref} className={`flex animate-pop flex-col overflow-hidden rounded-lg bg-black ${className} ${fullscreen.filling ? FILL_CLASS : ""}`}>
        <div className="flex h-11 shrink-0 items-center gap-2 border-b border-line bg-panel pr-1.5 pl-3">
          <Popcorn className="size-4 shrink-0 text-blurple-hi" />
          {live && <LiveBadge />}
          <span className="type-link-sm min-w-0 truncate">{watchTitle(source)}</span>
          <span className="min-w-0 flex-1 truncate text-xs text-soft">{status && `· ${status}`}</span>
          <button
            onClick={onLeave}
            className="type-link-sm flex h-8 shrink-0 items-center gap-1.5 rounded-sm px-2 text-soft transition hover:bg-surface-hi hover:text-ink"
            title="Fecha o vídeo só pra você; a sessão segue pros outros"
          >
            <EyeOff className="size-4" />
            <span className="hidden sm:inline">Parar de acompanhar</span>
          </button>
          <button
            onClick={onMinimize}
            aria-label="Minimizar"
            title="Minimizar"
            className="grid size-8 shrink-0 place-items-center rounded-sm text-soft transition hover:bg-surface-hi hover:text-ink"
          >
            <Minimize2 className="size-4" />
          </button>
          <button
            onClick={toggleFullscreen}
            aria-label={fullscreenLabel}
            title={fullscreenLabel}
            className="grid size-8 shrink-0 place-items-center rounded-sm text-soft transition hover:bg-surface-hi hover:text-ink"
          >
            <FullscreenIcon className="size-4" />
          </button>
        </div>
        <div className="relative min-h-0 flex-1" aria-label={`Assistindo junto: ${watchTitle(source)}`}>
          <YouTubeMedia
            videoId={source.videoId}
            start={() => (source.live ? undefined : positionAt(state, watch.hostNow()))}
            onMedia={setMedia}
            onError={setFailure}
            onState={sync.onPlayerState}
            onRate={sync.onPlayerRate}
          />
          {failure ? (
            <Overlay>
              <p className="type-link">{failure}</p>
            </Overlay>
          ) : !media ? (
            <div className="pointer-events-none absolute inset-0 grid place-items-center text-soft">
              <Spinner className="size-7" />
            </div>
          ) : (
            sync.blocked && (
              // YouTube's own play button is right there and counts as the gesture the browser wants.
              <div className="type-link-sm pointer-events-none absolute top-3 left-1/2 z-10 flex -translate-x-1/2 animate-fade-in items-center gap-2 rounded-full bg-blurple px-4 py-2 text-ink shadow-float">
                <Play className="size-4 fill-current" /> Dê play no vídeo pra entrar na sessão
              </div>
            )
          )}
        </div>
      </div>
    );
  }

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
        <FilePicker label="Escolher arquivo" primary onPick={onPickFile} />
        <button onClick={onLeave} className="type-link-sm rounded-sm px-2 py-1 text-soft transition hover:text-ink">
          Não quero assistir
        </button>
      </Overlay>
    );
  } else if (failure) {
    overlay = (
      <Overlay>
        <p className="type-link">{failure}</p>
        <FilePicker
          label="Escolher outro arquivo"
          onPick={(picked) => {
            setFailure(null);
            onPickFile(picked);
          }}
        />
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
      className={`group relative animate-pop overflow-hidden rounded-lg bg-black focus-visible:outline-offset-0 ${className} ${fullscreen.filling ? FILL_CLASS : ""}`}
    >
      {file && <FileMedia file={file} onMedia={setMedia} onError={setFailure} />}

      {/* Clicks on the video go through the shared controls. */}
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
          <span className="min-w-0 flex-1 truncate px-1 text-xs text-ink/65">{status}</span>
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
          <ControlIcon onClick={onLeave} label="Parar de acompanhar (só pra você)">
            <EyeOff className="size-4" />
          </ControlIcon>
          <ControlIcon onClick={onMinimize} label="Minimizar">
            <Minimize2 className="size-4" />
          </ControlIcon>
          <ControlIcon onClick={toggleFullscreen} label={fullscreenLabel}>
            <FullscreenIcon className="size-4" />
          </ControlIcon>
        </div>
      </div>
    </div>
  );
}

/**
 * The session as a tile on the stage: while minimized (the audio keeps playing), or, for a viewer who
 * stopped following, an offer to join.
 */
export function WatchTile({
  party,
  joined,
  compact,
  onOpen,
}: {
  party: WatchParty;
  joined: boolean;
  compact?: boolean;
  onOpen: () => void;
}) {
  const { source, playing } = party.state;
  const live = source.kind === "youtube" && source.live;
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
          <Popcorn className={compact ? "size-3.5" : "size-4"} />
          {joined ? (compact ? "Abrir" : "Voltar pro vídeo") : compact ? "Entrar" : "Assistir junto"}
        </button>
      </div>
      <div className="absolute top-2 left-2 flex max-w-[calc(100%-1rem)] items-center gap-1.5 truncate rounded-sm bg-black/65 px-2.5 py-1 text-[13px] font-semibold text-ink backdrop-blur-md">
        <Popcorn className="size-3.5 shrink-0" />
        <span className="truncate">{compact ? "Assistindo junto" : watchTitle(source)}</span>
      </div>
      {!compact && (
        <div className="absolute bottom-2 left-2 flex items-center gap-1.5 rounded-sm bg-black/65 px-2.5 py-1 text-xs text-ink/85 backdrop-blur-md">
          {live && <LiveBadge />}
          {playing ? <Play className="size-3 fill-current" /> : <Pause className="size-3 fill-current" />}
          {playing ? "Tocando" : "Pausado"}
          {!joined && <span className="text-ink/60">· você não está acompanhando</span>}
        </div>
      )}
    </div>
  );
}
