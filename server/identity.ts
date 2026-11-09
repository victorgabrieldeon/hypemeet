// What a room identity says. The server assigns it and nobody can change it, unlike the participant's name and
// attributes (client-writable): `${nickname}#${uuid8}` for guests, `${nickname}#${uuid8}.${discordId}` for Discord
// sign-ins (site or Activity), `${nickname}#tx-${uuid8}` for transmitters (/api/cast).

/** The Discord id of a Discord sign-in; null for anyone else. */
export const discordIdOf = (identity: string) => /#[0-9a-f]{8}\.(\d{5,25})$/.exec(identity)?.[1] ?? null;

/** A transmitter: only those carry a `castFor` the server set, and they can't change it. */
export const isTransmitter = (identity: string) => /#tx-[0-9a-f]{8}$/.test(identity);

/** The nickname the server put in the identity; `name` (client-writable) only for identities it didn't make. */
export const nicknameOf = (identity: string, name?: string) =>
  /^(.*)#(?:tx-)?[0-9a-f]{8}(?:\.\d{5,25})?$/.exec(identity)?.[1] || name || identity;
