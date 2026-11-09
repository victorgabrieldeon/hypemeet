import { afterEach, beforeEach, expect, jest, mock, spyOn, test } from "bun:test";
import { createGateway, reduce, type GatewayState } from "./gateway";

const G = "100000";
const GERAL = "200000";
const JOGOS = "300000";
const ANA = "400000";
const BIA = "500000";
const CAIO = "600000";

const vs = (user_id: string, channel_id: string | null, flags: object = {}) => ({
  user_id,
  channel_id,
  mute: false,
  deaf: false,
  self_mute: false,
  self_deaf: false,
  self_video: false,
  suppress: false,
  ...flags,
});
const user = (id: string, extra: object = {}) => ({ id, username: `u${id}`, global_name: null, avatar: null, ...extra });

test("voice state: GUILD_CREATE, then join, move, mute flags and leave", () => {
  const state: GatewayState = new Map();
  expect(reduce(state, "READY", { guilds: [{ id: G, unavailable: true }] })).toBeNull();
  expect(state.get(G)?.unavailable).toBe(true);
  const created = {
    id: G,
    voice_states: [vs(ANA, GERAL, { self_mute: true })],
    // Bia isn't in voice: not kept.
    members: [{ user: user(ANA, { global_name: "Ana", avatar: "a1" }), nick: "Aninha", avatar: "g1" }, { user: user(BIA) }],
  };
  expect(reduce(state, "GUILD_CREATE", created)).toEqual({ cache: "botGuilds", guildId: G });
  const g = state.get(G)!;
  expect(g.unavailable).toBe(false);
  expect(g.voice.get(ANA)).toMatchObject({ channelId: GERAL, selfMute: true, mute: false });
  expect(g.people.get(ANA)).toEqual({ name: "Aninha", avatar: `https://cdn.discordapp.com/guilds/${G}/users/${ANA}/avatars/g1.png?size=64` });
  expect(g.people.has(BIA)).toBe(false);

  // Bia joins with her member, moves, and a moderator mutes and deafens her.
  reduce(state, "VOICE_STATE_UPDATE", { guild_id: G, ...vs(BIA, GERAL), member: { user: user(BIA, { avatar: "b1" }) } });
  expect(g.people.get(BIA)).toEqual({ name: `u${BIA}`, avatar: `https://cdn.discordapp.com/avatars/${BIA}/b1.png?size=64` });
  reduce(state, "VOICE_STATE_UPDATE", {
    guild_id: G,
    ...vs(BIA, JOGOS, { mute: true, deaf: true }),
    member: { user: user(BIA, { global_name: "Bia" }) },
  });
  expect(g.voice.get(BIA)).toMatchObject({ channelId: JOGOS, mute: true, deaf: true, selfMute: false });
  expect(g.people.get(BIA)).toEqual({ name: "Bia", avatar: null });
  // Ana leaves.
  reduce(state, "VOICE_STATE_UPDATE", { guild_id: G, ...vs(ANA, null) });
  expect(g.voice.has(ANA)).toBe(false);
  expect(g.people.has(ANA)).toBe(false);
  // A server it doesn't know: ignored.
  reduce(state, "VOICE_STATE_UPDATE", { guild_id: "999999", ...vs(CAIO, GERAL) });
  expect(state.has("999999")).toBe(false);
});

test("server membership, and the caches events make stale", () => {
  const state: GatewayState = new Map();
  reduce(state, "GUILD_CREATE", { id: G, voice_states: [vs(ANA, GERAL)], members: [] });
  // An outage keeps the server, marked; being removed drops it.
  expect(reduce(state, "GUILD_DELETE", { id: G, unavailable: true })).toEqual({ cache: "botGuilds", guildId: G });
  expect(state.get(G)?.unavailable).toBe(true);
  expect(state.get(G)?.voice.size).toBe(1);
  reduce(state, "GUILD_DELETE", { id: G });
  expect(state.has(G)).toBe(false);
  expect(reduce(state, "CHANNEL_UPDATE", { id: GERAL, guild_id: G })).toEqual({ cache: "channels", guildId: G });
  expect(reduce(state, "CHANNEL_CREATE", { id: "700000", type: 1 })).toBeNull(); // a DM
  expect(reduce(state, "GUILD_ROLE_UPDATE", { guild_id: G, role: {} })).toEqual({ cache: "guild", guildId: G });
  expect(reduce(state, "GUILD_UPDATE", { id: G })).toEqual({ cache: "guild", guildId: G });
  expect(reduce(state, "TYPING_START", {})).toBeNull();
});

/** Stands in for Bun's WebSocket: the test plays Discord's side. */
class FakeSocket {
  static all: FakeSocket[] = [];
  readyState: number = WebSocket.OPEN;
  sent: unknown[] = [];
  closedWith?: number;
  private listeners: Record<string, ((e: unknown) => void)[]> = {};
  constructor(readonly url: string) {
    FakeSocket.all.push(this);
  }
  addEventListener(type: string, fn: (e: unknown) => void) {
    (this.listeners[type] ??= []).push(fn);
  }
  send(data: string) {
    this.sent.push(JSON.parse(data));
  }
  close(code?: number) {
    this.closedWith = code;
    this.readyState = WebSocket.CLOSED;
  }
  receive(payload: object) {
    for (const fn of this.listeners.message ?? []) fn({ data: JSON.stringify(payload) });
  }
  drop(code: number, reason = "") {
    this.readyState = WebSocket.CLOSED;
    for (const fn of this.listeners.close ?? []) fn({ code, reason });
  }
}

const HELLO = { op: 10, d: { heartbeat_interval: 1000 } };
const ready = (s: number, guilds: object[] = []) => ({
  op: 0,
  s,
  t: "READY",
  d: { session_id: "s1", resume_gateway_url: "wss://resume.discord.gg", guilds },
});
const IDENTIFY = { op: 2, d: { token: "tok", intents: 129, properties: { os: process.platform, browser: "hypemeet", device: "hypemeet" } } };

function start() {
  FakeSocket.all = [];
  const forgotten: string[] = [];
  const forget = {
    channels: (g: string) => forgotten.push(`channels ${g}`),
    guild: (g: string) => forgotten.push(`guild ${g}`),
    botGuilds: (g: string) => forgotten.push(`botGuilds ${g}`),
  };
  const gateway = createGateway({ token: "tok", forget, WebSocket: FakeSocket as unknown as typeof WebSocket });
  return { gateway, forgotten, socket: () => FakeSocket.all.at(-1)! };
}

beforeEach(() => {
  jest.useFakeTimers();
  spyOn(Math, "random").mockReturnValue(0.5);
  spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  jest.useRealTimers();
  mock.restore();
});

test("identifies after Hello and answers from what Discord sent", () => {
  const { gateway, forgotten, socket } = start();
  const ws = socket();
  expect(ws.url).toBe("wss://gateway.discord.gg/?v=10&encoding=json");
  ws.receive(HELLO);
  expect(ws.sent).toEqual([IDENTIFY]);
  ws.receive(ready(1, [{ id: G, unavailable: true }]));
  expect(gateway.connected).toBe(true);
  // Its GUILD_CREATE hasn't come yet.
  expect(gateway.knows(G)).toBe(false);
  expect(gateway.voiceMembers(G, GERAL)).toEqual([]);
  ws.receive({
    op: 0,
    s: 2,
    t: "GUILD_CREATE",
    d: {
      id: G,
      voice_states: [vs(BIA, GERAL, { self_deaf: true }), vs(ANA, GERAL, { mute: true }), vs(CAIO, JOGOS)],
      members: [{ user: user(BIA, { global_name: "Bia" }), avatar: "g1" }, { user: user(ANA, { global_name: "Ana" }) }],
    },
  });
  expect(gateway.knows(G)).toBe(true);
  expect(gateway.voiceChannelOf(G, CAIO)).toBe(JOGOS);
  expect(gateway.voiceChannelOf(G, "700000")).toBeNull();
  expect(gateway.voiceMembers(G, GERAL)).toEqual([
    { id: ANA, name: "Ana", mute: true, deaf: false },
    { id: BIA, name: "Bia", avatar: `https://cdn.discordapp.com/guilds/${G}/users/${BIA}/avatars/g1.png?size=64`, mute: false, deaf: true },
  ]);
  ws.receive({ op: 0, s: 3, t: "CHANNEL_UPDATE", d: { id: GERAL, guild_id: G } });
  expect(forgotten).toEqual([`botGuilds ${G}`, `channels ${G}`]);
  gateway.stop();
});

test("heartbeats; a missing ack or a dropped connection resumes the session", () => {
  const { gateway, socket } = start();
  const first = socket();
  first.receive(HELLO);
  first.receive(ready(1));
  first.sent.length = 0;
  // The first beat is jittered (half the interval here), then one per interval.
  jest.advanceTimersByTime(500);
  expect(first.sent).toEqual([{ op: 1, d: 1 }]);
  first.receive({ op: 11 });
  first.receive({ op: 1 }); // Discord asking for one now
  jest.advanceTimersByTime(1000);
  expect(first.sent).toEqual([
    { op: 1, d: 1 },
    { op: 1, d: 1 },
    { op: 1, d: 1 },
  ]);
  // No ack for that beat: a dead connection, closed with a code that keeps the session.
  jest.advanceTimersByTime(1000);
  expect(first.closedWith).toBe(4000);
  expect(gateway.connected).toBe(false);
  jest.advanceTimersByTime(0);
  const second = socket();
  expect(second.url).toBe("wss://resume.discord.gg/?v=10&encoding=json");
  second.receive(HELLO);
  expect(second.sent).toEqual([{ op: 6, d: { token: "tok", session_id: "s1", seq: 1 } }]);
  second.receive({ op: 0, s: 2, t: "RESUMED", d: null });
  expect(gateway.connected).toBe(true);

  // The old socket's late close changes nothing; a drop of the current one reconnects with backoff.
  first.drop(1006);
  expect(FakeSocket.all.length).toBe(2);
  second.drop(1006, "Connection ended");
  expect(gateway.connected).toBe(false);
  jest.advanceTimersByTime(999);
  expect(FakeSocket.all.length).toBe(2);
  jest.advanceTimersByTime(1);
  socket().drop(1006, "Failed to connect");
  jest.advanceTimersByTime(1999);
  expect(FakeSocket.all.length).toBe(3);
  jest.advanceTimersByTime(1);
  socket().receive(HELLO);
  expect(socket().sent).toEqual([{ op: 6, d: { token: "tok", session_id: "s1", seq: 2 } }]);
  gateway.stop();
});

test("op 7 resumes, op 9 and lost sessions identify again, fatal closes stop", () => {
  const { gateway, socket } = start();
  socket().receive(HELLO);
  socket().receive(ready(5));
  socket().receive({ op: 7, d: null });
  expect(socket().closedWith).toBe(4000);
  jest.advanceTimersByTime(0);
  socket().receive(HELLO);
  expect(socket().sent).toEqual([{ op: 6, d: { token: "tok", session_id: "s1", seq: 5 } }]);
  // Not resumable: a fresh Identify on a new connection after 1–5 s (3 s here).
  socket().receive({ op: 9, d: false });
  jest.advanceTimersByTime(2999);
  expect(FakeSocket.all.length).toBe(2);
  jest.advanceTimersByTime(1);
  expect(socket().url).toBe("wss://gateway.discord.gg/?v=10&encoding=json");
  socket().receive(HELLO);
  expect(socket().sent).toEqual([IDENTIFY]);
  socket().receive(ready(1));
  // Session timed out: identify, not resume.
  socket().drop(4009, "Session timed out.");
  jest.advanceTimersByTime(1000);
  socket().receive(HELLO);
  expect(socket().sent).toEqual([IDENTIFY]);

  const error = spyOn(console, "error").mockImplementation(() => {});
  socket().drop(4004, "Authentication failed.");
  jest.advanceTimersByTime(120_000);
  expect(FakeSocket.all.length).toBe(4);
  expect(error).toHaveBeenCalledTimes(1);
  expect(gateway.connected).toBe(false);
});
