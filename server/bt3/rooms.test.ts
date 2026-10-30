import { expect, test } from "bun:test";
import { NetRooms, parseRoomParams, type NetSocket, type RoomParams } from "./rooms";

class Fake implements NetSocket {
  sent: (string | Uint8Array)[] = [];
  closed: number | null = null;
  send(data: string | Uint8Array) {
    this.sent.push(data);
  }
  close(code = 1000) {
    this.closed = code;
  }
  /** The JSON messages. */
  get messages() {
    return this.sent.filter((m) => typeof m === "string").map((m) => JSON.parse(m as string) as { t: string } & Record<string, unknown>);
  }
  get types() {
    return this.messages.map((m) => m.t);
  }
  last() {
    return this.messages.at(-1);
  }
}

const p = (role: "host" | "join", fields: Partial<RoomParams> = {}): RoomParams => ({
  room: "ABCD",
  role,
  phase: "lobby",
  name: role === "host" ? "Ana" : "Bia",
  cid: role === "host" ? "cid-ana" : "cid-bia",
  ...fields,
});

test("params: a bad room code or role is a bad request", () => {
  expect(parseRoomParams(new URLSearchParams("room=ABCD&role=host&phase=session&name=Ana&cid=x"))).toEqual({
    room: "ABCD",
    role: "host",
    phase: "session",
    name: "Ana",
    cid: "x",
  });
  expect(parseRoomParams(new URLSearchParams("room=abcd&role=host"))).toBeNull();
  expect(parseRoomParams(new URLSearchParams("room=ABCD&role=boss"))).toBeNull();
  expect(parseRoomParams(new URLSearchParams("room=ABCD&role=join"))).toMatchObject({ name: "Player", phase: "lobby" });
});

test("host and join meet (peer); a second host is turned away (taken); join without a host is told (nohost)", () => {
  const rooms = new NetRooms();
  const host = new Fake();
  rooms.openRoom(host, p("host"));
  expect(host.types).toEqual(["wait"]);
  const lonely = new Fake();
  rooms.openRoom(lonely, p("join", { room: "ZZZZ" }));
  expect(lonely.types).toEqual(["nohost"]);
  expect(lonely.closed).toBe(4002);
  const join = new Fake();
  rooms.openRoom(join, p("join"));
  expect(join.last()).toEqual({ t: "peer", name: "Ana" });
  expect(host.last()).toEqual({ t: "peer", name: "Bia" });
  const intruder = new Fake();
  rooms.openRoom(intruder, p("host", { cid: "someone-else" }));
  expect(intruder.types).toEqual(["taken"]);
  expect(intruder.closed).toBe(4001);
  const third = new Fake();
  rooms.openRoom(third, p("join", { cid: "cid-cai" }));
  expect(third.types).toEqual(["full"]);
  // The two in the room never heard of them.
  expect(host.types).toEqual(["wait", "peer"]);
});

test("the same cid again (a reload) replaces the old connection, without 'left'", () => {
  const rooms = new NetRooms();
  const host = new Fake();
  const join = new Fake();
  rooms.openRoom(host, p("host"));
  rooms.openRoom(join, p("join"));
  const again = new Fake();
  rooms.openRoom(again, p("host"));
  expect(host.closed).toBe(4000);
  expect(again.last()).toEqual({ t: "peer", name: "Bia" });
  rooms.close(host, 4000);
  expect(join.types).not.toContain("left");
  // The new one is the room's host now.
  rooms.message(join, JSON.stringify({ t: "sig", sdp: "x" }));
  expect(again.last()).toEqual({ t: "sig", sdp: "x" });
  expect(host.types).not.toContain("sig");
});

test("sig, go, relay, bye and binary reach the other side; ping gets pong; the rest is dropped", () => {
  const rooms = new NetRooms();
  const host = new Fake();
  const join = new Fake();
  rooms.openRoom(host, p("host"));
  rooms.openRoom(join, p("join"));
  for (const t of ["sig", "go", "relay", "bye"]) {
    rooms.message(host, JSON.stringify({ t, x: 1 }));
    expect(join.last()).toEqual({ t, x: 1 });
  }
  const packet = new Uint8Array([1, 2, 3]);
  rooms.message(join, packet);
  expect(host.sent.at(-1)).toBe(packet);
  rooms.message(host, JSON.stringify({ t: "ping", ts: 42 }));
  expect(host.last()).toEqual({ t: "pong", ts: 42 });
  const before = join.sent.length;
  rooms.message(host, JSON.stringify({ t: "peer", name: "fake" }));
  rooms.message(host, "not json");
  expect(join.sent.length).toBe(before);
});

test("leaving tells the other 'left'; a session waits for the other, apart from the lobby", () => {
  const rooms = new NetRooms();
  const host = new Fake();
  const join = new Fake();
  rooms.openRoom(host, p("host"));
  rooms.openRoom(join, p("join"));
  rooms.close(join, 1001);
  expect(host.types.at(-1)).toBe("left");

  // The pages load themselves into the session: the host first, it waits (the lobby join is gone).
  const sHost = new Fake();
  rooms.openRoom(sHost, p("host", { phase: "session" }));
  expect(host.closed).toBe(4000); // (its lobby page, same player)
  expect(sHost.types).toEqual(["wait"]);
  const sJoin = new Fake();
  rooms.openRoom(sJoin, p("join", { phase: "session" }));
  expect(sJoin.last()).toEqual({ t: "peer", name: "Ana" });
  expect(sHost.last()).toEqual({ t: "peer", name: "Bia" });

  // Joining a session first is fine too: it waits. Empty rooms go.
  const other = new NetRooms();
  const early = new Fake();
  other.openRoom(early, p("join", { phase: "session" }));
  expect(early.types).toEqual(["wait"]);
  other.close(early, 1001);
  expect(other.size).toBe(0);
});

test("Quick Match pairs two, with a code and sides; the waiting hear the count", () => {
  const rooms = new NetRooms(() => Date.now(), () => 0);
  const ana = new Fake();
  rooms.openQueue(ana, { name: "Ana", cid: "a" });
  expect(ana.last()).toEqual({ t: "count", n: 1 });
  // A reload of the same player replaces the older one.
  const ana2 = new Fake();
  rooms.openQueue(ana2, { name: "Ana", cid: "a" });
  expect(ana.closed).toBe(4000);
  expect(ana2.last()).toEqual({ t: "count", n: 1 });
  const bia = new Fake();
  rooms.openQueue(bia, { name: "Bia", cid: "b" });
  const rules = String(3 << 8);
  expect(ana2.messages.find((m) => m.t === "match")).toEqual({ t: "match", room: "AAAA", role: "host", vs: "Bia", rules });
  expect(bia.messages.find((m) => m.t === "match")).toEqual({ t: "match", room: "AAAA", role: "join", vs: "Ana", rules });
  rooms.message(bia, "ping");
  expect(bia.last()).toEqual({ t: "pong" });
  // The paired ones aren't waiting any more.
  const cai = new Fake();
  rooms.openQueue(cai, { name: "Cai", cid: "c" });
  expect(cai.last()).toEqual({ t: "count", n: 1 });
  const dan = new Fake();
  rooms.openQueue(dan, { name: "Dan", cid: "d" });
  expect(dan.messages.find((m) => m.t === "match")).toMatchObject({ role: "join", vs: "Cai" });
});
