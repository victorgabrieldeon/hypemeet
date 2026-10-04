import { RoomEvent, type RemoteParticipant, type Room } from "livekit-client";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
  type CSSProperties,
} from "react";
import { buildTiles, type TileModel } from "./model";

/** The only emojis accepted off the wire: a peer can't push arbitrary text onto everyone's screen. */
export const REACTIONS = ["🔥", "😂", "😮", "👏", "❤️", "💀", "🎉", "👀"] as const;

const TOPIC = "reaction";
/** Per tile; anything beyond is dropped so a flood can't bog down the stage. */
const MAX_VISIBLE = 30;
/** Sender-side throttle: at most COUNT reactions per WINDOW ms. */
const RATE = { count: 8, window: 2000 };

interface WireReaction {
  emoji: string;
  /** Tile id (same on every client: camera ids come from the identity, screen ids from the track sid). */
  target: string;
}

export interface FloatingReaction {
  id: number;
  emoji: string;
  name: string;
  /** Horizontal start, % of the tile width. */
  x: number;
  /** Half the side-to-side sway, px. */
  sway: number;
  duration: number;
  /** Negative delay that desyncs the sway between emojis. */
  phase: number;
}

const NONE: FloatingReaction[] = [];

/** Floating reactions per tile, read with useSyncExternalStore so a burst only re-renders its own tile. */
class ReactionStore {
  private byTile = new Map<string, FloatingReaction[]>();
  private listeners = new Set<() => void>();
  private nextId = 0;

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  get(tileId: string): FloatingReaction[] {
    return this.byTile.get(tileId) ?? NONE;
  }

  add(tileId: string, emoji: string, name: string) {
    const list = this.get(tileId);
    if (list.length >= MAX_VISIBLE) return;
    const reaction: FloatingReaction = {
      id: this.nextId++,
      emoji,
      name,
      x: 12 + Math.random() * 76,
      sway: 6 + Math.random() * 10,
      duration: 2400 + Math.random() * 900,
      phase: -Math.random() * 900,
    };
    this.set(tileId, [...list, reaction]);
    setTimeout(() => this.set(tileId, this.get(tileId).filter((r) => r !== reaction)), reaction.duration);
  }

  private set(tileId: string, list: FloatingReaction[]) {
    if (list.length) this.byTile.set(tileId, list);
    else this.byTile.delete(tileId);
    for (const listener of this.listeners) listener();
  }
}

interface Reactions {
  store: ReactionStore;
  /** Sends a reaction to everyone (us included) over the tile `target`. False when throttled. */
  send(emoji: string, target: string): boolean;
}

const ReactionsContext = createContext<Reactions | null>(null);
export const ReactionsProvider = ReactionsContext.Provider;

/** Listens for reactions in the room and returns the handle that ReactionsProvider shares with the tiles. */
export function useReactions(room: Room): Reactions {
  const store = useMemo(() => new ReactionStore(), []);

  useEffect(() => {
    const decoder = new TextDecoder();
    const onData = (payload: Uint8Array, participant?: RemoteParticipant, _kind?: unknown, topic?: string) => {
      if (topic !== TOPIC || !participant) return;
      let msg: WireReaction;
      try {
        msg = JSON.parse(decoder.decode(payload));
      } catch {
        return;
      }
      if (!(REACTIONS as readonly string[]).includes(msg.emoji) || typeof msg.target !== "string") return;
      // The tile may be gone by now (screen stopped): land on the sender's camera instead.
      const exists = buildTiles(room).some((t) => t.id === msg.target);
      const target = exists ? msg.target : `${participant.identity}:camera`;
      store.add(target, msg.emoji, participant.name || participant.identity);
    };
    room.on(RoomEvent.DataReceived, onData);
    return () => {
      room.off(RoomEvent.DataReceived, onData);
    };
  }, [room, store]);

  const sentAt = useMemo<number[]>(() => [], []);
  const send = useCallback(
    (emoji: string, target: string) => {
      const now = Date.now();
      while (sentAt.length && now - sentAt[0]! > RATE.window) sentAt.shift();
      if (sentAt.length >= RATE.count) return false;
      sentAt.push(now);
      const local = room.localParticipant;
      // Peers don't get our own data echoed back, so show it locally right away.
      store.add(target, emoji, local.name || local.identity);
      const payload = new TextEncoder().encode(JSON.stringify({ emoji, target } satisfies WireReaction));
      // Lossy: a dropped reaction doesn't matter, a late one would.
      void local.publishData(payload, { reliable: false, topic: TOPIC }).catch(() => {});
      return true;
    },
    [room, store, sentAt],
  );

  return useMemo(() => ({ store, send }), [store, send]);
}

/**
 * Where a reaction lands: the pinned tile, else someone's screen (another person's first — that's who
 * you're reacting to), else your own camera.
 */
export function reactionTarget(tiles: TileModel[], pinnedId: string | null): TileModel | undefined {
  const pinned = tiles.find((t) => t.id === pinnedId);
  if (pinned) return pinned;
  const screens = tiles.filter((t) => t.kind === "screen");
  return (
    screens.find((t) => !t.participant.isLocal) ??
    screens[0] ??
    tiles.find((t) => t.kind === "camera" && t.participant.isLocal)
  );
}

/** Emojis rising over a tile, Twitch-style. Purely visual: never takes pointer events. */
export function ReactionLayer({ tileId, compact }: { tileId: string; compact?: boolean }) {
  const reactions = useContext(ReactionsContext);
  if (!reactions) throw new Error("ReactionLayer outside ReactionsProvider");
  const { store } = reactions;
  const list = useSyncExternalStore(store.subscribe, () => store.get(tileId));
  if (!list.length) return null;
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden [container-type:size]" aria-hidden>
      {list.map((r) => (
        // w-0 + justify-center keeps the emoji centred on x% while the animations own `transform`.
        <div
          key={r.id}
          className="reaction-rise absolute bottom-[8%] flex w-0 justify-center"
          style={{ left: `${r.x}%`, animationDuration: `${r.duration}ms` }}
        >
          <div
            className="reaction-sway flex flex-col items-center gap-1"
            style={{ "--sway": `${r.sway}px`, animationDelay: `${r.phase}ms` } as CSSProperties}
          >
            <span className="text-[clamp(22px,11cqmin,52px)] leading-none drop-shadow-[0_2px_8px_rgb(0_0_0/0.5)]">
              {r.emoji}
            </span>
            {!compact && (
              <span className="max-w-28 truncate rounded-full bg-black/60 px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap text-ink backdrop-blur-md">
                {r.name}
              </span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

/** "na tela de Ana", "na sua câmera"… */
function targetLabel(tile: TileModel): string {
  const { participant } = tile;
  const name = participant.name || participant.identity;
  const what = tile.kind === "camera" ? "câmera" : tile.number ? `tela ${tile.number}` : "tela";
  return participant.isLocal ? `na sua ${what}` : `na ${what} de ${name}`;
}

/** Contents of the dock's reaction popover: where reactions will land, and the emoji row. */
export function ReactionBar({ target, onReact }: { target: TileModel; onReact: (emoji: string) => void }) {
  return (
    <>
      <p className="truncate px-1 pb-2 text-center text-xs text-soft">
        Aparece <span className="font-semibold text-ink">{targetLabel(target)}</span>
      </p>
      <div className="flex gap-0.5">
        {REACTIONS.map((emoji) => (
          <button
            key={emoji}
            onClick={() => onReact(emoji)}
            aria-label={`Reagir com ${emoji}`}
            className="grid size-9 place-items-center rounded-md text-2xl transition duration-150 ease-out-expo hover:scale-110 hover:bg-surface-hi active:scale-90 sm:size-11"
          >
            {emoji}
          </button>
        ))}
      </div>
    </>
  );
}
