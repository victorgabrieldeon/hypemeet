/**
 * The disc image's upload and the plugin's state, from the files in the data folder (/app/data/bt3/):
 *
 *   upload/disc.iso.part, upload/state.json   an upload under way ({ size, received, by, at })
 *   disc.iso                                  the whole image: the builder (plugins/bt3/builder) takes it from here
 *   retry                                     left here by "Tentar de novo"; the builder deletes it when it starts
 *   status.json                               the builder's own state, written only by it (with a heartbeat, `at`)
 *   build/                                    the compiled game, swapped in whole by the builder
 *
 * One upload at a time, in pieces, each starting exactly where the last one ended, so a dropped connection picks up
 * from the last piece taken. Someone else may take over an upload only after it went quiet.
 */
import { mkdir, open, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Pass } from "./pass";

export const MIN_ISO = 1024 ** 3;
export const MAX_ISO = 9 * 1024 ** 3;
/** The page sends 32 MiB; a little room above that. */
export const MAX_PIECE = 40 * 1024 ** 2;
/** An upload or a builder quiet for this long is taken as gone. */
export const QUIET_MS = 2 * 60_000;

interface UploadState {
  size: number;
  received: number;
  by: { id: string; name: string };
  at: number;
}

/** status.json (plugins/bt3/builder/builder.ts). */
export interface BuilderStatus {
  at: number;
  state: "idle" | "building" | "ready" | "failed";
  /** The disc.iso it worked on (its mtime), so a newer image isn't shown an older one's result. */
  iso?: number;
  step?: number;
  total?: number;
  label?: string;
  startedAt?: number;
  message?: string;
  /** It turned the image down and deleted it: another one can be sent. */
  refused?: boolean;
}

export type Status =
  | { state: "empty" }
  | { state: "uploading"; received: number; size: number; by: string; mine: boolean; stale: boolean }
  | { state: "queued" }
  | { state: "building"; step: number; total: number; label: string; elapsed: number }
  | { state: "failed"; message: string; refused: boolean }
  | { state: "ready" }
  | { state: "offline" };

export type PutResult =
  | { ok: true; received: number; done: boolean }
  | { ok: false; status: number; code: "done" | "size" | "busy" | "order"; error: string; received?: number };

async function readJsonFile<T>(path: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T;
  } catch {
    return null;
  }
}

const exists = (path: string) => stat(path).then((s) => s, () => null);

export interface DiscStoreOptions {
  now?: () => number;
  /** Accepted image sizes and the largest piece (smaller in tests). */
  min?: number;
  max?: number;
  maxPiece?: number;
}

export function createDiscStore(dir: string, { now = () => Date.now(), min = MIN_ISO, max = MAX_ISO, maxPiece = MAX_PIECE }: DiscStoreOptions = {}) {
  const paths = {
    part: join(dir, "upload", "disc.iso.part"),
    state: join(dir, "upload", "state.json"),
    iso: join(dir, "disc.iso"),
    retry: join(dir, "retry"),
    status: join(dir, "status.json"),
    build: join(dir, "build"),
  };
  // One piece at a time, whoever sends it.
  let queue: Promise<unknown> = Promise.resolve();
  const serial = <T>(fn: () => Promise<T>): Promise<T> => {
    const run = queue.then(fn, fn);
    queue = run.catch(() => undefined);
    return run;
  };

  const readUpload = () => readJsonFile<UploadState>(paths.state);

  return {
    paths,

    /** How much of the image the server has, for picking an upload up where it stopped. */
    async progress(): Promise<{ received: number; size: number | null; done: boolean }> {
      if (await exists(paths.iso)) return { received: 0, size: null, done: true };
      const up = await readUpload();
      return { received: up?.received ?? 0, size: up?.size ?? null, done: false };
    },

    put(pass: Pass, offset: number, size: number, body: Uint8Array): Promise<PutResult> {
      return serial(async () => {
        if (await exists(paths.iso)) return { ok: false, status: 409, code: "done", error: "O servidor já tem a ISO" };
        if (!Number.isSafeInteger(size) || size < min || size > max)
          return { ok: false, status: 400, code: "size", error: "Esse arquivo não parece a ISO do jogo (tamanho fora do esperado)" };
        if (body.length > maxPiece) return { ok: false, status: 413, code: "size", error: "Pedaço grande demais" };
        let up = await readUpload();
        const t = now();
        if (up && up.by.id !== pass.id && t - up.at < QUIET_MS)
          return { ok: false, status: 409, code: "busy", error: `${up.by.name} está enviando a ISO`, received: up.received };
        // Another file (or a different one picked after a reload): from the start.
        if (up && up.size !== size) {
          await rm(paths.part, { force: true });
          up = null;
        }
        const received = up?.received ?? 0;
        if (offset !== received) return { ok: false, status: 409, code: "order", error: "Fora de ordem", received };
        if (received + body.length > size || (!body.length && received < size))
          return { ok: false, status: 400, code: "order", error: "Pedaço fora do arquivo", received };
        await mkdir(join(dir, "upload"), { recursive: true });
        const file = await open(paths.part, received ? "r+" : "w");
        try {
          await file.write(body, 0, body.length, received);
          await file.truncate(received + body.length);
        } finally {
          await file.close();
        }
        const next: UploadState = { size, received: received + body.length, by: { id: pass.id, name: pass.name }, at: t };
        if (next.received < size) {
          await writeFile(paths.state, JSON.stringify(next));
          return { ok: true, received: next.received, done: false };
        }
        await rename(paths.part, paths.iso);
        await rm(join(dir, "upload"), { recursive: true, force: true });
        return { ok: true, received: next.received, done: true };
      });
    },

    /** "Tentar de novo": the builder picks it up on its next look. */
    async retry() {
      await mkdir(dir, { recursive: true });
      await writeFile(paths.retry, "");
    },

    async status(pass: Pass): Promise<Status> {
      const [iso, built, builder] = await Promise.all([
        exists(paths.iso),
        exists(join(paths.build, "index.html")),
        readJsonFile<BuilderStatus>(paths.status),
      ]);
      const t = now();
      if (iso && built) return { state: "ready" };
      if (!iso) {
        const up = await readUpload();
        if (up)
          return {
            state: "uploading",
            received: up.received,
            size: up.size,
            by: up.by.name,
            mine: up.by.id === pass.id,
            stale: t - up.at >= QUIET_MS,
          };
        if (builder?.state === "failed" && builder.refused) return { state: "failed", message: builder.message ?? "", refused: true };
        return { state: "empty" };
      }
      if (!builder || t - builder.at > QUIET_MS) return { state: "offline" };
      if (builder.iso === iso.mtimeMs) {
        if (builder.state === "building")
          return {
            state: "building",
            step: builder.step ?? 1,
            total: builder.total ?? 1,
            label: builder.label ?? "",
            elapsed: Math.max(0, t - (builder.startedAt ?? t)),
          };
        if (builder.state === "failed") return { state: "failed", message: builder.message ?? "", refused: false };
      }
      return { state: "queued" };
    },
  };
}

export type DiscStore = ReturnType<typeof createDiscStore>;
