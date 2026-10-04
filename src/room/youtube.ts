/** The slice of the YouTube IFrame Player API the watch party uses. */
export interface YTPlayer {
  playVideo(): void;
  pauseVideo(): void;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  getCurrentTime(): number;
  getDuration(): number;
  getPlayerState(): number;
  getPlaybackRate(): number;
  setPlaybackRate(rate: number): void;
  /** Undocumented but stable; the only way to read the title (or tell a live) without an API key. */
  getVideoData(): { title?: string; isLive?: boolean };
  destroy(): void;
}

interface YTNamespace {
  Player: new (
    element: HTMLElement,
    options: {
      videoId: string;
      width: string;
      height: string;
      playerVars: Record<string, string | number>;
      events: {
        onReady?: () => void;
        onError?: (event: { data: number }) => void;
        onStateChange?: (event: { data: number }) => void;
        onPlaybackRateChange?: (event: { data: number }) => void;
      };
    },
  ) => YTPlayer;
}

declare global {
  interface Window {
    YT?: YTNamespace;
    onYouTubeIframeAPIReady?: () => void;
  }
}

export const YT_STATE = { UNSTARTED: -1, ENDED: 0, PLAYING: 1, PAUSED: 2, BUFFERING: 3, CUED: 5 } as const;

const ERRORS: Record<number, string> = {
  2: "Link do YouTube inválido.",
  5: "O player do YouTube não conseguiu tocar esse vídeo.",
  100: "Vídeo não encontrado (removido ou privado).",
  101: "O dono do vídeo não deixa tocar fora do YouTube.",
  150: "O dono do vídeo não deixa tocar fora do YouTube.",
  153: "O YouTube recusou o player (faltou o cabeçalho Referer).",
};

export const youTubeError = (code: number) => ERRORS[code] ?? `O YouTube deu erro ${code}.`;

let api: Promise<YTNamespace> | null = null;

/** Loads https://www.youtube.com/iframe_api once per page. */
export function loadYouTube(): Promise<YTNamespace> {
  api ??= new Promise((resolve, reject) => {
    if (window.YT?.Player) return resolve(window.YT);
    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      previous?.();
      resolve(window.YT!);
    };
    const script = document.createElement("script");
    script.src = "https://www.youtube.com/iframe_api";
    script.onerror = () => {
      api = null;
      script.remove();
      reject(new Error("Não deu pra carregar o player do YouTube."));
    };
    document.head.append(script);
  });
  return api;
}

const VIDEO_ID = /^[\w-]{11}$/;

/** "90", "90s", "1m30s", "1h2m3s" → seconds. */
function parseStart(raw: string | null): number {
  if (!raw) return 0;
  if (/^\d+$/.test(raw)) return Number(raw);
  const match = raw.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/);
  return match ? Number(match[1] ?? 0) * 3600 + Number(match[2] ?? 0) * 60 + Number(match[3] ?? 0) : 0;
}

/**
 * Accepts watch, youtu.be, shorts, live, embed and music links (or a bare video id), keeping the
 * `t=` start time. Null when it isn't a YouTube video.
 */
export function parseYouTube(input: string): { videoId: string; start: number } | null {
  const text = input.trim();
  if (VIDEO_ID.test(text)) return { videoId: text, start: 0 };
  let url: URL;
  try {
    url = new URL(/^[a-z]+:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    return null;
  }
  const host = url.hostname.replace(/^(www|m|music)\./, "");
  let id: string | null | undefined = null;
  if (host === "youtu.be") id = url.pathname.split("/")[1];
  else if (host === "youtube.com" || host === "youtube-nocookie.com")
    id = url.searchParams.get("v") ?? url.pathname.match(/^\/(?:embed|shorts|live|v)\/([\w-]{11})/)?.[1];
  if (!id || !VIDEO_ID.test(id)) return null;
  return { videoId: id, start: parseStart(url.searchParams.get("t") ?? url.searchParams.get("start")) };
}

export const youTubeThumbnail = (videoId: string) => `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
