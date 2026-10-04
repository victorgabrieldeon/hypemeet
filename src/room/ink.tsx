import { RoomEvent, type RemoteParticipant, type Room } from "livekit-client";
import { createContext, useContext, useEffect, useMemo, type ReactNode } from "react";

/**
 * Ink: freehand strokes, arrows and click pings drawn over a screen tile, seen by everyone watching
 * that screen. Marks are ephemeral — they fade a few seconds after the pointer lifts, since the
 * picture underneath keeps moving — so there's no state to hand to late joiners: each mark is just
 * streamed to the room over the data channel while it's drawn.
 *
 * Points are normalised to the shared picture (0–1 on both axes, letterbox excluded), so a mark lands
 * on the same spot of the content whatever size each viewer's tile is.
 */

export type InkTool = "pen" | "arrow";

/** Strokes stay solid this long after the pointer lifts, then fade out over FADE_MS. */
export const HOLD_MS = 3500;
export const FADE_MS = 700;
export const PING_MS = 1400;
/** A stroke whose author vanished mid-draw (left, crashed) is dropped after this much silence. */
const STALE_MS = 10_000;
/** Local strokes are streamed in batches this often while drawing. */
const FLUSH_MS = 40;
/** Pen points closer than this (normalised) to the previous one are skipped. */
const MIN_STEP = 0.002;
const TOPIC = "ink";
/** Wire coordinates are integers in 0..SCALE. */
const SCALE = 10_000;

export interface Stroke {
  tool: InkTool;
  /** Flat [x0, y0, x1, y1, …], normalised. Arrows always hold exactly two points: tail and head. */
  points: number[];
  color: string;
  /** Author's name; null for our own marks. */
  name: string | null;
  /** When the pointer lifted, or null while it's still being drawn. */
  doneAt: number | null;
  touchedAt: number;
}

export interface Ping {
  x: number;
  y: number;
  color: string;
  name: string | null;
  at: number;
}

export interface ScreenInk {
  strokes: Map<string, Stroke>;
  pings: Ping[];
}

/**
 * A stroke is sent as a series of splices: `pts` replaces everything from index `from` on. Pens
 * append (from = what was already sent); arrows resend their head (from = 2).
 */
type Message =
  | { t: "stroke"; s: string; id: string; tool: InkTool; from: number; pts: number[]; done?: 1 }
  | { t: "ping"; s: string; x: number; y: number };

/** Bright enough to read on top of anything someone might share. */
const COLORS = ["#ff3b5c", "#ffb020", "#2ee59d", "#33c3ff", "#b36bff", "#ff6bd6", "#ffe14d", "#7cff4d"];

/** Each person's ink colour, the same on every screen in the room. */
export function inkColor(identity: string): string {
  let hash = 0;
  for (const ch of identity) hash = (hash * 31 + ch.codePointAt(0)!) | 0;
  return COLORS[Math.abs(hash) % COLORS.length]!;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const toWire = (v: number) => Math.round(v * SCALE);

export class InkStore {
  private screens = new Map<string, ScreenInk>();
  private listeners = new Map<string, Set<() => void>>();
  /** Our strokes still being streamed, by id; dirtyFrom = first point index not yet sent. */
  private outgoing = new Map<string, { screen: string; stroke: Stroke; dirtyFrom: number }>();
  private flushTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private room: Room) {}

  /** Our own ink colour. */
  get color(): string {
    return inkColor(this.room.localParticipant.identity);
  }

  /** Calls back whenever marks on this screen change; returns the unsubscribe. */
  subscribe(screen: string, listener: () => void): () => void {
    let set = this.listeners.get(screen);
    if (!set) this.listeners.set(screen, (set = new Set()));
    set.add(listener);
    return () => {
      set.delete(listener);
      if (set.size === 0) this.listeners.delete(screen);
    };
  }

  /** Drops expired marks and returns what's still on this screen at `now`, or null when nothing is. */
  visible(screen: string, now: number): ScreenInk | null {
    const ink = this.screens.get(screen);
    if (!ink) return null;
    for (const [key, stroke] of ink.strokes) {
      const expired =
        stroke.doneAt !== null
          ? now - stroke.doneAt > HOLD_MS + FADE_MS
          : now - stroke.touchedAt > STALE_MS && !this.outgoing.has(key);
      if (expired) ink.strokes.delete(key);
    }
    ink.pings = ink.pings.filter((ping) => now - ping.at < PING_MS);
    if (ink.strokes.size === 0 && ink.pings.length === 0) {
      this.screens.delete(screen);
      return null;
    }
    return ink;
  }

  /** Starts one of our strokes at (x, y); returns its id for extend/finish. */
  start(screen: string, tool: InkTool, x: number, y: number): string {
    const id = crypto.randomUUID().slice(0, 8);
    const now = performance.now();
    const stroke: Stroke = {
      tool,
      points: tool === "arrow" ? [x, y, x, y] : [x, y],
      color: this.color,
      name: null,
      doneAt: null,
      touchedAt: now,
    };
    this.ink(screen).strokes.set(id, stroke);
    this.outgoing.set(id, { screen, stroke, dirtyFrom: 0 });
    this.changed(screen);
    return id;
  }

  /** Pen: adds a point. Arrow: moves the head. */
  extend(id: string, x: number, y: number) {
    const out = this.outgoing.get(id);
    if (!out) return;
    const { points } = out.stroke;
    if (out.stroke.tool === "arrow") {
      points[2] = x;
      points[3] = y;
      out.dirtyFrom = Math.min(out.dirtyFrom, 2);
    } else {
      if (Math.hypot(x - points.at(-2)!, y - points.at(-1)!) < MIN_STEP) return;
      points.push(x, y);
    }
    out.stroke.touchedAt = performance.now();
    this.changed(out.screen);
  }

  finish(id: string) {
    const out = this.outgoing.get(id);
    if (!out || out.stroke.doneAt !== null) return;
    out.stroke.doneAt = performance.now();
    this.changed(out.screen);
  }

  ping(screen: string, x: number, y: number) {
    this.ink(screen).pings.push({ x, y, color: this.color, name: null, at: performance.now() });
    this.send({ t: "ping", s: screen, x: toWire(x), y: toWire(y) });
    this.notify(screen);
  }

  receive(payload: Uint8Array, participant: RemoteParticipant | undefined, topic: string | undefined) {
    if (topic !== TOPIC || !participant) return;
    let msg: Message;
    try {
      msg = JSON.parse(decoder.decode(payload)) as Message;
    } catch {
      return;
    }
    const color = inkColor(participant.identity);
    const name = participant.name || participant.identity;
    const now = performance.now();
    if (msg.t === "ping") {
      this.ink(msg.s).pings.push({ x: msg.x / SCALE, y: msg.y / SCALE, color, name, at: now });
    } else if (msg.t === "stroke") {
      const strokes = this.ink(msg.s).strokes;
      const key = `${participant.identity}/${msg.id}`;
      let stroke = strokes.get(key);
      if (!stroke) {
        stroke = { tool: msg.tool, points: [], color, name, doneAt: null, touchedAt: now };
        strokes.set(key, stroke);
      }
      stroke.points.splice(msg.from, Infinity, ...msg.pts.map((v) => v / SCALE));
      stroke.touchedAt = now;
      if (msg.done) stroke.doneAt = now;
    } else {
      return;
    }
    this.notify(msg.s);
  }

  dispose() {
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = null;
  }

  private ink(screen: string): ScreenInk {
    let ink = this.screens.get(screen);
    if (!ink) this.screens.set(screen, (ink = { strokes: new Map(), pings: [] }));
    return ink;
  }

  private notify(screen: string) {
    for (const listener of this.listeners.get(screen) ?? []) listener();
  }

  /** A local stroke changed: redraw now, stream it with the next batch. */
  private changed(screen: string) {
    this.notify(screen);
    this.flushTimer ??= setTimeout(this.flush, FLUSH_MS);
  }

  private flush = () => {
    this.flushTimer = null;
    for (const [id, out] of this.outgoing) {
      const { stroke } = out;
      const done = stroke.doneAt !== null;
      if (out.dirtyFrom < stroke.points.length || done) {
        this.send({
          t: "stroke",
          s: out.screen,
          id,
          tool: stroke.tool,
          from: out.dirtyFrom,
          pts: stroke.points.slice(out.dirtyFrom).map(toWire),
          ...(done ? { done: 1 as const } : {}),
        });
        out.dirtyFrom = stroke.points.length;
      }
      if (done) this.outgoing.delete(id);
    }
  };

  private send(msg: Message) {
    // Reliable: strokes are splices, so every batch has to land, in order.
    void this.room.localParticipant
      .publishData(encoder.encode(JSON.stringify(msg)), { reliable: true, topic: TOPIC })
      .catch(() => undefined);
  }
}

const InkContext = createContext<InkStore | null>(null);

export function InkProvider({ room, children }: { room: Room; children: ReactNode }) {
  const store = useMemo(() => new InkStore(room), [room]);
  useEffect(() => {
    const onData = (payload: Uint8Array, participant?: RemoteParticipant, _kind?: unknown, topic?: string) =>
      store.receive(payload, participant, topic);
    room.on(RoomEvent.DataReceived, onData);
    return () => {
      room.off(RoomEvent.DataReceived, onData);
      store.dispose();
    };
  }, [room, store]);
  return <InkContext.Provider value={store}>{children}</InkContext.Provider>;
}

export function useInk(): InkStore {
  const store = useContext(InkContext);
  if (!store) throw new Error("useInk outside InkProvider");
  return store;
}
