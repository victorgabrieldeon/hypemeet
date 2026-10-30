/**
 * The game's online rooms (Dragon Net Battle), in this process's memory: a port of the fork's
 * cloudflare/src/room.js (one Durable Object per room code) speaking the same protocol as its net.js.
 *
 *   net/ws?room=CODE&role=host|join&phase=lobby|session&name=...&cid=...
 *   net/queue?name=...&cid=...                                      (Quick Match)
 *
 * Text messages are JSON and carry the setting up: who is there ({t:'peer'}), the host's start ({t:'go'}), and the
 * WebRTC offer, answer and candidates ({t:'sig'}), passed to the other player as they are. Binary messages are the
 * game's own packets, passed on when the two browsers can't reach each other directly (the relay).
 *
 * Lobby: the host opens the room; a second host with another cid is turned away (the code is taken), and one who
 * joins a room without a host is told so. Session (after both pages loaded themselves into the match): either may
 * arrive first and waits for the other.
 *
 * Sockets are abstract (send/close), so this runs without a network in tests; server/index.ts wires it to Bun's.
 */

export interface NetSocket {
  send(data: string | Uint8Array): void;
  close(code?: number, reason?: string): void;
}

type Role = "host" | "join";

export interface RoomParams {
  room: string;
  role: Role;
  phase: "lobby" | "session";
  name: string;
  cid: string;
}

export interface QueueParams {
  name: string;
  cid: string;
}

type Conn =
  | ({ kind: "room" } & RoomParams)
  | ({ kind: "queue"; t: number; matched: boolean } & QueueParams);

/** Closed by us: the same player again (4000), turned away (4001), no host (4002). No "left" for those. */
const QUIET = new Set([4000, 4001, 4002]);
const LETTERS = "ABCDEFGHJKLMNPQRSTUVWXYZ";

const nameOf = (q: URLSearchParams) => (q.get("name") || "Player").slice(0, 16);
const cidOf = (q: URLSearchParams) => (q.get("cid") || "").slice(0, 40);

/** A room connection's parameters, or null for a bad request (400 before upgrading). */
export function parseRoomParams(q: URLSearchParams): RoomParams | null {
  const room = q.get("room") || "";
  const role = q.get("role");
  if (!/^[A-Z]{4}$/.test(room) || (role !== "host" && role !== "join")) return null;
  return { room, role, phase: q.get("phase") === "session" ? "session" : "lobby", name: nameOf(q), cid: cidOf(q) };
}

export const parseQueueParams = (q: URLSearchParams): QueueParams => ({ name: nameOf(q), cid: cidOf(q) });

const send = (ws: NetSocket, data: string | Uint8Array) => {
  try {
    ws.send(data);
  } catch {
    // (already gone: its close comes next)
  }
};
const sendJson = (ws: NetSocket, msg: object) => send(ws, JSON.stringify(msg));

export class NetRooms {
  private conns = new Map<NetSocket, Conn>();
  private rooms = new Map<string, Set<NetSocket>>();

  constructor(
    private now = () => Date.now(),
    private random = Math.random,
  ) {}

  /** Live room codes (for tests and logs). */
  get size() {
    return this.rooms.size;
  }

  openRoom(ws: NetSocket, p: RoomParams) {
    const members = this.rooms.get(p.room) ?? new Set<NetSocket>();
    // The same role already here: the same player again (a reload) replaces it; anyone else is turned away.
    for (const other of [...members]) {
      const o = this.conns.get(other);
      if (o?.kind !== "room" || o.role !== p.role) continue;
      if (o.cid && o.cid === p.cid) {
        this.drop(other);
        other.close(4000, "replaced");
        continue;
      }
      sendJson(ws, { t: p.role === "host" ? "taken" : "full" });
      ws.close(4001, "taken");
      return;
    }
    const other = this.peersOf(p.room, p.role, p.phase)[0];
    if (!other && p.role === "join" && p.phase === "lobby") {
      sendJson(ws, { t: "nohost" });
      ws.close(4002, "no host");
      return;
    }
    this.conns.set(ws, { kind: "room", ...p });
    members.add(ws);
    this.rooms.set(p.room, members);
    if (other) {
      const o = this.conns.get(other) as RoomParams;
      sendJson(ws, { t: "peer", name: o.name });
      sendJson(other, { t: "peer", name: p.name });
    } else {
      sendJson(ws, { t: "wait" });
    }
  }

  /**
   * Quick Match: the players searching wait here; as soon as two are there they're paired. Each is told a new room
   * code and a side ({t:'match', room, role, vs, rules}), and both pages then load themselves into that room's
   * session exactly as after Host / Join. The ones waiting hear how many are searching ({t:'count', n}).
   */
  openQueue(ws: NetSocket, p: QueueParams) {
    // The same player again (a second tab, a reload): the older one goes.
    for (const w of this.waiting()) {
      if (p.cid && (this.conns.get(w) as QueueParams).cid === p.cid) {
        this.drop(w);
        w.close(4000, "replaced");
      }
    }
    const t = this.now();
    const others = this.waiting().sort((a, b) => this.queued(a).t - this.queued(b).t);
    this.conns.set(ws, { kind: "queue", ...p, t, matched: false });
    const first = others[0];
    if (first) {
      const o = this.queued(first);
      const room = Array.from({ length: 4 }, () => LETTERS[Math.floor(this.random() * LETTERS.length)]).join("");
      const rules = String(3 << 8); // single battle, 240 seconds: the game's own defaults
      o.matched = true;
      this.queued(ws).matched = true;
      sendJson(first, { t: "match", room, role: "host", vs: p.name, rules });
      sendJson(ws, { t: "match", room, role: "join", vs: o.name, rules });
    }
    this.count();
  }

  message(ws: NetSocket, msg: string | Uint8Array) {
    const me = this.conns.get(ws);
    if (!me) return;
    if (me.kind === "queue") {
      // (only "still here")
      if (typeof msg === "string" && msg.includes("ping")) sendJson(ws, { t: "pong" });
      return;
    }
    const to = this.peersOf(me.room, me.role, me.phase);
    if (typeof msg !== "string") {
      // the game's packets (relay)
      for (const o of to) send(o, msg);
      return;
    }
    let m: { t?: unknown; ts?: unknown };
    try {
      m = JSON.parse(msg);
    } catch {
      return;
    }
    if (m.t === "ping") sendJson(ws, { t: "pong", ts: m.ts });
    else if (m.t === "sig" || m.t === "go" || m.t === "relay" || m.t === "bye") for (const o of to) send(o, msg);
  }

  close(ws: NetSocket, code: number) {
    const me = this.conns.get(ws);
    if (!me) return; // (already let go: replaced or turned away)
    this.drop(ws);
    if (me.kind === "queue") {
      this.count();
      return;
    }
    if (QUIET.has(code)) return;
    for (const o of this.peersOf(me.room, me.role, me.phase)) sendJson(o, { t: "left" });
  }

  /** The other side's connections in a room's phase. */
  private peersOf(room: string, role: Role, phase: RoomParams["phase"]) {
    return [...(this.rooms.get(room) ?? [])].filter((ws) => {
      const c = this.conns.get(ws);
      return c?.kind === "room" && c.role !== role && c.phase === phase;
    });
  }

  private queued(ws: NetSocket) {
    return this.conns.get(ws) as Extract<Conn, { kind: "queue" }>;
  }

  private waiting() {
    return [...this.conns].filter(([, c]) => c.kind === "queue" && !c.matched).map(([ws]) => ws);
  }

  private count() {
    const w = this.waiting();
    for (const ws of w) sendJson(ws, { t: "count", n: w.length });
  }

  private drop(ws: NetSocket) {
    const c = this.conns.get(ws);
    this.conns.delete(ws);
    if (c?.kind !== "room") return;
    const members = this.rooms.get(c.room);
    members?.delete(ws);
    if (members && !members.size) this.rooms.delete(c.room);
  }
}
