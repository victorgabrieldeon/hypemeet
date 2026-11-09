import { expect, test } from "bun:test";
import type { Participant } from "livekit-client";
import { castOwnerOf } from "./cast";

// model.ts reads window at load (Region Capture), which bun doesn't have; removed after so other test files don't see it.
const g = globalThis as { window?: unknown };
const hadWindow = "window" in g;
g.window ??= globalThis;
const { discordAvatar, nameOf } = await import("./model");
if (!hadWindow) delete g.window;

const person = (identity: string, name = "", attributes: Record<string, string> = {}) =>
  ({ identity, name, attributes }) as unknown as Participant;

test("nameOf reads the nickname from the identity, not the self-written name", () => {
  expect(nameOf(person("Ana#1a2b3c4d", "Victor"))).toBe("Ana");
  expect(nameOf(person("Ana Paula#1a2b3c4d.123456789012345678", "Victor"))).toBe("Ana Paula");
  expect(nameOf(person("Ana#tx-1a2b3c4d", "Victor"))).toBe("Ana");
  expect(nameOf(person("a#b#1a2b3c4d"))).toBe("a#b");
  expect(nameOf(person("odd", "Bia"))).toBe("Bia");
  expect(nameOf({ identity: "odd" })).toBe("odd");
});

test("discordAvatar only takes that account's avatar on Discord's CDN", () => {
  const url = "https://cdn.discordapp.com/avatars/123456789/abc.png";
  expect(discordAvatar(person("Ana#1a2b3c4d.123456789", "", { avatar: url }))).toBe(url);
  expect(discordAvatar(person("Ana#1a2b3c4d.987654321", "", { avatar: url }))).toBeUndefined();
  expect(discordAvatar(person("Ana#1a2b3c4d.12345678", "", { avatar: url }))).toBeUndefined();
  expect(discordAvatar(person("Ana#1a2b3c4d", "", { avatar: url }))).toBeUndefined();
  expect(discordAvatar(person("Ana#1a2b3c4d.123456789", "", { avatar: "https://evil.example/a.png" }))).toBeUndefined();
});

test("castOwnerOf trusts castFor only on transmitter identities", () => {
  expect(castOwnerOf(person("Ana#tx-1a2b3c4d", "Ana", { castFor: "Ana#5e6f7a8b" }))).toBe("Ana#5e6f7a8b");
  expect(castOwnerOf(person("Mallory#1a2b3c4d", "", { castFor: "x" }))).toBeNull();
  expect(castOwnerOf(person("x#tx-1a2b3c4d#5e6f7a8b", "", { castFor: "x" }))).toBeNull();
  expect(castOwnerOf(person("Ana#tx-1a2b3c4d"))).toBeNull();
});
