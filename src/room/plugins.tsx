import { RoomEvent, type Participant, type RemoteParticipant, type Room } from "livekit-client";
import { Blocks, Maximize, Minimize, Minimize2, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  isEnvelope,
  MAX_LOSSY_MESSAGE,
  MAX_MESSAGE,
  PROTOCOL,
  type Envelope,
  type HostMessage,
  type PluginMessage,
  type PluginPerson,
} from "../../sdk/hypemeet-plugin";
import { Avatar, Spinner } from "../components/ui";
import { api, type PluginInfo, type RoomInfo } from "../lib/api";
import { inDiscord } from "../lib/discord";
import { isTransmitter, remotePeople } from "./cast";
import { FILL_CLASS, useFullscreen } from "./fullscreen";
import { discordAvatar } from "./model";
import { PLUGIN_FRAME_ALLOW, pluginSandbox, usablePlugins } from "./pluginFrame";

/**
 * Plugins (sdk/hypemeet-plugin.ts): pages on their own origin, embedded in an iframe and bridged to
 * the room by postMessage. Who has which plugin open travels in each participant's "plugins"
 * attribute ({ id: opened-at }), so a plugin's tile shows for everyone while anyone has it open and
 * there's nothing to hand over when someone leaves. What plugins send each other rides the data
 * channel on topic "plugin:<id>", which only reaches the people who have it open.
 */

const ATTRIBUTE = "plugins";
const ID = /^[a-z0-9-]{1,32}$/;
/** While the plugin list can't be had (server or plugins still booting), asking again this often. */
const LIST_RETRY_MS = 30_000;

export const pluginTileId = (id: string) => `plugin:${id}`;

/**
 * Discord's CSP only lets the Activity load its own proxy, so there a plugin goes through the URL mapping
 * `/plugins/<id>` → its host. shortcut: only plugins at their host's root; one under a path fails the check
 * in `reachable` and stays out of the Activity.
 */
const proxied = (url: string, id: string) => {
  const { pathname, search } = new URL(url);
  return `${location.origin}/plugins/${id}${pathname}${search}`;
};

/** Mapped: its manifest answers through the proxy. Unmapped, the path falls to the room's own site. */
async function reachable(info: PluginInfo): Promise<PluginInfo | null> {
  try {
    const res = await fetch(`${location.origin}/plugins/${info.id}/hypemeet-plugin.json`);
    if ((((await res.json()) as { id?: unknown }).id) !== info.id) return null;
  } catch {
    return null;
  }
  return { ...info, url: proxied(info.url, info.id), icon: info.icon && proxied(info.icon, info.id) };
}

const topicOf = (id: string) => `plugin:${id}`;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export interface PluginSession {
  info: PluginInfo;
  /** Everyone in the room, us first; `since` is null for those without it open. */
  people: PluginPerson[];
  /** We have it open. */
  open: boolean;
}

/** Plugins someone has open, and since when (their clock). Others' attributes are untrusted input. */
function openedBy(participant: Participant): Record<string, number> {
  try {
    const raw = JSON.parse(participant.attributes[ATTRIBUTE] || "{}") as Record<string, unknown>;
    return Object.fromEntries(
      Object.entries(raw).filter((e): e is [string, number] => ID.test(e[0]) && Number.isFinite(e[1])),
    );
  } catch {
    return {};
  }
}

export interface Plugins {
  /** Every plugin the server lists, whether or not anyone has it open. */
  sessions: PluginSession[];
  open: (id: string) => void;
  close: (id: string) => void;
}

/** Re-renders ride on useRoomVersion (ParticipantAttributesChanged). */
export function usePlugins(room: Room): Plugins {
  const [available, setAvailable] = useState<PluginInfo[]>([]);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let cancelled = false;
    const load = () =>
      api.plugins().then(
        async (list) => {
          list = await usablePlugins(list, location.origin, inDiscord, reachable);
          if (!cancelled) setAvailable(list);
        },
        () => {
          if (!cancelled) timer = setTimeout(load, LIST_RETRY_MS);
        },
      );
    void load();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, []);

  // Ours is read from here, not from our attribute: that only updates once the server echoes it.
  const [mine, setMine] = useState<Record<string, number>>({});
  const local = room.localParticipant;
  const value = Object.keys(mine).length ? JSON.stringify(mine) : "";
  // A full reconnect rejoins with the token's attributes, without ours: the echo going stale sends it again.
  const echoed = local.attributes[ATTRIBUTE] ?? "";
  useEffect(() => {
    // "" deletes the attribute. Fails while disconnected; the next change sends it again.
    if (echoed !== value) void local.setAttributes({ [ATTRIBUTE]: value }).catch(() => undefined);
  }, [local, value, echoed]);

  const everyone = [local, ...remotePeople(room)];
  const sessions = available.map((info) => ({
    info,
    people: everyone.map((p) => ({
      identity: p.identity,
      name: p.name || p.identity,
      avatar: discordAvatar(p),
      since: (p === local ? mine : openedBy(p))[info.id] ?? null,
    })),
    open: info.id in mine,
  }));

  const open = useCallback((id: string) => setMine((m) => (id in m ? m : { ...m, [id]: Date.now() })), []);
  const close = useCallback(
    (id: string) =>
      setMine((m) => {
        const { [id]: _closed, ...rest } = m;
        return rest;
      }),
    [],
  );
  return { sessions, open, close };
}

export const usersOf = (session: PluginSession) => session.people.filter((p) => p.since !== null);

interface PluginViewProps {
  room: Room;
  info: RoomInfo;
  /** Our room token: what a built-in plugin's pass is asked with. */
  token: string;
  session: PluginSession;
  onMinimize: () => void;
  onClose: () => void;
  onToast: (text: string, tone: "info" | "error") => void;
  className?: string;
}

/** A plugin's page and its bridge to the room. Lives outside the stage so pinning never reloads it. */
export function PluginView({ room, info, token, session, onMinimize, onClose, onToast, className = "" }: PluginViewProps) {
  const ref = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const plugin = session.info;
  const src = useFrameSrc(plugin, token);
  // Built in, or through Discord's proxy, it would share the room's origin: it runs as an opaque one instead
  // ("null"), without allow-same-origin. Posting to "*" is fine there: a built-in one is ours, and the Activity's
  // CSP only lets the frame navigate within its own proxy.
  const opaque = new URL(plugin.url).origin === location.origin;
  const origin = opaque ? "null" : new URL(plugin.url).origin;
  const target = opaque ? "*" : origin;
  const topic = topicOf(plugin.id);
  const ready = useRef(false);
  const latest = useRef({ session, onToast });
  latest.current = { session, onToast };

  const post = useCallback(
    (msg: HostMessage) =>
      frame.current?.contentWindow?.postMessage({ ...msg, hypemeet: PROTOCOL } satisfies Envelope<HostMessage>, target),
    [target],
  );

  const people = JSON.stringify(session.people);
  useEffect(() => {
    if (ready.current) post({ type: "people", people: JSON.parse(people) as PluginPerson[] });
  }, [people, post]);

  // From the same plugin in other browsers.
  useEffect(() => {
    const person = (p: Participant | undefined): p is RemoteParticipant => !!p && !p.isLocal && !isTransmitter(p);
    const onData = (payload: Uint8Array, participant?: RemoteParticipant, _kind?: unknown, t?: string) => {
      if (t === topic && person(participant) && ready.current)
        post({ type: "message", from: participant.identity, data: decoder.decode(payload) });
    };
    room.on(RoomEvent.DataReceived, onData);
    room.registerTextStreamHandler(topic, async (reader, { identity }) => {
      // LiveKit holds the stream to its declared size; our sendText always declares one.
      if (!reader.info.size || reader.info.size > MAX_MESSAGE) return;
      const data = await reader.readAll().catch(() => null);
      if (data !== null && person(room.remoteParticipants.get(identity)) && ready.current)
        post({ type: "message", from: identity, data });
    });
    return () => {
      room.off(RoomEvent.DataReceived, onData);
      room.unregisterTextStreamHandler(topic);
    };
  }, [room, topic, post]);

  // From the page. It's someone else's code: every field is checked.
  useEffect(() => {
    const local = room.localParticipant;
    const onMessage = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow || event.origin !== origin || !isEnvelope(event.data)) return;
      const msg = event.data as unknown as PluginMessage;
      switch (msg.type) {
        case "ready":
          ready.current = true;
          // Not the code: it's all it takes to join the room.
          post({ type: "init", room: { name: info.name }, self: local.identity, people: latest.current.session.people });
          return;
        case "send": {
          if (typeof msg.data !== "string") return;
          const remote = new Set(remotePeople(room).map((p) => p.identity));
          // By default only those with it open; an explicit `to` may be someone whose attribute hasn't reached us yet.
          const to = Array.isArray(msg.to)
            ? msg.to.filter((id) => typeof id === "string" && remote.has(id))
            : usersOf(latest.current.session)
                .map((p) => p.identity)
                .filter((id) => remote.has(id));
          if (!to.length) return;
          const bytes = encoder.encode(msg.data);
          if (msg.lossy) {
            if (bytes.length <= MAX_LOSSY_MESSAGE)
              void local.publishData(bytes, { reliable: false, topic, destinationIdentities: to }).catch(() => undefined);
          } else if (bytes.length <= MAX_MESSAGE) {
            void local.sendText(msg.data, { topic, destinationIdentities: to }).catch(() => undefined);
          }
          return;
        }
        case "toast":
          if (typeof msg.text === "string" && msg.text.trim())
            latest.current.onToast(msg.text.slice(0, 300), msg.tone === "error" ? "error" : "info");
          return;
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [room, info, origin, topic, post]);

  const fullscreen = useFullscreen(ref);
  const fullscreenLabel = fullscreen.active ? "Sair da tela cheia" : "Tela cheia";
  const FullscreenIcon = fullscreen.active ? Minimize : Maximize;
  const users = usersOf(session);
  const iconButton = "grid size-8 shrink-0 place-items-center rounded-sm text-soft transition hover:bg-surface-hi hover:text-ink";

  return (
    <div ref={ref} className={`flex animate-pop flex-col overflow-hidden rounded-lg bg-black ${className} ${fullscreen.filling ? FILL_CLASS : ""}`}>
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-line bg-panel pr-1.5 pl-3">
        <PluginIcon info={plugin} className="size-4" />
        <span className="type-link-sm min-w-0 truncate">{plugin.name}</span>
        <span className="min-w-0 flex-1 truncate text-xs text-soft">
          · {users.length === 1 ? "só você" : `${users.length} pessoas`}
        </span>
        <button
          onClick={onClose}
          aria-label={`Fechar ${plugin.name}`}
          title={users.length > 1 ? "Fecha só pra você; segue aberto pros outros" : "Você é o último: fechar encerra pra todos"}
          className={iconButton}
        >
          <X className="size-4" />
        </button>
        <button onClick={onMinimize} aria-label="Minimizar" title="Minimizar" className={iconButton}>
          <Minimize2 className="size-4" />
        </button>
        <button onClick={fullscreen.toggle} aria-label={fullscreenLabel} title={fullscreenLabel} className={iconButton}>
          <FullscreenIcon className="size-4" />
        </button>
      </div>
      {src.url ? (
        <iframe
          ref={frame}
          src={src.url}
          title={plugin.name}
          // Its own origin keeps it away from the room's: what it can do is what the bridge above allows.
          sandbox={pluginSandbox(opaque)}
          allow={PLUGIN_FRAME_ALLOW}
          className="min-h-0 w-full flex-1 border-0 bg-white"
        />
      ) : (
        <div className="grid min-h-0 flex-1 place-items-center bg-canvas p-4 text-center text-sm text-soft">
          {src.error ? (
            <p className="text-danger">{src.error}</p>
          ) : (
            <span className="flex items-center gap-3">
              <Spinner className="size-5" /> Abrindo…
            </span>
          )}
        </div>
      )}
    </div>
  );
}

/** The page to load: an external plugin's own; a built-in one's address with a pass, asked for first. */
function useFrameSrc(plugin: PluginInfo, token: string): { url: string | null; error: string | null } {
  const [opened, setOpened] = useState<{ url: string | null; error: string | null }>({ url: null, error: null });
  useEffect(() => {
    if (!plugin.builtin) return;
    let cancelled = false;
    setOpened({ url: null, error: null });
    api.pluginOpen(plugin.id, token).then(
      ({ url }) => !cancelled && setOpened({ url: new URL(url, location.origin).href, error: null }),
      (err: Error) => !cancelled && setOpened({ url: null, error: err.message }),
    );
    return () => {
      cancelled = true;
    };
  }, [plugin.builtin, plugin.id, token]);
  return plugin.builtin ? opened : { url: plugin.url, error: null };
}

export function PluginIcon({ info, className = "size-5" }: { info: PluginInfo; className?: string }) {
  return info.icon ? (
    <img src={info.icon} alt="" draggable={false} className={`shrink-0 object-contain ${className}`} />
  ) : (
    <Blocks className={`shrink-0 text-blurple-hi ${className}`} />
  );
}

function Faces({ people }: { people: PluginPerson[] }) {
  return (
    <span className="flex -space-x-1.5">
      {people.slice(0, 4).map((p) => (
        <Avatar key={p.identity} name={p.name} image={p.avatar} size="xs" className="ring-2 ring-black/70" />
      ))}
    </span>
  );
}

/** A plugin someone has open, on the stage: opens it here (or brings it back). */
export function PluginTile({ session, compact, onOpen }: { session: PluginSession; compact?: boolean; onOpen: () => void }) {
  const users = usersOf(session);
  return (
    <div onDoubleClick={onOpen} className="group relative size-full animate-pop overflow-hidden rounded-lg bg-black">
      <div className="size-full bg-[radial-gradient(circle_at_50%_45%,rgb(88_101_242/0.3),transparent_70%)]" />
      <div className="absolute inset-0 grid place-items-center">
        <button
          onClick={(e) => {
            e.stopPropagation();
            onOpen();
          }}
          onDoubleClick={(e) => e.stopPropagation()}
          className={`type-link-sm flex items-center gap-2 rounded-full bg-blurple text-ink shadow-float transition duration-200 ease-out-expo hover:brightness-110 active:scale-95 ${compact ? "h-8 px-3 text-xs" : "h-11 px-5"}`}
        >
          <PluginIcon info={session.info} className={compact ? "size-3.5" : "size-4"} />
          {session.open ? "Abrir" : "Entrar"}
        </button>
      </div>
      <div className="absolute top-2 left-2 flex max-w-[calc(100%-1rem)] items-center gap-1.5 truncate rounded-sm bg-black/65 px-2.5 py-1 text-[13px] font-semibold text-ink backdrop-blur-md">
        <span className="truncate">{session.info.name}</span>
      </div>
      {!compact && users.length > 0 && (
        <div className="absolute bottom-2 left-2 flex items-center gap-2 rounded-sm bg-black/65 px-2 py-1 text-xs text-ink/85 backdrop-blur-md">
          <Faces people={users} />
          {users.length === 1 ? users[0]!.name : `${users.length} pessoas`}
        </div>
      )}
    </div>
  );
}

/** Popover above the dock: every plugin the server offers, with who's in each. */
export function PluginPanel({ plugins, onOpen, onClose }: { plugins: Plugins; onOpen: (id: string) => void; onClose: (id: string) => void }) {
  return (
    <div
      role="dialog"
      aria-label="Plugins"
      className="absolute bottom-full left-1/2 z-40 mb-3 flex w-[min(23rem,calc(100vw-1.5rem))] -translate-x-1/2 animate-pop flex-col gap-3 rounded-lg bg-panel p-3 shadow-float ring-1 ring-line"
    >
      <div className="px-1 pt-1">
        <h2 className="type-link">Plugins</h2>
        <p className="mt-0.5 text-xs text-soft">Abra pra usar junto: aparece pra todo mundo da sala.</p>
      </div>
      {plugins.sessions.map((session) => {
        const users = usersOf(session);
        const { info } = session;
        return (
          <div key={info.id} className="flex items-center gap-3 rounded-md border border-line bg-surface p-3">
            <PluginIcon info={info} className="size-8" />
            <div className="min-w-0 flex-1 text-sm">
              <p className="truncate font-semibold">{info.name}</p>
              {info.description && <p className="line-clamp-2 text-xs text-soft">{info.description}</p>}
              <p className="mt-1 flex items-center gap-1.5 text-xs text-soft">
                {users.length > 0 && <Faces people={users} />}
                {users.length ? `${users.length} usando` : "Ninguém usando"}
              </p>
            </div>
            <button
              type="button"
              onClick={() => (session.open ? onClose(info.id) : onOpen(info.id))}
              className={`type-link-sm h-9 shrink-0 rounded-sm px-3 transition ${session.open ? "bg-surface-hi text-ink hover:brightness-110" : "bg-blurple text-ink hover:brightness-110"}`}
            >
              {session.open ? "Fechar" : users.length ? "Entrar" : "Abrir"}
            </button>
          </div>
        );
      })}
    </div>
  );
}
