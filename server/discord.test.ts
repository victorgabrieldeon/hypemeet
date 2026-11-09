import { expect, test } from "bun:test";
import { createDiscord } from "./discord";

test("a 401 says whose token Discord turned down: the person's, not the bot's", async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response("{}", { status: 401 })) as unknown as typeof fetch;
  try {
    const discord = createDiscord();
    await expect(discord.userGuilds("400000", "t")).rejects.toMatchObject({ status: 401, userToken: true });
    await expect(discord.guild("100000")).rejects.toMatchObject({ status: 401, userToken: false });
  } finally {
    globalThis.fetch = realFetch;
  }
});
