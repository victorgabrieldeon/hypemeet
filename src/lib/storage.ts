import { useSyncExternalStore } from "react";

export interface SavedRoom {
  code: string;
  name: string;
  lastJoinedAt: number;
}

const NICKNAME_KEY = "hypemeet:nickname";
const ROOMS_KEY = "hypemeet:rooms";
const MAX_SAVED = 30;

export const loadNickname = () => localStorage.getItem(NICKNAME_KEY) ?? "";
export const saveNickname = (nickname: string) => localStorage.setItem(NICKNAME_KEY, nickname);

// --- saved rooms: tiny external store so every mounted list stays in sync (incl. other tabs) ---

const listeners = new Set<() => void>();
let cache: SavedRoom[] | null = null;

function readRooms(): SavedRoom[] {
  if (cache) return cache;
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(ROOMS_KEY) ?? "[]");
    cache = Array.isArray(parsed)
      ? parsed.filter(
          (r): r is SavedRoom =>
            typeof r?.code === "string" && typeof r?.name === "string" && typeof r?.lastJoinedAt === "number",
        )
      : [];
  } catch {
    cache = [];
  }
  return cache;
}

function writeRooms(rooms: SavedRoom[]) {
  cache = rooms;
  localStorage.setItem(ROOMS_KEY, JSON.stringify(rooms));
  listeners.forEach((l) => l());
}

window.addEventListener("storage", (e) => {
  if (e.key !== ROOMS_KEY) return;
  cache = null;
  listeners.forEach((l) => l());
});

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useSavedRooms(): SavedRoom[] {
  return useSyncExternalStore(subscribe, readRooms);
}

/** Moves the room to the top of the list (or adds it), refreshing its name. */
export function rememberRoom(room: { code: string; name: string }) {
  const rest = readRooms().filter((r) => r.code !== room.code);
  writeRooms([{ code: room.code, name: room.name, lastJoinedAt: Date.now() }, ...rest].slice(0, MAX_SAVED));
}

export function forgetRoom(code: string) {
  writeRooms(readRooms().filter((r) => r.code !== code));
}
