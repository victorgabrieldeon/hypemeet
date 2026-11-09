// Discord permissions in a channel, computed the way Discord does (base from roles, then overwrites), and what
// they mean in a HypeMeet room. Pure, so it's tested on its own (permissions.test.ts).

import { TrackSource } from "livekit-server-sdk";

export const P = {
  CREATE_INSTANT_INVITE: 1n << 0n,
  ADMINISTRATOR: 1n << 3n,
  MANAGE_GUILD: 1n << 5n,
  STREAM: 1n << 9n,
  VIEW_CHANNEL: 1n << 10n,
  READ_MESSAGE_HISTORY: 1n << 16n,
  CONNECT: 1n << 20n,
  SPEAK: 1n << 21n,
  MUTE_MEMBERS: 1n << 22n,
  DEAFEN_MEMBERS: 1n << 23n,
  MOVE_MEMBERS: 1n << 24n,
} as const;

const ALL = (1n << 64n) - 1n;

export interface Role {
  id: string;
  permissions: string;
}

export interface Overwrite {
  id: string;
  /** 0 role, 1 member */
  type: number;
  allow: string;
  deny: string;
}

export function channelPermissions(o: {
  guildId: string;
  ownerId: string;
  roles: Role[];
  member: { userId: string; roles: string[]; communicationDisabledUntil?: string | null };
  overwrites: Overwrite[];
  now: number;
}): bigint {
  if (o.member.userId === o.ownerId) return ALL;
  const rolePerms = new Map(o.roles.map((r) => [r.id, BigInt(r.permissions)]));
  // The @everyone role's id is the guild's.
  let perms = rolePerms.get(o.guildId) ?? 0n;
  for (const id of o.member.roles) perms |= rolePerms.get(id) ?? 0n;
  if (perms & P.ADMINISTRATOR) return ALL;

  const everyone = o.overwrites.find((w) => w.type === 0 && w.id === o.guildId);
  if (everyone) perms = (perms & ~BigInt(everyone.deny)) | BigInt(everyone.allow);
  let allow = 0n;
  let deny = 0n;
  for (const w of o.overwrites)
    if (w.type === 0 && w.id !== o.guildId && o.member.roles.includes(w.id)) {
      allow |= BigInt(w.allow);
      deny |= BigInt(w.deny);
    }
  perms = (perms & ~deny) | allow;
  const own = o.overwrites.find((w) => w.type === 1 && w.id === o.member.userId);
  if (own) perms = (perms & ~BigInt(own.deny)) | BigInt(own.allow);

  const until = o.member.communicationDisabledUntil ? Date.parse(o.member.communicationDisabledUntil) : NaN;
  if (until > o.now) perms &= P.VIEW_CHANNEL | P.READ_MESSAGE_HISTORY;
  return perms & P.VIEW_CHANNEL ? perms : 0n;
}

export const has = (perms: bigint, bit: bigint) => (perms & bit) === bit;

/** Who may add the bot to a server, from their partial guild (`owner`, base `permissions`). */
export const canManageGuild = (g: { owner?: boolean; permissions?: string }) =>
  !!g.owner || (BigInt(g.permissions ?? "0") & (P.ADMINISTRATOR | P.MANAGE_GUILD)) !== 0n;

/** What a room token may publish: SPEAK → microphone, STREAM ("Vídeo") → camera and screen. */
export function publishSources(perms: bigint): TrackSource[] {
  return [
    ...(has(perms, P.SPEAK) ? [TrackSource.MICROPHONE] : []),
    ...(has(perms, P.STREAM) ? [TrackSource.CAMERA, TrackSource.SCREEN_SHARE, TrackSource.SCREEN_SHARE_AUDIO] : []),
  ];
}

export const moderationOf = (perms: bigint) => ({
  mute: has(perms, P.MUTE_MEMBERS),
  deafen: has(perms, P.DEAFEN_MEMBERS),
  disconnect: has(perms, P.MOVE_MEMBERS),
  invite: has(perms, P.CREATE_INSTANT_INVITE),
});
