import { expect, test } from "bun:test";
import { TrackSource } from "livekit-server-sdk";
import { canManageGuild, channelPermissions, has, moderationOf, P, publishSources } from "./permissions";

const G = "100000";
const MOD = "200000";
const BANNED = "300000";
const USER = "400000";
const now = Date.parse("2026-11-08T12:00:00Z");
const voice = P.VIEW_CHANNEL | P.CONNECT | P.SPEAK | P.STREAM;
const roles = [
  { id: G, permissions: String(voice) },
  { id: MOD, permissions: String(P.MUTE_MEMBERS) },
  { id: BANNED, permissions: "0" },
];
const perms = (memberRoles: string[], overwrites: { id: string; type: number; allow: bigint; deny: bigint }[] = [], extra = {}) =>
  channelPermissions({
    guildId: G,
    ownerId: "999999",
    roles,
    member: { userId: USER, roles: memberRoles, ...extra },
    overwrites: overwrites.map((w) => ({ ...w, allow: String(w.allow), deny: String(w.deny) })),
    now,
  });

test("base: @everyone plus the member's roles", () => {
  expect(perms([])).toBe(voice);
  expect(perms([MOD])).toBe(voice | P.MUTE_MEMBERS);
});

test("owner gets everything, even when overwrites deny", () => {
  const p = channelPermissions({
    guildId: G,
    ownerId: USER,
    roles,
    member: { userId: USER, roles: [] },
    overwrites: [{ id: USER, type: 1, allow: "0", deny: String(P.VIEW_CHANNEL) }],
    now,
  });
  expect(has(p, P.VIEW_CHANNEL | P.CONNECT | P.MOVE_MEMBERS)).toBe(true);
});

test("administrator bypasses overwrites", () => {
  const admin = [...roles, { id: "500000", permissions: String(P.ADMINISTRATOR) }];
  const p = channelPermissions({
    guildId: G,
    ownerId: "999999",
    roles: admin,
    member: { userId: USER, roles: ["500000"] },
    overwrites: [{ id: G, type: 0, allow: "0", deny: String(P.VIEW_CHANNEL | P.CONNECT) }],
    now,
  });
  expect(has(p, P.VIEW_CHANNEL | P.CONNECT | P.DEAFEN_MEMBERS)).toBe(true);
});

test("@everyone denies VIEW, a role allows it back", () => {
  const ow = [
    { id: G, type: 0, allow: 0n, deny: P.VIEW_CHANNEL },
    { id: MOD, type: 0, allow: P.VIEW_CHANNEL, deny: 0n },
  ];
  expect(perms([], ow)).toBe(0n);
  expect(has(perms([MOD], ow), P.VIEW_CHANNEL | P.CONNECT)).toBe(true);
});

test("roles combine: a role's allow beats another role's deny; the member's deny beats both", () => {
  const ow = [
    { id: BANNED, type: 0, allow: 0n, deny: P.SPEAK },
    { id: MOD, type: 0, allow: P.SPEAK, deny: 0n },
  ];
  expect(has(perms([BANNED], ow), P.SPEAK)).toBe(false);
  expect(has(perms([BANNED, MOD], ow), P.SPEAK)).toBe(true);
  expect(has(perms([BANNED, MOD], [...ow, { id: USER, type: 1, allow: 0n, deny: P.SPEAK }]), P.SPEAK)).toBe(false);
  // A member overwrite for someone else changes nothing.
  expect(has(perms([MOD], [{ id: "777777", type: 1, allow: 0n, deny: P.SPEAK }]), P.SPEAK)).toBe(true);
});

test("timed out: only VIEW_CHANNEL and READ_MESSAGE_HISTORY until it ends", () => {
  expect(perms([MOD], [], { communicationDisabledUntil: "2026-11-08T13:00:00Z" })).toBe(P.VIEW_CHANNEL);
  expect(perms([MOD], [], { communicationDisabledUntil: "2026-11-08T11:00:00Z" })).toBe(voice | P.MUTE_MEMBERS);
  expect(perms([MOD], [], { communicationDisabledUntil: null })).toBe(voice | P.MUTE_MEMBERS);
});

test("no VIEW_CHANNEL means nothing at all", () => {
  expect(perms([MOD], [{ id: USER, type: 1, allow: P.CONNECT, deny: P.VIEW_CHANNEL }])).toBe(0n);
});

test("what it means in the room", () => {
  expect(publishSources(voice)).toEqual([TrackSource.MICROPHONE, TrackSource.CAMERA, TrackSource.SCREEN_SHARE, TrackSource.SCREEN_SHARE_AUDIO]);
  expect(publishSources(P.VIEW_CHANNEL | P.CONNECT | P.STREAM)).toEqual([TrackSource.CAMERA, TrackSource.SCREEN_SHARE, TrackSource.SCREEN_SHARE_AUDIO]);
  expect(publishSources(P.VIEW_CHANNEL | P.CONNECT)).toEqual([]);
  expect(moderationOf(voice | P.MUTE_MEMBERS | P.CREATE_INSTANT_INVITE)).toEqual({ mute: true, deafen: false, disconnect: false, invite: true });
  expect(canManageGuild({ owner: true, permissions: "0" })).toBe(true);
  expect(canManageGuild({ permissions: String(P.MANAGE_GUILD) })).toBe(true);
  expect(canManageGuild({ permissions: String(P.MUTE_MEMBERS) })).toBe(false);
});
