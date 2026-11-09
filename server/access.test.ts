import { expect, test } from "bun:test";
import { createAccess, Denied } from "./access";
import type { Discord } from "./discord";
import { P } from "./permissions";

const G = "100000";
const VOICE = "200000";
const HIDDEN = "300000";
const ANA = "400000";
const BIA = "500000";

const fake = (botIn: boolean) =>
  ({
    botGuildIds: async () => new Set(botIn ? [G] : []),
    channels: async () => [
      { id: VOICE, type: 2, name: "Geral", position: 0, permission_overwrites: [{ id: BIA, type: 1, allow: "0", deny: String(P.CONNECT) }] },
    ],
    guild: async () => ({ id: G, name: "S", icon: null, owner_id: "999999", roles: [{ id: G, permissions: String(P.VIEW_CHANNEL | P.CONNECT | P.SPEAK) }] }),
    member: async (_g: string, u: string) => (u === ANA ? { roles: [], mute: true, deaf: true } : u === BIA ? { roles: [] } : null),
    voiceChannel: async (_g: string, u: string) => (u === ANA ? HIDDEN : null),
    userGuilds: async (u: string) => (u === ANA ? [{ id: G, name: "S", icon: null }] : []),
  }) as unknown as Discord;

test("bot in the server: the channel's permissions decide", async () => {
  const access = createAccess(fake(true));
  const ana = await access.check({ id: ANA }, G, VOICE);
  expect(ana.perms).toBe(P.VIEW_CHANNEL | P.CONNECT | P.SPEAK);
  expect(ana.channel?.name).toBe("Geral");
  // Their server mute / deafen come along for the grant; the bot vouched for the channel.
  expect(ana).toMatchObject({ member: { mute: true, deaf: true }, verified: true });
  // Bia can see it but not connect; a stranger isn't in the server.
  await expect(access.check({ id: BIA }, G, VOICE)).rejects.toBeInstanceOf(Denied);
  await expect(access.check({ id: "600000" }, G, VOICE)).rejects.toBeInstanceOf(Denied);
  // A channel the bot can't see: only from inside its call.
  expect(await access.check({ id: ANA }, G, HIDDEN)).toEqual({ perms: null, channel: null, member: null, verified: true });
  await expect(access.check({ id: BIA }, G, HIDDEN)).rejects.toBeInstanceOf(Denied);
});

test("bot not in the server: members only", async () => {
  const access = createAccess(fake(false));
  // Membership says nothing about where the channel is: not verified.
  expect(await access.check({ id: ANA, accessToken: "t" }, G, VOICE)).toEqual({ perms: null, channel: null, member: null, verified: false });
  await expect(access.check({ id: BIA, accessToken: "t" }, G, VOICE)).rejects.toBeInstanceOf(Denied);
  await expect(access.check({ id: ANA }, G, VOICE)).rejects.toBeInstanceOf(Denied);
});

test("the Gateway's voice state wins when it knows the server, else REST is asked", async () => {
  const rest = fake(true);
  const restCalls: string[] = [];
  rest.voiceChannel = async (_g, u) => (restCalls.push(u), u === ANA ? HIDDEN : null);
  // The Gateway has BIA in the hidden call and ANA nowhere; it doesn't know other servers.
  const access = createAccess(rest, { knows: (g) => g === G, voiceChannelOf: (_g, u) => (u === BIA ? HIDDEN : null) });
  expect(await access.check({ id: BIA }, G, HIDDEN)).toEqual({ perms: null, channel: null, member: null, verified: true });
  await expect(access.check({ id: ANA }, G, HIDDEN)).rejects.toBeInstanceOf(Denied);
  expect(restCalls).toEqual([]);
  expect(await access.voiceChannel("700000", ANA)).toBe(HIDDEN);
  expect(restCalls).toEqual([ANA]);
});
