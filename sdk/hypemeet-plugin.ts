/**
 * HypeMeet plugin SDK: the postMessage protocol between a room and a plugin running in an iframe,
 * plus the plugin-side client. Standalone on purpose — copy this file into your plugin as is.
 *
 * A plugin is a web page on its own origin. The room server lists it (env PLUGINS = base URLs) and
 * reads its manifest at `<base>/hypemeet-plugin.json`:
 *
 *   { "id": "drawspace", "name": "Drawspace", "description": "…", "icon": "/icon.svg", "entry": "/" }
 *
 * Anyone in the room can open it; it shows as a tile for everyone and runs in the browser of each
 * person who has it open. What it gets from the room:
 *   - the room's name, who is in it and who has the plugin open (`since`: when they opened it, their clock)
 *   - messages from the same plugin in other people's browsers (`send` / "message"), on a topic of
 *     its own: it never sees or speaks on the room's other channels
 */

export const PROTOCOL = 1;

/** Reliable messages bigger than this (bytes, UTF-8) are dropped by the host, sending or receiving. */
export const MAX_MESSAGE = 8 * 1024 * 1024;
/** Lossy messages (pointers and the like) have to fit in one packet (bytes, UTF-8). */
export const MAX_LOSSY_MESSAGE = 1200;

export interface PluginPerson {
  identity: string;
  name: string;
  /** Discord avatar, when they came in through the Activity. */
  avatar?: string;
  /** When they opened this plugin (their clock, ms), or null when they don't have it open. */
  since: number | null;
}

export type HostMessage =
  | {
      type: "init";
      /** No code: the code alone gets anyone into the room. */
      room: { name: string };
      /** Our own identity. */
      self: string;
      people: PluginPerson[];
    }
  | { type: "people"; people: PluginPerson[] }
  /** `data` as another browser's plugin sent it. */
  | { type: "message"; from: string; data: string };

export type PluginMessage =
  | { type: "ready" }
  /** To everyone else with the plugin open, or just `to`. */
  | { type: "send"; data: string; to?: string[]; lossy?: boolean }
  | { type: "toast"; text: string; tone?: "info" | "error" };

/** Messages on the wire carry this tag so either side can ignore everyone else's postMessage traffic. */
export type Envelope<T> = T & { hypemeet: typeof PROTOCOL };

export function isEnvelope(data: unknown): data is Envelope<{ type: string }> {
  const d = data as { hypemeet?: unknown; type?: unknown } | null;
  return typeof d === "object" && d !== null && d.hypemeet === PROTOCOL && typeof d.type === "string";
}

// ---- Plugin side --------------------------------------------------------------------------------

type Events = {
  people: (people: PluginPerson[]) => void;
  message: (from: string, data: string) => void;
};

export interface HostConnection {
  room: { name: string };
  self: string;
  /** Latest list, updated before "people" fires. */
  people: PluginPerson[];
  send(data: string, options?: { to?: string[]; lossy?: boolean }): void;
  toast(text: string, tone?: "info" | "error"): void;
  on<E extends keyof Events>(event: E, listener: Events[E]): () => void;
}

/** Connects to the room this page is embedded in. Rejects when it isn't inside one. */
export function connectToHost(timeoutMs = 10_000): Promise<HostConnection> {
  if (window.parent === window) return Promise.reject(new Error("not inside a HypeMeet room"));
  return new Promise((resolve, reject) => {
    let hostOrigin: string | null = null;
    let conn: HostConnection | null = null;
    const listeners: { [E in keyof Events]: Set<Events[E]> } = { people: new Set(), message: new Set() };
    const post = (msg: PluginMessage, origin = hostOrigin ?? "*") =>
      window.parent.postMessage({ ...msg, hypemeet: PROTOCOL } satisfies Envelope<PluginMessage>, origin);

    const timer = setTimeout(() => reject(new Error("HypeMeet didn't answer")), timeoutMs);
    window.addEventListener("message", (event) => {
      if (event.source !== window.parent || !isEnvelope(event.data)) return;
      // The first init pins the host's origin; nothing else is trusted before or outside it.
      if (hostOrigin === null && event.data.type === "init") hostOrigin = event.origin;
      if (event.origin !== hostOrigin) return;
      const msg = event.data as unknown as HostMessage;
      switch (msg.type) {
        case "init":
          if (conn) return;
          clearTimeout(timer);
          conn = {
            room: msg.room,
            self: msg.self,
            people: msg.people,
            send: (data, options) => post({ type: "send", data, to: options?.to, lossy: options?.lossy }),
            toast: (text, tone) => post({ type: "toast", text, tone }),
            on: (event, listener) => {
              (listeners[event] as Set<typeof listener>).add(listener);
              return () => (listeners[event] as Set<typeof listener>).delete(listener);
            },
          };
          resolve(conn);
          return;
        case "people":
          if (!conn) return;
          conn.people = msg.people;
          for (const l of listeners.people) l(msg.people);
          return;
        case "message":
          for (const l of listeners.message) l(msg.from, msg.data);
          return;
      }
    });
    post({ type: "ready" }, "*");
  });
}
