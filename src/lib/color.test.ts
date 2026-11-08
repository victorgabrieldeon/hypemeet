import { expect, test } from "bun:test";
import { assignPersonColors, PERSON_COLORS, personColor } from "./color";

test("everyone in a room gets their own colour, the same on every client", () => {
  const ids = Array.from({ length: 8 }, (_, i) => `p${i}#${(i * 2654435761).toString(16)}`);
  assignPersonColors(ids);
  const colours = ids.map(personColor);
  expect(new Set(colours).size).toBe(PERSON_COLORS.length);
  // Same join order elsewhere → same colours.
  assignPersonColors([...ids]);
  expect(ids.map(personColor)).toEqual(colours);
});

test("a ninth person repeats a colour instead of looping forever", () => {
  const ids = Array.from({ length: 9 }, (_, i) => `x${i}`);
  assignPersonColors(ids);
  expect(PERSON_COLORS).toContain(personColor("x8") as (typeof PERSON_COLORS)[number]);
});

test("outside a room the colour is the plain hash", () => {
  assignPersonColors([]);
  expect(personColor("K7QM2X")).toBe(personColor("K7QM2X"));
});
