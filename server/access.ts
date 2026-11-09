import type { Channel, Discord, Guild, Member } from "./discord";
import type { Gateway } from "./gateway";
import { channelPermissions, has, P } from "./permissions";

/** A refusal whose message is shown to the person as is. */
export class Denied extends Error {
  constructor(
    message: string,
    readonly status = 403,
  ) {
    super(message);
  }
}

const NO_ACCESS = "Você não tem acesso a este canal no Discord";

export const permsIn = (guild: Guild, userId: string, member: Member, channel: Channel) =>
  channelPermissions({
    guildId: guild.id,
    ownerId: guild.owner_id,
    roles: guild.roles,
    member: { userId, roles: member.roles, communicationDisabledUntil: member.communication_disabled_until },
    overwrites: channel.permission_overwrites ?? [],
    now: Date.now(),
  });

export function createAccess(discord: Discord, gateway?: Pick<Gateway, "knows" | "voiceChannelOf">) {
  /** The voice channel they're in there, or null: the Gateway's answer when it knows that server, else Discord's REST. */
  const voiceChannel = (guildId: string, userId: string): Promise<string | null> =>
    gateway?.knows(guildId) ? Promise.resolve(gateway.voiceChannelOf(guildId, userId)) : discord.voiceChannel(guildId, userId);

  /** Their permissions in a channel the bot can see (0 when they're not in the server); null when it can't see it. */
  async function perms(guildId: string, channelId: string, userId: string): Promise<{ perms: bigint; channel: Channel; member: Member | null } | null> {
    const channel = (await discord.channels(guildId)).find((c) => c.id === channelId);
    if (!channel) return null;
    const [guild, member] = await Promise.all([discord.guild(guildId), discord.member(guildId, userId)]);
    return { perms: member ? permsIn(guild, userId, member, channel) : 0n, channel, member };
  }

  return {
    perms,
    voiceChannel,

    /**
     * May this Discord user join the room of this server's channel? Every join path asks here. Throws Denied.
     * `perms: null` → not known (the bot can't see the channel or isn't in the server): no moderation, every source.
     * `verified` → the bot vouched that the channel is in that server; only then may the server be stored for it.
     */
    async check(user: { id: string; accessToken?: string }, guildId: string, channelId: string) {
      if ((await discord.botGuildIds()).has(guildId)) {
        // Being in the bot's channel list is what proves the channel belongs to that server.
        const found = await perms(guildId, channelId, user.id);
        if (found) {
          if (!has(found.perms, P.VIEW_CHANNEL | P.CONNECT)) throw new Denied(NO_ACCESS);
          return { ...found, verified: true };
        }
        // A channel hidden from the bot: being in its call is the proof.
        if ((await voiceChannel(guildId, user.id)) === channelId) return { perms: null, channel: null, member: null, verified: true };
        throw new Denied(NO_ACCESS);
      }
      // shortcut: without the bot only membership is checked, not that the channel is in that server (so not verified).
      const guilds = user.accessToken ? await discord.userGuilds(user.id, user.accessToken) : [];
      if (guilds.some((g) => g.id === guildId)) return { perms: null, channel: null, member: null, verified: false };
      throw new Denied(NO_ACCESS);
    },
  };
}
