/**
 * YouTube for the Discord Activity: Discord's CSP keeps YouTube's player out of it, so the server relays
 * the video. yt-dlp finds a single-file MP4 (video and audio together, usually 360p) and the bytes come
 * through here, Range and all, so the Activity plays it in a <video> from its own origin. Lives aren't
 * relayed (they're HLS).
 */

const FORMAT = "18/b[ext=mp4][vcodec!=none][acodec!=none]";
const RESOLVE_TIMEOUT_MS = 30_000;
/** Media URLs carry their own expiry; leave a margin so a long video doesn't lose it mid-play. */
const EXPIRY_MARGIN_MS = 10 * 60_000;
const DEFAULT_TTL_MS = 60 * 60_000;
/** A video YouTube refused is refused again for a while: retrying at every Range request only gets the server rate-limited. */
const FAILURE_TTL_MS = 2 * 60_000;
const PASSED_HEADERS = ["content-type", "content-length", "content-range", "accept-ranges"];

export class RelayError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/** yt-dlp's `--print is_live --print urls` output → the media URL. */
export function parseResolved(stdout: string): string {
  const [live, url] = stdout.trim().split("\n");
  if (live === "True") throw new RelayError("Lives do YouTube não tocam no Discord", 422);
  if (!/^https?:\/\//.test(url ?? "")) throw new RelayError("O YouTube não entregou esse vídeo", 502);
  return url;
}

/** Until when a media URL can be used (its `expire` param, in seconds). */
export function usableUntil(url: string, now = Date.now()): number {
  const expire = Number(new URL(url).searchParams.get("expire"));
  return expire > 0 ? expire * 1000 - EXPIRY_MARGIN_MS : now + DEFAULT_TTL_MS;
}

export function createYouTubeRelay(bin = process.env.YTDLP_PATH || "yt-dlp", cookies = process.env.YTDLP_COOKIES || null) {
  // In-flight resolutions are shared: every viewer's first Range request arrives at once. Failures stay too.
  const cache = new Map<string, { url: Promise<string>; until: number }>();

  async function resolve(videoId: string): Promise<string> {
    let proc;
    try {
      proc = Bun.spawn(
        // yt-dlp needs a JS runtime for YouTube's challenges: deno (its default, in the Docker image), else this very Bun.
        [bin, ...(Bun.which("deno") ? [] : ["--js-runtimes", `bun:${process.execPath}`]), "--no-playlist", "--no-warnings", "-f", FORMAT,
          // YouTube asks servers to "sign in to confirm you're not a bot": a logged-in cookies.txt answers it.
          ...(cookies ? ["--cookies", cookies] : []),
          "--print", "is_live", "--print", "urls", `https://www.youtube.com/watch?v=${videoId}`],
        { stdout: "pipe", stderr: "pipe", timeout: RESOLVE_TIMEOUT_MS },
      );
    } catch {
      throw new RelayError("O servidor não tem o yt-dlp pra tocar YouTube no Discord", 503);
    }
    const [stdout, stderr, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
    if (code !== 0) {
      console.error(`yt-dlp ${videoId}: ${stderr.trim().split("\n").at(-1)}`);
      throw new RelayError("O YouTube não entregou esse vídeo", 502);
    }
    return parseResolved(stdout);
  }

  function mediaUrl(videoId: string): Promise<string> {
    const now = Date.now();
    const hit = cache.get(videoId);
    if (hit && hit.until > now) return hit.url;
    for (const [id, entry] of cache) if (entry.until <= now) cache.delete(id);
    return remember(videoId, resolve(videoId));
  }

  function remember(videoId: string, url: Promise<string>): Promise<string> {
    const entry = { url, until: Infinity };
    cache.set(videoId, entry);
    url.then(
      (found) => (entry.until = usableUntil(found)),
      () => (entry.until = Date.now() + FAILURE_TTL_MS),
    );
    return url;
  }

  return {
    async stream(videoId: string, req: Request): Promise<Response> {
      try {
        for (let attempt = 0; ; attempt++) {
          const url = await mediaUrl(videoId);
          const range = req.headers.get("range");
          // Aborted with the viewer's request: a seek drops the old range at once.
          const upstream = await fetch(url, { headers: range ? { range } : {}, signal: req.signal });
          // Expired early or bound to an old IP: find it again, once.
          if (upstream.status === 403 && attempt === 0) {
            cache.delete(videoId);
            continue;
          }
          if (!upstream.ok) {
            const err = new RelayError(`O YouTube respondeu ${upstream.status}`, 502);
            // Refused even with a fresh URL. Not other errors: a 416 is just a seek past the end.
            if (upstream.status === 403) void remember(videoId, Promise.reject(err));
            throw err;
          }
          const headers = new Headers();
          for (const name of PASSED_HEADERS) {
            const value = upstream.headers.get(name);
            if (value) headers.set(name, value);
          }
          return new Response(upstream.body, { status: upstream.status, headers });
        }
      } catch (err) {
        if (err instanceof RelayError) return Response.json({ error: err.message }, { status: err.status });
        if (req.signal.aborted) return new Response(null, { status: 499 });
        console.error(`youtube relay ${videoId}:`, err);
        return Response.json({ error: "Não deu pra trazer o vídeo do YouTube" }, { status: 502 });
      }
    },
  };
}
