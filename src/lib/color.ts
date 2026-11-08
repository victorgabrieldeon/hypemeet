import type { CSSProperties } from "react";

/**
 * Sticker colours for people, tuned to glow on the charcoal canvas. Grape (the brand accent) and
 * anything close to danger red stay out, so a person never reads as "selected" or as an alarm.
 * Every one takes dark text (--color-on-accent) at ≥7:1.
 */
export const PERSON_COLORS = [
  "#ff9b5e", // tangerine
  "#ff85c2", // bubblegum
  "#54dfb1", // mint
  "#ffd45e", // sun
  "#62c4ff", // sky
  "#b5e35c", // lime
  "#e89bff", // orchid
  "#e6c69a", // sand
] as const;

const hashIndex = (key: string) => {
  let hash = 0;
  for (const ch of key) hash = (hash * 31 + ch.codePointAt(0)!) | 0;
  return Math.abs(hash) % PERSON_COLORS.length;
};

/** Colours handed out in the current room, by identity (see assignPersonColors). */
let assigned = new Map<string, string>();

/**
 * Gives everyone in the room their own colour while there are colours left: in join order, each
 * person takes their hash colour, or the next free one if someone who joined earlier has it. Every
 * client sees the same server join order, so every screen shows the same colours. RoomView calls this
 * on each render, before its children read personColor.
 * shortcut: when someone leaves, people bumped past them (and anyone bumped by those) can change colour;
 * keeping old colours would split late joiners from everyone else. Fixed colours need the server to hand them out.
 */
export function assignPersonColors(identitiesInJoinOrder: string[]) {
  const next = new Map<string, string>();
  const taken = new Set<number>();
  for (const identity of identitiesInJoinOrder) {
    let i = hashIndex(identity);
    if (taken.size < PERSON_COLORS.length) while (taken.has(i)) i = (i + 1) % PERSON_COLORS.length;
    taken.add(i);
    next.set(identity, PERSON_COLORS[i]!);
  }
  assigned = next;
}

/** Someone's colour: their room colour, else (outside a room, e.g. a room's code) the plain hash. */
export const personColor = (key: string): string => assigned.get(key) ?? PERSON_COLORS[hashIndex(key)]!;

/** Sets --p for the person-* utilities in index.css. */
export const personStyle = (key: string) => ({ "--p": personColor(key) }) as CSSProperties;
