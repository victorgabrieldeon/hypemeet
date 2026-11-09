import { expect, test } from "bun:test";
import { discordIdOf, isTransmitter, nicknameOf } from "./identity";

test("identities: the Discord id, transmitters and the nickname come from the identity, not the client's name", () => {
  expect(discordIdOf("Ana#1234abcd.400000")).toBe("400000");
  expect(discordIdOf("Ana#1234abcd")).toBeNull();
  expect(isTransmitter("Ana#tx-1234abcd")).toBe(true);
  // A guest can't name themselves into a transmitter (or a Discord id): the server's suffix comes last.
  for (const guest of ["x#tx-1234abcd#5678abcd", "x#1234abcd.400000#5678abcd"]) {
    expect(isTransmitter(guest)).toBe(false);
    expect(discordIdOf(guest)).toBeNull();
  }
  expect(nicknameOf("Ana#1234abcd.400000", "Victor")).toBe("Ana");
  expect(nicknameOf("A#na#1234abcd", "Victor")).toBe("A#na");
  expect(nicknameOf("Ana#tx-1234abcd")).toBe("Ana");
  expect(nicknameOf("x#tx-1234abcd#5678abcd")).toBe("x#tx-1234abcd");
  // Not one the server made: the name, then the identity itself.
  expect(nicknameOf("someone", "Bia")).toBe("Bia");
  expect(nicknameOf("someone")).toBe("someone");
});
