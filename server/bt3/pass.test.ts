import { expect, test } from "bun:test";
import { createPasses, PASS_TTL_MS, passForToken, type RoomClaims } from "./pass";

let clock = 1_000_000;
const now = () => clock;
const passes = createPasses("secret", now);

test("pass: issued, verified, expires", async () => {
  clock = 1_000_000;
  const pass = await passes.issue("Ana#1234", "Ana");
  expect(pass).toMatch(/^[\w-]+\.[\w-]+$/);
  expect(await passes.verify(pass)).toEqual({ id: "Ana#1234", name: "Ana", exp: clock + PASS_TTL_MS });
  clock += PASS_TTL_MS - 1;
  expect(await passes.verify(pass)).not.toBeNull();
  clock += 1;
  expect(await passes.verify(pass)).toBeNull();
});

test("pass: tampered, another secret, another identity", async () => {
  clock = 1_000_000;
  const pass = await passes.issue("Ana#1234", "Ana");
  const [body, mac] = pass.split(".") as [string, string];
  // Someone else's identity with Ana's signature.
  const forged = Buffer.from(JSON.stringify({ id: "Bia#9999", name: "Bia", exp: clock + PASS_TTL_MS })).toString("base64url");
  expect(await passes.verify(`${forged}.${mac}`)).toBeNull();
  expect(await passes.verify(`${body}.${mac.slice(0, -2)}AA`)).toBeNull();
  expect(await passes.verify(`${body}.${mac}.x`)).toBeNull();
  expect(await passes.verify("garbage")).toBeNull();
  expect(await createPasses("other", now).verify(pass)).toBeNull();
  // Each identity gets its own.
  expect((await passes.verify(await passes.issue("Bia#9999", "Bia")))?.id).toBe("Bia#9999");
});

test("pass for a room token: only a valid one, of a room that exists, not a transmitter", async () => {
  const tokens: Record<string, RoomClaims> = {
    ok: { sub: "Ana#1234", name: "Ana", video: { room: "abc-defg-hij" } },
    gone: { sub: "Ana#1234", name: "Ana", video: { room: "old-room-xyz" } },
    cast: { sub: "Ana#tx-1", name: "Ana", video: { room: "abc-defg-hij" }, attributes: { castFor: "Ana#1234" } },
  };
  const deps = {
    verify: async (t: string) => {
      const claims = tokens[t];
      if (!claims) throw new Error("invalid token");
      return claims;
    },
    roomExists: (code: string) => code === "abc-defg-hij",
    passes,
  };
  clock = 1_000_000;
  const pass = await passForToken("ok", deps);
  expect((await passes.verify(pass!))?.name).toBe("Ana");
  expect(await passForToken("forged", deps)).toBeNull();
  expect(await passForToken("gone", deps)).toBeNull();
  expect(await passForToken("cast", deps)).toBeNull();
  expect(await passForToken(undefined, deps)).toBeNull();
});
