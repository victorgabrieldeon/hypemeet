import { RoomEvent, Track, type Participant, type RemoteParticipant, type Room } from "livekit-client";
import * as sfx from "./casinoAudio";
import { isViewing } from "./model";

/**
 * Mesa: whoever streams a casino opens a "table" and keeps its balance up to date; the room plays
 * around it — lucky seats, the night's jinx, rituals, a passed-around amulet, a narrator, side bets
 * paid in silly avatars, votes, pinned comments and thrown tomatoes. Nothing here moves money: the
 * balance is just a number the streamer types in.
 *
 * The table's owner is its authority: their client holds the state, applies what viewers send it
 * (prayers, ballots, bets) and broadcasts the whole table on every change; newcomers say "hello" and
 * get it back. Moments that need no agreement (tomatoes, pinned comments, the drum roll, "para!")
 * go straight to everyone. Nothing goes through our server.
 */
const TOPIC = "casino";

const RITUAL_MS = 5000;
const VOTE_MS = { stop: 20_000, avisei: 15_000 } as const;
const SUSPENSE_MAX_MS = 25_000;
const SUSPENSE_RESULT_MS = 2600;
const PIN_MS = 10_000;
export const PIN_COOLDOWN_MS = 2 * 60_000;
export const STOP_COOLDOWN_MS = 30_000;
const STOP_SHOWN_MS = 4000;
/** A loss this soon after someone called "para!" opens the "eu avisei" vote. */
const AVISEI_WINDOW_MS = 2 * 60_000;
const COSTUME_MS = 60 * 60_000;
const DISCO_MS = 4500;
const PLAQUE_MS = 4800;
const FLIGHT_MS = 2400;
/** When a thrown item hits the screen, ms after it's thrown (matches casino-fly in index.css). */
export const IMPACT_MS = 520;
/** Losses in a row that turn the stream into a soap opera, and that can make someone the night's jinx. */
export const NOVELA_STREAK = 3;
const FROZEN_STREAK = 3;
/** Losses after a lucky viewer walked away before the room is told they took the luck with them. */
const LUCK_GONE_LOSSES = 2;
export const MAX_PIN = 80;
export const MAX_QUESTION = 100;
const MAX_TEXT = 140;
const HISTORY = 60;
const MAX_OPEN_BETS = 3;
const MAX_SETTLED_BETS = 3;
const MAX_STOPS = 4;
/** Hype halves every this many ms without new excitement. */
const HYPE_HALF_LIFE = 10_000;
/** Second hello after joining, and the delay before owners push their table to a newcomer. */
const HELLO_RETRY_MS = 2000;
const SAVE_KEY = "hypemeet:casino:";
const SAVE_MAX_AGE = 6 * 60 * 60_000;
const COSTUME_ATTRIBUTE = "costume";
const COSTUME_KEY = "hypemeet:costume";

export const AMULETS = [
  { emoji: "🧿", name: "olho grego" },
  { emoji: "🐈‍⬛", name: "gato da sorte" },
  { emoji: "🪬", name: "hamsá" },
  { emoji: "🐘", name: "elefante da sorte" },
] as const;

/** What losers of a side bet turn into for an hour; the only avatars accepted off the wire. */
export const COSTUMES = ["🤡", "🐔", "🥔", "🐸", "🦆", "🐷"] as const;

export type Throwable = "tomato" | "rose";
export const THROWABLES: Record<Throwable, { emoji: string; label: string }> = {
  tomato: { emoji: "🍅", label: "Tomate" },
  rose: { emoji: "🌹", label: "Flor" },
};

export type Side = "yes" | "no";

/** Side bet: losers wear `costume` for an hour. */
export interface Bet {
  id: string;
  by: string;
  question: string;
  costume: string;
  picks: Record<string, Side>;
  result: Side | null;
  losers: string[];
}

export interface Vote {
  id: string;
  /** stop: the goal or limit was hit, "do they quit?"; avisei: someone called it, do they get the point? */
  kind: "stop" | "avisei";
  question: string;
  options: string[];
  /** Owner's clock; see localTime. */
  endsAt: number;
  ballots: Record<string, number>;
  /** Who the vote is about; they don't get a ballot. */
  subjects: string[];
}

export type MomentKind = "win" | "loss" | "goal" | "limit" | "note";

/** The latest thing that happened at the table: what the narrator says, and what plays on everyone's screen. */
export interface Moment {
  id: string;
  kind: MomentKind;
  text: string;
  /** Smaller lines under the narrator's: who's lucky now, where the amulet went… */
  notes: string[];
  delta: number;
  big: boolean;
}

export interface Session {
  id: string;
  owner: string;
  ownerName: string;
  /** Starting bankroll. */
  start: number;
  balance: number;
  /** A win or loss at least this large is "big". */
  big: number;
  /** Take-profit and stop-loss balances; crossing one sounds the alarm. */
  goal: number | null;
  limit: number | null;
  peak: number;
  history: number[];
  /** > 0: wins in a row; < 0: losses in a row. */
  streak: number;
  /** Longest losing run of the night. */
  worstStreak: number;
  /** 🍀 Watching at the last win. */
  lucky: string[];
  /** 🧊 Watching through the night's worst losing run, until the next win. */
  frozen: string[];
  amulet: { emoji: string; name: string; holder: string | null };
  /** "Eu avisei" points. */
  avisei: Record<string, number>;
  /** Names of everyone referenced above, so they still read right after someone leaves. */
  names: Record<string, string>;
  /** Casino soundtrack on for the room. */
  music: boolean;
  ritual: { id: string; endsAt: number; prayers: string[] } | null;
  /** How many prayed in the last ritual; shown until the next result. */
  prayed: number | null;
  vote: Vote | null;
  bets: Bet[];
  moment: Moment | null;
}

type Message =
  | { t: "hello" }
  | { t: "state"; s: Session; now: number; sync?: 1 }
  | { t: "end"; id: string }
  | { t: "pray"; ritual: string }
  | { t: "ballot"; vote: string; option: number }
  | { t: "bet"; question: string; costume: string }
  | { t: "pick"; bet: string; side: Side }
  | { t: "settle"; bet: string; result: Side | null }
  | { t: "stop"; owner: string }
  | { t: "suspense"; owner: string; on: boolean; result?: "paid" | "nope" }
  | { t: "pin"; owner: string; text: string }
  | { t: "throw"; tile: string; item: Throwable; x: number; y: number };

/** Messages only the table's owner acts on. */
type ToOwner = Extract<Message, { t: "pray" | "ballot" | "bet" | "pick" | "settle" }>;

export interface OwnerFx {
  caption: { id: string; text: string; notes: string[]; kind: MomentKind } | null;
  plaque: { id: string; amount: number } | null;
  /** Colour snapping back after a soap opera, or a big win's flash. */
  flash: { id: string } | null;
  /** "Vai pagar…": result null while the drum rolls. */
  suspense: { by: string; result: "paid" | "nope" | null } | null;
  pin: { id: string; text: string; name: string } | null;
  stops: { id: string; name: string }[];
}

export interface Flight {
  id: string;
  item: Throwable;
  /** Target, 0–1 of the tile. */
  x: number;
  y: number;
  /** Where it's thrown from along the bottom edge, 0–1. */
  fromX: number;
  name: string;
}

const NO_FX: OwnerFx = { caption: null, plaque: null, flash: null, suspense: null, pin: null, stops: [] };
const NO_FLIGHTS: Flight[] = [];

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const uid = () => crypto.randomUUID().slice(0, 8);
const nameOf = (p: Participant) => p.name || p.identity;
const pick = <T>(list: readonly T[]): T => list[Math.floor(Math.random() * list.length)]!;
const listFormat = new Intl.ListFormat("pt-BR");
const round2 = (v: number) => Math.round(v * 100) / 100;

const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
export const money = (v: number) => brl.format(v).replace(/,00$/, "");
/** "+R$ 30" / "−R$ 30" */
export const signedMoney = (v: number) => `${v < 0 ? "−" : "+"}${money(Math.abs(v))}`;

/**
 * Reads what the streamer typed: "1.250,50" or "1250.5" is the new balance, "+150" / "-80" a change.
 * Null when it isn't a number.
 */
export function parseAmount(text: string): { value: number; relative: boolean } | null {
  let t = text.replace(/r\$|\s/gi, "").replace("−", "-");
  const sign = t[0] === "+" || t[0] === "-" ? t[0] : null;
  if (sign) t = t.slice(1);
  if (!/^[\d.,]+$/.test(t)) return null;
  if (t.includes(",")) t = t.replace(/\./g, "").replace(",", ".");
  // pt-BR thousands: "1.250" or "12.500.000".
  else if (/^\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, "");
  const value = Number(t);
  if (!Number.isFinite(value)) return null;
  return { value: sign === "-" ? -value : value, relative: sign !== null };
}

/** What the narrator says about a balance change. */
function narrate(s: Session, prev: number, next: number, streak: number, big: boolean): string {
  const amount = money(Math.abs(next - prev));
  if (next > prev) {
    if (prev < s.start && next >= s.start) return pick(["🔄 VIRADA HISTÓRICA! Voltou pro lucro", "🔄 Saiu do buraco, tá no lucro de novo"]);
    if (big && next > s.peak) return pick([`🚀 RECORDE DA NOITE: ${money(next)}`, `🚀 Nunca esteve tão alto: ${money(next)}`]);
    if (big) return pick([`💰 PAGOU! +${amount}`, `💰 CHUVA DE DINHEIRO: +${amount}`, `🤑 ESTOUROU: +${amount}`]);
    if (streak >= 3) return pick([`🔥 ${streak} seguidas, tá on fire`, `🔥 ${streak} vitórias em sequência, ninguém segura`]);
    if (prev <= s.start * 0.25) return `🧗 Respirou: +${amount}`;
    return pick([`Pingou +${amount}`, `+${amount} pra conta`, `Veio um troco: +${amount}`]);
  }
  if (next <= 0) return "🪦 Zerou a banca";
  if (prev >= s.start && next < s.start) return pick(["📉 Entrou no prejuízo", "📉 Acabou o lucro da noite"]);
  if (big) return pick([`⚰️ Perdeu ${amount} de uma vez`, `💸 Foram-se ${amount}`]);
  if (next <= s.start * 0.1) return `🆘 Respira… só sobrou ${money(next)}`;
  if (streak <= -NOVELA_STREAK)
    return pick(["📉 O saldo está em queda livre", `📉 ${-streak} perdas seguidas`, "🎻 Começou a novela"]);
  return pick([`Mais uma pro cassino (−${amount})`, `−${amount}, segue o jogo`, `Escorregou ${amount}`]);
}

// --- reading the wire: a peer can send anything, so every field is checked and capped ---

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const numOrNull = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const ids = (v: unknown, max = 50) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(0, max).map((x) => x.slice(0, 80)) : []);

function record<T>(v: unknown, read: (x: unknown) => T | undefined, max = 100): Record<string, T> {
  const out: Record<string, T> = {};
  if (!isObj(v)) return out;
  for (const [key, value] of Object.entries(v).slice(0, max)) {
    const parsed = read(value);
    if (parsed !== undefined) out[key.slice(0, 80)] = parsed;
  }
  return out;
}

const readSide = (v: unknown): Side | undefined => (v === "yes" || v === "no" ? v : undefined);
const MOMENT_KINDS: MomentKind[] = ["win", "loss", "goal", "limit", "note"];

function readSession(v: unknown, owner: string, ownerName: string): Session | null {
  if (!isObj(v) || typeof v.id !== "string") return null;
  const amulet = isObj(v.amulet) ? v.amulet : {};
  const known = AMULETS.find((a) => a.emoji === amulet.emoji) ?? AMULETS[0];
  const ritual = isObj(v.ritual) ? v.ritual : null;
  const vote = isObj(v.vote) ? v.vote : null;
  const moment = isObj(v.moment) ? v.moment : null;
  return {
    id: v.id.slice(0, 16),
    owner,
    ownerName,
    start: num(v.start),
    balance: num(v.balance),
    big: num(v.big),
    goal: numOrNull(v.goal),
    limit: numOrNull(v.limit),
    peak: num(v.peak),
    history: Array.isArray(v.history) ? v.history.slice(-HISTORY).map(num) : [],
    streak: num(v.streak),
    worstStreak: num(v.worstStreak),
    lucky: ids(v.lucky),
    frozen: ids(v.frozen),
    amulet: { emoji: known.emoji, name: known.name, holder: typeof amulet.holder === "string" ? amulet.holder.slice(0, 80) : null },
    avisei: record(v.avisei, (x) => (typeof x === "number" && Number.isFinite(x) ? x : undefined)),
    names: record(v.names, (x) => (typeof x === "string" ? x.slice(0, 40) : undefined), 200),
    music: v.music === true,
    ritual: ritual && typeof ritual.id === "string" ? { id: ritual.id.slice(0, 16), endsAt: num(ritual.endsAt), prayers: ids(ritual.prayers, 100) } : null,
    prayed: numOrNull(v.prayed),
    vote:
      vote && typeof vote.id === "string" && (vote.kind === "stop" || vote.kind === "avisei")
        ? {
          id: vote.id.slice(0, 16),
          kind: vote.kind,
          question: str(vote.question, MAX_TEXT),
          options: ids(vote.options, 4).map((o) => o.slice(0, 30)),
          endsAt: num(vote.endsAt),
          ballots: record(vote.ballots, (x) => (typeof x === "number" ? x : undefined)),
          subjects: ids(vote.subjects),
        }
        : null,
    bets: Array.isArray(v.bets)
      ? v.bets
        .filter(isObj)
        .slice(0, MAX_OPEN_BETS + MAX_SETTLED_BETS)
        .filter((b) => typeof b.id === "string" && (COSTUMES as readonly unknown[]).includes(b.costume))
        .map((b) => ({
          id: (b.id as string).slice(0, 16),
          by: str(b.by, 80),
          question: str(b.question, MAX_QUESTION),
          costume: b.costume as string,
          picks: record(b.picks, readSide),
          result: readSide(b.result) ?? null,
          losers: ids(b.losers, 100),
        }))
      : [],
    moment:
      moment && typeof moment.id === "string" && MOMENT_KINDS.includes(moment.kind as MomentKind)
        ? {
          id: moment.id.slice(0, 16),
          kind: moment.kind as MomentKind,
          text: str(moment.text, MAX_TEXT),
          notes: ids(moment.notes, 4).map((n) => n.slice(0, MAX_TEXT)),
          delta: num(moment.delta),
          big: moment.big === true,
        }
        : null,
  };
}

/** Keeps `names` to the people the table still mentions, so it doesn't grow all night. */
function pruneNames(s: Session): Session {
  const used = new Set([
    ...s.lucky,
    ...s.frozen,
    ...(s.amulet.holder ? [s.amulet.holder] : []),
    ...Object.keys(s.avisei),
    ...(s.ritual?.prayers ?? []),
    ...(s.vote ? [...s.vote.subjects, ...Object.keys(s.vote.ballots)] : []),
    ...s.bets.flatMap((b) => [b.by, ...Object.keys(b.picks)]),
  ]);
  const names: Record<string, string> = {};
  for (const id of used) if (s.names[id]) names[id] = s.names[id];
  return { ...s, names };
}

// --- costumes: a participant attribute each loser sets on themselves ---

/** The silly avatar someone is wearing after losing a side bet, or null. */
export function costumeOf(participant: Participant): string | null {
  const [emoji, until] = (participant.attributes[COSTUME_ATTRIBUTE] ?? "").split("|");
  if (!emoji || !(COSTUMES as readonly string[]).includes(emoji) || !(Number(until) > Date.now())) return null;
  return emoji;
}

/** Tile that carries a person's table: their first screen, else their camera. */
export function primaryTileId(participant: Participant): string {
  const screens = [...participant.trackPublications.values()]
    .filter((p) => p.source === Track.Source.ScreenShare)
    .sort((a, b) => a.trackName.localeCompare(b.trackName));
  return screens[0]?.trackSid ?? `${participant.identity}:camera`;
}

interface Remote {
  session: Session;
  /** Our clock minus the owner's: their deadlines + skew = ours. */
  skew: number;
}

export class CasinoStore {
  private mine: Session | null = null;
  private remote = new Map<string, Remote>();
  private fx = new Map<string, OwnerFx>();
  private flights = new Map<string, Flight[]>();
  private hypeBy = new Map<string, { value: number; at: number }>();
  private discoUntil = 0;
  private draggingItem: Throwable | null = null;
  private listeners = new Set<() => void>();
  private version = 0;
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  private drumrolls = new Map<string, () => void>();

  // Owner-only bookkeeping that never leaves this client.
  /** Lucky viewers who stopped watching → losses seen since. */
  private departed = new Map<string, number>();
  /** Who watched every loss of the current losing run. */
  private streakWatchers: Set<string> | null = null;
  private stopCalls: { identity: string; name: string; at: number }[] = [];
  private ritualPending = false;
  private broadcastTimer: ReturnType<typeof setTimeout> | null = null;

  // Sender-side cooldowns and receiver-side limits.
  private lastPinAt = 0;
  private lastStopAt = 0;
  private sentThrows: number[] = [];
  private pinsFrom = new Map<string, number>();
  private stopsFrom = new Map<string, number>();
  private throwsFrom = new Map<string, number[]>();
  private appliedBets = new Set<string>();

  constructor(private room: Room) {}

  // --- lifecycle ---

  start() {
    this.room
      .on(RoomEvent.DataReceived, this.onData)
      .on(RoomEvent.ParticipantConnected, this.onParticipantJoined)
      .on(RoomEvent.ParticipantDisconnected, this.onParticipantLeft)
      .on(RoomEvent.Reconnected, this.hello);
    if (!this.mine) this.restore();
    this.restoreCostume();
    // A hello sent right after joining can reach owners before they know we exist (and get dropped),
    // so it goes out twice; owners also push their table to whoever joins.
    this.hello();
    this.setTimer("hello", HELLO_RETRY_MS, () => {
      this.hello();
      // Same for a table restored after a reload: the room may not have known us at first.
      if (this.mine) this.broadcast();
    });
    if (this.mine) this.broadcast();
  }

  dispose() {
    this.room
      .off(RoomEvent.DataReceived, this.onData)
      .off(RoomEvent.ParticipantConnected, this.onParticipantJoined)
      .off(RoomEvent.ParticipantDisconnected, this.onParticipantLeft)
      .off(RoomEvent.Reconnected, this.hello);
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    if (this.broadcastTimer) clearTimeout(this.broadcastTimer);
    this.broadcastTimer = null;
    for (const stop of this.drumrolls.values()) stop();
    this.drumrolls.clear();
  }

  // --- reading, for React ---

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  };

  getVersion = () => this.version;

  get me(): string {
    return this.room.localParticipant.identity;
  }

  get myTable(): Session | null {
    return this.mine;
  }

  /** Every open table, ours first. */
  tables(): Session[] {
    return [...(this.mine ? [this.mine] : []), ...[...this.remote.values()].map((r) => r.session)];
  }

  table(owner: string): Session | null {
    return owner === this.me ? this.mine : (this.remote.get(owner)?.session ?? null);
  }

  /** An owner-clock time (ritual and vote deadlines) on our clock. */
  localTime(owner: string, t: number): number {
    return t + (owner === this.me ? 0 : (this.remote.get(owner)?.skew ?? 0));
  }

  fxOf(owner: string): OwnerFx {
    return this.fx.get(owner) ?? NO_FX;
  }

  flightsOn(tileId: string): Flight[] {
    return this.flights.get(tileId) ?? NO_FLIGHTS;
  }

  get disco(): boolean {
    return Date.now() < this.discoUntil;
  }

  get dragging(): Throwable | null {
    return this.draggingItem;
  }

  setDragging(item: Throwable | null) {
    this.draggingItem = item;
    this.notify();
  }

  /** 0–1, decaying: how worked up the room is about this table. */
  hype(owner: string): number {
    const h = this.hypeBy.get(owner);
    if (!h) return 0;
    return h.value * 0.5 ** ((Date.now() - h.at) / HYPE_HALF_LIFE);
  }

  pinCooldown(): number {
    return Math.max(0, this.lastPinAt + PIN_COOLDOWN_MS - Date.now());
  }

  stopCooldown(): number {
    return Math.max(0, this.lastStopAt + STOP_COOLDOWN_MS - Date.now());
  }

  /** Whose table a tile belongs to, if any. */
  ownerOfTile(tileId: string): string | null {
    const owner = tileId.endsWith(":camera")
      ? tileId.slice(0, -":camera".length)
      : [this.room.localParticipant, ...this.room.remoteParticipants.values()].find((p) => p.trackPublications.has(tileId))
        ?.identity;
    return owner && this.table(owner) ? owner : null;
  }

  /** The tile a table plays on (and where tomatoes thrown from the panel land). */
  primaryTileOf(owner: string): string | null {
    const participant =
      owner === this.me ? this.room.localParticipant : [...this.room.remoteParticipants.values()].find((p) => p.identity === owner);
    return participant ? primaryTileId(participant) : null;
  }

  /** Whether we're receiving any of this person's screens. */
  watchingScreenOf(owner: string): boolean {
    const participant = [...this.room.remoteParticipants.values()].find((p) => p.identity === owner);
    return !!participant && [...participant.trackPublications.values()].some((p) => p.source === Track.Source.ScreenShare && p.isDesired);
  }

  /** Someone reacted on a tile: the table's hype goes up. */
  onReaction = (tileId: string) => {
    const owner = this.ownerOfTile(tileId);
    if (owner) this.bump(owner, 0.05);
  };

  // --- the owner's controls ---

  open(opts: { start: number; big: number; goal: number | null; limit: number | null }) {
    const local = this.room.localParticipant;
    const amulet = pick(AMULETS);
    this.departed.clear();
    this.streakWatchers = null;
    this.stopCalls = [];
    this.ritualPending = false;
    this.update(() => ({
      id: uid(),
      owner: local.identity,
      ownerName: nameOf(local),
      start: opts.start,
      balance: opts.start,
      big: opts.big,
      goal: opts.goal,
      limit: opts.limit,
      peak: opts.start,
      history: [opts.start],
      streak: 0,
      worstStreak: 0,
      lucky: [],
      frozen: [],
      amulet: { emoji: amulet.emoji, name: amulet.name, holder: null },
      avisei: {},
      names: {},
      music: false,
      ritual: null,
      prayed: null,
      vote: null,
      bets: [],
      moment: {
        id: uid(),
        kind: "note",
        text: `🎰 ${nameOf(local)} abriu a mesa com ${money(opts.start)}`,
        notes: [`${amulet.emoji} O ${amulet.name} da mesa está esperando a primeira vitória`],
        delta: 0,
        big: false,
      },
    }));
  }

  close() {
    const s = this.mine;
    if (!s) return;
    this.mine = null;
    for (const key of [...this.timers.keys()]) if (key.startsWith("own:")) this.clearTimer(key);
    sessionStorage.removeItem(this.saveKey);
    this.send({ t: "end", id: s.id });
    this.endSuspense(s.owner, null);
    this.fx.delete(s.owner);
    this.notify();
  }

  setTargets(goal: number | null, limit: number | null, big: number) {
    if (!this.mine) return;
    this.update((s) => ({ ...s, goal, limit, big }));
  }

  setMusic(on: boolean) {
    if (!this.mine) return;
    this.update((s) => ({ ...s, music: on }));
  }

  /** The streamer typed a new balance (or a change): everything that reacts to wins and losses runs from here. */
  setBalance(input: { value: number; relative: boolean }) {
    const s = this.mine;
    if (!s) return;
    const next = round2(input.relative ? s.balance + input.value : input.value);
    const prev = s.balance;
    const delta = round2(next - prev);
    if (!Number.isFinite(next) || delta === 0) return;
    const win = delta > 0;
    const watchers = this.watchers();
    const watching = watchers.map((p) => p.identity);
    const names = { ...s.names };
    for (const p of watchers) names[p.identity] = nameOf(p);
    const who = (id: string) => names[id] ?? "alguém";
    const notes: string[] = [];
    let { streak, worstStreak, lucky, frozen, amulet } = s;
    let vote = s.vote;

    if (win) {
      streak = streak > 0 ? streak + 1 : 1;
      lucky = watching;
      if (lucky.length) notes.push(`🍀 Cadeira da sorte: ${listFormat.format(lucky.map(who))}`);
      if (frozen.length) notes.push(`🧊 O gelo quebrou: ${listFormat.format(frozen.map(who))} ${frozen.length > 1 ? "estão" : "está"} perdoado${frozen.length > 1 ? "s" : ""}`);
      frozen = [];
      this.departed.clear();
      this.streakWatchers = null;
      this.stopCalls = [];
      const heirs = watching.filter((id) => id !== amulet.holder);
      if (heirs.length) {
        amulet = { ...amulet, holder: pick(heirs) };
        notes.push(`${amulet.emoji} O ${amulet.name} passou pra ${who(amulet.holder!)}`);
      }
    } else {
      streak = streak < 0 ? streak - 1 : -1;
      this.streakWatchers =
        streak === -1 || !this.streakWatchers
          ? new Set(watching)
          : new Set(watching.filter((id) => this.streakWatchers!.has(id)));
      const run = -streak;
      if (run >= FROZEN_STREAK && run >= worstStreak) {
        worstStreak = run;
        const jinxed = [...this.streakWatchers];
        if (jinxed.length && jinxed.join() !== frozen.join())
          notes.push(`🧊 Pé-frio da noite: ${listFormat.format(jinxed.map(who))}`);
        frozen = jinxed;
      }
      for (const id of lucky) {
        if (watching.includes(id)) {
          this.departed.delete(id);
          continue;
        }
        const losses = (this.departed.get(id) ?? 0) + 1;
        this.departed.set(id, losses);
        if (losses === LUCK_GONE_LOSSES) notes.push(`🍀 ${who(id)} levou a sorte embora`);
      }
    }
    if (this.ritualPending) {
      notes.unshift(win ? "🙏 A reza funcionou" : "🙏 A reza não colou");
      this.ritualPending = false;
    }

    const big = Math.abs(delta) >= s.big;
    let kind: MomentKind = win ? "win" : "loss";
    let text = narrate(s, prev, next, streak, big);
    if (s.goal !== null && prev < s.goal && next >= s.goal) {
      kind = "goal";
      text = `🎯 META BATIDA: ${money(next)}`;
      vote = this.newVote("stop", "META BATIDA, VAI SAIR?", ["Sai", "Continua"], []);
    } else if (s.limit !== null && prev > s.limit && next <= s.limit) {
      kind = "limit";
      text = `🚨 LIMITE ATINGIDO: ${money(next)}`;
      vote = this.newVote("stop", "BATEU O LIMITE, VAI SAIR?", ["Sai", "Continua"], []);
    } else if (!win && !vote) {
      const now = Date.now();
      const callers = this.stopCalls.filter((c) => now - c.at < AVISEI_WINDOW_MS);
      const subjects = [...new Set(callers.map((c) => c.identity))];
      for (const c of callers) names[c.identity] = c.name;
      if (subjects.length) {
        const list = listFormat.format(subjects.map(who));
        const verb = subjects.length > 1 ? "mandaram" : "mandou";
        vote = this.newVote("avisei", `${list} ${verb} parar e veio a perda. Vale ponto de "eu avisei"?`, ["Vale", "Não vale"], subjects);
      }
    }
    if (!win) this.stopCalls = [];

    this.update((current) => ({
      ...current,
      balance: next,
      peak: Math.max(current.peak, next),
      history: [...current.history, next].slice(-HISTORY),
      streak,
      worstStreak,
      lucky,
      frozen,
      amulet,
      names,
      prayed: null,
      vote,
      moment: { id: uid(), kind, text, notes: notes.slice(0, 4), delta, big },
    }));
  }

  startRitual() {
    const s = this.mine;
    if (!s || s.ritual) return;
    const ritual = { id: uid(), endsAt: Date.now() + RITUAL_MS, prayers: [] };
    this.update((current) => ({ ...current, ritual }));
    this.setTimer("own:ritual", RITUAL_MS, () => {
      const current = this.mine;
      if (current?.ritual?.id !== ritual.id) return;
      const count = current.ritual.prayers.length;
      this.ritualPending = count > 0;
      this.update((c) => ({
        ...c,
        ritual: null,
        prayed: count,
        moment: {
          id: uid(),
          kind: "note",
          text: count ? `🙏 ${count} ${count > 1 ? "rezaram" : "rezou"}` : "😶 Ninguém rezou",
          notes: [],
          delta: 0,
          big: false,
        },
      }));
    });
  }

  // --- what anyone at a table can do ---

  pray(owner: string) {
    const s = this.table(owner);
    if (s?.ritual) this.toOwner(owner, { t: "pray", ritual: s.ritual.id });
  }

  ballot(owner: string, option: number) {
    const s = this.table(owner);
    if (s?.vote) this.toOwner(owner, { t: "ballot", vote: s.vote.id, option });
  }

  proposeBet(owner: string, question: string, costume: string) {
    this.toOwner(owner, { t: "bet", question: question.trim().slice(0, MAX_QUESTION), costume });
  }

  pickSide(owner: string, bet: string, side: Side) {
    this.toOwner(owner, { t: "pick", bet, side });
  }

  settleBet(owner: string, bet: string, result: Side | null) {
    this.toOwner(owner, { t: "settle", bet, result });
  }

  /** "Para!": false while on cooldown. */
  callStop(owner: string): boolean {
    if (this.stopCooldown() > 0 || owner === this.me) return false;
    this.lastStopAt = Date.now();
    this.send({ t: "stop", owner });
    this.onStop(owner, this.room.localParticipant);
    return true;
  }

  /** "Vai pagar…": starts the drum roll for everyone. */
  suspend(owner: string) {
    if (this.fxOf(owner).suspense) return;
    this.send({ t: "suspense", owner, on: true });
    this.startSuspense(owner, "você");
  }

  /** Someone called the result of the drum roll. */
  callResult(owner: string, result: "paid" | "nope") {
    if (this.fxOf(owner).suspense?.result !== null) return;
    this.send({ t: "suspense", owner, on: false, result });
    this.endSuspense(owner, result);
  }

  /** Pins a comment over the table for a few seconds; false while on cooldown. */
  pin(owner: string, text: string): boolean {
    const clean = text.trim().slice(0, MAX_PIN);
    if (!clean || this.pinCooldown() > 0) return false;
    this.lastPinAt = Date.now();
    this.send({ t: "pin", owner, text: clean });
    this.showPin(owner, clean, "você");
    return true;
  }

  /** Throws a tomato or a rose at a tile, landing at (x, y) of it (0–1). False when throwing too fast. */
  throwAt(tileId: string, item: Throwable, x: number, y: number): boolean {
    const now = Date.now();
    this.sentThrows = this.sentThrows.filter((t) => now - t < 4000);
    if (this.sentThrows.length >= 5) return false;
    this.sentThrows.push(now);
    this.send({ t: "throw", tile: tileId, item, x, y });
    this.land(tileId, item, x, y, "você");
    return true;
  }

  // --- internals: owner ---

  private get saveKey() {
    return SAVE_KEY + this.room.name;
  }

  /** Remote viewers watching any of our screens; with no screen up, everyone in the room. */
  private watchers(): RemoteParticipant[] {
    const screens = [...this.room.localParticipant.trackPublications.values()].filter(
      (p) => p.source === Track.Source.ScreenShare,
    );
    const remotes = [...this.room.remoteParticipants.values()];
    return screens.length ? remotes.filter((p) => screens.some((pub) => isViewing(p, pub))) : remotes;
  }

  private newVote(kind: Vote["kind"], question: string, options: string[], subjects: string[]): Vote {
    const vote: Vote = { id: uid(), kind, question, options, endsAt: Date.now() + VOTE_MS[kind], ballots: {}, subjects };
    this.setTimer("own:vote", VOTE_MS[kind], () => this.closeVote(vote.id));
    return vote;
  }

  private closeVote(id: string) {
    const s = this.mine;
    const vote = s?.vote;
    if (!s || !vote || vote.id !== id) return;
    const counts = vote.options.map((_, i) => Object.values(vote.ballots).filter((b) => b === i).length);
    const [yes = 0, no = 0] = counts;
    const tally = `(${yes} × ${no})`;
    let text: string;
    const avisei = { ...s.avisei };
    if (vote.kind === "stop") {
      text = yes + no === 0 ? "🤷 Ninguém votou: decide aí" : yes > no ? `🚪 A galera decidiu: SAI ${tally}` : yes < no ? `🎰 A galera decidiu: CONTINUA ${tally}` : `⚖️ Empate ${tally}: decide aí`;
    } else {
      const who = listFormat.format(vote.subjects.map((sid) => s.names[sid] ?? "alguém"));
      if (yes > no) {
        for (const sid of vote.subjects) avisei[sid] = (avisei[sid] ?? 0) + 1;
        text = `📢 Ponto de "eu avisei" pra ${who} ${tally}`;
      } else text = `🙅 Não valeu: ${who} fica sem ponto ${tally}`;
    }
    this.update((c) => ({
      ...c,
      vote: null,
      avisei,
      moment: { id: uid(), kind: "note", text, notes: [], delta: 0, big: false },
    }));
  }

  /** What viewers send the owner. */
  private fromViewer(msg: ToOwner, sender: Participant) {
    const s = this.mine;
    if (!s) return;
    const id = sender.identity;
    const named = { ...s.names, [id]: nameOf(sender) };
    const now = Date.now();
    switch (msg.t) {
      case "pray": {
        const ritual = s.ritual;
        if (!ritual || ritual.id !== msg.ritual || now > ritual.endsAt + 500 || id === s.owner || ritual.prayers.includes(id)) return;
        this.bump(s.owner, 0.04);
        this.update((c) => ({ ...c, names: named, ritual: { ...ritual, prayers: [...ritual.prayers, id] } }), true);
        return;
      }
      case "ballot": {
        const vote = s.vote;
        if (!vote || vote.id !== msg.vote || now > vote.endsAt + 500 || id === s.owner || vote.subjects.includes(id)) return;
        if (!Number.isInteger(msg.option) || msg.option < 0 || msg.option >= vote.options.length) return;
        this.update((c) => ({ ...c, names: named, vote: { ...vote, ballots: { ...vote.ballots, [id]: msg.option } } }), true);
        return;
      }
      case "bet": {
        const question = str(msg.question, MAX_QUESTION).trim();
        if (!question || !(COSTUMES as readonly string[]).includes(msg.costume)) return;
        if (s.bets.filter((b) => b.result === null).length >= MAX_OPEN_BETS) return;
        const bet: Bet = { id: uid(), by: id, question, costume: msg.costume, picks: {}, result: null, losers: [] };
        this.update((c) => ({
          ...c,
          names: named,
          bets: [...c.bets, bet],
          moment: { id: uid(), kind: "note", text: `🎲 Aposta de zoeira: ${question}`, notes: [`Quem errar vira ${msg.costume} por 1 hora`], delta: 0, big: false },
        }));
        return;
      }
      case "pick": {
        const bet = s.bets.find((b) => b.id === msg.bet);
        const side = readSide(msg.side);
        if (!bet || bet.result !== null || !side) return;
        this.update((c) => ({ ...c, names: named, bets: c.bets.map((b) => (b === bet ? { ...b, picks: { ...b.picks, [id]: side } } : b)) }), true);
        return;
      }
      case "settle": {
        const bet = s.bets.find((b) => b.id === msg.bet);
        if (!bet || bet.result !== null || (id !== bet.by && id !== s.owner)) return;
        if (msg.result === null) {
          this.update((c) => ({ ...c, bets: c.bets.filter((b) => b !== bet) }));
          return;
        }
        const result = readSide(msg.result);
        if (!result) return;
        const losers = Object.entries(bet.picks).filter(([, side]) => side !== result).map(([pid]) => pid);
        const who = listFormat.format(losers.map((pid) => s.names[pid] ?? "alguém"));
        const text = losers.length
          ? `${bet.costume} ${who} ${losers.length > 1 ? "viraram" : "virou"} ${bet.costume} por 1 hora`
          : "🎲 Ninguém errou o palpite";
        const settled = { ...bet, result, losers };
        const open = s.bets.filter((b) => b !== bet && b.result === null);
        const done = [...s.bets.filter((b) => b !== bet && b.result !== null), settled].slice(-MAX_SETTLED_BETS);
        this.update((c) => ({
          ...c,
          bets: [...open, ...done],
          moment: { id: uid(), kind: "note", text, notes: [`"${bet.question}": deu ${result === "yes" ? "sim" : "não"}`], delta: 0, big: false },
        }));
        return;
      }
    }
  }

  /**
   * Replaces our table and tells the room. `soon` coalesces bursts (a room full of people praying at
   * once) into one broadcast.
   */
  private update(fn: (s: Session) => Session, soon = false) {
    const prev = this.mine;
    const next = pruneNames(fn(prev ?? ({} as Session)));
    this.mine = next;
    this.save();
    this.transition(next.owner, prev, next, true);
    this.notify();
    if (!soon) this.broadcast();
    else this.broadcastTimer ??= setTimeout(() => this.broadcast(), 200);
  }

  private broadcast(to?: string) {
    if (this.broadcastTimer && !to) {
      clearTimeout(this.broadcastTimer);
      this.broadcastTimer = null;
    }
    if (!this.mine) return;
    this.send({ t: "state", s: this.mine, now: Date.now(), ...(to ? { sync: 1 as const } : {}) }, to);
  }

  private save() {
    if (!this.mine) return;
    const { ritual: _r, vote: _v, moment: _m, ...rest } = this.mine;
    sessionStorage.setItem(this.saveKey, JSON.stringify({ at: Date.now(), s: rest }));
  }

  /** Reloaded mid-session: the table comes back (under our new identity). */
  private restore() {
    try {
      const saved = JSON.parse(sessionStorage.getItem(this.saveKey) ?? "null") as { at: number; s: unknown } | null;
      if (!saved || Date.now() - saved.at > SAVE_MAX_AGE) return;
      const local = this.room.localParticipant;
      const s = readSession(saved.s, local.identity, nameOf(local));
      if (s) this.mine = { ...s, ritual: null, vote: null, moment: null };
    } catch {
      sessionStorage.removeItem(this.saveKey);
    }
  }

  // --- internals: everyone ---

  private hello = () => this.send({ t: "hello" });

  private send(msg: Message, to?: string) {
    void this.room.localParticipant
      .publishData(encoder.encode(JSON.stringify(msg)), {
        reliable: true,
        topic: TOPIC,
        ...(to ? { destinationIdentities: [to] } : {}),
      })
      .catch(() => undefined);
  }

  private toOwner(owner: string, msg: ToOwner) {
    if (owner === this.me) this.fromViewer(msg, this.room.localParticipant);
    else this.send(msg, owner);
  }

  private onData = (payload: Uint8Array, participant?: RemoteParticipant, _kind?: unknown, topic?: string) => {
    if (topic !== TOPIC || !participant) return;
    let msg: Message;
    try {
      msg = JSON.parse(decoder.decode(payload)) as Message;
    } catch {
      return;
    }
    if (!isObj(msg)) return;
    const owner = "owner" in msg && typeof msg.owner === "string" ? msg.owner : null;
    switch (msg.t) {
      case "hello":
        if (this.mine) this.broadcast(participant.identity);
        return;
      case "state": {
        const session = readSession(msg.s, participant.identity, nameOf(participant));
        if (!session) return;
        const prev = this.remote.get(participant.identity)?.session ?? null;
        this.remote.set(participant.identity, { session, skew: Date.now() - num(msg.now) });
        this.transition(participant.identity, prev && prev.id === session.id ? prev : null, session, !msg.sync);
        this.notify();
        return;
      }
      case "end":
        if (this.remote.get(participant.identity)?.session.id === msg.id) this.dropTable(participant.identity);
        return;
      case "pray":
      case "ballot":
      case "bet":
      case "pick":
      case "settle":
        this.fromViewer(msg, participant);
        return;
      case "stop": {
        if (!owner || !this.table(owner) || owner === participant.identity) return;
        const last = this.stopsFrom.get(participant.identity) ?? 0;
        if (Date.now() - last < STOP_COOLDOWN_MS - 5000) return;
        this.stopsFrom.set(participant.identity, Date.now());
        this.onStop(owner, participant);
        return;
      }
      case "suspense":
        if (!owner || !this.table(owner)) return;
        if (msg.on) this.startSuspense(owner, nameOf(participant));
        else if (msg.result === "paid" || msg.result === "nope") this.endSuspense(owner, msg.result);
        return;
      case "pin": {
        const text = str(msg.text, MAX_PIN).trim();
        if (!owner || !this.table(owner) || !text) return;
        const last = this.pinsFrom.get(participant.identity) ?? 0;
        if (Date.now() - last < PIN_COOLDOWN_MS - 5000) return;
        this.pinsFrom.set(participant.identity, Date.now());
        this.showPin(owner, text, nameOf(participant));
        return;
      }
      case "throw": {
        if (typeof msg.tile !== "string" || msg.tile.length > 80 || !Object.hasOwn(THROWABLES, msg.item)) return;
        const x = num(msg.x);
        const y = num(msg.y);
        if (x < 0 || x > 1 || y < 0 || y > 1 || !this.ownerOfTile(msg.tile)) return;
        const now = Date.now();
        const recent = (this.throwsFrom.get(participant.identity) ?? []).filter((t) => now - t < 4000);
        if (recent.length >= 6) return;
        this.throwsFrom.set(participant.identity, [...recent, now]);
        this.land(msg.tile, msg.item, x, y, nameOf(participant));
        return;
      }
    }
  };

  /** Their store may not be listening yet: give them a moment before sending our table. */
  private onParticipantJoined = (participant: RemoteParticipant) => {
    if (this.mine) this.setTimer(`welcome:${participant.identity}`, HELLO_RETRY_MS, () => this.broadcast(participant.identity));
  };

  private onParticipantLeft = (participant: RemoteParticipant) => {
    if (this.remote.has(participant.identity)) this.dropTable(participant.identity);
  };

  private dropTable(owner: string) {
    this.remote.delete(owner);
    this.endSuspense(owner, null);
    this.fx.delete(owner);
    this.hypeBy.delete(owner);
    this.notify();
  }

  /** Plays whatever changed between two versions of a table. `live` is false for the catch-up on joining. */
  private transition(owner: string, prev: Session | null, next: Session, live: boolean) {
    if (live && next.moment && next.moment.id !== prev?.moment?.id) this.onMoment(owner, next.moment, prev);
    if (live && next.ritual && next.ritual.id !== prev?.ritual?.id) {
      sfx.gong();
      this.bump(owner, 0.2);
    }
    if (live && next.vote?.kind === "avisei" && next.vote.id !== prev?.vote?.id) sfx.pop();
    for (const bet of next.bets) {
      if (bet.result === null || this.appliedBets.has(bet.id)) continue;
      this.appliedBets.add(bet.id);
      if (live && bet.losers.includes(this.me)) this.wearCostume(bet.costume);
    }
  }

  private onMoment(owner: string, m: Moment, prev: Session | null) {
    const kind = m.kind;
    this.setFx(owner, { caption: { id: m.id, text: m.text, notes: m.notes, kind } }, "caption", 4500 + m.notes.length * 1200);
    if (kind === "win" || kind === "goal") {
      this.bump(owner, m.big ? 0.6 : 0.25);
      if (m.big || kind === "goal") this.startDisco();
      if (m.big || (prev?.streak ?? 0) <= -NOVELA_STREAK) this.setFx(owner, { flash: { id: m.id } }, "flash", 900);
      if (kind === "goal") sfx.siren();
      else if (m.big) sfx.jackpot();
      else sfx.coin();
      if (this.fxOf(owner).suspense?.result === null) this.endSuspense(owner, "paid");
    } else if (kind === "loss" || kind === "limit") {
      this.bump(owner, m.big ? 0.5 : 0.15);
      if (m.big) {
        this.setFx(owner, { plaque: { id: m.id, amount: Math.abs(m.delta) } }, "plaque", PLAQUE_MS);
        sfx.toll();
      }
      if (kind === "limit") sfx.siren();
      if (this.fxOf(owner).suspense?.result === null) this.endSuspense(owner, "nope");
    } else {
      sfx.pop();
    }
  }

  private onStop(owner: string, from: Participant) {
    const stop = { id: uid(), name: from.isLocal ? "você" : nameOf(from) };
    const stops = [...this.fxOf(owner).stops, stop].slice(-MAX_STOPS);
    this.setFx(owner, { stops });
    this.setTimer(`stop:${stop.id}`, STOP_SHOWN_MS, () =>
      this.setFx(owner, { stops: this.fxOf(owner).stops.filter((s) => s !== stop) }),
    );
    sfx.bonk();
    this.bump(owner, 0.08);
    if (owner === this.me && !from.isLocal) this.stopCalls.push({ identity: from.identity, name: nameOf(from), at: Date.now() });
  }

  private startSuspense(owner: string, by: string) {
    if (this.fxOf(owner).suspense) return;
    this.setFx(owner, { suspense: { by, result: null } });
    this.drumrolls.get(owner)?.();
    this.drumrolls.set(owner, sfx.drumroll());
    this.bump(owner, 0.3);
    this.setTimer(`suspense:${owner}`, SUSPENSE_MAX_MS, () => this.endSuspense(owner, null));
  }

  /** Ends the drum roll; with a result, shows it for a moment. */
  private endSuspense(owner: string, result: "paid" | "nope" | null) {
    const suspense = this.fxOf(owner).suspense;
    if (!suspense || suspense.result !== null) return;
    this.drumrolls.get(owner)?.();
    this.drumrolls.delete(owner);
    if (!result) {
      this.clearTimer(`suspense:${owner}`);
      this.setFx(owner, { suspense: null });
      return;
    }
    if (result === "paid") sfx.crash();
    else sfx.sadTrombone();
    this.bump(owner, 0.3);
    this.setFx(owner, { suspense: { ...suspense, result } }, "suspense", SUSPENSE_RESULT_MS);
  }

  private showPin(owner: string, text: string, name: string) {
    this.setFx(owner, { pin: { id: uid(), text, name } }, "pin", PIN_MS);
    sfx.pop();
    this.bump(owner, 0.06);
  }

  private land(tileId: string, item: Throwable, x: number, y: number, name: string) {
    const flight: Flight = { id: uid(), item, x, y, fromX: 0.15 + Math.random() * 0.7, name };
    this.flights.set(tileId, [...this.flightsOn(tileId), flight].slice(-12));
    this.notify();
    this.setTimer(`flight:${flight.id}`, IMPACT_MS, () => (item === "tomato" ? sfx.splat() : sfx.chime()));
    this.setTimer(`flight-end:${flight.id}`, FLIGHT_MS, () => {
      const left = this.flightsOn(tileId).filter((f) => f !== flight);
      if (left.length) this.flights.set(tileId, left);
      else this.flights.delete(tileId);
      this.notify();
    });
    const owner = this.ownerOfTile(tileId);
    if (owner) this.bump(owner, 0.08);
  }

  private startDisco() {
    this.discoUntil = Date.now() + DISCO_MS;
    this.notify();
    this.setTimer("disco", DISCO_MS + 50, () => this.notify());
  }

  private bump(owner: string, amount: number) {
    this.hypeBy.set(owner, { value: Math.min(1, this.hype(owner) + amount), at: Date.now() });
  }

  /** Patches a table's effects; with `field` + `ms`, that field clears itself after ms. */
  private setFx(owner: string, patch: Partial<OwnerFx>, field?: keyof OwnerFx, ms?: number) {
    this.fx.set(owner, { ...this.fxOf(owner), ...patch });
    this.notify();
    if (field && ms) {
      const value = patch[field];
      this.setTimer(`fx:${owner}:${field}`, ms, () => {
        if (this.fxOf(owner)[field] === value) this.setFx(owner, { [field]: NO_FX[field] });
      });
    }
  }

  private setTimer(key: string, ms: number, fn: () => void) {
    this.clearTimer(key);
    this.timers.set(
      key,
      setTimeout(() => {
        this.timers.delete(key);
        fn();
      }, ms),
    );
  }

  private clearTimer(key: string) {
    const timer = this.timers.get(key);
    if (timer) clearTimeout(timer);
    this.timers.delete(key);
  }

  private notify() {
    this.version++;
    for (const listener of this.listeners) listener();
  }

  // --- costumes ---

  /** Lost a side bet: we wear the costume for an hour, here and after a reload. */
  private wearCostume(emoji: string) {
    const until = Date.now() + COSTUME_MS;
    localStorage.setItem(COSTUME_KEY, `${emoji}|${until}`);
    this.applyCostume(emoji, until);
  }

  private restoreCostume() {
    const [emoji, until] = (localStorage.getItem(COSTUME_KEY) ?? "").split("|");
    if (emoji && Number(until) > Date.now()) this.applyCostume(emoji, Number(until));
    else localStorage.removeItem(COSTUME_KEY);
  }

  private applyCostume(emoji: string, until: number) {
    const local = this.room.localParticipant;
    void local.setAttributes({ [COSTUME_ATTRIBUTE]: `${emoji}|${until}` }).catch(() => undefined);
    this.setTimer("costume", until - Date.now(), () => {
      localStorage.removeItem(COSTUME_KEY);
      void local.setAttributes({ [COSTUME_ATTRIBUTE]: "" }).catch(() => undefined);
    });
  }
}
